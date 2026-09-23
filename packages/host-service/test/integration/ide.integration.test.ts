import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import { workspaces } from "../../src/db/schema";
import { type BasicScenario, createBasicScenario } from "../helpers/scenarios";
import { seedWorkspace } from "../helpers/seed";

let scenario: BasicScenario;
beforeEach(async () => {
	scenario = await createBasicScenario();
});
afterEach(async () => {
	await scenario?.dispose();
});

test("IDE credentials are only available to authenticated clients", async () => {
	await expect(
		scenario.host.unauthenticatedTrpc.ide.start.mutate({
			workspaceId: scenario.workspaceId,
		}),
	).rejects.toMatchObject({ data: { code: "UNAUTHORIZED" } });
	await expect(
		scenario.host.unauthenticatedTrpc.ide.openFile.mutate({
			workspaceId: scenario.workspaceId,
			path: "README.md",
		}),
	).rejects.toMatchObject({ data: { code: "UNAUTHORIZED" } });
	await expect(
		scenario.host.unauthenticatedTrpc.ide.getTheme.query({
			workspaceId: scenario.workspaceId,
		}),
	).rejects.toMatchObject({ data: { code: "UNAUTHORIZED" } });
	await expect(
		scenario.host.unauthenticatedTrpc.ide.setTheme.mutate({
			workspaceId: scenario.workspaceId,
			theme: "light",
		}),
	).rejects.toMatchObject({ data: { code: "UNAUTHORIZED" } });
});

test("unknown and archived workspaces cannot launch an IDE", async () => {
	await expect(
		scenario.host.trpc.ide.start.mutate({ workspaceId: "missing" }),
	).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
	await expect(
		scenario.host.trpc.ide.getTheme.query({ workspaceId: "missing" }),
	).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
	scenario.host.db
		.update(workspaces)
		.set({ archivedAt: Date.now() })
		.where(eq(workspaces.id, scenario.workspaceId))
		.run();
	await expect(
		scenario.host.trpc.ide.start.mutate({ workspaceId: scenario.workspaceId }),
	).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
	await expect(
		scenario.host.trpc.ide.setTheme.mutate({
			workspaceId: scenario.workspaceId,
			theme: "light",
		}),
	).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
});

test("themes persist independently per workspace without installing or starting the IDE", async () => {
	const { id: second } = seedWorkspace(scenario.host, {
		projectId: scenario.projectId,
		worktreePath: scenario.repo.repoPath,
		branch: "second",
	});
	const input = { workspaceId: scenario.workspaceId };
	expect(await scenario.host.trpc.ide.getTheme.query(input)).toEqual({
		theme: "dark",
	});
	expect(
		await scenario.host.trpc.ide.setTheme.mutate({ ...input, theme: "light" }),
	).toEqual({ theme: "light" });
	expect(await scenario.host.trpc.ide.getTheme.query(input)).toEqual({
		theme: "light",
	});
	expect(
		await scenario.host.trpc.ide.getTheme.query({ workspaceId: second }),
	).toEqual({ theme: "dark" });
	expect(
		existsSync(join(dirname(scenario.host.dbPath), "ide", "runtime")),
	).toBe(false);
});

test("stopping an unopened IDE is idempotent", async () => {
	await scenario.host.trpc.ide.stop.mutate({
		workspaceId: scenario.workspaceId,
	});
	await scenario.host.trpc.ide.stop.mutate({
		workspaceId: scenario.workspaceId,
	});
});
