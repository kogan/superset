import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@superset/db/client";
import { stub } from "../../../test/stub";
import * as realtime from "../../lib/realtime";
import * as access from "./access";

const WORKSPACE_ID = "0b8f4c1e-2a3d-4e5f-8a9b-1c2d3e4f5a6b";
const OTHER_WORKSPACE_ID = "7d6c5b4a-3e2f-4a1b-9c8d-7e6f5a4b3c2d";

let inserted: Record<string, unknown>[] = [];

function chain(rows: () => unknown[]): unknown {
	const proxy: unknown = new Proxy(
		{},
		{
			get(_, key) {
				if (key === "then") {
					return (resolve: (value: unknown[]) => void) => resolve(rows());
				}
				if (key === "values") {
					return (values: Record<string, unknown>[]) => {
						inserted.push(...values);
						return proxy;
					};
				}
				return () => proxy;
			},
		},
	);
	return proxy;
}

stub(db.query.members, {
	findMany: async () => [{ organizationId: "org-1" }],
});
stub(db, {
	select: () => chain(() => [{ id: "repo-1", fullName: "Acme/App" }]),
	insert: () => chain(() => inserted.map(() => ({}))),
});
stub(access, {
	loadVisibleWorkspace: async (_: unknown, id: string) => ({
		id,
		organizationId: "org-1",
	}),
});
stub(realtime, { nudge: () => {} });

const { cloudWorkspaceRecordRouter } = await import("./record");
const { createCallerFactory, createTRPCContext, createTRPCRouter } =
	await import("../../trpc");

const callerFor = (sandboxCaller: { workspaceId: string } | null) =>
	createCallerFactory(
		createTRPCRouter({ cloudWorkspace: cloudWorkspaceRecordRouter }),
	)(
		createTRPCContext({
			session: {
				user: { id: "user-1", email: "user@example.com" },
				session: { activeOrganizationId: "org-1" },
			} as never,
			auth: {} as never,
			headers: new Headers(),
			sandboxCaller: sandboxCaller && {
				...sandboxCaller,
				organizationId: "org-1",
				userId: "user-1",
			},
		}),
	);

beforeEach(() => {
	inserted = [];
});

describe("cloudWorkspace.reportPullRequests", () => {
	test("records PRs only for the workspace's own repositories", async () => {
		const result = await callerFor({
			workspaceId: WORKSPACE_ID,
		}).cloudWorkspace.reportPullRequests({
			id: WORKSPACE_ID,
			pullRequests: [
				{ repository: "acme/app", number: 7 },
				{ repository: "someone/else", number: 8 },
			],
		});

		expect(result.ignored).toEqual(["someone/else"]);
		expect(inserted).toEqual([
			{ cloudWorkspaceId: WORKSPACE_ID, repositoryId: "repo-1", prNumber: 7 },
		]);
	});

	test("a box cannot report pull requests for another workspace", async () => {
		await expect(
			callerFor({
				workspaceId: WORKSPACE_ID,
			}).cloudWorkspace.reportPullRequests({
				id: OTHER_WORKSPACE_ID,
				pullRequests: [{ repository: "acme/app", number: 7 }],
			}),
		).rejects.toThrow("only report its own");
		expect(inserted).toEqual([]);
	});
});
