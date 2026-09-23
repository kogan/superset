import { afterEach, expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ideFileArguments, resolveIdeFile } from "./open-file";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

test("resolves only regular files inside the actual worktree, including symlink checks", async () => {
	const root = await mkdtemp(join(tmpdir(), "ide-files-test-"));
	directories.push(root);
	const workspace = join(root, "worktree");
	await mkdir(workspace);
	await writeFile(join(workspace, "file.ts"), "test");
	await writeFile(join(root, "secret.txt"), "outside");
	await symlink(join(root, "secret.txt"), join(workspace, "escape"));
	expect(await resolveIdeFile(workspace, "file.ts")).toBe(
		await realpath(join(workspace, "file.ts")),
	);
	await expect(
		resolveIdeFile(workspace, "../secret.txt"),
	).rejects.toMatchObject({ code: "FORBIDDEN" });
	await expect(resolveIdeFile(workspace, "escape")).rejects.toMatchObject({
		code: "FORBIDDEN",
	});
	await expect(resolveIdeFile(workspace, ".")).rejects.toMatchObject({
		code: "BAD_REQUEST",
	});
	await expect(resolveIdeFile(workspace, "missing")).rejects.toMatchObject({
		code: "NOT_FOUND",
	});
});

test("encodes special filenames without interpreting trailing numeric colons as a location", () => {
	const file = "/tmp/project/report #draft?:12";
	const args = ideFileArguments(file, { path: file });
	expect(args).not.toContain("--goto");
	expect(fileURLToPath(args.at(-1) ?? "")).toBe(file);
	const located = ideFileArguments(file, { path: file, line: 4, column: 6 });
	expect(located).toContain("--goto");
	expect(fileURLToPath(located.at(-1) ?? "")).toBe(`${file}:4:6`);
});

test("opens workspace configuration as a text file instead of changing the workspace", () => {
	const file = "/tmp/project/settings.code-workspace";
	const args = ideFileArguments(file, { path: file });
	expect(args).toContain("--goto");
	expect(fileURLToPath(args.at(-1) ?? "")).toBe(`${file}:1:1`);
});
