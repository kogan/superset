import { afterEach, describe, expect, test } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DockerPort } from "./docker-ports.ts";
import { matchWorkspaceRoot, WorkspacePortScanner } from "./workspace-ports.ts";

const children: ChildProcess[] = [];
const directories: string[] = [];
afterEach(async () => {
	for (const child of children.splice(0)) child.kill();
	for (const directory of directories.splice(0))
		await rm(directory, { recursive: true, force: true });
});

async function server() {
	const path = await mkdtemp(join(tmpdir(), "workspace-ports-"));
	directories.push(path);
	await mkdir(join(path, "frontend"));
	const child = spawn(
		"node",
		[
			"-e",
			'const s=require("net").createServer(); s.listen(0,"127.0.0.1",()=>console.log(s.address().port));',
		],
		{
			cwd: join(path, "frontend"),
			env: { PATH: process.env.PATH },
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	children.push(child);
	const port = await new Promise<number>((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", () =>
			reject(new Error("Server exited before listening")),
		);
		child.stdout?.once("data", (data) => resolve(Number(String(data).trim())));
	});
	return { path, port, child };
}

test("matches the deepest worktree and rejects sibling prefixes", () => {
	const roots = [
		{ workspaceId: "outer", path: "/repos/app" },
		{ workspaceId: "inner", path: "/repos/app/nested" },
	];
	expect(matchWorkspaceRoot("/repos/app/nested/src", roots)?.workspaceId).toBe(
		"inner",
	);
	expect(matchWorkspaceRoot("/repos/app-other", roots)).toBeUndefined();
});

async function dockerFixture() {
	const path = await mkdtemp(join(tmpdir(), "docker-worktree-ports-"));
	directories.push(path);
	const roots = ["incomm", "coinspot"].map((workspaceId) => ({
		workspaceId,
		path: join(path, workspaceId),
	}));
	for (const root of roots) await mkdir(root.path);
	let containers: DockerPort[] = roots.map((root, index) => ({
		host: "unix:///var/run/docker.sock",
		containerId: (index === 0 ? "a" : "b").repeat(64),
		containerName: `${root.workspaceId}-db`,
		workingDirectory: root.path,
		port: 5437 + index,
		address: "0.0.0.0",
	}));
	const stopped: string[] = [];
	const killed: number[] = [];
	let unavailable = false;
	const scanner = new WorkspacePortScanner({
		readProcesses: async () => ({
			ports: [5437, 5438, 6000].map((port) => ({
				port,
				address: "0.0.0.0",
				pid: 1000,
				processName: "com.docker.backend",
			})),
			directories: new Map([[1000, path]]),
		}),
		docker: {
			readPorts: async () => {
				if (unavailable) throw new Error("Docker unavailable");
				return containers;
			},
			stopContainer: async ({ containerId }) => {
				stopped.push(containerId);
				containers = containers.filter(
					(container) => container.containerId !== containerId,
				);
			},
		},
	});
	const close = (
		workspaceId: string,
		port: number,
		root = join(path, workspaceId),
	) =>
		scanner.killPort({
			workspaceId,
			path: root,
			port,
			killFn: async ({ pid }) => {
				killed.push(pid);
				return { success: true };
			},
		});
	return {
		scanner,
		roots,
		path,
		close,
		stopped,
		killed,
		setUnavailable: () => {
			unavailable = true;
		},
	};
}

test("assigns each Docker container to its own worktree, never the shared backend's directory", async () => {
	const { scanner, roots, path } = await dockerFixture();
	await symlink(join(path, "incomm"), join(path, "alias"));
	const ports = await scanner.getPorts(
		[
			{ workspaceId: "outer", path },
			...roots.map((root) =>
				root.workspaceId === "incomm"
					? { ...root, path: join(path, "alias") }
					: root,
			),
		],
		[],
	);
	expect(ports.map(({ port, workspaceId }) => ({ port, workspaceId }))).toEqual(
		[
			{ port: 5437, workspaceId: "incomm" },
			{ port: 5438, workspaceId: "coinspot" },
		],
	);
	expect(ports.map(({ processName }) => processName)).toEqual([
		"docker:incomm-db",
		"docker:coinspot-db",
	]);
});

test("closing a Docker port only stops the owning container and never signals the backend", async () => {
	const fixture = await dockerFixture();
	const { scanner, roots, close, stopped, killed, path } = fixture;
	await scanner.getPorts(roots, []);
	expect((await close("coinspot", 5437)).success).toBe(false);
	expect((await close("incomm", 5437, join(path, "coinspot"))).success).toBe(
		false,
	);
	expect(stopped).toEqual([]);
	expect((await close("incomm", 5437)).success).toBe(true);
	expect((await close("incomm", 5437)).success).toBe(true);
	expect(stopped).toEqual(["a".repeat(64)]);
	expect(killed).toEqual([]);
	expect((await scanner.getPorts(roots, [])).map(({ port }) => port)).toEqual([
		5438,
	]);
	fixture.setUnavailable();
	expect((await close("coinspot", 5438)).success).toBe(false);
	expect(stopped).toHaveLength(1);
});

test("Docker inspection failure never falls back to the daemon's worktree", async () => {
	const fixture = await dockerFixture();
	fixture.setUnavailable();
	expect(
		await fixture.scanner.getPorts(
			[{ workspaceId: "outer", path: fixture.path }, ...fixture.roots],
			[],
		),
	).toEqual([]);
});

describe.skipIf(process.platform !== "darwin" && process.platform !== "linux")(
	"worktree server discovery",
	() => {
		test("finds a server with no terminal metadata through a symlinked worktree", async () => {
			const { path, port } = await server();
			await symlink(path, join(path, "alias"));
			const scanner = new WorkspacePortScanner();
			const roots = [{ workspaceId: "adopted", path: join(path, "alias") }];
			const ports = await scanner.getPorts(roots, []);
			expect(ports.map((entry) => entry.port)).toEqual([port]);
			expect(ports[0]?.workspaceId).toBe("adopted");
			expect(await scanner.getPorts(roots, ports)).toEqual([]);
		}, 15000);

		test("validates the worktree and live listener before allowing a close", async () => {
			const { path, port, child } = await server();
			const scanner = new WorkspacePortScanner();
			await scanner.getPorts([{ workspaceId: "owned", path }], []);
			const killed: number[] = [];
			const killFn = async ({ pid }: { pid: number }) => {
				killed.push(pid);
				return { success: true };
			};
			expect(
				(
					await scanner.killPort({
						workspaceId: "owned",
						path: join(path, "missing"),
						port,
						killFn,
					})
				).success,
			).toBe(false);
			expect(
				(await scanner.killPort({ workspaceId: "other", path, port, killFn }))
					.success,
			).toBe(false);
			expect(killed).toEqual([]);
			expect(
				(await scanner.killPort({ workspaceId: "owned", path, port, killFn }))
					.success,
			).toBe(true);
			expect(killed).toHaveLength(1);
			expect(killed[0]).toBe(child.pid);
			child.kill();
			await new Promise((resolve) => child.once("exit", resolve));
			expect(
				(await scanner.killPort({ workspaceId: "owned", path, port, killFn }))
					.success,
			).toBe(false);
			expect(killed).toHaveLength(1);
		}, 15000);
	},
);
