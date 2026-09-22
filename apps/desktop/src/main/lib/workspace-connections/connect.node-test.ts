import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
	createDb,
	externalWorkspacePaths,
	projects,
	terminalSessions,
	workspaces,
} from "@superset/host-service/db";
import { eq } from "drizzle-orm";
import {
	connectWorkspaceSources,
	discoverWorkspaceSources,
	inspectWorkspaceSource,
	workspacePathId,
} from "./connect";

const migrationsFolder = resolve("../../packages/host-service/drizzle");
const git = (cwd: string, ...args: string[]) =>
	execFileSync("/usr/bin/git", ["-C", cwd, ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
	}).trim();

function fixture() {
	const root = realpathSync(
		mkdtempSync(join(tmpdir(), "superset-connections-")),
	);
	const sourceHome = join(root, ".superset");
	const dataDir = join(root, "fork");
	const repo = join(root, "repository");
	const checkout = join(sourceHome, "worktrees", "feature");
	mkdirSync(repo);
	mkdirSync(dataDir);
	git(repo, "init", "--initial-branch=main");
	git(repo, "config", "user.name", "Fixture");
	git(repo, "config", "user.email", "fixture@example.com");
	writeFileSync(join(repo, "file"), "initial\n");
	writeFileSync(join(repo, ".gitignore"), ".env\nnode_modules/\n");
	git(repo, "add", ".");
	git(repo, "commit", "-m", "initial");
	git(repo, "worktree", "add", "-b", "feature", checkout);
	writeFileSync(join(checkout, "file"), "staged\n");
	git(checkout, "add", "file");
	writeFileSync(join(checkout, "file"), "unstaged\n");
	writeFileSync(join(checkout, "untracked"), "keep\n");
	writeFileSync(join(checkout, ".env"), "LOCAL_FIXTURE=value\n");
	mkdirSync(join(checkout, "node_modules"));
	writeFileSync(join(checkout, "node_modules", "fixture"), "dependencies\n");
	const projectId = randomUUID();
	const sourceDbPath = join(sourceHome, "host", randomUUID(), "host.db");
	const sourceDb = createDb(sourceDbPath, migrationsFolder);
	sourceDb
		.insert(projects)
		.values({ id: projectId, repoPath: repo, name: "Project" })
		.run();
	for (const [path, branch, type] of [
		[repo, "main", "local"],
		[checkout, "feature", "worktree"],
	] as const) {
		sourceDb
			.insert(workspaces)
			.values({
				id: randomUUID(),
				projectId,
				worktreePath: path,
				branch,
				type,
				name: branch,
			})
			.run();
	}
	sourceDb.$client.close();
	const options = {
		dataDir,
		organizationId: randomUUID(),
		userId: randomUUID(),
		migrationsFolder,
	};
	const targetDbPath = join(dataDir, "host", options.organizationId, "host.db");
	return {
		root,
		sourceHome,
		dataDir,
		repo,
		checkout,
		sourceDbPath,
		options,
		targetDbPath,
	};
}

