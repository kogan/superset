import { afterEach, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { BRANCH_CHANGES_SOURCE } from "./branch-changes-extension";

const exec = promisify(execFile);
const roots: string[] = [];
interface Snapshot {
	branch: string;
	baseRef: string;
	mergeBase: string;
	files: { status: string; path: string; originalPath: string }[];
}
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "ide-branch-changes-"));
	roots.push(root);
	const git = (...args: string[]) => exec("git", args, { cwd: root });
	await git("init", "-b", "main");
	await git("config", "user.email", "ide-test@example.com");
	await git("config", "user.name", "IDE Test");
	await writeFile(join(root, "modified.ts"), "export const value = 1;\n");
	await writeFile(join(root, "removed.py"), "print('old')\n");
	await writeFile(join(root, "old name.ts"), "export const rename = true;\n");
	await git("add", ".");
	await git("commit", "-m", "base");
	await git("checkout", "-b", "feature");
	await git("config", "branch.feature.base", "main");
	const extensions = join(root, ".extensions");
	await writeFile(join(root, ".git", "info", "exclude"), ".extensions/\n");
	await writeFile(join(root, "extension.cjs"), BRANCH_CHANGES_SOURCE);
	await git("config", "core.excludesFile", join(root, ".git/info/exclude"));
	await writeFile(
		join(root, ".git/info/exclude"),
		".extensions/\nextension.cjs\n",
	);
	const api: { readBranchChanges: (root: string) => Promise<Snapshot> } =
		createRequire(import.meta.url)(join(root, "extension.cjs"));
	return {
		root,
		git,
		read: () => api.readBranchChanges(root),
		api,
		extensions,
	};
}
afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("IDE branch changes, using real Git worktrees", () => {
	test("shows committed changes with a clean working tree, then includes local edits", async () => {
		const { root, git, read } = await fixture();
		await writeFile(join(root, "modified.ts"), "export const value = 2;\n");
		await git("rm", "removed.py");
		await git("mv", "old name.ts", "renamed # ü.ts");
		await git("add", ".");
		await git("commit", "-m", "branch changes");
		expect((await git("status", "--porcelain")).stdout).toBe("");
		const committed = await read();
		expect(committed.baseRef).toBe("main");
		expect(committed.files).toEqual([
			{ status: "M", path: "modified.ts", originalPath: "modified.ts" },
			{ status: "D", path: "removed.py", originalPath: "removed.py" },
			{ status: "R", path: "renamed # ü.ts", originalPath: "old name.ts" },
		]);
		await writeFile(join(root, "untracked\nfile.py"), "print('new')\n");
		await writeFile(join(root, "modified.ts"), "export const value = 3;\n");
		expect((await read()).files).toHaveLength(4);
		await git("add", "untracked\nfile.py");
		expect(
			(await read()).files.find((file) => file.path === "untracked\nfile.py")
				?.status,
		).toBe("A");
	});

	test("uses the merge base and the configured base branch's upstream", async () => {
		const { root, git, read } = await fixture();
		await git("config", "branch.main.remote", "upstream");
		await git("config", "branch.main.merge", "refs/heads/develop");
		await git("update-ref", "refs/remotes/upstream/develop", "main");
		await writeFile(join(root, "modified.ts"), "feature change\n");
		await git("commit", "-am", "feature");
		await git("checkout", "main");
		await writeFile(join(root, "base-only.txt"), "base branch advanced\n");
		await git("add", ".");
		await git("commit", "-m", "base advanced");
		await git("update-ref", "refs/remotes/upstream/develop", "main");
		await git("checkout", "feature");
		const result = await read();
		expect(result.baseRef).toBe("upstream/develop");
		expect(result.files.map((file) => file.path)).toEqual(["modified.ts"]);
	});

	test("isolates linked worktrees and refreshes after external edits", async () => {
		const { root, git, read, api } = await fixture();
		const other = `${root}-linked`;
		roots.push(other);
		await git("worktree", "add", "-b", "other", other, "main");
		await writeFile(join(other, "modified.ts"), "other worktree\n");
		expect((await read()).files).toEqual([]);
		expect(
			(await api.readBranchChanges(other)).files.map((file) => file.path),
		).toEqual(["modified.ts"]);
		await writeFile(join(other, "modified.ts"), "export const value = 1;\n");
		expect((await api.readBranchChanges(other)).files).toEqual([]);
	});

	test("does not execute repository fsmonitor or external diff programs", async () => {
		const { root, git, read } = await fixture();
		const marker = join(root, "executed");
		await git("config", "core.fsmonitor", `touch '${marker}'`);
		await git("config", "diff.external", `touch '${marker}'`);
		await writeFile(join(root, "modified.ts"), "changed\n");
		expect((await read()).files).toHaveLength(1);
		expect(await readFile(marker, "utf8").catch(() => null)).toBeNull();
	});

	test("fails visibly for an unavailable explicit base instead of using an unrelated one", async () => {
		const { git, read } = await fixture();
		await git("config", "branch.feature.base", "missing");
		await expect(read()).rejects.toThrow("Choose an available base branch");
	});
});
