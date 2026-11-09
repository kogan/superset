import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { defaultAppHomeDir } from "./paths";

const MOVE_RECORD_FILE = "legacy-home-move.json";

export type LegacyHomeMove = "nothing-to-move";

export interface LegacyHomeMoveRecord {
	from: string;
	to: string;
}

/**
 * Resolves the app home for a process that owns it (desktop main,
 * host-service, CLI). superset++ has always lived in `~/.superestset`;
 * `~/.superset` belongs to the official Superset app, so it is never moved
 * or used as a fallback.
 */
export function moveLegacyAppHome(env: NodeJS.ProcessEnv = process.env): {
	homeDir: string;
	move: LegacyHomeMove | "custom-home" | "test-runner";
} {
	if (env.NODE_ENV === "test" || env.NODE_TEST_CONTEXT !== undefined) {
		return {
			homeDir: env.SUPERSET_HOME_DIR?.trim() || defaultAppHomeDir(),
			move: "test-runner",
		};
	}
	const homeDir = defaultAppHomeDir();
	const explicit = env.SUPERSET_HOME_DIR?.trim();
	if (explicit && path.resolve(explicit) !== homeDir) {
		return { homeDir: explicit, move: "custom-home" };
	}
	env.SUPERSET_HOME_DIR = homeDir;
	return { homeDir, move: "nothing-to-move" };
}

export function readLegacyHomeMove(
	homeDir: string,
): LegacyHomeMoveRecord | null {
	try {
		const record = JSON.parse(
			fs.readFileSync(path.join(homeDir, MOVE_RECORD_FILE), "utf8"),
		) as Partial<LegacyHomeMoveRecord>;
		return typeof record.from === "string" && typeof record.to === "string"
			? { from: record.from, to: record.to }
			: null;
	} catch {
		return null;
	}
}

export interface SqliteRunner {
	prepare(sql: string): {
		run(...params: unknown[]): { changes: number | bigint };
	};
}

/**
 * Rewrites stored absolute paths under the old home to the new one. Safe to
 * run on every open: rows already rewritten no longer match.
 */
export function rewriteLegacyHomePaths(
	db: SqliteRunner,
	columns: ReadonlyArray<readonly [table: string, column: string]>,
	move: LegacyHomeMoveRecord,
): number {
	const prefix = `${move.from}/`;
	let changes = 0;
	for (const [table, column] of columns) {
		const result = db
			.prepare(
				`UPDATE "${table}" SET "${column}" = ? || substr("${column}", ?) WHERE "${column}" = ? OR substr("${column}", 1, ?) = ?`,
			)
			.run(move.to, move.from.length + 1, move.from, prefix.length, prefix);
		changes += Number(result.changes);
	}
	return changes;
}

/**
 * Points each repository's worktree records at the moved checkouts, so
 * `git worktree list` agrees with the rewritten paths. Only checkouts whose
 * git records still name the legacy home are repaired, so this is cheap to
 * run on every boot. Failures are logged: git still reaches the old paths
 * through the `~/.superset` symlink.
 */
export async function repairGitWorktrees(
	worktrees: ReadonlyArray<{ repoPath: string; worktreePath: string }>,
	legacyHomeDir: string,
): Promise<void> {
	const byRepo = new Map<string, string[]>();
	for (const { repoPath, worktreePath } of worktrees) {
		if (!gitRecordsNameLegacyHome(worktreePath, legacyHomeDir)) continue;
		byRepo.set(repoPath, [...(byRepo.get(repoPath) ?? []), worktreePath]);
	}
	for (const [repoPath, paths] of byRepo) {
		await new Promise<void>((resolve) => {
			execFile(
				"git",
				["-C", repoPath, "worktree", "repair", ...paths],
				(error) => {
					if (error) {
						console.warn(
							`[legacy-home-move] git worktree repair failed in ${repoPath}:`,
							error.message,
						);
					}
					resolve();
				},
			);
		});
	}
}

function gitRecordsNameLegacyHome(
	worktreePath: string,
	legacyHomeDir: string,
): boolean {
	try {
		const legacyPrefixes = [
			legacyHomeDir,
			path.join(
				fs.realpathSync(path.dirname(legacyHomeDir)),
				path.basename(legacyHomeDir),
			),
		].map((dir) => `${dir}/`);
		const namesLegacyHome = (recorded: string) =>
			legacyPrefixes.some((prefix) => recorded.startsWith(prefix));
		const dotGit = fs.readFileSync(path.join(worktreePath, ".git"), "utf8");
		const adminDir = /^gitdir: (.+)$/m.exec(dotGit)?.[1]?.trim();
		if (!adminDir) return false;
		const resolvedAdminDir = path.resolve(worktreePath, adminDir);
		if (namesLegacyHome(resolvedAdminDir)) return true;
		const backlink = fs
			.readFileSync(path.join(resolvedAdminDir, "gitdir"), "utf8")
			.trim();
		return namesLegacyHome(path.resolve(resolvedAdminDir, backlink));
	} catch {
		return false;
	}
}
