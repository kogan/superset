import { describe, expect, test } from "bun:test";
import type { TerminalAgentBinding } from "renderer/hooks/host-service/useTerminalAgentBindings";
import { agentAttentionItems } from "./attention-items";

const binding: TerminalAgentBinding = {
	terminalId: "terminal-a",
	workspaceId: "workspace",
	agentId: "codex",
	agentSessionId: "session",
	startedAt: 1,
	lastEventAt: 2,
	lastEventType: "PermissionRequest",
	title: null,
};

describe("agent attention", () => {
	test("child questions stay in Attention while the parent keeps working", () => {
		const child = {
			id: "child",
			startedAt: 3,
			lastEventAt: 4,
			needsInput: true as const,
		};
		expect(
			agentAttentionItems({
				workspaceId: "workspace",
				workspaceName: "test",
				bindings: [{ ...binding, lastEventType: "Start", subagents: [child] }],
			}),
		).toMatchObject([{ terminalId: "terminal-a", updatedAt: 4 }]);
		expect(
			agentAttentionItems({
				workspaceId: "workspace",
				workspaceName: "test",
				bindings: [
					{
						...binding,
						lastEventType: "Start",
						subagents: [{ ...child, needsInput: undefined }],
					},
				],
			}),
		).toEqual([]);
	});

	test("only a current permission request needs input", () => {
		for (const lastEventType of [
			"Start",
			"Stop",
			"Failed",
			"SessionStart",
		] as const) {
			expect(
				agentAttentionItems({
					workspaceId: "workspace",
					workspaceName: "Worktree",
					bindings: [{ ...binding, lastEventType }],
				}),
			).toEqual([]);
		}
		expect(
			agentAttentionItems({
				workspaceId: "workspace",
				workspaceName: "Worktree",
				bindings: [binding],
			}),
		).toMatchObject([{ kind: "agent", terminalId: "terminal-a" }]);
	});
	test("same-name agents preserve distinct terminal targets and numbering", () => {
		const items = agentAttentionItems({
			workspaceId: "workspace",
			workspaceName: "Worktree",
			bindings: [
				{ ...binding, lastEventType: "Start" },
				{ ...binding, terminalId: "terminal-b", startedAt: 2 },
			],
		});
		expect(items).toMatchObject([
			{ title: "Codex 2", terminalId: "terminal-b" },
		]);
	});
	test("resuming or removing a binding clears its row", () => {
		expect(
			agentAttentionItems({
				workspaceId: "workspace",
				workspaceName: "Worktree",
				bindings: [{ ...binding, lastEventType: "Start", lastEventAt: 3 }],
			}),
		).toEqual([]);
		expect(
			agentAttentionItems({
				workspaceId: "workspace",
				workspaceName: "Worktree",
				bindings: [],
			}),
		).toEqual([]);
	});
});
