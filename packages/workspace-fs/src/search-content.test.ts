import { afterEach, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { invalidateAllSearchIndexes, searchContent } from "./search";

const execute = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
	invalidateAllSearchIndexes();
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "content-search-"));
	roots.push(root);
	await execute("git", ["init", "-q", root]);
	await mkdir(join(root, "src"));
	await writeFile(
		join(root, "src/example.ts"),
		"const heading = 'hello';\nconst message = '你好 😀 needle';\nconst option = '--needle';\n",
	);
	await writeFile(join(root, "src/excluded.ts"), "needle\n");
	await writeFile(join(root, ".hidden"), "needle\n");
	await writeFile(join(root, ".gitignore"), "ignored.txt\n");
	await writeFile(join(root, "ignored.txt"), "needle\n");
	return root;
}

test("content results use editor columns for Unicode and return literal hyphenated queries", async () => {
	const rootPath = await fixture();
	let ripgrepCompleted = 0;
	const runRipgrep = async (
		args: string[],
		options: { cwd: string; maxBuffer: number },
	) => {
		const result = await execute("rg", args, options);
		ripgrepCompleted++;
		return { stdout: result.stdout };
	};
	const matches = await searchContent({
		rootPath,
		query: "needle",
		includePattern: "src/example.ts",
		runRipgrep,
	});
	expect(matches.find((match) => match.line === 2)?.column).toBe(
		"const message = '你好 😀 ".length + 1,
	);
	const hyphen = await searchContent({
		rootPath,
		query: "--needle",
		runRipgrep,
	});
	expect(hyphen).toHaveLength(1);
	expect(hyphen[0]).toMatchObject({
		relativePath: "src/example.ts",
		line: 3,
		column: 17,
	});
	expect(ripgrepCompleted).toBe(2);
});

test("content search applies include and exclude filters, hides ignored files and stays within its workspace", async () => {
	const rootPath = await fixture();
	const otherRoot = await fixture();
	await writeFile(join(otherRoot, "other.ts"), "needle\n");
	const matches = await searchContent({
		rootPath,
		query: "needle",
		includeHidden: false,
		includePattern: "src/**",
		excludePattern: "**/excluded.ts",
	});
	expect(matches.map((match) => match.line)).toEqual([2, 3]);
	expect(
		matches.every(
			(match) => match.absolutePath === join(rootPath, "src/example.ts"),
		),
	).toBe(true);
	const visible = await searchContent({
		rootPath,
		query: "needle",
		includeHidden: false,
	});
	expect(
		visible.some(
			(match) =>
				match.relativePath === "ignored.txt" ||
				match.relativePath === ".hidden",
		),
	).toBe(false);
	expect(
		await searchContent({ rootPath, query: "missing search text" }),
	).toEqual([]);
});

test("previews keep a match visible near the end of a long line", async () => {
	const rootPath = await fixture();
	await writeFile(
		join(rootPath, "long.ts"),
		`${"x".repeat(300)} needle ${"y".repeat(300)}\n`,
	);
	const matches = await searchContent({
		rootPath,
		query: "needle",
		includePattern: "long.ts",
	});
	expect(matches[0]?.preview).toContain("needle");
	expect(matches[0]?.column).toBe(302);
	expect(matches[0]?.preview.length).toBeLessThanOrEqual(160);
});
