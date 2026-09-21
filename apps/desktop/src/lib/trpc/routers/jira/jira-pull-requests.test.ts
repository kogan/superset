import { describe, expect, test } from "bun:test";
import {
	createJiraGithubClient,
	descriptionPullRequests,
	parsePullRequestUrl,
} from "./jira-pull-requests";

describe("Jira PR discovery", () => {
	test("finds and deduplicates PRs in Jira text and ADF links without accepting unsafe URLs", () => {
		const url = "https://github.com/team/repo/pull/123";
		expect(
			descriptionPullRequests({
				type: "doc",
				content: [
					{
						type: "paragraph",
						content: [
							{
								text: `Review (${url}/files).`,
								marks: [{ attrs: { href: url } }],
							},
						],
					},
				],
			}).map((link) => link.url),
		).toEqual([url]);
		for (const invalid of [
			"javascript:alert(1)",
			"https://github.com.evil.example/team/repo/pull/123",
			"https://user:secret@github.com/team/repo/pull/123",
			"http://github.com/team/repo/pull/123",
			"https://github.com/team/repo/issues/123",
			"https://github.com/team/repo/pull/123bad",
		])
			expect(parsePullRequestUrl(invalid)).toBeNull();
		expect(descriptionPullRequests(null)).toEqual([]);
	});
	test("matches complete Jira keys and the configured repository, including merged PRs", async () => {
		const commands: string[][] = [];
		const github = createJiraGithubClient({
			command: async (args) => {
				commands.push(args);
				return JSON.stringify({
					total_count: 4,
					incomplete_results: false,
					items: [
						{
							html_url: "https://github.com/team/repo/pull/1",
							title: "Fix SL-1",
							body: null,
							state: "open",
							pull_request: {},
						},
						{
							html_url: "https://github.com/team/repo/pull/2",
							title: "Fix SL-10",
							body: null,
							state: "open",
							pull_request: {},
						},
						{
							html_url: "https://github.com/team/repo/pull/3",
							title: "Fix payment",
							body: "https://jira.example/browse/SL-2",
							state: "closed",
							pull_request: { merged_at: "2026-09-01" },
						},
						{
							html_url: "https://github.com/other/repo/pull/4",
							title: "SL-1",
							body: null,
							state: "open",
							pull_request: {},
						},
					],
				});
			},
		});
		const result = await github.search({
			scope: "team/repo",
			issueKeys: ["SL-1", "SL-2"],
		});
		expect(result[0]?.links.map((link) => link.number)).toEqual([1]);
		expect(result[1]?.links[0]?.state).toBe("merged");
		expect(commands[0]).toContain(
			'q=is:pr repo:team/repo in:title,body "SL-1" OR "SL-2"',
		);
	});
	test("reports incomplete searches and strips command failures", async () => {
		const incomplete = createJiraGithubClient({
			command: async () =>
				JSON.stringify({
					total_count: 101,
					incomplete_results: false,
					items: [],
				}),
		});
		await expect(
			incomplete.search({ scope: "team/repo", issueKeys: ["SL-1"] }),
		).rejects.toMatchObject({ code: "BAD_GATEWAY" });
		const broken = createJiraGithubClient({
			command: async () => {
				throw new Error("secret token");
			},
		});
		await expect(
			broken.search({ scope: "team/repo", issueKeys: ["SL-1"] }),
		).rejects.toThrow("Could not load GitHub PRs.");
	});
});
