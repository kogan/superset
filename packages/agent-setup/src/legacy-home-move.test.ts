import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	moveLegacyAppHome,
	repairGitWorktrees,
	rewriteLegacyHomePaths,
} from "./legacy-home-move";
import { APP_HOME_DIR_NAME, isDefaultAppHomeDir } from "./paths";

let home: string;
const originalHome = process.env.HOME;

beforeEach(() => {
	home = realpathSync(mkdtempSync(path.join(tmpdir(), "legacy-home-")));
	process.env.HOME = home;
});

afterEach(() => {
	rmSync(home, { recursive: true, force: true });
	process.env.HOME = originalHome;
});

const appHome = () => path.join(home, APP_HOME_DIR_NAME);
const superset = () => path.join(home, ".superset");

function write(file: string, content: string) {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, content);
}

describe("moveLegacyAppHome", () => {
	it("uses the app home on a fresh machine", () => {
		const env: NodeJS.ProcessEnv = {};

		expect(moveLegacyAppHome(env)).toEqual({
			homeDir: appHome(),
			move: "nothing-to-move",
		});
		expect(env.SUPERSET_HOME_DIR).toBe(appHome());
	});

	it("uses the app home and leaves the official app's ~/.superset alone", () => {
		write(path.join(superset(), "local.db"), "official");
		write(path.join(appHome(), "local.db"), "ours");
		const env: NodeJS.ProcessEnv = { SUPERSET_HOME_DIR: appHome() };

		expect(moveLegacyAppHome(env).homeDir).toBe(appHome());
		expect(env.SUPERSET_HOME_DIR).toBe(appHome());
		expect(lstatSync(superset()).isDirectory()).toBe(true);
		expect(readFileSync(path.join(superset(), "local.db"), "utf8")).toBe(
			"official",
		);
		expect(readFileSync(path.join(appHome(), "local.db"), "utf8")).toBe("ours");
	});

	it("does not take over ~/.superset when the app home does not exist yet", () => {
		write(path.join(superset(), "local.db"), "official");

		expect(moveLegacyAppHome({}).homeDir).toBe(appHome());
		expect(lstatSync(superset()).isDirectory()).toBe(true);
		expect(existsSync(appHome())).toBe(false);
	});

	it("leaves a custom home alone", () => {
		const custom = path.join(home, "dev-data");

		expect(moveLegacyAppHome({ SUPERSET_HOME_DIR: custom })).toEqual({
			homeDir: custom,
			move: "custom-home",
		});
	});

	it("never runs under a test runner", () => {
		expect(moveLegacyAppHome({ NODE_ENV: "test" }).move).toBe("test-runner");
	});
});

describe("rewriteLegacyHomePaths", () => {
	it("rewrites paths under the old home and nothing else", () => {
		const db = new Database(":memory:");
		db.run("CREATE TABLE workspaces (worktree_path TEXT)");
		for (const value of [
			"/u/.superset/worktrees/app/main",
			"/u/.superset",
			"/u/.superset-dev/worktrees/x",
			"/u/code/app",
			null,
		]) {
			db.prepare("INSERT INTO workspaces VALUES (?)").run(value);
		}
		const move = { from: "/u/.superset", to: "/u/.paradev" };

		expect(
			rewriteLegacyHomePaths(db, [["workspaces", "worktree_path"]], move),
		).toBe(2);
		expect(
			db
				.query("SELECT worktree_path AS p FROM workspaces")
				.all()
				.map((row) => (row as { p: string | null }).p),
		).toEqual([
			"/u/.paradev/worktrees/app/main",
			"/u/.paradev",
			"/u/.superset-dev/worktrees/x",
			"/u/code/app",
			null,
		]);
		expect(
			rewriteLegacyHomePaths(db, [["workspaces", "worktree_path"]], move),
		).toBe(0);
	});
});

describe("repairGitWorktrees", () => {
	it("points git at a moved worktree past a deleted one", async () => {
		const repo = path.join(home, "repo");
		const git = (...args: string[]) =>
			execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
		mkdirSync(repo);
		git("init", "-q");
		git(
			"-c",
			"user.email=t@t",
			"-c",
			"user.name=t",
			"commit",
			"-q",
			"--allow-empty",
			"-m",
			"x",
		);
		const before = path.join(home, "old", "wt");
		const after = path.join(home, "new", "wt");
		git("worktree", "add", "-q", before);
		mkdirSync(path.dirname(after));
		renameSync(before, after);

		await repairGitWorktrees(
			[
				{ repoPath: repo, worktreePath: path.join(home, "deleted", "wt") },
				{ repoPath: repo, worktreePath: after },
			],
			path.join(home, "old"),
		);

		expect(git("worktree", "list", "--porcelain")).toContain(
			`worktree ${after}`,
		);
	});
});

describe("isDefaultAppHomeDir", () => {
	it("counts the app home and a link to it, but not ~/.superset", () => {
		mkdirSync(appHome());
		mkdirSync(superset());
		const link = path.join(home, "home-link");
		symlinkSync(APP_HOME_DIR_NAME, link);

		expect(isDefaultAppHomeDir(appHome())).toBe(true);
		expect(isDefaultAppHomeDir(link)).toBe(true);
		expect(isDefaultAppHomeDir(superset())).toBe(false);
	});
});
