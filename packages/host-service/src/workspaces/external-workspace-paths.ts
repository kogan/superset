import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { HostDb } from "../db";
import { externalWorkspacePaths } from "../db/schema";

function canonicalPath(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

export function externalWorkspacePathSet(db: HostDb): ReadonlySet<string> {
	return new Set(
		db
			.select()
			.from(externalWorkspacePaths)
			.all()
			.flatMap(({ worktreePath }) => [
				resolve(worktreePath),
				canonicalPath(worktreePath),
			]),
	);
}

export function isExternalWorkspacePath(
	paths: ReadonlySet<string>,
	path: string,
): boolean {
	return paths.has(resolve(path)) || paths.has(canonicalPath(path));
}
