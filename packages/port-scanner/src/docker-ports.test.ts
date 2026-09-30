import { describe, expect, test } from "bun:test";
import {
	dockerClient,
	isLocalDockerHost,
	parseDockerPorts,
} from "./docker-ports.ts";

const host = "unix:///var/run/docker.sock";
const container = {
	id: "a".repeat(64),
	name: "/incomm-db-1",
	workingDirectory: "/worktrees/incomm",
	running: true,
	ports: {
		"5432/tcp": [{ HostIp: "0.0.0.0", HostPort: "5437" }],
		"5432/udp": [{ HostIp: "0.0.0.0", HostPort: "6000" }],
		"8080/tcp": null,
	},
};

test("reads published TCP bindings and Compose worktree ownership", () => {
	expect(parseDockerPorts(JSON.stringify(container), host)).toEqual([
		{
			host,
			containerId: container.id,
			containerName: "incomm-db-1",
			workingDirectory: "/worktrees/incomm",
			port: 5437,
			address: "0.0.0.0",
		},
	]);
});

test("does not infer ownership for stopped, unlabelled, or unpublished containers", () => {
	for (const change of [
		{ running: false },
		{ workingDirectory: null },
		{ workingDirectory: "" },
		{ ports: null },
	]) {
		expect(
			parseDockerPorts(JSON.stringify({ ...container, ...change }), host),
		).toEqual([]);
	}
	expect(() =>
		parseDockerPorts(JSON.stringify({ ...container, id: "--all" }), host),
	).toThrow();
});

describe("Docker endpoint isolation", () => {
	test("only accepts local Unix sockets or the local Windows pipe", async () => {
		expect(isLocalDockerHost(host)).toBe(true);
		expect(isLocalDockerHost("npipe:////./pipe/docker_engine")).toBe(true);
		for (const endpoint of [
			"ssh://server",
			"tcp://127.0.0.1:2375",
			"npipe:////server/pipe/docker_engine",
		]) {
			expect(isLocalDockerHost(endpoint)).toBe(false);
			expect(await dockerClient.readPorts(endpoint)).toEqual([]);
			await expect(
				dockerClient.stopContainer({
					host: endpoint,
					containerId: container.id,
				}),
			).rejects.toThrow();
		}
	});
});
