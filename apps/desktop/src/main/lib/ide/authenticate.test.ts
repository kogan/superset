import { describe, expect, test } from "bun:test";
import { idePrepareSchema } from "shared/ide-types";
import { authenticateIde, ideFolderUrl, isIdeOrigin } from "./authenticate";

const password = "test-password-that-is-at-least-32-characters";

describe("IDE authentication", () => {
	test("verifies the login cookie before exposing a view", async () => {
		const server = Bun.serve({
			port: 0,
			async fetch(request) {
				if (new URL(request.url).pathname === "/login") {
					const body = new URLSearchParams(await request.text());
					expect(body.get("password")).toBe(password);
					return new Response(null, {
						status: 302,
						headers: {
							Location: "/",
							"Set-Cookie": "test-session=authenticated; HttpOnly",
						},
					});
				}
				return new Response(null, {
					status:
						request.headers.get("Cookie") === "test-session=authenticated"
							? 200
							: 302,
				});
			},
		});
		try {
			const cookies = await authenticateIde({
				origin: server.url.origin,
				folderPath: "/tmp",
				password,
			});
			expect(cookies).toEqual([
				{ name: "test-session", value: "authenticated" },
			]);
		} finally {
			await server.stop(true);
		}
	});

	test("rejects a successful login response when the session cookie is missing", async () => {
		const server = Bun.serve({
			port: 0,
			fetch: () => new Response(null, { status: 302 }),
		});
		try {
			await expect(
				authenticateIde({
					origin: server.url.origin,
					folderPath: "/tmp",
					password,
					fetch,
				}),
			).rejects.toThrow("session cookie");
		} finally {
			await server.stop(true);
		}
	});

	test("rejects bad credentials without putting them in the error", async () => {
		const server = Bun.serve({
			port: 0,
			fetch: () => new Response("Login again"),
		});
		try {
			await expect(
				authenticateIde({
					origin: server.url.origin,
					folderPath: "/tmp",
					password,
					fetch,
				}),
			).rejects.toThrow("Could not authenticate the IDE");
		} finally {
			await server.stop(true);
		}
	});
});

describe("IDE connection boundaries", () => {
	test("retains encoded worktree paths without embedding authentication", () => {
		const url = new URL(
			ideFolderUrl("http://127.0.0.1:1234", "/tmp/my worktree/#folder?name"),
		);
		expect(url.searchParams.get("folder")).toBe(
			"/tmp/my worktree/#folder?name",
		);
		expect([...url.searchParams.keys()]).toEqual(["folder"]);
	});

	test("restricts IDE navigation to its exact origin", () => {
		const origin = "http://127.0.0.1:1234";
		expect(isIdeOrigin(`${origin}/?folder=/tmp`, origin)).toBe(true);
		for (const url of [
			"http://127.0.0.1:1235",
			"http://localhost:1234",
			"file:///tmp",
			"javascript:void(0)",
			"not a URL",
		]) {
			expect(isIdeOrigin(url, origin)).toBe(false);
		}
	});

	test("requires UUID runtime identity, a bounded port and a host URL without credentials", () => {
		const input = {
			paneId: "pane",
			workspaceId: "workspace",
			target: { kind: "local" },
			connection: {
				sessionId: crypto.randomUUID(),
				port: 1234,
				password,
				folderPath: "/tmp/worktree",
			},
		};
		expect(idePrepareSchema.safeParse(input).success).toBe(true);
		expect(
			idePrepareSchema.safeParse({
				...input,
				connection: { ...input.connection, sessionId: "wrong" },
			}).success,
		).toBe(false);
		expect(
			idePrepareSchema.safeParse({
				...input,
				connection: { ...input.connection, port: 65536 },
			}).success,
		).toBe(false);
		for (const hostUrl of [
			"file:///tmp",
			"https://secret@example.com",
			"https://example.com/?token=secret",
		]) {
			expect(
				idePrepareSchema.safeParse({
					...input,
					target: { kind: "remote", hostUrl },
				}).success,
			).toBe(false);
		}
	});
});