test("connects original Git folders without copying or mutating them, and remembers removals", async () => {
	const f = fixture();
	try {
		const before = {
			db: readFileSync(f.sourceDbPath),
			config: readFileSync(join(f.repo, ".git/config")),
			status: git(f.checkout, "status", "--porcelain=v1"),
			index: git(f.checkout, "diff", "--cached", "--binary"),
		};
		const sources = await discoverWorkspaceSources(f.dataDir, f.root);
		const result = await connectWorkspaceSources(sources, f.options);
		assert.equal(result.connected, 2);
		assert.deepEqual(result.failures, []);
		const db = createDb(f.targetDbPath, migrationsFolder);
		const rows = db.select().from(workspaces).all();
		assert.deepEqual(
			new Set(rows.map((r) => r.worktreePath)),
			new Set([f.repo, f.checkout]),
		);
		assert.equal(db.select().from(projects).get()?.repoPath, f.repo);
		assert.equal(db.select().from(externalWorkspacePaths).all().length, 2);
		assert.equal(existsSync(join(f.dataDir, "projects")), false);
		assert.equal(existsSync(join(f.dataDir, "worktrees")), false);
		assert.deepEqual(readFileSync(f.sourceDbPath), before.db);
		assert.deepEqual(readFileSync(join(f.repo, ".git/config")), before.config);
		assert.equal(git(f.checkout, "status", "--porcelain=v1"), before.status);
		assert.equal(git(f.checkout, "diff", "--cached", "--binary"), before.index);
		assert.equal(readFileSync(join(f.checkout, "file"), "utf8"), "unstaged\n");
		assert.equal(
			readFileSync(join(f.checkout, ".env"), "utf8"),
			"LOCAL_FIXTURE=value\n",
		);
		assert.equal(
			readFileSync(join(f.checkout, "node_modules/fixture"), "utf8"),
			"dependencies\n",
		);
		assert.equal(
			(await connectWorkspaceSources(sources, f.options)).connected,
			0,
		);
		db.update(workspaces)
			.set({ archivedAt: Date.now(), archiveReason: "deleted" })
			.where(eq(workspaces.worktreePath, f.checkout))
			.run();
		await connectWorkspaceSources(sources, f.options);
		assert.ok(
			db
				.select()
				.from(workspaces)
				.where(eq(workspaces.worktreePath, f.checkout))
				.get()?.archivedAt,
		);
		db.delete(projects).run();
		db.$client.close();
		assert.equal(
			(await connectWorkspaceSources(sources, f.options)).connected,
			0,
		);
		const reopened = createDb(f.targetDbPath, migrationsFolder);
		assert.equal(reopened.select().from(workspaces).all().length, 0);
		assert.equal(
			reopened.select().from(externalWorkspacePaths).all().length,
			2,
		);
		reopened.$client.close();
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});

test("adopts the original path without duplicating a copied workspace", async () => {
	const f = fixture();
	try {
		const copyId = workspacePathId(f.checkout, "workspace", "");
		const copyProjectId = workspacePathId(f.repo, "project", "");
		const copyRepo = join(f.dataDir, "projects", copyProjectId);
		const copyPath = join(f.dataDir, "worktrees", copyProjectId, copyId);
		mkdirSync(copyRepo, { recursive: true });
		mkdirSync(copyPath, { recursive: true });
		writeFileSync(join(copyPath, "unique"), "only in previous copy");
		const db = createDb(f.targetDbPath, migrationsFolder);
		db.insert(projects)
			.values({ id: copyProjectId, repoPath: copyRepo, name: "Project" })
			.run();
		db.insert(workspaces)
			.values({
				id: copyId,
				projectId: copyProjectId,
				worktreePath: copyPath,
				branch: "feature",
				name: "Copied feature",
			})
			.run();
		const terminalId = randomUUID();
		db.insert(terminalSessions)
			.values({ id: terminalId, originWorkspaceId: copyId })
			.run();
		const source = await inspectWorkspaceSource(f.sourceHome);
		assert.equal(
			(await connectWorkspaceSources([source], f.options)).adoptedCopies,
			1,
		);
		assert.equal(
			db.query.workspaces.findFirst({ where: eq(workspaces.id, copyId) }).sync()
				?.worktreePath,
			f.checkout,
		);
		assert.equal(
			db.select().from(terminalSessions).get()?.originWorkspaceId,
			copyId,
		);
		assert.equal(
			readFileSync(join(copyPath, "unique"), "utf8"),
			"only in previous copy",
		);
		assert.equal(
			db
				.select()
				.from(workspaces)
				.all()
				.some((row) => row.worktreePath === copyPath),
			false,
		);
		assert.equal(
			db
				.select()
				.from(externalWorkspacePaths)
				.all()
				.some((row) => row.worktreePath === f.checkout),
			true,
		);
		assert.equal(
			db.query.projects
				.findFirst({ where: eq(projects.id, copyProjectId) })
				.sync()?.repoPath,
			f.repo,
		);
		await connectWorkspaceSources([source], f.options);
		assert.equal(db.select().from(workspaces).all().length, 2);
		db.$client.close();
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});

test("rejects redirected database destinations before any original writes", async () => {
	const f = fixture();
	try {
		const source = await inspectWorkspaceSource(f.sourceHome);
		const before = readFileSync(f.sourceDbPath);
		symlinkSync(join(f.sourceHome, "host"), join(f.dataDir, "host"));
		await assert.rejects(
			connectWorkspaceSources([source], f.options),
			/outside the app data/,
		);
		assert.deepEqual(readFileSync(f.sourceDbPath), before);
		const alias = join(f.root, "alias");
		symlinkSync(f.sourceHome, alias);
		await assert.rejects(
			connectWorkspaceSources([source], { ...f.options, dataDir: alias }),
			/overlaps/,
		);
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});
