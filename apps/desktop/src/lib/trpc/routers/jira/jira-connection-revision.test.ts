import { afterEach, describe, expect, test } from "bun:test";
import { createJiraRouter } from ".";
import { createJiraClient } from "./jira-client";
import {
	jiraTransitionInputSchema,
	type StoredJiraConnection,
} from "./jira-schema";

const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const stop of cleanup.splice(0)) stop();
});
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((yes) => {
		resolve = yes;
	});
	return { promise, resolve };
}
function fixture(onLookup?: () => Promise<void>) {
	let lookups = 0;
	const posts: string[] = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const path = new URL(request.url).pathname;
			if (path.endsWith("/myself"))
				return Response.json({ displayName: "Same user", active: true });
			if (path.endsWith("/field")) return Response.json([]);
			if (request.method === "POST") {
				posts.push(request.headers.get("authorization") ?? "");
				return new Response(null, { status: 204 });
			}
			lookups++;
			await onLookup?.();
			return Response.json({
				transitions: [
					{ id: "21", name: "Start", to: { name: "In Progress" }, fields: {} },
				],
			});
		},
	});
	cleanup.push(() => server.stop(true));
	const input = {
		kind: "pat",
		baseUrl: server.url.origin,
		token: "first",
	} as const;
	let saved: StoredJiraConnection | null = {
		...input,
		version: 2,
		displayName: "Same user",
	};
	const storage = {
		read: async () => saved,
		write: async (value: StoredJiraConnection) => {
			saved = value;
		},
		remove: async () => {
			saved = null;
		},
	};
	const linked: unknown[] = [];
	const workspaceLinks = {
		list: () => [],
		set: (baseUrl: string, link: unknown) => {
			linked.push({ baseUrl, link });
		},
	};
	const createCaller = () =>
		createJiraRouter({
			client: createJiraClient({ request: fetch }),
			storage,
			workspaceLinks,
		}).createCaller({ senderWindow: null });
	return {
		caller: createCaller(),
		createCaller,
		input,
		posts,
		linked,
		lookups: () => lookups,
	};
}
describe("Jira connection revisions", () => {
	test("same-site reconnect invalidates a selection before any transition network request", async () => {
		const { caller, input, posts, lookups } = fixture();
		const first = await caller.listTransitions({ issueKey: "TEAM-1" });
		await caller.connect({ ...input, token: "second" });
		const before = lookups();
		await expect(
			caller.transitionIssue({
				issueKey: "TEAM-1",
				transitionId: "21",
				connectionRevision: first.connectionRevision,
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(lookups()).toBe(before);
		expect(posts).toEqual([]);
		const next = await caller.listTransitions({ issueKey: "TEAM-1" });
		expect(next.connectionRevision).not.toBe(first.connectionRevision);
		await caller.transitionIssue({
			issueKey: "TEAM-1",
			transitionId: "21",
			connectionRevision: next.connectionRevision,
		});
		expect(posts).toEqual(["Bearer second"]);
	});
	test("a lookup finishing after reconnect retains its old revision", async () => {
		const started = deferred<void>();
		const release = deferred<void>();
		let block = true;
		const { caller, input, posts } = fixture(async () => {
			if (block) {
				started.resolve();
				await release.promise;
			}
		});
		const pending = caller.listTransitions({ issueKey: "TEAM-1" });
		await started.promise;
		await caller.connect({ ...input, token: "second" });
		block = false;
		release.resolve();
		const stale = await pending;
		const current = await caller.listTransitions({ issueKey: "TEAM-1" });
		expect(stale.connectionRevision).not.toBe(current.connectionRevision);
		await expect(
			caller.transitionIssue({
				issueKey: "TEAM-1",
				transitionId: "21",
				connectionRevision: stale.connectionRevision,
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(posts).toEqual([]);
	});
	test("disconnect and router restart invalidate outstanding revisions", async () => {
		const { caller, createCaller, posts } = fixture();
		const first = await caller.listTransitions({ issueKey: "TEAM-1" });
		await expect(
			createCaller().transitionIssue({
				issueKey: "TEAM-1",
				transitionId: "21",
				connectionRevision: first.connectionRevision,
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
		await caller.disconnect();
		await expect(
			caller.transitionIssue({
				issueKey: "TEAM-1",
				transitionId: "21",
				connectionRevision: first.connectionRevision,
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(posts).toEqual([]);
	});
	test("rejects missing and malformed revisions at the input boundary", () => {
		for (const connectionRevision of [
			undefined,
			"",
			"secret",
			":1",
			"00000000-0000-0000-0000-000000000000:-1",
			"a".repeat(81),
		])
			expect(
				jiraTransitionInputSchema.safeParse({
					issueKey: "TEAM-1",
					transitionId: "21",
					connectionRevision,
				}).success,
			).toBe(false);
		expect(
			jiraTransitionInputSchema.safeParse({
				issueKey: "TEAM-1",
				transitionId: "21",
				connectionRevision: "00000000-0000-0000-0000-000000000000:1",
			}).success,
		).toBe(true);
	});
});

test("workspace links reject stale ticket connection context", async () => {
	const { caller, input, linked } = fixture();
	const context = await caller.getWorkspaceContext({ issueKey: "TEAM-1" });
	const link = {
		issueKey: "TEAM-1",
		workspaceId: "11111111-1111-4111-8111-111111111111",
		hostId: "local-host",
		linked: true,
		connectionRevision: context.connectionRevision,
	};
	await caller.connect({ ...input, token: "second" });
	await expect(caller.setWorkspaceLink(link)).rejects.toMatchObject({
		code: "CONFLICT",
	});
	expect(linked).toEqual([]);
	const current = await caller.getWorkspaceContext({ issueKey: "TEAM-1" });
	await caller.setWorkspaceLink({
		...link,
		connectionRevision: current.connectionRevision,
	});
	expect(linked).toHaveLength(1);
});
