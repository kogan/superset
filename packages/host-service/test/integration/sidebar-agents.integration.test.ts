import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { terminalAgentBindings, terminalSessions } from "../../src/db/schema";
import { createBasicScenario } from "../helpers/scenarios";
import { seedTerminalSession, seedWorkspace } from "../helpers/seed";

test("subagent rename uses the authenticated host API and is scoped to its terminal workspace", async () => {
	const scenario = await createBasicScenario();
	try {
		const { host, workspaceId, projectId, repo } = scenario;
		const other = seedWorkspace(host, {
			projectId,
			worktreePath: repo.repoPath,
			branch: "main",
		});
		const terminal = seedTerminalSession(host, {
			originWorkspaceId: workspaceId,
		});
		const hook = {
			terminalId: terminal.id,
			eventType: "SessionStart",
			agent: { agentId: "codex", sessionId: "parent" },
		};
		await host.trpc.notifications.hook.mutate(hook);
		const childHook = {
			terminalId: terminal.id,
			eventType: "SubagentStart",
			subagent: { id: "child", type: "default", sessionId: "child" },
		};
		await host.trpc.notifications.hook.mutate(childHook);
		const rename = {
			workspaceId,
			terminalId: terminal.id,
			subagentId: "child",
			name: "  Review\u0000 payments  ",
		};
		await expect(
			host.unauthenticatedTrpc.terminalAgents.renameSubagent.mutate(rename),
		).rejects.toMatchObject({ data: { code: "UNAUTHORIZED" } });
		await expect(
			host.trpc.terminalAgents.renameSubagent.mutate({
				...rename,
				workspaceId: other.id,
			}),
		).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
		await expect(
			host.trpc.terminalAgents.renameSubagent.mutate({
				...rename,
				subagentId: "unknown",
			}),
		).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
		expect(
			await host.trpc.terminalAgents.renameSubagent.mutate(rename),
		).toEqual({ subagentId: "child", name: "Review payments" });
		await host.trpc.notifications.hook.mutate({
			...childHook,
			eventType: "PostToolUse",
		});
		const bindings = await host.trpc.terminalAgents.listByWorkspace.query({
			workspaceId,
		});
		expect(bindings[0]?.subagents?.[0]?.customName).toBe("Review payments");
		await host.trpc.terminalAgents.renameSubagent.mutate({
			...rename,
			name: " ",
		});
		expect(
			(await host.trpc.terminalAgents.listByWorkspace.query({ workspaceId }))[0]
				?.subagents?.[0]?.customName,
		).toBeUndefined();
		await host.trpc.terminalAgents.renameSubagent.mutate({
			...rename,
			name: "x".repeat(300),
		});
		expect(
			(await host.trpc.terminalAgents.listByWorkspace.query({ workspaceId }))[0]
				?.subagents?.[0]?.customName,
		).toHaveLength(200);
		await expect(
			host.trpc.terminalAgents.renameSubagent.mutate({
				...rename,
				name: "x".repeat(1001),
			}),
		).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
	} finally {
		await scenario.dispose();
	}
});

test("sidebar lists all live agents in the workspace and follows session names and exits", async () => {
	const scenario = await createBasicScenario();
	try {
		const { host, workspaceId, projectId, repo } = scenario;
		const other = seedWorkspace(host, {
			projectId,
			worktreePath: repo.repoPath,
			branch: "main",
		});
		const first = seedTerminalSession(host, { originWorkspaceId: workspaceId });
		const second = seedTerminalSession(host, {
			originWorkspaceId: workspaceId,
		});
		const elsewhere = seedTerminalSession(host, {
			originWorkspaceId: other.id,
		});
		for (const [terminalId, owner] of [
			[first.id, workspaceId],
			[second.id, workspaceId],
			[elsewhere.id, other.id],
		]) {
			host.db
				.insert(terminalAgentBindings)
				.values({
					terminalId,
					workspaceId: owner,
					agentId: "codex",
					startedAt: 1,
					lastEventAt: 1,
					lastEventType: "Attached",
				})
				.run();
		}
		const before = await host.trpc.terminalAgents.listByWorkspace.query({
			workspaceId,
		});
		expect(before.map((agent) => agent.terminalId).sort()).toEqual(
			[first.id, second.id].sort(),
		);
		await host.trpc.terminal.rename.mutate({
			workspaceId,
			terminalId: second.id,
			title: "Review checkout",
		});
		const renamed = await host.trpc.terminalAgents.listByWorkspace.query({
			workspaceId,
		});
		expect(renamed.find((agent) => agent.terminalId === second.id)?.title).toBe(
			"Review checkout",
		);
		expect(
			renamed.find((agent) => agent.terminalId === first.id)?.title,
		).toBeNull();
		host.db
			.update(terminalSessions)
			.set({ status: "exited", endedAt: Date.now() })
			.where(eq(terminalSessions.id, first.id))
			.run();
		const after = await host.trpc.terminalAgents.listByWorkspace.query({
			workspaceId,
		});
		expect(after.map((agent) => agent.terminalId)).toEqual([second.id]);
	} finally {
		await scenario.dispose();
	}
});
