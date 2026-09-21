import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { promisify } from "node:util";
import {
	createDb,
	externalWorkspacePaths,
	projects,
	tagFolderSettings,
	workspaces,
	workspaceTags,
} from "@superset/host-service/db";
import { SESSIONS_TAG_SCOPE } from "@superset/shared/workspace-tags";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { z } from "zod";

const projectSchema = z.object({
	id: z.string(),
	repo_path: z.string(),
	name: z.string().default(""),
	repo_provider: z.string().nullable().default(null),
	repo_owner: z.string().nullable().default(null),
	repo_name: z.string().nullable().default(null),
	repo_url: z.string().nullable().default(null),
	remote_name: z.string().nullable().default(null),
	icon: z.string().nullable().default(null),
	color: z.string().nullable().default(null),
	worktree_base_dir: z.string().nullable().default(null),
});
const workspaceSchema = z.object({
	id: z.string(),
	project_id: z.string().nullable(),
	worktree_path: z.string(),
	branch: z.string(),
	name: z.string().default(""),
	// Older Superset hosts called the project's primary checkout "main".
	type: z
		.enum(["main", "local", "worktree", "session"])
		.transform((type) => (type === "main" ? "local" : type))
		.default("worktree"),
	upstream_owner: z.string().nullable().default(null),
	upstream_repo: z.string().nullable().default(null),
	upstream_branch: z.string().nullable().default(null),
	archived_at: z.number().nullable().default(null),
});
type SourceProject = z.infer<typeof projectSchema>;
type SourceWorkspace = z.infer<typeof workspaceSchema>;
export type WorkspaceSource = {
	home: string;
	databases: {
		path: string;
		projects: SourceProject[];
		workspaces: SourceWorkspace[];
	}[];
	missing: number;
};

