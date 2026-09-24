import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { projects, workspaces } from "../../../db/schema";
import type { HostServiceContext } from "../../../types";
import {
	externalWorkspacePathSet,
	isExternalWorkspacePath,
} from "../../../workspaces/external-workspace-paths";

type WorkspaceRow = typeof workspaces.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;

export type WorkspaceCleanupState = {
	local: WorkspaceRow | undefined;
	project: ProjectRow | undefined;
	preservesFiles: boolean;
	isWorktree: boolean;
};

export async function getWorkspaceCleanupState(
	ctx: HostServiceContext,
	workspaceId: string,
): Promise<WorkspaceCleanupState> {
	const local = ctx.db.query.workspaces
		.findFirst({ where: eq(workspaces.id, workspaceId) })
		.sync();
	// Session workspaces (null projectId) have no project checkout to share.
	const project = local?.projectId
		? ctx.db.query.projects
				.findFirst({ where: eq(projects.id, local.projectId) })
				.sync()
		: undefined;

	const samePath =
		local !== undefined &&
		project !== undefined &&
		normalizePath(local.worktreePath) === normalizePath(project.repoPath);

	return {
		local,
		project,
		isWorktree: local?.type === "worktree" && !samePath,
		preservesFiles:
			samePath ||
			local?.type === "local" ||
			(local !== undefined &&
				isExternalWorkspacePath(
					externalWorkspacePathSet(ctx.db),
					local.worktreePath,
				)),
	};
}

function normalizePath(p: string): string {
	try {
		return realpathSync(p);
	} catch {
		return resolve(p);
	}
}
