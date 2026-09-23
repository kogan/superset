import { describe, expect, test } from "bun:test";
import type { TerminalAgentBinding } from "renderer/hooks/host-service/useTerminalAgentBindings";
import {
	type AttentionPrSnapshot,
	agentAttentionItems,
	fetchAttentionPullRequests,
	matchesAttentionFilter,
	mergeAttentionPullRequests,
	type PullRequestsPage,
} from "./attention-items";

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
const pr: PullRequestsPage["pullRequests"][number] = {
	projectId: "project",
	prNumber: 42,
	title: "Fix checkout",
	url: "https://github.com/owner/repo/pull/42",
	state: "open",
	isDraft: false,
	authorLogin: "author",
	updatedAt: "2026-09-20T00:00:00Z",
	checks: [{ name: "Tests", status: "failure", url: null }],
	checksStatus: "failure",
	additions: 3,
	deletions: 1,
	headRefName: "fix",
};
const projectNames = new Map([["project", "Repo"]]);
const snapshot = (pullRequests = [pr]): AttentionPrSnapshot => ({
	pullRequests,
	hasMore: false,
	incomplete: false,
});
const page = (overrides: Partial<PullRequestsPage> = {}): PullRequestsPage => ({
	pullRequests: [],
	totalCount: 0,
	hasNextPage: false,
	page: 1,
	searchIncomplete: false,
	checksUnavailable: false,
	...overrides,
});

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

describe("pull request attention", () => {
	test("merges reasons and project copies by URL, not PR number", () => {
		const items = mergeAttentionPullRequests([
			{ reason: "failed-checks", snapshot: snapshot(), projectNames },
			{
				reason: "reviews",
				snapshot: snapshot([
					{ ...pr, projectId: "copy" },
					{ ...pr, url: "https://github.com/owner/another/pull/42" },
				]),
				projectNames,
			},
		]);
		expect(items).toHaveLength(2);
		const both = items.find((item) => item.id === pr.url);
		expect(both).toMatchObject({
			projectId: "project",
			reasons: ["failed-checks", "reviews"],
		});
		if (!both) throw new Error("Expected merged PR");
		expect(matchesAttentionFilter(both, "failed-checks")).toBe(true);
		expect(matchesAttentionFilter(both, "reviews")).toBe(true);
		expect(matchesAttentionFilter(both, "agents")).toBe(false);
	});
	test("closed, recovered and cancelled-only checks are excluded", () => {
		const items = mergeAttentionPullRequests([
			{
				reason: "failed-checks",
				projectNames,
				snapshot: snapshot([
					{ ...pr, state: "closed" },
					{
						...pr,
						checksStatus: "success",
						checks: [{ name: "Tests", status: "success", url: null }],
					},
					{
						...pr,
						checks: [{ name: "Tests", status: "cancelled", url: null }],
					},
				]),
			},
		]);
		expect(items).toEqual([]);
	});
	test("review withdrawal clears only the review reason", () => {
		const items = mergeAttentionPullRequests([
			{ reason: "failed-checks", snapshot: snapshot(), projectNames },
			{ reason: "reviews", snapshot: snapshot([]), projectNames },
		]);
		expect(items).toMatchObject([{ reasons: ["failed-checks"] }]);
	});
	test("page refresh starts over and drops an obsolete tail", async () => {
		let resolved = false;
		const calls: number[] = [];
		const search: Parameters<typeof fetchAttentionPullRequests>[0]["search"] =
			async (input) => {
				calls.push(input.page ?? 1);
				return resolved
					? page()
					: page({
							pullRequests: [{ ...pr, prNumber: input.page ?? 1 }],
							hasNextPage: input.page === 1,
						});
			};
		const options = {
			search,
			projectIds: ["project"],
			reason: "reviews",
			pageLimit: 2,
		} satisfies Parameters<typeof fetchAttentionPullRequests>[0];
		expect(
			(await fetchAttentionPullRequests(options)).pullRequests,
		).toHaveLength(2);
		resolved = true;
		expect((await fetchAttentionPullRequests(options)).pullRequests).toEqual(
			[],
		);
		expect(calls).toEqual([1, 2, 1]);
	});
	test("uses personal relationship filters and marks unknown coverage", async () => {
		const search: Parameters<typeof fetchAttentionPullRequests>[0]["search"] =
			async (input) => {
				expect(input.viewerRelationship).toBe("authored");
				expect(input.query).toBe("status:failure");
				expect(input.includeClosed).toBe(false);
				return page({
					searchIncomplete: undefined,
					checksUnavailable: undefined,
				});
			};
		expect(
			(
				await fetchAttentionPullRequests({
					search,
					projectIds: ["project"],
					reason: "failed-checks",
					pageLimit: 1,
				})
			).incomplete,
		).toBe(true);
	});
	test("unknown check enrichment prevents all-clear but does not block review requests", async () => {
		const search: Parameters<typeof fetchAttentionPullRequests>[0]["search"] =
			async () => page({ checksUnavailable: true });
		expect(
			(
				await fetchAttentionPullRequests({
					search,
					projectIds: ["project"],
					reason: "failed-checks",
					pageLimit: 1,
				})
			).incomplete,
		).toBe(true);
		expect(
			(
				await fetchAttentionPullRequests({
					search,
					projectIds: ["project"],
					reason: "reviews",
					pageLimit: 1,
				})
			).incomplete,
		).toBe(false);
	});
});
