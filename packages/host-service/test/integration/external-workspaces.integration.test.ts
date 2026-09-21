import { describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { externalWorkspacePaths, workspaces } from "../../src/db/schema";
import {
	externalWorkspacePathSet,
	isExternalWorkspacePath,
} from "../../src/workspaces/external-workspace-paths";
import { createFeatureWorktreeScenario } from "../helpers/scenarios";
import { seedWorkspace } from "../helpers/seed";

describe("external Superset workspaces", () => {
	test("force removal and re-adoption preserve dirty files, Git registration and branches", async () => {
		const scenario = await createFeatureWorktreeScenario();
		try {
			const {
				host,
				repo,
				worktreePath,
				featureWorkspaceId,
				branch,
				projectId,
			} = scenario;
			host.db
				.insert(externalWorkspacePaths)
				.values({ worktreePath: realpathSync(worktreePath) })
				.run();
			writeFileSync(join(worktreePath, "unique"), "keep me");
			mkdirSync(join(worktreePath, ".superset"), { recursive: true });
			writeFileSync(
				join(worktreePath, ".superset/config.json"),
				JSON.stringify({ teardown: ["touch teardown-ran"] }),
			);
			const preview = await host.trpc.workspaceCleanup.inspect.query({
				workspaceId: featureWorkspaceId,
			});
			expect(preview).toMatchObject({
				canDelete: true,
				hasChanges: false,
				preservesFiles: true,
			});
			const result = await host.trpc.workspaceCleanup.destroy.mutate({
				workspaceId: featureWorkspaceId,
				force: true,
				deleteBranch: true,
			});
			expect(result).toMatchObject({
				success: true,
				worktreeRemoved: false,
				branchDeleted: false,
			});
			expect(readFileSync(join(worktreePath, "unique"), "utf8")).toBe(
				"keep me",
			);
			expect(existsSync(join(worktreePath, "teardown-ran"))).toBe(false);
			expect(await repo.git.raw(["worktree", "list", "--porcelain"])).toContain(
				worktreePath,
			);
			expect(await repo.git.raw(["branch", "--list", branch])).toContain(
				branch,
			);
			const alias = join(repo.repoPath, "alias");
			symlinkSync(worktreePath, alias);
			expect(
				isExternalWorkspacePath(externalWorkspacePathSet(host.db), alias),
			).toBe(true);
			const adopted = seedWorkspace(host, {
				projectId,
				worktreePath: alias,
				branch,
			});
			await host.trpc.workspaceCleanup.destroy.mutate({
				workspaceId: adopted.id,
				force: true,
				deleteBranch: true,
			});
			expect(existsSync(worktreePath)).toBe(true);
			await host.trpc.project.remove.mutate({ projectId });
			expect(existsSync(worktreePath)).toBe(true);
			expect(host.db.select().from(workspaces).all()).toHaveLength(0);
			expect(host.db.select().from(externalWorkspacePaths).all()).toHaveLength(
				1,
			);
		} finally {
			await scenario.dispose();
		}
	});

	test("projectless originals are preserved and newly managed worktrees still clean up", async () => {
		const scenario = await createFeatureWorktreeScenario();
		try {
			const { host, repo, worktreePath, featureWorkspaceId, branch } = scenario;
			const session = join(repo.repoPath, "original-session");
			mkdirSync(session);
			writeFileSync(join(session, "keep"), "session content");
			host.db
				.insert(externalWorkspacePaths)
				.values({ worktreePath: realpathSync(session) })
				.run();
			const row = seedWorkspace(host, {
				projectId: null,
				worktreePath: session,
				branch: "main",
				type: "session",
			});
			expect(
				await host.trpc.workspaceCleanup.inspect.query({ workspaceId: row.id }),
			).toMatchObject({ preservesFiles: true });
			await host.trpc.workspaceCleanup.destroy.mutate({
				workspaceId: row.id,
				force: true,
			});
			expect(readFileSync(join(session, "keep"), "utf8")).toBe(
				"session content",
			);
			const result = await host.trpc.workspaceCleanup.destroy.mutate({
				workspaceId: featureWorkspaceId,
				force: true,
				deleteBranch: true,
			});
			expect(result).toMatchObject({
				worktreeRemoved: true,
				branchDeleted: true,
			});
			expect(existsSync(worktreePath)).toBe(false);
			expect((await repo.git.raw(["branch", "--list", branch])).trim()).toBe(
				"",
			);
		} finally {
			await scenario.dispose();
		}
	});
});
