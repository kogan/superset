import { afterEach, describe, expect, test } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
