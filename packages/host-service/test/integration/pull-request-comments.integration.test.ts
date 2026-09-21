import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { type BasicScenario, createBasicScenario } from "../helpers/scenarios";

let scenario: BasicScenario;
const commitId = "a".repeat(40);
let head = commitId;
const post = mock(async (_input: unknown) => ({
	data: {
		id: 123,
		html_url: "https://github.com/example/repo/pull/42#discussion_r123",
	},
}));
beforeEach(async () => {
	head = commitId;
	post.mockClear();
	scenario = await createBasicScenario({
		hostOptions: {
			githubFactory: async () => ({
				pulls: {
					get: async () => ({ data: { head: { sha: head } } }),
					createReviewComment: post,
				},
			}),
		},
	});
	await scenario.repo.git.addRemote(
		"origin",
		"https://github.com/example/repo.git",
	);
});
afterEach(async () => {
	await scenario?.dispose();
});
const input = () => ({
	projectId: scenario.projectId,
	prNumber: 42,
	body: " Please check this. ",
	commitId,
	path: "src/example.ts",
	startLine: 4,
	endLine: 4,
	startSide: "RIGHT" as const,
	endSide: "RIGHT" as const,
});
test("posts a single-line review comment using the project's GitHub repo", async () => {
	expect(
		await scenario.host.trpc.pullRequests.createComment.mutate(input()),
	).toMatchObject({ id: 123 });
	expect(post).toHaveBeenCalledWith({
		owner: "example",
		repo: "repo",
		pull_number: 42,
		body: "Please check this.",
		commit_id: commitId,
		path: "src/example.ts",
		line: 4,
		side: "RIGHT",
	});
});
test("posts a deleted multiline range with both anchors", async () => {
	await scenario.host.trpc.pullRequests.createComment.mutate({
		...input(),
		startLine: 2,
		endLine: 5,
		startSide: "LEFT",
		endSide: "LEFT",
	});
	expect(post.mock.calls[0]?.[0]).toMatchObject({
		start_line: 2,
		line: 5,
		start_side: "LEFT",
		side: "LEFT",
	});
});
test("rejects stale diffs without posting", async () => {
	head = "b".repeat(40);
	await expect(
		scenario.host.trpc.pullRequests.createComment.mutate(input()),
	).rejects.toMatchObject({ data: { code: "CONFLICT" } });
	expect(post).not.toHaveBeenCalled();
});
test("rejects unauthenticated and invalid requests without posting", async () => {
	await expect(
		scenario.host.unauthenticatedTrpc.pullRequests.createComment.mutate(
			input(),
		),
	).rejects.toThrow();
	await expect(
		scenario.host.trpc.pullRequests.createComment.mutate({
			...input(),
			body: " ",
		}),
	).rejects.toThrow();
	await expect(
		scenario.host.trpc.pullRequests.createComment.mutate({
			...input(),
			startLine: 9,
		}),
	).rejects.toThrow();
	expect(post).not.toHaveBeenCalled();
});
