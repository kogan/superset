import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { z } from "zod";

const MAX_MESSAGE_BYTES = 32 * 1024 * 1024;
const TIMEOUT_MS = 8_000;

const responseSchema = z
	.object({
		id: z.number(),
		method: z.never().optional(),
		result: z.unknown().optional(),
		error: z.object({ code: z.number(), message: z.string() }).optional(),
	})
	.refine((response) => "result" in response || "error" in response);

export type SpawnCodexProxy = (
	env: NodeJS.ProcessEnv,
) => ChildProcessWithoutNullStreams;

type PendingRequest = {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
};

export class CodexProxy {
	private nextId = 1;
	private buffer = "";
	private pending = new Map<number, PendingRequest>();
	private failure: Error | undefined;
	private deadline: ReturnType<typeof setTimeout>;
	private closed: Promise<void>;

	constructor(
		private child: ChildProcessWithoutNullStreams,
		timeoutMs: number,
	) {
		this.closed = new Promise((resolve) =>
			child.once("close", () => resolve()),
		);
		this.deadline = setTimeout(
			() => this.fail(new Error("Codex control connection timed out")),
			timeoutMs,
		);
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => this.receive(chunk));
		child.stderr.resume();
		child.on("error", () =>
			this.fail(new Error("Codex control is unavailable")),
		);
		child.stdin.on("error", () =>
			this.fail(new Error("Codex control disconnected")),
		);
		child.on("close", () => this.fail(new Error("Codex control disconnected")));
	}

	private fail(error: Error): void {
		this.failure ??= error;
		for (const request of this.pending.values()) request.reject(this.failure);
		this.pending.clear();
	}

	private receive(chunk: string): void {
		if (this.failure) return;
		this.buffer += chunk;
		if (Buffer.byteLength(this.buffer) > MAX_MESSAGE_BYTES) {
			this.fail(new Error("Codex control response is too large"));
			return;
		}
		let end = this.buffer.indexOf("\n");
		while (end >= 0) {
			const line = this.buffer.slice(0, end);
			this.buffer = this.buffer.slice(end + 1);
			if (line.trim()) {
				try {
					const response = responseSchema.safeParse(JSON.parse(line));
					if (response.success) {
						const request = this.pending.get(response.data.id);
						if (request) {
							this.pending.delete(response.data.id);
							if (response.data.error) {
								request.reject(new Error("Codex rejected the control request"));
							} else {
								request.resolve(response.data.result);
							}
						}
					}
				} catch {
					this.fail(new Error("Invalid Codex control response"));
				}
			}
			end = this.buffer.indexOf("\n");
		}
	}

	request(method: string, params: unknown): Promise<unknown> {
		if (this.failure) return Promise.reject(this.failure);
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
		});
	}

	notify(method: string): void {
		if (this.failure) throw this.failure;
		this.child.stdin.write(`${JSON.stringify({ method })}\n`);
	}

	async close(): Promise<void> {
		clearTimeout(this.deadline);
		this.fail(new Error("Codex control connection closed"));
		this.child.stdin.end();
		const terminate = setTimeout(() => this.child.kill("SIGTERM"), 100);
		const kill = setTimeout(() => this.child.kill("SIGKILL"), 500);
		try {
			await this.closed;
		} finally {
			clearTimeout(terminate);
			clearTimeout(kill);
		}
	}
}

export async function withCodexProxy<T>(
	input: {
		env: NodeJS.ProcessEnv;
		spawnProxy?: SpawnCodexProxy;
		timeoutMs?: number;
	},
	operation: (proxy: CodexProxy) => Promise<T>,
): Promise<T> {
	// A managed wrapper on PATH must not report this proxy's exit as its parent terminal's SessionEnd.
	const env = Object.fromEntries(
		Object.entries(input.env).filter(
			([key]) =>
				!key.startsWith("SUPERSET_") &&
				key !== "CODEX_TUI_RECORD_SESSION" &&
				key !== "CODEX_TUI_SESSION_LOG_PATH",
		),
	);
	const child = input.spawnProxy
		? input.spawnProxy(env)
		: spawn("codex", ["app-server", "proxy"], {
				env,
				stdio: "pipe",
			});
	const proxy = new CodexProxy(child, input.timeoutMs ?? TIMEOUT_MS);
	try {
		await proxy.request("initialize", {
			clientInfo: { name: "superset-subagent-control", version: "1.0.0" },
			capabilities: { experimentalApi: true, requestAttestation: false },
		});
		proxy.notify("initialized");
		return await operation(proxy);
	} finally {
		await proxy.close();
	}
}