export function workspacePathId(source: string, kind: string, id: string) {
	const hex = createHash("sha256")
		.update(`${source}\0${kind}\0${id}`)
		.digest("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function inspectWorkspaceSource(
	home: string,
): Promise<WorkspaceSource> {
	const source: WorkspaceSource = {
		home: await realpath(home),
		databases: [],
		missing: 0,
	};
	const hostRoot = join(source.home, "host");
	if (!existsSync(hostRoot)) return source;
	for (const entry of readdirSync(hostRoot, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const path = join(hostRoot, entry.name, "host.db");
		if (!existsSync(path)) continue;
		const db = new Database(path, { readonly: true, fileMustExist: true });
		try {
			const all = workspaceSchema
				.array()
				.parse(db.prepare("SELECT * FROM workspaces").all());
			const active = all.filter((workspace) => workspace.archived_at === null);
			const available = active.filter((workspace) =>
				existsSync(workspace.worktree_path),
			);
			source.missing += active.length - available.length;
			source.databases.push({
				path,
				projects: await Promise.all(
					projectSchema
						.array()
						.parse(db.prepare("SELECT * FROM projects").all())
						.map(async (project) => ({
							...project,
							repo_path: existsSync(project.repo_path)
								? await realpath(project.repo_path)
								: project.repo_path,
						})),
				),
				workspaces: await Promise.all(
					available.map(async (workspace) => ({
						...workspace,
						worktree_path: await realpath(workspace.worktree_path),
					})),
				),
			});
		} finally {
			db.close();
		}
	}
	return uniqueSources([source])[0] ?? source;
}

export function sourceWorkspaceCount(source: WorkspaceSource) {
	return source.databases.reduce(
		(count, db) => count + db.workspaces.length,
		0,
	);
}

function uniqueSources(sources: WorkspaceSource[]) {
	const seen = new Set<string>();
	// Prefer the custom fork's record when both apps track the same folder.
	return [...sources]
		.reverse()
		.map((source) => ({
			...source,
			databases: source.databases.map((database) => ({
				...database,
				workspaces: database.workspaces.filter((workspace) => {
					if (seen.has(workspace.worktree_path)) return false;
					seen.add(workspace.worktree_path);
					return true;
				}),
			})),
		}))
		.filter((source) => sourceWorkspaceCount(source) > 0)
		.reverse();
}

/** Inspect known data homes and the custom data home beside an existing checkout. */
export async function discoverWorkspaceSources(
	dataDir: string,
	home = homedir(),
) {
	const targetHome = await realpath(dataDir);
	const candidates = new Set([
		join(home, ".superset"),
		join(home, ".superset-dev"),
	]);
	const sources: WorkspaceSource[] = [];
	for (const candidate of candidates) {
		if (!existsSync(candidate) || (await realpath(candidate)) === targetHome)
			continue;
		const source = await inspectWorkspaceSource(candidate);
		if (sourceWorkspaceCount(source) > 0) sources.push(source);
		// Only one level of known checkout paths; never recursively crawl a home folder.
		if (candidates.size < 64) {
			for (const database of source.databases) {
				for (const workspace of database.workspaces) {
					const custom = join(workspace.worktree_path, "superset-dev-data");
					if (existsSync(join(custom, "host"))) candidates.add(custom);
				}
			}
		}
	}
	return uniqueSources(sources);
}

type ConnectOptions = {
	dataDir: string;
	organizationId: string;
	userId: string;
	migrationsFolder: string;
	previousCopiesLabel: string;
};

const exec = promisify(execFile);
async function git(path: string, ...args: string[]) {
	const { stdout } = await exec("git", ["-C", path, ...args], {
		env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
		timeout: 15_000,
		maxBuffer: 1024 * 1024,
	});
	return stdout.trim();
}

function contains(parent: string, child: string) {
	const path = relative(parent, child);
	return (
		path === "" ||
		(path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
	);
}

async function verifyDestination(dataDir: string, target: string) {
	let ancestor = target;
	while (
		!(await lstat(ancestor).catch((error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return null;
			throw error;
		}))
	)
		ancestor = dirname(ancestor);
	if (!contains(dataDir, await realpath(ancestor)))
		throw new Error(
			"The workspace database points outside the app data folder.",
		);
}

export async function connectWorkspaceSources(
	sources: WorkspaceSource[],
	options: ConnectOptions,
) {
	const dataDir = await realpath(options.dataDir);
	for (const source of sources) {
		for (const original of [
			source.home,
			...source.databases.flatMap((db) => [
				...db.projects.map((project) => project.repo_path),
				...db.workspaces.map((workspace) => workspace.worktree_path),
			]),
		]) {
			if (!existsSync(original)) continue;
			const path = await realpath(original);
			if (contains(path, dataDir) || contains(dataDir, path))
				throw new Error(
					"The app data folder overlaps an original Superset folder.",
				);
		}
	}
	const dbPath = join(dataDir, "host", options.organizationId, "host.db");
	await verifyDestination(dataDir, dbPath);
	const db = createDb(dbPath, options.migrationsFolder);
	const report: {
		connected: number;
		alreadyKnown: number;
		previousCopies: number;
		failures: string[];
	} = { connected: 0, alreadyKnown: 0, previousCopies: 0, failures: [] };
	try {
		const seen = new Set(
			db
				.select()
				.from(externalWorkspacePaths)
				.all()
				.map((row) => row.worktreePath),
		);
		for (const source of sources)
			for (const database of source.databases)
				for (const workspace of database.workspaces) {
					const path = workspace.worktree_path;
					if (seen.has(path)) {
						report.alreadyKnown++;
						continue;
					}
					try {
						const root = await realpath(
							await git(path, "rev-parse", "--show-toplevel"),
						);
						if (root !== path)
							throw new Error("Workspace path is not a Git checkout root.");
						const project = database.projects.find(
							(row) => row.id === workspace.project_id,
						);
						if (workspace.project_id && !project)
							throw new Error("Source project metadata is missing.");
						if (project) {
							const common = await git(
								path,
								"rev-parse",
								"--path-format=absolute",
								"--git-common-dir",
							);
							const projectCommon = await git(
								project.repo_path,
								"rev-parse",
								"--path-format=absolute",
								"--git-common-dir",
							);
							if ((await realpath(common)) !== (await realpath(projectCommon)))
								throw new Error(
									"Workspace and project belong to different Git repositories.",
								);
						}
						const branch = await git(
							path,
							"symbolic-ref",
							"--quiet",
							"--short",
							"HEAD",
						).catch(() => workspace.branch);
						const headSha = await git(
							path,
							"rev-parse",
							"--verify",
							"HEAD",
						).catch(() => null);
						const existing = db
							.select()
							.from(workspaces)
							.all()
							.find((row) => {
								try {
									return realpathSync(row.worktreePath) === path;
								} catch {
									return false;
								}
							});
						const existingProject = project
							? db
									.select()
									.from(projects)
									.all()
									.find((row) => row.repoPath === project.repo_path)
							: undefined;
						const projectId = project
							? (existingProject?.id ??
								workspacePathId(project.repo_path, "connected-project", ""))
							: null;
						const copied = db.query.workspaces
							.findFirst({
								where: eq(
									workspaces.id,
									workspacePathId(path, "workspace", ""),
								),
							})
							.sync();
						db.transaction((tx) => {
							if (project && projectId && !existingProject && !existing)
								tx.insert(projects)
									.values({
										id: projectId,
										repoPath: project.repo_path,
										name: project.name,
										repoProvider: project.repo_provider,
										repoOwner: project.repo_owner,
										repoName: project.repo_name,
										repoUrl: project.repo_url,
										remoteName: project.remote_name,
										icon: project.icon,
										color: project.color,
										worktreeBaseDir: project.worktree_base_dir,
										updatedAt: Date.now(),
									})
									.onConflictDoNothing()
									.run();
							if (!existing)
								tx.insert(workspaces)
									.values({
										id: workspacePathId(path, "connected-workspace", ""),
										projectId,
										worktreePath: path,
										branch,
										headSha,
										name: workspace.name,
										type: project
											? path === project.repo_path
												? "local"
												: "worktree"
											: "session",
										upstreamOwner: workspace.upstream_owner,
										upstreamRepo: workspace.upstream_repo,
										upstreamBranch: workspace.upstream_branch,
										createdByUserId: options.userId,
										updatedAt: Date.now(),
									})
									.run();
							tx.insert(externalWorkspacePaths)
								.values({ worktreePath: path })
								.run();
							if (copied && contains(dataDir, copied.worktreePath)) {
								const tag = "previous-copies";
								tx.insert(workspaceTags)
									.values({
										workspaceId: copied.id,
										tag,
										createdByUserId: options.userId,
									})
									.onConflictDoNothing()
									.run();
								tx.insert(tagFolderSettings)
									.values({
										scope: copied.projectId ?? SESSIONS_TAG_SCOPE,
										tag,
										displayName: options.previousCopiesLabel,
										createdByUserId: options.userId,
									})
									.onConflictDoNothing()
									.run();
								if (copied.projectId) {
									const copiedProject = tx
										.select()
										.from(projects)
										.where(eq(projects.id, copied.projectId))
										.get();
									const suffix = ` (${options.previousCopiesLabel})`;
									if (
										copiedProject &&
										contains(dataDir, copiedProject.repoPath) &&
										!copiedProject.name.endsWith(suffix)
									)
										tx.update(projects)
											.set({
												name: `${copiedProject.name}${suffix}`,
												updatedAt: Date.now(),
											})
											.where(eq(projects.id, copiedProject.id))
											.run();
								}
							}
						});
						seen.add(path);
						if (existing) report.alreadyKnown++;
						else report.connected++;
						if (copied) report.previousCopies++;
					} catch (error) {
						report.failures.push(
							`${workspace.name || path}: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
				}
		return report;
	} finally {
		db.$client.close();
	}
}
