import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { EXEC_TIMEOUT_MS } from "./exec.ts";
import type { PortInfo } from "./scanner.ts";

const execFileAsync = promisify(execFile);
const portNumber = z.coerce.number().int().min(1).max(65535);
const containerSchema = z.object({
	id: z.string().regex(/^[a-f0-9]{64}$/),
	name: z.string(),
	workingDirectory: z.string().nullable(),
	running: z.boolean(),
	ports: z
		.record(
			z.string(),
			z
				.array(z.object({ HostIp: z.string(), HostPort: portNumber }))
				.nullable(),
		)
		.nullable(),
});

export interface DockerPort {
	host: string;
	containerId: string;
	containerName: string;
	workingDirectory: string;
	port: number;
	address: string;
}

export function isDockerPortProcess({
	processName,
}: Pick<PortInfo, "processName">): boolean {
	return [
		"com.docker.backend",
		"com.docker.backend.exe",
		"vpnkit",
		"dockerd",
		"docker-proxy",
	].includes(processName);
}

export function isLocalDockerHost(host: string): boolean {
	return host.startsWith("unix:///") || host.startsWith("npipe:////./pipe/");
}

export function parseDockerPorts(output: string, host: string): DockerPort[] {
	if (!isLocalDockerHost(host)) return [];
	return output
		.split("\n")
		.filter(Boolean)
		.flatMap((line) => {
			const container = containerSchema.parse(JSON.parse(line));
			const { workingDirectory } = container;
			if (!container.running || !workingDirectory) return [];
			return Object.entries(container.ports ?? {}).flatMap(
				([target, bindings]) =>
					target.endsWith("/tcp")
						? (bindings ?? []).map((binding) => ({
								host,
								containerId: container.id,
								containerName: container.name.replace(/^\//, ""),
								workingDirectory,
								port: binding.HostPort,
								address: binding.HostIp || "0.0.0.0",
							}))
						: [],
			);
		});
}

async function runDocker(args: string[], timeout = EXEC_TIMEOUT_MS) {
	const env = { ...process.env };
	delete env.DOCKER_HOST;
	delete env.DOCKER_CONTEXT;
	const { stdout } = await execFileAsync("docker", args, {
		env,
		timeout,
		maxBuffer: 4 * 1024 * 1024,
	});
	return stdout.trim();
}

async function localDockerHost(): Promise<string> {
	if (!process.env.DOCKER_CONTEXT && process.env.DOCKER_HOST)
		return process.env.DOCKER_HOST;
	return runDocker([
		"context",
		"inspect",
		...(process.env.DOCKER_CONTEXT ? [process.env.DOCKER_CONTEXT] : []),
		"--format",
		"{{.Endpoints.docker.Host}}",
	]);
}

const CONTAINER_FORMAT =
	'{"id":{{json .Id}},"name":{{json .Name}},"workingDirectory":{{json (index .Config.Labels "com.docker.compose.project.working_dir")}},"running":{{json .State.Running}},"ports":{{json .NetworkSettings.Ports}}}';

export const dockerClient = {
	async readPorts(host?: string): Promise<DockerPort[]> {
		const endpoint = host ?? (await localDockerHost());
		if (!isLocalDockerHost(endpoint)) return [];
		const ids = (
			await runDocker([
				"--host",
				endpoint,
				"container",
				"ls",
				"--quiet",
				"--no-trunc",
			])
		)
			.split("\n")
			.filter(Boolean);
		if (ids.length === 0) return [];
		if (!ids.every((id) => /^[a-f0-9]{64}$/.test(id)))
			throw new Error("Invalid Docker container IDs");
		return parseDockerPorts(
			await runDocker([
				"--host",
				endpoint,
				"container",
				"inspect",
				"--format",
				CONTAINER_FORMAT,
				...ids,
			]),
			endpoint,
		);
	},
	async stopContainer({
		host,
		containerId,
	}: Pick<DockerPort, "host" | "containerId">) {
		if (!isLocalDockerHost(host) || !/^[a-f0-9]{64}$/.test(containerId))
			throw new Error("Invalid local Docker container");
		await runDocker(
			["--host", host, "container", "stop", "--time", "10", containerId],
			15000,
		);
	},
};
