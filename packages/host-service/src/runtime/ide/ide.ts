import { type ChildProcess, execFile, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import type { DetectedPort } from "@superset/port-scanner";
import { getTerminalBaseEnv, waitForTerminalBaseEnv } from "../../terminal/env";
import { installBranchChangesExtension } from "./branch-changes-extension";
import { ensureCodeServer, IdeUnavailableError } from "./code-server-runtime";
import {
	getIdeTheme,
	type IdeTheme,
	initializeIdeSettings,
	setIdeTheme,
} from "./default-settings";
import {
	connectedEditorSocket,
	type IdeFileTarget,
	ideFileArguments,
	resolveIdeFile,
} from "./open-file";
import { IDE_SUPERVISOR_SOURCE } from "./supervisor";

export interface IdeConnection {
	sessionId: string;
	port: number;
	password: string;
	folderPath: string;
}

export class IdeWorkspaceUnavailableError extends Error {
	constructor() {
		super("This workspace is missing or has been archived.");
		this.name = "IdeWorkspaceUnavailableError";
	}
}

interface RunningIde {
	connection: IdeConnection;
	supervisor: ChildProcess;
	exited: Promise<void>;
	sessionSocket: string;
	remoteCli: string;
}

const execFileAsync = promisify(execFile);

interface IdeEntry {
	abort: AbortController;
	ready: Promise<RunningIde>;
	running: RunningIde | null;
}

export interface WorkspaceIdeManagerOptions {
	dataDirectory: string;
	resolveWorkspace: (workspaceId: string) => string;
	runtimeExecutable?: string;
	socketRootDirectory?: string;
}

export class WorkspaceIdeManager {
	private readonly sessions = new Map<string, IdeEntry>();
	private closed = false;

	constructor(private readonly options: WorkspaceIdeManagerOptions) {}

	async getTheme(workspaceId: string): Promise<{ theme: IdeTheme | null }> {
		return {
			theme: await getIdeTheme(
				join(this.workspaceDirectory(workspaceId), "user-data"),
			),
		};
	}

	async setTheme(
		workspaceId: string,
		theme: IdeTheme,
	): Promise<{ theme: IdeTheme }> {
		await setIdeTheme(
			join(this.workspaceDirectory(workspaceId), "user-data"),
			theme,
		);
		return { theme };
	}

	private workspaceDirectory(workspaceId: string): string {
		this.options.resolveWorkspace(workspaceId);
		return join(
			this.options.dataDirectory,
			"workspaces",
			createHash("sha256").update(workspaceId).digest("hex"),
		);
	}

	async start(workspaceId: string): Promise<IdeConnection> {
		if (this.closed)
			throw new IdeUnavailableError("The host is shutting down.");
		this.options.resolveWorkspace(workspaceId);
		const existing = this.sessions.get(workspaceId);
		if (existing) {
			if (existing.abort.signal.aborted) {
				await this.stop(workspaceId);
				return this.start(workspaceId);
			}
			return (await existing.ready).connection;
		}
		const abort = new AbortController();
		const entry: IdeEntry = {
			abort,
			running: null,
			ready: Promise.resolve().then(() =>
				this.launch(workspaceId, abort.signal),
			),
		};
		this.sessions.set(workspaceId, entry);
		try {
			const running = await entry.ready;
			entry.running = running;
			void running.exited.then(() => {
				if (this.sessions.get(workspaceId) === entry) {
					this.sessions.delete(workspaceId);
				}
			});
			return running.connection;
		} catch (error) {
			if (this.sessions.get(workspaceId) === entry) {
				this.sessions.delete(workspaceId);
			}
			if (abort.signal.aborted)
				throw new IdeUnavailableError("IDE startup was cancelled.");
			throw error;
		}
	}

	async stop(workspaceId: string): Promise<void> {
		const entry = this.sessions.get(workspaceId);
		if (!entry) return;
		entry.abort.abort();
		try {
			const running = await entry.ready;
			running.supervisor.kill("SIGTERM");
			await running.exited;
		} catch {
			// A failed or cancelled launch has already reaped its child.
		} finally {
			if (this.sessions.get(workspaceId) === entry) {
				this.sessions.delete(workspaceId);
			}
		}
	}

	async openFile(
		workspaceId: string,
		target: IdeFileTarget,
	): Promise<{ opened: true }> {
		const folder = this.options.resolveWorkspace(workspaceId);
		const file = await resolveIdeFile(folder, target.path);
		await this.start(workspaceId);
		const entry = this.sessions.get(workspaceId);
		if (!entry)
			throw new IdeUnavailableError(
				"The IDE stopped before the file could be opened.",
			);
		const running = await entry.ready;
		const deadline = Date.now() + 20_000;
		while (Date.now() < deadline && !entry.abort.signal.aborted) {
			const socket = await connectedEditorSocket(
				running.sessionSocket,
				file,
				entry.abort.signal,
			).catch(() => undefined);
			if (socket) {
				const environment = getTerminalBaseEnv();
				delete environment.VSCODE_CLIENT_COMMAND;
				delete environment.VSCODE_CLI_AUTHORITY;
				delete environment.NODE_EXEC_PATH;
				try {
					const result = await execFileAsync(
						running.remoteCli,
						ideFileArguments(file, target),
						{
							cwd: folder,
							env: { ...environment, VSCODE_IPC_HOOK_CLI: socket },
							signal: entry.abort.signal,
							timeout: 10_000,
							maxBuffer: 128 * 1024,
						},
					);
					if (result.stderr.trim()) throw new Error(result.stderr.trim());
					return { opened: true };
				} catch (error) {
					throw new IdeUnavailableError(
						`Could not open the file in the IDE: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}
			await delay(200);
		}
		throw new IdeUnavailableError(
			"The IDE is still connecting. Keep its pane open and try again.",
		);
	}

	getForwardPorts(workspaceId: string): DetectedPort[] {
		const entry = this.sessions.get(workspaceId);
		const running = entry?.running;
		if (
			!running ||
			entry?.abort.signal.aborted ||
			running.supervisor.exitCode !== null ||
			running.supervisor.signalCode !== null
		)
			return [];
		return [
			{
				port: running.connection.port,
				pid: running.supervisor.pid ?? 0,
				processName: "code-server",
				terminalId: `ide:${running.connection.sessionId}`,
				workspaceId,
				detectedAt: 0,
				address: "127.0.0.1",
			},
		];
	}

	async close(): Promise<void> {
		this.closed = true;
		await Promise.all([...this.sessions.keys()].map((id) => this.stop(id)));
	}

	private async launch(
		workspaceId: string,
		signal: AbortSignal,
	): Promise<RunningIde> {
		const executable =
			this.options.runtimeExecutable ??
			(await abortable(
				ensureCodeServer(join(this.options.dataDirectory, "runtime")),
				signal,
			));
		signal.throwIfAborted();
		const folderPath = this.options.resolveWorkspace(workspaceId);
		try {
			if (!(await stat(folderPath)).isDirectory())
				throw new Error("Not a directory.");
		} catch {
			throw new IdeUnavailableError(
				"The worktree folder is not available on this host.",
			);
		}
		const workspaceDirectory = this.workspaceDirectory(workspaceId);
		await mkdir(workspaceDirectory, { recursive: true, mode: 0o700 });
		const config = join(workspaceDirectory, "config.yaml");
		await writeFile(config, "{}\n", { mode: 0o600 });
		await initializeIdeSettings(join(workspaceDirectory, "user-data"));
		await waitForTerminalBaseEnv();
		const environment = getTerminalBaseEnv();
		delete environment.HASHED_PASSWORD;
		delete environment.PORT;
		delete environment.CODE_SERVER_CONFIG;
		delete environment.CODE_SERVER_SESSION_SOCKET;
		delete environment.VSCODE_IPC_HOOK_CLI;
		await installBranchChangesExtension({
			executable,
			extensionsDirectory: join(workspaceDirectory, "extensions"),
			userDataDirectory: join(workspaceDirectory, "user-data"),
			config,
			environment,
			signal,
		});
		for (let attempt = 0; attempt < 3; attempt++) {
			signal.throwIfAborted();
			const connection: IdeConnection = {
				sessionId: randomUUID(),
				port: await availablePort(),
				password: randomBytes(32).toString("base64url"),
				folderPath,
			};
			const socketDirectory = await mkdtemp(
				join(this.options.socketRootDirectory ?? "/tmp", "superset-ide-"),
			);
			const sessionSocket = join(socketDirectory, "session.sock");
			const supervisor = spawn(
				process.execPath,
				["-e", IDE_SUPERVISOR_SOURCE],
				{
					env: {
						...environment,
						PASSWORD: connection.password,
						...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
					},
					stdio: ["ignore", "pipe", "pipe", "ipc"],
				},
			);
			let output = "";
			const appendOutput = (chunk: Buffer) => {
				output = (output + chunk.toString()).slice(-4000);
			};
			supervisor.stdout?.on("data", appendOutput);
			supervisor.stderr?.on("data", appendOutput);
			const launchState: { error: Error | null } = { error: null };
			const exited = new Promise<void>((resolve) => {
				supervisor.once("exit", () => resolve());
				supervisor.once("error", (error) => {
					launchState.error = error;
					resolve();
				});
			}).then(async () => {
				try {
					await rm(socketDirectory, { recursive: true, force: true });
				} catch (error) {
					console.warn(
						"[ide] Could not remove retired session socket directory",
						error,
					);
				}
			});
			supervisor.send(
				{
					executable,
					cwd: folderPath,
					socketDirectory,
					args: [
						"--config",
						config,
						"--bind-addr",
						`127.0.0.1:${connection.port}`,
						"--auth",
						"password",
						"--cookie-suffix",
						connection.sessionId,
						"--session-socket",
						sessionSocket,
						"--user-data-dir",
						join(workspaceDirectory, "user-data"),
						"--extensions-dir",
						join(workspaceDirectory, "extensions"),
						"--disable-telemetry",
						"--disable-update-check",
						folderPath,
					],
				},
				(error) => {
					if (error) launchState.error = error;
				},
			);
			try {
				const deadline = Date.now() + 45_000;
				while (Date.now() < deadline) {
					signal.throwIfAborted();
					if (
						launchState.error ||
						supervisor.exitCode !== null ||
						supervisor.signalCode !== null
					) {
						throw new Error(
							launchState.error?.message ??
								"The IDE process exited during startup.",
						);
					}
					const ready = await fetch(
						`http://127.0.0.1:${connection.port}/login`,
						{
							method: "POST",
							body: new URLSearchParams({ password: connection.password }),
							redirect: "manual",
							signal: AbortSignal.any([signal, AbortSignal.timeout(1500)]),
						},
					)
						.then(async (response) => {
							const authenticated =
								response.status === 302 && response.headers.has("set-cookie");
							await response.body?.cancel();
							return authenticated;
						})
						.catch(() => false);
					if (ready) {
						signal.throwIfAborted();
						this.options.resolveWorkspace(workspaceId);
						return {
							connection,
							supervisor,
							exited,
							sessionSocket,
							remoteCli: join(
								dirname(dirname(executable)),
								"lib",
								"vscode",
								"bin",
								"remote-cli",
								"code-server",
							),
						};
					}
					await delay(100, undefined, { signal });
				}
				throw new Error("The IDE did not become ready within 45 seconds.");
			} catch (error) {
				supervisor.kill("SIGTERM");
				await exited;
				if (!signal.aborted && output.includes("EADDRINUSE") && attempt < 2)
					continue;
				if (signal.aborted)
					throw new IdeUnavailableError("IDE startup was cancelled.");
				const detail = output
					.replaceAll(connection.password, "[redacted]")
					.trim();
				throw new IdeUnavailableError(
					`Could not start the IDE: ${error instanceof Error ? error.message : String(error)}${detail ? `\n${detail}` : ""}`,
					{ cause: error },
				);
			}
		}
		throw new IdeUnavailableError("Could not allocate an IDE port.");
	}
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	return new Promise((resolve, reject) => {
		const onAbort = () =>
			reject(new IdeUnavailableError("IDE startup was cancelled."));
		promise
			.then(resolve, reject)
			.finally(() => signal.removeEventListener("abort", onAbort));
		if (signal.aborted) {
			onAbort();
			return;
		}
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

function availablePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close();
				reject(new Error("Could not allocate an IDE port."));
				return;
			}
			server.close((error) => (error ? reject(error) : resolve(address.port)));
		});
	});
}
