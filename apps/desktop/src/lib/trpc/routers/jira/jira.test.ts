import { afterEach, describe, expect, test } from "bun:test";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiraRouter } from ".";
import { createJiraClient } from "./jira-client";
import { createJiraPreferences } from "./jira-preferences";
import { createJiraGithubClient } from "./jira-pull-requests";
import {
	type JiraCredentials,
	jiraConnectInputSchema,
	type StoredJiraConnection,
} from "./jira-schema";
import { createJiraStorage } from "./jira-storage";

const cleanup: (() => void | Promise<void>)[] = [];

afterEach(async () => {
	for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

function serve(handler: (request: Request) => Response | Promise<Response>) {
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: (request) =>
			new URL(request.url).pathname.endsWith("/field")
				? Response.json([])
				: handler(request),
	});
	cleanup.push(() => server.stop(true));
	return `${server.url.origin}/jira`;
}

function encryptionFixture() {
	const key = randomBytes(32);
	return {
		isEncryptionAvailable: () => true,
		getSelectedStorageBackend: () => "gnome_libsecret" as const,
		encryptString(plaintext: string) {
			const iv = randomBytes(12);
			const cipher = createCipheriv("aes-256-gcm", key, iv);
			const ciphertext = Buffer.concat([
				cipher.update(plaintext, "utf8"),
				cipher.final(),
			]);
			return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
		},
		decryptString(bytes: Buffer) {
			if (bytes.length < 28) throw new Error("Invalid fixture ciphertext");
			const decipher = createDecipheriv(
				"aes-256-gcm",
				key,
				bytes.subarray(0, 12),
			);
			decipher.setAuthTag(bytes.subarray(12, 28));
			return Buffer.concat([
				decipher.update(bytes.subarray(28)),
				decipher.final(),
			]).toString("utf8");
		},
	};
}

async function storageFixture() {
	const directory = await mkdtemp(join(tmpdir(), "personal-jira-"));
	cleanup.push(() => rm(directory, { recursive: true, force: true }));
	const encryption = encryptionFixture();
	const storage = createJiraStorage({ directory, encryption });
	return {
		directory,
		encryption,
		storage,
		filename: join(directory, "jira-connection.enc"),
	};
}

function issue(key: string, priority: { name: string } | null = null) {
	return {
		id: key,
		key,
		self: "https://untrusted.example/ignore-this",
		fields: {
			summary: `Fix ${key}`,
			status: { name: "In Progress", statusCategory: { key: "indeterminate" } },
			project: { name: "Team" },
			priority,
			updated: "2026-09-17T01:30:00.000+0000",
			privateField: "not returned to renderer",
		},
	};
}

const savedConnection: StoredJiraConnection = {
	version: 2,
	kind: "pat",
	baseUrl: "https://jira.company.example/jira",
	token: "old-personal-access-token",
	displayName: "Local User",
};

describe("Jira URL boundary", () => {
	test("preserves context paths and accepts HTTPS or loopback HTTP only", () => {
		expect(
			jiraConnectInputSchema.parse({
				kind: "pat",
				baseUrl: " https://jira.company.example/jira/ ",
				token: " token ",
			}),
		).toEqual({
			kind: "pat",
			baseUrl: "https://jira.company.example/jira",
			token: "token",
		});
		for (const baseUrl of [
			"http://localhost:9876/jira",
			"http://127.0.0.1/jira",
			"http://[::1]/jira",
		]) {
			expect(
				jiraConnectInputSchema.safeParse({
					kind: "pat",
					baseUrl,
					token: "token",
				}).success,
			).toBe(true);
		}
		for (const baseUrl of [
			"http://jira.company.example",
			"ftp://jira.company.example",
			"file:///tmp/jira",
			"https://user:pass@jira.company.example",
			"https://jira.company.example?token=secret",
			"https://jira.company.example#fragment",
			"invalid",
			"https://jira.company.example?",
			"https://jira.company.example#",
		]) {
			expect(
				jiraConnectInputSchema.safeParse({
					kind: "pat",
					baseUrl,
					token: "token",
				}).success,
			).toBe(false);
		}
		expect(
			jiraConnectInputSchema.safeParse({
				kind: "pat",
				baseUrl: savedConnection.baseUrl,
				token: "token\nheader",
			}).success,
		).toBe(false);
	});
});

