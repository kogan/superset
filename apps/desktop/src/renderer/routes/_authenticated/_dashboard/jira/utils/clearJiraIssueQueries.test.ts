import { describe, expect, it } from "bun:test";
import {
	isCancelledError,
	QueryClient,
	QueryObserver,
} from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { clearJiraIssueQueries } from "./clearJiraIssueQueries";

describe("clearJiraIssueQueries", () => {
	it("removes every Jira filter and page without removing unrelated queries", async () => {
		const client = new QueryClient();
		const assigned = getQueryKey(
			electronTrpc.jira.listIssues,
			{ scope: { kind: "mine" }, status: "unfinished" },
			"infinite",
		);
		const inProgress = getQueryKey(
			electronTrpc.jira.listIssues,
			{ scope: { kind: "mine" }, status: "in-progress" },
			"infinite",
		);
		const page = getQueryKey(
			electronTrpc.jira.listIssues,
			{ scope: { kind: "mine" }, status: "unfinished" },
			"query",
		);
		client.setQueryData(assigned, {
			pages: [{ issues: [{ key: "OLD-1" }] }, { issues: [{ key: "OLD-4" }] }],
		});
		client.setQueryData(inProgress, {
			pages: [{ issues: [{ key: "OLD-2" }] }],
		});
		client.setQueryData(page, { issues: [{ key: "OLD-3" }] });
		const prs = getQueryKey(
			electronTrpc.jira.listPullRequests,
			{ issueKeys: ["OLD-1"] },
			"query",
		);
		const members = getQueryKey(
			electronTrpc.jira.searchMembers,
			{ search: "Teammate" },
			"query",
		);
		client.setQueryData(prs, { issues: [{ key: "OLD-1" }] });
		client.setQueryData(members, [{ id: "old-account" }]);
		client.setQueryData(["unrelated"], "keep");

		await clearJiraIssueQueries(client);

		expect(client.getQueryData(assigned)).toBeUndefined();
		expect(client.getQueryData(inProgress)).toBeUndefined();
		expect(client.getQueryData(page)).toBeUndefined();
		expect(client.getQueryData(prs)).toBeUndefined();
		expect(client.getQueryData(members)).toBeUndefined();
		expect(client.getQueryData<string>(["unrelated"])).toBe("keep");
		client.clear();
	});

	it("cancels an in-flight Jira request before removing its cached data", async () => {
		const client = new QueryClient();
		const queryKey = getQueryKey(
			electronTrpc.jira.listIssues,
			{ scope: { kind: "mine" }, status: "unfinished" },
			"query",
		);
		let aborted = false;
		const request = client
			.fetchQuery({
				queryKey,
				queryFn: ({ signal }) => {
					signal.addEventListener(
						"abort",
						() => {
							aborted = true;
						},
						{ once: true },
					);
					return new Promise<never>(() => {});
				},
			})
			.catch((error: unknown) => error);

		await clearJiraIssueQueries(client);

		expect(aborted).toBe(true);
		expect(isCancelledError(await request)).toBe(true);
		expect(client.getQueryState(queryKey)).toBeUndefined();
		client.clear();
	});

	it("clears data already held by an active page observer", async () => {
		const client = new QueryClient();
		const queryKey = getQueryKey(
			electronTrpc.jira.listIssues,
			{ scope: { kind: "mine" }, status: "unfinished" },
			"query",
		);
		client.setQueryData(queryKey, { issues: [{ key: "OLD-1" }] });
		const observer = new QueryObserver(client, { queryKey, enabled: false });
		const unsubscribe = observer.subscribe(() => {});
		expect(observer.getCurrentResult().data).toEqual({
			issues: [{ key: "OLD-1" }],
		});

		await clearJiraIssueQueries(client);

		expect(observer.getCurrentResult().data).toBeUndefined();
		expect(client.getQueryState(queryKey)).toBeUndefined();
		unsubscribe();
		client.clear();
	});
});
