import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpLink } from "@trpc/client";
import {
	type JiraListInput,
	jiraListInputSchema,
} from "lib/trpc/routers/jira/jira-schema";
import type { ReactNode } from "react";
import {
	type ElectronRouterOutputs,
	electronTrpc,
} from "renderer/lib/electron-trpc";
import superjson from "superjson";
import { nativeWebGlobals } from "../../../../../../../../../../../../test-setup";
import { useJiraIssues } from "./useJiraIssues";

type Page = ElectronRouterOutputs["jira"]["listIssues"];
const registered = GlobalRegistrator.isRegistered;
if (!registered) GlobalRegistrator.register();
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { act, cleanup, renderHook, waitFor } = await import(
	"@testing-library/react"
);
const disposals: (() => void)[] = [];
afterEach(() => {
	cleanup();
	for (const dispose of disposals.splice(0)) dispose();
});
afterAll(async () => {
	if (!registered) await GlobalRegistrator.unregister();
});

function fixture(respond: (input: JiraListInput) => Page | Promise<Page>) {
	const requests: JiraListInput[] = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const encoded = new URL(request.url).searchParams.get("input");
			const input = jiraListInputSchema.parse(superjson.parse(encoded ?? "{}"));
			requests.push(input);
			try {
				const page = await respond(input);
				return nativeWebGlobals.Response.json({
					result: { data: superjson.serialize(page) },
				});
			} catch {
				return nativeWebGlobals.Response.json(
					{
						error: superjson.serialize({
							message: "Jira unavailable",
							code: -32603,
							data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
						}),
					},
					{ status: 500 },
				);
			}
		},
	});
	const queryClient = new QueryClient();
	const client = electronTrpc.createClient({
		links: [
			httpLink({
				url: `http://127.0.0.1:${server.port}/trpc`,
				transformer: superjson,
				fetch: nativeWebGlobals.fetch,
			}),
		],
	});
	disposals.push(() => {
		queryClient.clear();
		server.stop(true);
	});
	function Wrapper({ children }: { children: ReactNode }) {
		return (
			<QueryClientProvider client={queryClient}>
				<electronTrpc.Provider client={client} queryClient={queryClient}>
					{children}
				</electronTrpc.Provider>
			</QueryClientProvider>
		);
	}
	return { requests, Wrapper };
}

function issue(id: number): Page["issues"][number] {
	return {
		id: String(id),
		key: `TEST-${id}`,
		summary: `Rank ${id}`,
		status: id <= 50 ? "Done" : "In Dev",
		statusCategory: id <= 50 ? "done" : "indeterminate",
		project: "Test",
		priority: null,
		updated: "2026-09-30T00:00:00Z",
		assignee: null,
		url: `https://jira.example/browse/TEST-${id}`,
		pullRequests: [],
		freshdeskLinks: [],
	};
}
const all: JiraListInput = { scope: { kind: "mine" }, status: "all" };

test("loads every ranked page automatically, including active issues beyond an initial 50 done issues", async () => {
	const issues = Array.from({ length: 103 }, (_, index) => issue(index + 1));
	const { requests, Wrapper } = fixture(({ cursor }) => {
		const start = cursor ? Number(cursor) : 0;
		return {
			issues: issues.slice(start, start + 50),
			total: null,
			nextCursor: start + 50 < issues.length ? String(start + 50) : null,
		};
	});
	const { result } = renderHook(() => useJiraIssues(all, true), {
		wrapper: Wrapper,
	});
	await waitFor(() =>
		expect(
			result.current.data?.pages.flatMap((page) => page.issues),
		).toHaveLength(103),
	);
	expect(
		result.current.data?.pages
			.flatMap((page) => page.issues)
			.map(({ id }) => id),
	).toEqual(issues.map(({ id }) => id));
	expect(requests.map(({ cursor }) => cursor)).toEqual([
		undefined,
		"50",
		"100",
	]);
	expect(result.current.hasNextPage).toBe(false);
});

test("stops after a failed page, keeps loaded issues, and resumes after an explicit retry", async () => {
	let fail = true;
	const { requests, Wrapper } = fixture(({ cursor }) => {
		if (cursor && fail) throw new Error("offline");
		return {
			issues: [issue(cursor ? 2 : 1)],
			total: 2,
			nextCursor: cursor ? null : 1,
		};
	});
	const { result } = renderHook(() => useJiraIssues(all, true), {
		wrapper: Wrapper,
	});
	await waitFor(() => expect(result.current.isFetchNextPageError).toBe(true));
	expect(
		result.current.data?.pages.flatMap((page) => page.issues),
	).toHaveLength(1);
	await act(async () => {
		await Bun.sleep(50);
	});
	expect(requests).toHaveLength(2);
	fail = false;
	await act(async () => {
		await result.current.refetch();
	});
	await waitFor(() => expect(result.current.hasNextPage).toBe(false));
	expect(
		result.current.data?.pages.flatMap((page) => page.issues),
	).toHaveLength(2);
});

test("does not fetch when disabled and stops the old board when the filter changes during a page request", async () => {
	let releasePage = () => {};
	const gate = new Promise<void>((resolve) => {
		releasePage = resolve;
	});
	const { requests, Wrapper } = fixture(async ({ status, cursor }) => {
		if (status === "all" && cursor) await gate;
		return {
			issues: [issue(status === "all" ? 1 : 51)],
			total: null,
			nextCursor: status === "all" ? String(Number(cursor ?? 0) + 1) : null,
		};
	});
	const { result, rerender, unmount } = renderHook(
		({ input, enabled }) => useJiraIssues(input, enabled),
		{ wrapper: Wrapper, initialProps: { input: all, enabled: false } },
	);
	expect(requests).toHaveLength(0);
	rerender({ input: all, enabled: true });
	await waitFor(() => expect(requests).toHaveLength(2));
	rerender({ input: { ...all, status: "in-progress" }, enabled: true });
	await waitFor(() =>
		expect(result.current.data?.pages[0]?.issues[0]?.id).toBe("51"),
	);
	await act(async () => {
		releasePage();
		await Bun.sleep(50);
	});
	expect(requests.filter(({ status }) => status === "all")).toHaveLength(2);
	expect(result.current.hasNextPage).toBe(false);
	unmount();
});
