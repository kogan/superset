import { describe, expect, test } from "bun:test";
import { createJiraClient } from "./jira-client";

const credentials = {
	kind: "cloud-api-token",
	baseUrl: "https://example.atlassian.net",
	email: "test@example.com",
	token: "fixture",
} as const;

describe("Jira code reviewers", () => {
	test("My work includes assigned and reviewing issues and excludes epics in every status", async () => {
		const urls: URL[] = [];
		const client = createJiraClient({
			request: async (input) => {
				const url = new URL(input);
				urls.push(url);
				return Response.json(
					url.pathname.endsWith("/field")
						? [
								{ id: "assignee", name: "Assignee" },
								{ id: "customfield_10123", name: "Code Reviewer" },
								{
									id: "customfield_10999",
									name: "Time to review normal change",
								},
							]
						: { issues: [], isLast: true },
				);
			},
		});
		await client.listIssues({
			credentials,
			scope: { kind: "mine" },
			status: "all",
			visibleStatuses: ["In Development", "Needs QA", "Being QA'd"],
		});
		expect(urls[1]?.searchParams.get("jql")).toBe(
			'(assignee = currentUser() OR cf[10123] = currentUser()) AND status IN ("In Development", "Needs QA", "Being QA\'d") AND issuetype != "Epic" ORDER BY updated DESC',
		);
	});

	test("uses the Code Reviewer user field and distinguishes unassigned, assigned, and unreadable values", async () => {
		const urls: URL[] = [];
		const client = createJiraClient({
			request: async (input) => {
				const url = new URL(input);
				urls.push(url);
				return Response.json(
					url.pathname.endsWith("/field")
						? [
								{ id: "customfield_1", name: "Code Reviewer" },
								{ id: "customfield_2", name: "Time to review normal change" },
							]
						: {
								issues: [
									{ key: "SL-1", fields: { customfield_1: null } },
									{
										key: "SL-2",
										fields: {
											customfield_1: {
												accountId: "reviewer-1",
												displayName: "Reviewer",
											},
										},
									},
									{ key: "SL-3", fields: {} },
									{
										key: "SL-4",
										fields: {
											customfield_1: [
												{
													accountId: "reviewer-2",
													displayName: "Second reviewer",
												},
											],
										},
									},
								],
							},
				);
			},
		});
		const result = await client.listReviewers({
			credentials,
			issueKeys: ["SL-1", "SL-2", "SL-3", "SL-4"],
		});
		expect(result.fieldNames).toEqual(["Code Reviewer"]);
		expect(urls[1]?.searchParams.get("fields")).toBe("customfield_1");
		expect(
			result.issues.map((issue) => issue.reviewers?.length ?? null),
		).toEqual([0, 1, null, 1]);
	});

	test("does not label issues unassigned when no reviewer field exists", async () => {
		const client = createJiraClient({
			request: async () =>
				Response.json([{ id: "assignee", name: "Assignee" }]),
		});
		expect(
			await client.listReviewers({ credentials, issueKeys: ["SL-1"] }),
		).toEqual({ fieldNames: [], issues: [] });
	});
});
