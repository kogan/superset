import { readlink, realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import {
	type DockerPort,
	dockerClient,
	isDockerPortProcess,
} from "./docker-ports.ts";
import { EXEC_TIMEOUT_MS, runTolerant } from "./exec.ts";
import type { KillFn } from "./port-manager.ts";
import {
	getListeningPortsForPids,
	type PortInfo,
	readProcessTable,
} from "./scanner.ts";
import type { DetectedPort } from "./types.ts";

export interface WorkspaceRoot {
	workspaceId: string;
	path: string;
}

export function workspacePortTerminalId(workspaceId: string): string {
	return `workspace-port:${workspaceId}`;
}

export function matchWorkspaceRoot(cwd: string, roots: WorkspaceRoot[]) {
	return roots
		.filter((root) => {
			const child = relative(root.path, cwd);
			return (
				child === "" ||
				(!isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`))
			);
		})
		.sort((a, b) => b.path.length - a.path.length)[0];
}

export async function readProcessDirectories(
	pids: number[],
): Promise<Map<number, string>> {
	const directories = new Map<number, string>();
	if (pids.length === 0) return directories;
	if (process.platform === "linux") {
		await Promise.all(
			pids.map(async (pid) => {
				try {
					directories.set(pid, await readlink(`/proc/${pid}/cwd`));
				} catch {}
			}),
		);
	} else if (process.platform === "darwin") {
		const output = await runTolerant(
			"lsof",
			["-a", "-p", pids.join(","), "-d", "cwd", "-Fpn"],
			{
				maxBuffer: 4 * 1024 * 1024,
				timeout: EXEC_TIMEOUT_MS,
			},
		);
		let pid: number | undefined;
		for (const line of output.split("\n")) {
			if (line.startsWith("p")) pid = Number(line.slice(1));
			else if (line.startsWith("n") && pid !== undefined)
				directories.set(pid, line.slice(1));
		}
	}
	return directories;
}

async function readWorkspaceProcesses() {
	const table = await readProcessTable();
	const ports = await getListeningPortsForPids(table.map(({ pid }) => pid));
	const directories = await readProcessDirectories([
		...new Set(ports.map(({ pid }) => pid)),
	]);
	return { ports, directories };
}

type ObservedPort = {
	port: DetectedPort;
	target: { kind: "process" } | { kind: "docker"; container: DockerPort };
};

// A server can outlive its terminal, or have been started before a worktree was adopted.
export class WorkspacePortScanner {
	private snapshot: {
		at: number;
		ports: PortInfo[];
		directories: Map<number, string>;
		dockerPorts: DockerPort[];
	} | null = null;
	private pending: Promise<
		NonNullable<WorkspacePortScanner["snapshot"]>
	> | null = null;
	private observed = new Map<string, ObservedPort>();

	constructor(
		private readonly sources = {
			readProcesses: readWorkspaceProcesses,
			docker: dockerClient,
		},
	) {}

	private async scan() {
		if (this.snapshot && Date.now() - this.snapshot.at < 2500)
			return this.snapshot;
		if (this.pending) return this.pending;
		this.pending = (async () => {
			const { ports, directories } = await this.sources.readProcesses();
			const dockerPorts = ports.some(isDockerPortProcess)
				? await this.sources.docker.readPorts().catch(() => [])
				: [];
			const snapshot = { at: Date.now(), ports, directories, dockerPorts };
			this.snapshot = snapshot;
			return snapshot;
		})();
		try {
			return await this.pending;
		} finally {
			this.pending = null;
		}
	}

	async getPorts(
		roots: WorkspaceRoot[],
		managedPorts: DetectedPort[],
	): Promise<DetectedPort[]> {
		const canonicalRoots = (
			await Promise.all(
				roots.map(async (root) => {
					try {
						return { ...root, path: await realpath(root.path) };
					} catch {
						return null;
					}
				}),
			)
		).filter((root) => root !== null);
		if (canonicalRoots.length === 0) return [];
		const snapshot = await this.scan();
		const containers = await Promise.all(
			snapshot.dockerPorts.map(async (container) => {
				try {
					return {
						...container,
						workingDirectory: await realpath(container.workingDirectory),
					};
				} catch {
					return null;
				}
			}),
		);
		const result = new Map<string, ObservedPort>();
		for (const info of snapshot.ports) {
			if ([22, 80, 443].includes(info.port)) continue;
			const docker = isDockerPortProcess(info);
			if (
				!docker &&
				managedPorts.some(
					(port) => port.pid === info.pid && port.port === info.port,
				)
			)
				continue;
			const candidates = docker
				? containers.filter(
						(container) =>
							container !== null &&
							container.port === info.port &&
							(container.address === info.address ||
								(info.address === "0.0.0.0" && container.address === "::")),
					)
				: [];
			const container = candidates[0];
			if (
				docker &&
				(!container ||
					candidates.some(
						(candidate) => candidate?.containerId !== container.containerId,
					))
			)
				continue;
			const cwd =
				container?.workingDirectory ?? snapshot.directories.get(info.pid);
			const root = cwd ? matchWorkspaceRoot(cwd, canonicalRoots) : undefined;
			if (!root) continue;
			const key = `${root.workspaceId}:${info.port}`;
			if (result.has(key)) continue;
			const port: DetectedPort = {
				...info,
				processName: container
					? `docker:${container.containerName}`
					: info.processName,
				workspaceId: root.workspaceId,
				terminalId: workspacePortTerminalId(root.workspaceId),
				detectedAt: this.observed.get(key)?.port.detectedAt ?? snapshot.at,
			};
			result.set(key, {
				port,
				target: container ? { kind: "docker", container } : { kind: "process" },
			});
		}
		this.observed = result;
		return [...result.values()].map(({ port }) => port);
	}

	async killPort({
		workspaceId,
		path,
		port,
		killFn,
	}: WorkspaceRoot & { port: number; killFn: KillFn }) {
		const observed = this.observed.get(`${workspaceId}:${port}`);
		if (!observed)
			return {
				success: false,
				error: "Refresh ports before closing this server",
			};
		try {
			const root = await realpath(path);
			if (observed.target.kind === "docker") {
				const { container } = observed.target;
				const current = (
					await this.sources.docker.readPorts(container.host)
				).find(
					(candidate) =>
						candidate.containerId === container.containerId &&
						candidate.port === port &&
						candidate.address === container.address,
				);
				if (current) {
					const cwd = await realpath(current.workingDirectory);
					if (!matchWorkspaceRoot(cwd, [{ workspaceId, path: root }]))
						return { success: false };
					await this.sources.docker.stopContainer(current);
				}
				this.snapshot = null;
				return { success: true };
			}
			const directories = await readProcessDirectories([observed.port.pid]);
			const cwd = directories.get(observed.port.pid);
			if (!cwd || !matchWorkspaceRoot(cwd, [{ workspaceId, path: root }]))
				return { success: false };
			const listeners = await getListeningPortsForPids([observed.port.pid]);
			if (
				!listeners.some(
					(info) =>
						info.port === port &&
						info.address === observed.port.address &&
						info.processName === observed.port.processName &&
						!isDockerPortProcess(info),
				)
			)
				return { success: false };
			const result = await killFn({ pid: observed.port.pid });
			if (result.success) {
				this.snapshot = null;
				this.observed.delete(`${workspaceId}:${port}`);
			}
			return result;
		} catch {
			return { success: false };
		}
	}
}