describe("Jira requests through the Electron router", () => {
	test("connects locally and paginates by returned rows with only ticket metadata", async () => {
		const requests: {
			url: URL;
			authorization: string | null;
			cookie: string | null;
		}[] = [];
		const baseUrl = serve((request) => {
			const url = new URL(request.url);
			requests.push({
				url,
				authorization: request.headers.get("authorization"),
				cookie: request.headers.get("cookie"),
			});
			if (url.pathname === "/jira/rest/api/2/myself") {
				return Response.json({
					displayName: "Local User",
					active: true,
					emailAddress: "private@example.com",
				});
			}
			if (url.pathname === "/jira/rest/api/2/search") {
				const startAt = Number(url.searchParams.get("startAt"));
				return Response.json({
					startAt,
					total: 3,
					issues:
						startAt === 0
							? [issue("TEAM-1"), issue("TEAM-2", { name: "High" })]
							: [issue("TEAM-3")],
				});
			}
			return new Response("Wrong context path", { status: 404 });
		});
		const { storage, filename } = await storageFixture();
		const caller = createJiraRouter({
			client: createJiraClient({ request: fetch }),
			storage,
		}).createCaller({ senderWindow: null });
		expect(await caller.getConnection()).toEqual({ status: "disconnected" });
		await expect(
			caller.listIssues({
				scope: { kind: "mine" },

				status: "unfinished",
			}),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
		expect(
			await caller.connect({ kind: "pat", baseUrl, token: "fixture-token" }),
		).toEqual({
			status: "connected",
			kind: "pat",
			baseUrl,
			displayName: "Local User",
		});
		expect(await caller.getConnection()).toEqual({
			status: "connected",
			kind: "pat",
			baseUrl,
			displayName: "Local User",
		});
		expect(
			(await readFile(filename)).includes(Buffer.from("fixture-token")),
		).toBe(false);
		const first = await caller.listIssues({
			scope: { kind: "mine" },

			status: "unfinished",
		});
		expect(first.nextCursor).toBe(2);
		expect(first.issues[0]).toEqual({
			id: "TEAM-1",
			key: "TEAM-1",
			summary: "Fix TEAM-1",
			pullRequests: [],
			freshdeskLinks: [],
			assignee: null,
			status: "In Progress",
			statusCategory: "indeterminate",
			project: "Team",
			priority: null,
			updated: "2026-09-17T01:30:00.000+0000",
			url: `${baseUrl}/browse/TEAM-1`,
		});
		expect(first.issues[1]?.priority).toBe("High");
		const second = await caller.listIssues({
			scope: { kind: "mine" },

			status: "unfinished",
			cursor: 2,
		});
		expect(second.nextCursor).toBeNull();
		expect(second.issues.map((row) => row.key)).toEqual(["TEAM-3"]);
		await caller.listIssues({
			scope: { kind: "mine" },

			status: "in-progress",
		});
		expect(
			requests.every(
				(request) =>
					request.authorization === "Bearer fixture-token" &&
					request.cookie === null,
			),
		).toBe(true);
		expect(requests[1]?.url.searchParams.get("jql")).toBe(
			'assignee = currentUser() AND issuetype != "Epic" AND statusCategory != Done ORDER BY updated DESC',
		);
		expect(requests[1]?.url.searchParams.get("fields")).toBe(
			"summary,status,project,priority,updated,assignee,description",
		);
		expect(requests[1]?.url.searchParams.get("maxResults")).toBe("50");
		expect(requests[2]?.url.searchParams.get("startAt")).toBe("2");
		expect(requests[3]?.url.searchParams.get("jql")).toContain(
			'statusCategory = "In Progress"',
		);
		await caller.disconnect();
		await caller.disconnect();
		expect(await caller.getConnection()).toEqual({ status: "disconnected" });
		await expect(stat(filename)).rejects.toMatchObject({ code: "ENOENT" });
	});

	test("failed reconnect preserves the prior encrypted connection and sanitizes errors", async () => {
		const token = "sensitive-rejected-token";
		const baseUrl = serve(() => new Response(token, { status: 401 }));
		const { storage, filename } = await storageFixture();
		await storage.write(savedConnection);
		const bytes = await readFile(filename);
		const caller = createJiraRouter({
			client: createJiraClient({ request: fetch }),
			storage,
		}).createCaller({ senderWindow: null });
		let caught: unknown;
		try {
			await caller.connect({ kind: "pat", baseUrl, token });
		} catch (error) {
			caught = error;
		}
		expect(caught).toMatchObject({ code: "UNAUTHORIZED", cause: undefined });
		expect(String(caught)).not.toContain(token);
		expect(await readFile(filename)).toEqual(bytes);
		expect(await caller.getConnection()).toEqual({
			status: "connected",
			kind: "pat",
			baseUrl: savedConnection.baseUrl,
			displayName: savedConnection.displayName,
		});
	});

	test("disconnect cannot be undone by an already pending connection", async () => {
		const started = Promise.withResolvers<void>();
		const response = Promise.withResolvers<Response>();
		const baseUrl = serve(() => {
			started.resolve();
			return response.promise;
		});
		const { storage } = await storageFixture();
		const caller = createJiraRouter({
			client: createJiraClient({ request: fetch }),
			storage,
		}).createCaller({ senderWindow: null });
		const connecting = caller.connect({ kind: "pat", baseUrl, token: "token" });
		await started.promise;
		const disconnecting = caller.disconnect();
		response.resolve(Response.json({ displayName: "User", active: true }));
		await Promise.all([connecting, disconnecting]);
		expect(await caller.getConnection()).toEqual({ status: "disconnected" });
	});
});

describe("Jira HTTP failure boundaries", () => {
	test("does not send a credential to a redirected endpoint", async () => {
		let redirectRequests = 0;
		const destination = serve(() => {
			redirectRequests++;
			return Response.json({ active: true, displayName: "Wrong server" });
		});
		const baseUrl = serve(() => Response.redirect(destination, 302));
		const client = createJiraClient({ request: fetch });
		await expect(
			client.testConnection({ kind: "pat", baseUrl, token: "fixture-token" }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(redirectRequests).toBe(0);
	});

	test("rejects inactive accounts, non-JSON, malformed fields, and forbidden responses", async () => {
		let response = Response.json({
			displayName: "Inactive User",
			active: false,
		});
		const baseUrl = serve(() => response.clone());
		const client = createJiraClient({ request: fetch });
		const credentials: JiraCredentials = {
			kind: "pat",
			baseUrl,
			token: "fixture-token",
		};
		await expect(client.testConnection(credentials)).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
		response = new Response("<html>private SSO response</html>");
		await expect(client.testConnection(credentials)).rejects.toMatchObject({
			code: "BAD_GATEWAY",
			cause: undefined,
		});
		response = Response.json({ active: true });
		await expect(client.testConnection(credentials)).rejects.toMatchObject({
			code: "BAD_GATEWAY",
		});
		response = new Response("company policy details", { status: 403 });
		await expect(client.testConnection(credentials)).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
		response = new Response("server-internal-secret", { status: 500 });
		await expect(client.testConnection(credentials)).rejects.toMatchObject({
			code: "BAD_GATEWAY",
			cause: undefined,
		});
		response = Response.json({
			startAt: 0,
			total: 1,
			issues: [{ fields: { summary: "missing status" } }],
		});
		await expect(
			client.listIssues({
				credentials,
				scope: { kind: "mine" },

				status: "unfinished",
			}),
		).rejects.toMatchObject({ code: "BAD_GATEWAY" });
	});

	test("ends empty pages and rejects a server that ignores the requested cursor", async () => {
		let response = { startAt: 0, total: 25, issues: [] };
		const baseUrl = serve(() => Response.json(response));
		const client = createJiraClient({ request: fetch });
		const credentials: JiraCredentials = {
			kind: "pat",
			baseUrl,
			token: "fixture-token",
		};
		expect(
			await client.listIssues({
				credentials,
				scope: { kind: "mine" },

				status: "unfinished",
			}),
		).toEqual({ issues: [], total: 25, nextCursor: null });
		response = { startAt: 0, total: 25, issues: [] };
		await expect(
			client.listIssues({
				credentials,
				scope: { kind: "mine" },

				status: "unfinished",
				cursor: 10,
			}),
		).rejects.toMatchObject({ code: "BAD_GATEWAY" });
	});

	test("times out a stalled request without exposing request details", async () => {
		const baseUrl = serve(async () => {
			await Bun.sleep(100);
			return Response.json({ displayName: "User", active: true });
		});
		const client = createJiraClient({ request: fetch, timeoutMs: 10 });
		await expect(
			client.testConnection({ kind: "pat", baseUrl, token: "never-in-errors" }),
		).rejects.toMatchObject({ code: "TIMEOUT", cause: undefined });
	});
});

describe("Jira encrypted storage", () => {
	test("writes private encrypted files atomically and replaces the singleton", async () => {
		const { storage, directory, filename } = await storageFixture();
		await storage.write(savedConnection);
		expect((await stat(filename)).mode & 0o777).toBe(0o600);
		expect(await storage.read()).toEqual(savedConnection);
		expect(
			(await readFile(filename)).includes(Buffer.from(savedConnection.token)),
		).toBe(false);
		await storage.write({ ...savedConnection, token: "new-token" });
		expect((await storage.read())?.token).toBe("new-token");
		expect(await readdir(directory)).toEqual(["jira-connection.enc"]);
	});

	test("never falls back to plaintext when encryption is unavailable", async () => {
		const { storage, directory, filename, encryption } = await storageFixture();
		await storage.write(savedConnection);
		const before = await readFile(filename);
		const locked = createJiraStorage({
			directory,
			encryption: { ...encryption, isEncryptionAvailable: () => false },
		});
		await expect(
			locked.write({ ...savedConnection, token: "replacement" }),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
		expect(await readFile(filename)).toEqual(before);
		const plaintext = createJiraStorage({
			directory,
			platform: "linux",
			encryption: {
				...encryption,
				getSelectedStorageBackend: () => "basic_text",
			},
		});
		await expect(plaintext.write(savedConnection)).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
		});
		expect(await readFile(filename)).toEqual(before);
	});

	test("reports corrupt storage without leaking contents and allows removal", async () => {
		const { storage, filename } = await storageFixture();
		await writeFile(filename, "private-corrupt-connection");
		await expect(storage.read()).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
			cause: undefined,
		});
		await storage.remove();
		expect(await storage.read()).toBeNull();
	});
});

