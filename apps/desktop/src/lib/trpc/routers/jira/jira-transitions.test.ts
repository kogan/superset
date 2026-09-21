import { afterEach, describe, expect, test } from "bun:test";
import { createJiraClient } from "./jira-client";
import type { JiraCredentials } from "./jira-schema";

const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const dispose of cleanup.splice(0)) dispose();
});

function fixture(handler: (request: Request) => Response | Promise<Response>) {
	const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler });
	cleanup.push(() => server.stop(true));
	return {
		client: createJiraClient({ request: fetch }),
		credentials: {
			kind: "cloud-api-token",
			baseUrl: `${server.url.origin}/jira`,
			email: "test@example.com",
			token: "fixture",
		} satisfies JiraCredentials,
	};
}

const available = {
	id: "21",
	name: "Start QA",
	to: { name: "Being QA'd" },
	fields: {},
};

describe("Jira status transitions", () => {
	test("lists allowed destinations and fields required by a transition", async () => {
		const { client, credentials } = fixture((request) => {
			const url = new URL(request.url);
			expect(url.pathname).toBe("/jira/rest/api/3/issue/SL-12/transitions");
			expect(url.searchParams.get("expand")).toBe("transitions.fields");
			return Response.json({
				transitions: [
					available,
					{
						id: "31",
						name: "Resolve",
						to: { name: "Done" },
						fields: {
							resolution: {
								name: "Resolution",
								required: true,
								hasDefaultValue: false,
							},
							assignee: {
								name: "Assignee",
								required: true,
								hasDefaultValue: true,
							},
						},
					},
					{ ...available, id: "99", isAvailable: false },
				],
			});
		});
		expect(
			await client.listTransitions({ credentials, issueKey: "SL-12" }),
		).toEqual([
			{ id: "21", name: "Start QA", status: "Being QA'd", requiredFields: [] },
			{
				id: "31",
				name: "Resolve",
				status: "Done",
				requiredFields: ["Resolution"],
			},
		]);
	});

	test("rechecks availability, posts a transition once and accepts an empty 204 response", async () => {
		const requests: string[] = [];
		const { client, credentials } = fixture(async (request) => {
			requests.push(request.method);
			expect(request.headers.get("user-agent")).toBe("SuperestSet");
			expect(request.headers.get("authorization")).toBe(
				`Basic ${Buffer.from("test@example.com:fixture").toString("base64")}`,
			);
			if (request.method === "GET")
				return Response.json({ transitions: [available] });
			expect(request.headers.get("content-type")).toBe("application/json");
			expect(await request.json()).toEqual({ transition: { id: "21" } });
			return new Response(null, { status: 204 });
		});
		await client.transitionIssue({
			credentials,
			issueKey: "SL-12",
			transitionId: "21",
		});
		expect(requests).toEqual(["GET", "POST"]);
	});

	test("does not post an unavailable transition or one requiring a Jira form", async () => {
		let writes = 0;
		const { client, credentials } = fixture((request) => {
			if (request.method === "POST") writes++;
			return Response.json({
				transitions: [
					{
						...available,
						fields: { resolution: { name: "Resolution", required: true } },
					},
				],
			});
		});
		await expect(
			client.transitionIssue({
				credentials,
				issueKey: "SL-12",
				transitionId: "99",
			}),
		).rejects.toThrow();
		await expect(
			client.transitionIssue({
				credentials,
				issueKey: "SL-12",
				transitionId: "21",
			}),
		).rejects.toThrow();
		expect(writes).toBe(0);
	});

	test.each([
		400, 403, 409, 500,
	])("keeps failures sanitized and never retries a rejected write (%i)", async (status) => {
		let writes = 0;
		const { client, credentials } = fixture((request) => {
			if (request.method === "GET")
				return Response.json({ transitions: [available] });
			writes++;
			return new Response("private server response fixture-secret", { status });
		});
		const move = client.transitionIssue({
			credentials,
			issueKey: "SL-12",
			transitionId: "21",
		});
		await expect(move).rejects.not.toThrow("fixture-secret");
		expect(writes).toBe(1);
	});

	test("does not follow a redirected write", async () => {
		let redirected = 0;
		const { client, credentials } = fixture((request) => {
			if (new URL(request.url).pathname === "/redirected") {
				redirected++;
				return new Response(null, { status: 204 });
			}
			if (request.method === "GET")
				return Response.json({ transitions: [available] });
			return Response.redirect(new URL("/redirected", request.url), 307);
		});
		await expect(
			client.transitionIssue({
				credentials,
				issueKey: "SL-12",
				transitionId: "21",
			}),
		).rejects.toThrow("redirected");
		expect(redirected).toBe(0);
	});

	test("uses Data Center v2 and scoped Cloud gateway authentication", async () => {
		for (const credentials of [
			{
				kind: "pat",
				baseUrl: "https://jira.example.com/context",
				token: "fixture",
			},
			{
				kind: "cloud-scoped-token",
				baseUrl: "https://example.atlassian.net",
				email: "test@example.com",
				token: "fixture",
				cloudId: "12345678-1234-4234-9234-123456789abc",
			},
		] satisfies JiraCredentials[]) {
			const requests: {
				url: string;
				method: string;
				authorization: string | null;
			}[] = [];
			const client = createJiraClient({
				request: async (url, init) => {
					requests.push({
						url,
						method: init.method ?? "GET",
						authorization: new Headers(init.headers).get("authorization"),
					});
					return init.method === "POST"
						? new Response(null, { status: 204 })
						: Response.json({ transitions: [available] });
				},
			});
			await client.transitionIssue({
				credentials,
				issueKey: "SL-12",
				transitionId: "21",
			});
			const expectedBase =
				credentials.kind === "pat"
					? "https://jira.example.com/context/rest/api/2/issue/SL-12/transitions"
					: `https://api.atlassian.com/ex/jira/${credentials.cloudId}/rest/api/3/issue/SL-12/transitions`;
			expect(requests.map((request) => request.url.split("?")[0])).toEqual([
				expectedBase,
				expectedBase,
			]);
			expect(requests[1]?.authorization).toBe(
				credentials.kind === "pat"
					? "Bearer fixture"
					: `Basic ${Buffer.from("test@example.com:fixture").toString("base64")}`,
			);
		}
	});
});
