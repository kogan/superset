import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	fileOriginalKey,
	pageManifestKey,
	pageVersionKey,
	signPageTicket,
} from "@superset/shared/usercontent";
import { LocalObjectStore } from "../../../packages/trpc/src/lib/local-objects";
import {
	presignedGetUrl,
	presignedPutUrl,
} from "../../../packages/trpc/src/lib/r2";
import { startStandaloneUsercontentServer } from "./standalone";

const SECRET = "s".repeat(32);

function loopbackUrl(origin: string, pathname: string): string {
	const url = new URL(origin);
	return `http://127.0.0.1:${url.port}${pathname}`;
}

function hostHeader(origin: string): string {
	return new URL(origin).host;
}

function loopbackRequestUrl(input: string): string {
	const url = new URL(input);
	url.hostname = "127.0.0.1";
	return url.toString();
}

function loopbackFetch(
	input: string,
	init: RequestInit = {},
): Promise<Response> {
	const headers = new Headers(init.headers);
	headers.set("Host", new URL(input).host);
	return fetch(loopbackRequestUrl(input), { ...init, headers });
}

let dataDir: string;
let restoreEnv: Record<string, string | undefined>;

beforeEach(async () => {
	dataDir = await mkdtemp(path.join(tmpdir(), "superestset-content-"));
	restoreEnv = {
		SUPERESTSET_DATA_DIR: process.env.SUPERESTSET_DATA_DIR,
		USERCONTENT_TOKEN_SECRET: process.env.USERCONTENT_TOKEN_SECRET,
		USERCONTENT_URL: process.env.USERCONTENT_URL,
		STATIC_URL: process.env.STATIC_URL,
	};
	process.env.SUPERESTSET_DATA_DIR = dataDir;
	process.env.USERCONTENT_TOKEN_SECRET = SECRET;
});

afterEach(async () => {
	for (const [key, value] of Object.entries(restoreEnv)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	await rm(dataDir, { recursive: true, force: true });
});

async function withServer<T>(fn: (origin: string) => Promise<T>): Promise<T> {
	const server = await startStandaloneUsercontentServer({
		dataDir,
		secret: SECRET,
		hostname: "127.0.0.1",
		port: 0,
	});
	process.env.USERCONTENT_URL = server.origin;
	process.env.STATIC_URL = server.origin;
	try {
		return await fn(server.origin);
	} finally {
		await server.close();
	}
}

describe("standalone usercontent object transport", () => {
	test("reports the page-isolated host origin when bundled defaults provide placeholder URLs", async () => {
		const server = await startStandaloneUsercontentServer({
			dataDir,
			secret: SECRET,
			hostname: "127.0.0.1",
			port: 0,
			usercontentUrl: "http://127.0.0.1:1",
			staticUrl: "http://127.0.0.1:1",
		});
		try {
			expect(server.origin).toStartWith("http://frame.usercontent.localhost:");
			const response = await fetch(loopbackUrl(server.origin, "/health"), {
				headers: { Host: hostHeader(server.origin) },
			});
			expect(response.status).toBe(200);
		} finally {
			await server.close();
		}
	});

	test("serves a ticketed page on its page host through a loopback connection", async () => {
		const pageId = "00000000-0000-4000-8000-000000000003";
		const store = new LocalObjectStore(dataDir);
		await store.put({
			bucket: "private",
			key: pageManifestKey(pageId),
			body: JSON.stringify({
				v: 1,
				pageId,
				slug: "local-page",
				visibility: "org",
				sharedVersion: null,
				latestVersion: 1,
				versions: {
					"1": {
						key: pageVersionKey(pageId, 1),
						contentType: "text/html",
					},
				},
			}),
			contentType: "application/json",
		});
		await store.put({
			bucket: "private",
			key: pageVersionKey(pageId, 1),
			body: "<h1>local page</h1>",
			contentType: "text/html",
		});
		const ticket = await signPageTicket(SECRET, {
			pageId,
			version: 1,
			exp: Math.floor(Date.now() / 1000) + 60,
		});
		const server = await startStandaloneUsercontentServer({
			dataDir,
			secret: SECRET,
			hostname: "127.0.0.1",
			port: 0,
		});
		try {
			const baseHost = hostHeader(server.origin);
			const response = await fetch(
				loopbackUrl(server.origin, `/versions/1/~${ticket}/`),
				{ headers: { Host: `${pageId}.${baseHost}` } },
			);
			expect(response.status).toBe(200);
			expect(response.headers.get("superset-storage-key")).toBe(
				pageVersionKey(pageId, 1),
			);
			expect(response.headers.get("content-security-policy")).toContain(
				"frame-ancestors",
			);
			expect(await response.text()).toContain("local page");
		} finally {
			await server.close();
		}
	});

	test("uploads and downloads through local presigned R2 helper URLs", async () => {
		await withServer(async () => {
			const key = fileOriginalKey("00000000-0000-4000-8000-000000000001");
			const upload = await presignedPutUrl({
				key,
				contentType: "text/plain",
				contentLength: 11,
			});
			const put = await loopbackFetch(upload.url, {
				method: "PUT",
				headers: { ...upload.headers, "Content-Length": "11" },
				body: "hello world",
			});
			expect(put.status).toBe(204);

			const get = await loopbackFetch(await presignedGetUrl(key));
			expect(get.status).toBe(200);
			expect(get.headers.get("content-type")).toBe("text/plain");
			expect(await get.text()).toBe("hello world");
		});
	});

	test("keeps object endpoints private and supports ranges after reopen", async () => {
		const key = fileOriginalKey("00000000-0000-4000-8000-000000000002");
		await withServer(async (origin) => {
			const upload = await presignedPutUrl({
				key,
				contentType: "text/plain",
				contentLength: 10,
			});
			expect(
				await fetch(
					loopbackUrl(
						origin,
						`/_objects/private?key=${encodeURIComponent(key)}`,
					),
					{ headers: { Host: hostHeader(origin) } },
				),
			).toHaveProperty("status", 403);
			expect(
				await loopbackFetch(upload.url, {
					method: "PUT",
					headers: { ...upload.headers, "Content-Length": "10" },
					body: "0123456789",
				}),
			).toHaveProperty("status", 204);
		});

		await withServer(async () => {
			const response = await loopbackFetch(await presignedGetUrl(key), {
				headers: { Range: "bytes=3-6" },
			});
			expect(response.status).toBe(206);
			expect(response.headers.get("content-range")).toBe("bytes 3-6/10");
			expect(await response.text()).toBe("3456");
		});
	});
});