describe("Atlassian API tokens", () => {
	test("uses email and Basic auth with Cloud search and opaque pagination", async () => {
		const requests: {
			url: URL;
			authorization: string | null;
			cookie: string | null;
		}[] = [];
		const nextPage = "next+/=?&page";
		const baseUrl = serve((request) => {
			const url = new URL(request.url);
			requests.push({
				url,
				authorization: request.headers.get("authorization"),
				cookie: request.headers.get("cookie"),
			});
			if (url.pathname === "/jira/rest/api/3/myself")
				return Response.json({ active: true, displayName: "Cloud User" });
			if (url.pathname === "/jira/rest/api/3/search/jql") {
				return url.searchParams.get("nextPageToken") === nextPage
					? Response.json({ isLast: true, issues: [issue("CLOUD-2")] })
					: Response.json({
							isLast: false,
							nextPageToken: nextPage,
							issues: [issue("CLOUD-1")],
						});
			}
			return new Response("Wrong Cloud endpoint", { status: 404 });
		});
		const { storage, filename } = await storageFixture();
		const caller = createJiraRouter({
			client: createJiraClient({ request: fetch }),
			storage,
		}).createCaller({ senderWindow: null });
		const credentials = {
			kind: "cloud-api-token",
			baseUrl,
			email: "developer@example.com",
			token: "api-token-fixture",
		} satisfies JiraCredentials;
		expect(await caller.connect(credentials)).toEqual({
			status: "connected",
			kind: credentials.kind,
			baseUrl,
			email: credentials.email,
			displayName: "Cloud User",
		});
		const first = await caller.listIssues({
			scope: { kind: "mine" },

			status: "unfinished",
		});
		expect(first.total).toBeNull();
		expect(first.nextCursor).toBe(nextPage);
		const second = await caller.listIssues({
			scope: { kind: "mine" },

			status: "unfinished",
			cursor: nextPage,
		});
		expect(second.nextCursor).toBeNull();
		expect(second.issues[0]?.key).toBe("CLOUD-2");
		expect(second.issues[0]?.url).toBe(`${baseUrl}/browse/CLOUD-2`);
		await caller.listIssues({
			scope: { kind: "mine" },

			status: "in-progress",
		});
		const expectedHeader = `Basic ${Buffer.from(`${credentials.email}:${credentials.token}`).toString("base64")}`;
		expect(
			requests.every(
				(request) =>
					request.authorization === expectedHeader && request.cookie === null,
			),
		).toBe(true);
		expect(requests[1]?.url.searchParams.has("startAt")).toBe(false);
		expect(requests[1]?.url.searchParams.has("nextPageToken")).toBe(false);
		expect(requests[2]?.url.searchParams.get("nextPageToken")).toBe(nextPage);
		expect(requests[3]?.url.searchParams.get("jql")).toContain(
			'statusCategory = "In Progress"',
		);
		expect(
			(await readFile(filename)).includes(Buffer.from(credentials.token)),
		).toBe(false);
		const restored = createJiraRouter({
			client: createJiraClient({ request: fetch }),
			storage,
		}).createCaller({ senderWindow: null });
		expect(await restored.getConnection()).toEqual(
			await caller.getConnection(),
		);
		expect(
			(
				await restored.listIssues({
					scope: { kind: "mine" },

					status: "unfinished",
				})
			).issues[0]?.key,
		).toBe("CLOUD-1");
	});

	test("discovers scoped-token Cloud IDs without credentials and only uses the Atlassian gateway", async () => {
		const cloudId = "11111111-2222-4333-8444-555555555555";
		const received: { path: string; auth: string | null }[] = [];
		const baseUrl = serve((request) => {
			const path = new URL(request.url).pathname;
			received.push({ path, auth: request.headers.get("authorization") });
			if (path === "/_edge/tenant_info")
				return Response.json({ cloudId, url: "https://untrusted.example" });
			if (path === `/ex/jira/${cloudId}/rest/api/3/myself`)
				return Response.json({ active: true, displayName: "Scoped User" });
			if (path === `/ex/jira/${cloudId}/rest/api/3/search/jql`)
				return Response.json({ isLast: true, issues: [issue("SCOPED-1")] });
			return new Response("Wrong scoped path", { status: 404 });
		});
		const destinations: string[] = [];
		const client = createJiraClient({
			request: (url, init) => {
				destinations.push(url);
				const destination = new URL(url);
				if (destination.origin === "https://api.atlassian.com") {
					return fetch(
						new URL(destination.pathname + destination.search, baseUrl),
						init,
					);
				}
				expect(destination.origin).toBe(new URL(baseUrl).origin);
				return fetch(url, init);
			},
		});
		const { storage } = await storageFixture();
		const caller = createJiraRouter({ client, storage }).createCaller({
			senderWindow: null,
		});
		const credentials = {
			kind: "cloud-scoped-token",
			baseUrl,
			email: "scoped@example.com",
			token: "scoped-fixture",
		};
		const connected = await caller.connect({
			...credentials,
			kind: "cloud-scoped-token",
		});
		expect(connected).toMatchObject({
			kind: "cloud-scoped-token",
			email: credentials.email,
		});
		expect(connected).not.toHaveProperty("token");
		expect(connected).not.toHaveProperty("cloudId");
		const result = await caller.listIssues({
			scope: { kind: "mine" },

			status: "unfinished",
		});
		expect(result.issues[0]?.url).toBe(`${baseUrl}/browse/SCOPED-1`);
		expect(received[0]).toEqual({ path: "/_edge/tenant_info", auth: null });
		expect(
			received
				.slice(1)
				.every(
					(request) =>
						request.auth ===
						`Basic ${Buffer.from(`${credentials.email}:${credentials.token}`).toString("base64")}`,
				),
		).toBe(true);
		expect(
			destinations
				.slice(1)
				.every((url) =>
					url.startsWith(
						`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/`,
					),
				),
		).toBe(true);
		expect(await storage.read()).toMatchObject({
			kind: "cloud-scoped-token",
			cloudId,
			version: 2,
		});
	});

	test("rejects invalid email and prevents malformed discovery IDs from receiving credentials", async () => {
		const input = {
			kind: "cloud-scoped-token",
			baseUrl: "https://jira.example.com",
			email: "invalid\r\nemail",
			token: "fixture",
		};
		expect(jiraConnectInputSchema.safeParse(input).success).toBe(false);
		const requests: (string | null)[] = [];
		const baseUrl = serve((request) => {
			requests.push(request.headers.get("authorization"));
			return Response.json({ cloudId: "../../attacker" });
		});
		await expect(
			createJiraClient({ request: fetch }).testConnection({
				kind: "cloud-scoped-token",
				baseUrl,
				email: "user@example.com",
				token: "fixture",
			}),
		).rejects.toMatchObject({ code: "BAD_GATEWAY" });
		expect(requests).toEqual([null]);
	});

	test("rejects a looping or malformed Cloud continuation and sanitizes API-token failures", async () => {
		let response = Response.json({
			isLast: false,
			nextPageToken: "repeated",
			issues: [issue("CLOUD-1")],
		});
		const baseUrl = serve(() => response.clone());
		const credentials = {
			kind: "cloud-api-token",
			baseUrl,
			email: "user@example.com",
			token: "private-api-token",
		} satisfies JiraCredentials;
		const client = createJiraClient({ request: fetch });
		await expect(
			client.listIssues({
				credentials,
				scope: { kind: "mine" },

				status: "unfinished",
				cursor: "repeated",
			}),
		).rejects.toMatchObject({ code: "BAD_GATEWAY" });
		response = Response.json({ isLast: false, issues: [issue("CLOUD-1")] });
		await expect(
			client.listIssues({
				credentials,
				scope: { kind: "mine" },

				status: "unfinished",
			}),
		).rejects.toMatchObject({ code: "BAD_GATEWAY" });
		response = new Response(credentials.token, { status: 401 });
		let caught: unknown;
		try {
			await client.testConnection(credentials);
		} catch (error) {
			caught = error;
		}
		expect(caught).toMatchObject({ code: "UNAUTHORIZED", cause: undefined });
		expect(String(caught)).not.toContain(credentials.token);
	});

	test("reads the previous encrypted PAT format without losing its connection", async () => {
		const { storage, filename, encryption } = await storageFixture();
		const { kind: _kind, ...legacy } = savedConnection;
		await writeFile(
			filename,
			encryption.encryptString(JSON.stringify({ ...legacy, version: 1 })),
		);
		expect(await storage.read()).toEqual(savedConnection);
	});
});

describe("Jira team board", () => {
	test("persists a board and searches all members and statuses, including safe server-side member filters", async () => {
		const searches: URL[] = [];
		const baseUrl = serve((request) => {
			const url = new URL(request.url);
			if (url.pathname.endsWith("/myself"))
				return Response.json({ displayName: "Local User", active: true });
			if (url.pathname.endsWith("/board"))
				return Response.json({
					startAt: Number(url.searchParams.get("startAt")),
					isLast: false,
					values: [{ id: 99, name: "Team board" }],
				});
			if (url.pathname.endsWith("/board/99/configuration"))
				return Response.json({
					id: 99,
					name: "Team board",
					filter: { id: "54321" },
				});
			if (url.pathname.endsWith("/user/search"))
				return Response.json([
					{
						displayName: "Teammate",
						accountId: "account:other",
						emailAddress: "private@example.com",
					},
				]);
			if (url.pathname.endsWith("/search/jql")) {
				searches.push(url);
				const ticket = issue("SL-1");
				return Response.json({
					isLast: true,
					issues: [
						{
							...ticket,
							fields: {
								...ticket.fields,
								assignee: {
									accountId: "account:other",
									displayName: "Teammate",
									emailAddress: "private@example.com",
								},
							},
						},
					],
				});
			}
			return new Response("missing", { status: 404 });
		});
		const { directory, storage } = await storageFixture();
		const preferences = createJiraPreferences(directory);
		const caller = createJiraRouter({
			client: createJiraClient({ request: fetch }),
			storage,
			preferences,
		}).createCaller({ senderWindow: null });
		await caller.connect({
			kind: "cloud-api-token",
			baseUrl,
			email: "local@example.com",
			token: "fake",
		});
		expect(await caller.listBoards({ search: "Team", cursor: 2 })).toEqual({
			boards: [{ id: 99, name: "Team board" }],
			nextCursor: 3,
		});
		await caller.selectBoard(99);
		expect(await createJiraPreferences(directory).read()).toEqual({
			baseUrl,
			teamBoard: { id: 99, name: "Team board" },
		});
		const all = await caller.listIssues({
			scope: { kind: "board", boardId: 99, assignee: { kind: "all" } },

			status: "all",
		});
		expect(searches[0]?.searchParams.get("jql")).toBe(
			'filter = 54321 AND issuetype != "Epic" ORDER BY updated DESC',
		);
		expect(all.issues[0]?.assignee).toEqual({
			id: "account:other",
			displayName: "Teammate",
		});
		await caller.listIssues({
			scope: {
				kind: "board",
				boardId: 99,
				assignee: { kind: "member", id: 'name" OR project = "other' },
			},

			status: "unfinished",
		});
		expect(searches[1]?.searchParams.get("jql")).toBe(
			`filter = 54321 AND assignee = ${JSON.stringify('name" OR project = "other')} AND issuetype != "Epic" AND statusCategory != Done ORDER BY updated DESC`,
		);
		await caller.listIssues({
			scope: { kind: "board", boardId: 99, assignee: { kind: "unassigned" } },

			status: "all",
		});
		expect(searches[2]?.searchParams.get("jql")).toBe(
			'filter = 54321 AND assignee IS EMPTY AND issuetype != "Epic" ORDER BY updated DESC',
		);
		await caller.listIssues({
			scope: { kind: "board", boardId: 99, assignee: { kind: "all" } },
			visibleStatuses: ["HPQ", "Needs QA", "Being QA'd"],
			status: "all",
		});
		expect(searches[3]?.searchParams.get("jql")).toBe(
			'filter = 54321 AND status IN ("HPQ", "Needs QA", "Being QA\'d") AND issuetype != "Epic" ORDER BY updated DESC',
		);
		await caller.listIssues({
			scope: { kind: "board", boardId: 99, assignee: { kind: "all" } },
			visibleStatuses: ["In Development", "Needs QA", "Monitoring"],
			status: "all",
		});
		expect(searches[4]?.searchParams.get("jql")).toBe(
			'filter = 54321 AND status IN ("In Development", "Needs QA", "Monitoring") AND issuetype != "Epic" ORDER BY updated DESC',
		);
		expect(await caller.searchMembers({ search: "Teammate" })).toEqual([
			{ id: "account:other", displayName: "Teammate" },
		]);
		await caller.setGithubScope("example/repository");
		expect((await preferences.read()).teamBoard?.id).toBe(99);
		await expect(
			caller.setGithubScope("example/repository is:issue"),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});
	test("preserves Jira PR links when GitHub lookup fails and keeps reads bounded", async () => {
		let active = 0;
		let peak = 0;
		const baseUrl = serve(async (request) => {
			const url = new URL(request.url);
			active++;
			peak = Math.max(peak, active);
			await Bun.sleep(3);
			active--;
			if (url.pathname.endsWith("/SL-1/remotelink"))
				return Response.json([
					{
						object: {
							url: "https://github.com/example/repository/pull/23/files",
							title: "Fix SL-1",
						},
					},
					{ object: { url: "javascript:alert(1)" } },
				]);
			if (url.pathname.endsWith("/SL-3/remotelink"))
				return new Response("private error", { status: 403 });
			return Response.json([]);
		});
		const { directory, storage } = await storageFixture();
		await storage.write({ ...savedConnection, baseUrl });
		const preferences = createJiraPreferences(directory);
		await preferences.write({ baseUrl, githubScope: "example/repository" });
		const caller = createJiraRouter({
			storage,
			preferences,
			client: createJiraClient({ request: fetch }),
			github: createJiraGithubClient({
				command: async () => {
					throw new Error("secret");
				},
			}),
		}).createCaller({ senderWindow: null });
		const result = await caller.listPullRequests({
			issueKeys: ["SL-1", "SL-2", "SL-3", "SL-4", "SL-5", "SL-6"],
		});
		expect(result.jiraUnavailable).toBe(true);
		expect(result.githubUnavailable).toBe(true);
		expect(peak).toBeLessThanOrEqual(4);
		expect(result.issues[0]?.links[0]?.url).toBe(
			"https://github.com/example/repository/pull/23",
		);
		expect(JSON.stringify(result)).not.toContain("secret");
	});
});

test("PR cache reuses overlapping filters, and refresh and disconnect clear it", async () => {
	let reads = 0;
	const baseUrl = serve(() => {
		reads++;
		return Response.json([]);
	});
	const { directory, storage } = await storageFixture();
	await storage.write({ ...savedConnection, baseUrl });
	const caller = createJiraRouter({
		storage,
		preferences: createJiraPreferences(directory),
		client: createJiraClient({ request: fetch }),
	}).createCaller({ senderWindow: null });
	await caller.listPullRequests({ issueKeys: ["SL-1", "SL-2"] });
	await caller.listPullRequests({ issueKeys: ["SL-2", "SL-3"] });
	expect(reads).toBe(3);
	await caller.refreshPullRequests();
	await caller.listPullRequests({ issueKeys: ["SL-1"] });
	expect(reads).toBe(4);
	await caller.disconnect();
	await expect(
		caller.listPullRequests({ issueKeys: ["SL-1"] }),
	).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
});

describe("saved Jira column layout", () => {
	test("persists layout across router restarts without changing board grouping or other preferences", async () => {
		const { directory, storage } = await storageFixture();
		await storage.write(savedConnection);
		const preferences = createJiraPreferences(directory);
		const original = {
			baseUrl: savedConnection.baseUrl,
			teamBoard: { id: 7, name: "Team" },
			columns: [{ name: "In dev", statuses: ["In Development", "Needs QA"] }],
			githubScope: "example/repository",
		};
		await preferences.write(original);
		const caller = createJiraRouter({ storage, preferences }).createCaller({
			senderWindow: null,
		});
		const layout = [
			{ key: "QA", visible: true },
			{ key: "In dev", visible: false },
		];
		await caller.setColumnLayout({
			baseUrl: savedConnection.baseUrl,
			boardId: 7,
			layout,
		});
		const restarted = createJiraRouter({
			storage,
			preferences: createJiraPreferences(directory),
		}).createCaller({ senderWindow: null });
		expect(await restarted.getPreferences()).toEqual({
			...original,
			columnLayout: layout,
		});
		await restarted.setColumnLayout({
			baseUrl: savedConnection.baseUrl,
			boardId: 7,
			layout: [],
		});
		expect(await preferences.read()).toEqual({ ...original, columnLayout: [] });
		await expect(
			restarted.setColumnLayout({
				baseUrl: savedConnection.baseUrl,
				boardId: 7,
				layout: [
					{ key: "QA", visible: true },
					{ key: "QA", visible: false },
				],
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	test("keeps a reselected board's layout, resets a different board and rejects stale saves", async () => {
		const baseUrl = serve((request) => {
			const id = Number(new URL(request.url).pathname.split("/").at(-2));
			return Response.json({
				id,
				name: `Board ${id}`,
				type: "kanban",
				filter: { id: "123" },
			});
		});
		const { directory, storage } = await storageFixture();
		await storage.write({ ...savedConnection, baseUrl });
		const preferences = createJiraPreferences(directory);
		const columnLayout = [{ key: "QA", visible: false }];
		await preferences.write({
			baseUrl,
			teamBoard: { id: 7, name: "Board 7" },
			columnLayout,
		});
		const client = createJiraClient({
			request: (url, init) => fetch(url, init),
		});
		const caller = createJiraRouter({
			storage,
			preferences,
			client,
		}).createCaller({ senderWindow: null });
		expect((await caller.selectBoard(7)).columnLayout).toEqual(columnLayout);
		expect((await caller.selectBoard(99)).columnLayout).toBeUndefined();
		await expect(
			caller.setColumnLayout({ baseUrl, boardId: 7, layout: columnLayout }),
		).rejects.toMatchObject({ code: "CONFLICT" });
		await expect(
			caller.setColumnLayout({
				baseUrl: savedConnection.baseUrl,
				boardId: 99,
				layout: columnLayout,
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect((await preferences.read()).columnLayout).toBeUndefined();
		expect((await preferences.read()).teamBoard?.id).toBe(99);
	});
});

test("Freshdesk remote links share the PR lookup and survive its cache", async () => {
	let reads = 0;
	const baseUrl = serve(() => {
		reads++;
		return Response.json([
			{
				object: {
					url: "https://support-team.freshdesk.com/a/tickets/123?source=jira",
					title: "Customer issue",
				},
			},
			{ object: { url: "https://github.com/example/repository/pull/23" } },
			{
				object: {
					url: "https://support-team.freshdesk.com.evil.test/a/tickets/456",
				},
			},
		]);
	});
	const { directory, storage } = await storageFixture();
	await storage.write({ ...savedConnection, baseUrl });
	const caller = createJiraRouter({
		storage,
		preferences: createJiraPreferences(directory),
		client: createJiraClient({ request: fetch }),
	}).createCaller({ senderWindow: null });
	const first = await caller.listPullRequests({ issueKeys: ["SL-1"] });
	expect(first.issues[0]?.freshdeskLinks).toEqual([
		{
			url: "https://support-team.freshdesk.com/a/tickets/123",
			ticketId: "123",
		},
	]);
	expect(first.issues[0]?.links[0]?.number).toBe(23);
	expect(await caller.listPullRequests({ issueKeys: ["SL-1"] })).toEqual(first);
	expect(reads).toBe(1);
	await caller.refreshPullRequests();
	await caller.listPullRequests({ issueKeys: ["SL-1"] });
	expect(reads).toBe(2);
});
