import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	handleLocalObjectRequest,
	LocalObjectStore,
	ObjectKeyError,
	signedObjectUrl,
} from ".";

const SECRET = "x".repeat(32);

let dataDir: string;

beforeEach(async () => {
	dataDir = await mkdtemp(path.join(tmpdir(), "superestset-objects-"));
});

afterEach(async () => {
	await rm(dataDir, { recursive: true, force: true });
});

function signed({
	method,
	key,
	contentType,
	contentLength,
	expiresInSeconds = 60,
}: {
	method: "GET" | "PUT";
	key: string;
	contentType?: string;
	contentLength?: number;
	expiresInSeconds?: number;
}): string {
	return signedObjectUrl({
		origin: "http://127.0.0.1:1234",
		secret: SECRET,
		grant: {
			v: 1,
			bucket: "private",
			key,
			method,
			...(contentType ? { contentType } : {}),
			...(contentLength !== undefined ? { contentLength } : {}),
			exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
		},
	});
}

async function objectRequest(request: Request): Promise<Response> {
	const response = await handleLocalObjectRequest({
		request,
		store: new LocalObjectStore(dataDir),
		secret: SECRET,
	});
	if (!response) throw new Error("request was not handled");
	return response;
}

describe("LocalObjectStore", () => {
	test("writes bytes and metadata, then reopens them from a new store", async () => {
		await new LocalObjectStore(dataDir).put({
			bucket: "private",
			key: "pages/one.html",
			body: "<h1>one</h1>",
			contentType: "text/html",
			cacheControl: "private, max-age=60",
		});

		const reopened = new LocalObjectStore(dataDir);
		expect(
			await reopened.head({ bucket: "private", key: "pages/one.html" }),
		).toEqual({
			sizeBytes: 12,
			contentType: "text/html",
			cacheControl: "private, max-age=60",
		});
		const object = await reopened.get({
			bucket: "private",
			key: "pages/one.html",
		});
		expect(await object?.text()).toBe("<h1>one</h1>");
	});

	test("returns null for a missing key", async () => {
		const store = new LocalObjectStore(dataDir);
		expect(await store.head({ bucket: "private", key: "missing" })).toBeNull();
		expect(await store.get({ bucket: "private", key: "missing" })).toBeNull();
	});

	test("rejects keys that escape the object root", async () => {
		const store = new LocalObjectStore(dataDir);
		await expect(
			store.put({
				bucket: "private",
				key: "../escape",
				body: "no",
				contentType: "text/plain",
			}),
		).rejects.toBeInstanceOf(ObjectKeyError);
	});
});

describe("signed local object HTTP", () => {
	test("writes and reads through method-bound signed grants", async () => {
		const put = signed({
			method: "PUT",
			key: "uploads/file.txt",
			contentType: "text/plain",
			contentLength: 5,
		});
		const write = await objectRequest(
			new Request(put, {
				method: "PUT",
				headers: { "Content-Type": "text/plain", "Content-Length": "5" },
				body: "hello",
			}),
		);
		expect(write.status).toBe(204);

		const read = await objectRequest(
			new Request(signed({ method: "GET", key: "uploads/file.txt" })),
		);
		expect(read.status).toBe(200);
		expect(read.headers.get("content-type")).toBe("text/plain");
		expect(await read.text()).toBe("hello");
	});

	test("rejects missing tokens, wrong methods, bad signatures, size and mime drift", async () => {
		const put = signed({
			method: "PUT",
			key: "uploads/file.txt",
			contentType: "text/plain",
			contentLength: 5,
		});
		expect(
			await objectRequest(
				new Request(
					"http://127.0.0.1:1234/_objects/private?key=uploads/file.txt",
				),
			),
		).toHaveProperty("status", 403);
		expect(await objectRequest(new Request(put))).toHaveProperty("status", 403);
		expect(
			await objectRequest(
				new Request(put.replace(/.$/, "x"), {
					method: "PUT",
					headers: { "Content-Type": "text/plain", "Content-Length": "5" },
					body: "hello",
				}),
			),
		).toHaveProperty("status", 403);
		expect(
			await objectRequest(
				new Request(put, {
					method: "PUT",
					headers: {
						"Content-Type": "application/json",
						"Content-Length": "5",
					},
					body: "hello",
				}),
			),
		).toHaveProperty("status", 403);
		expect(
			await objectRequest(
				new Request(put, {
					method: "PUT",
					headers: { "Content-Type": "text/plain", "Content-Length": "4" },
					body: "hell",
				}),
			),
		).toHaveProperty("status", 403);
	});

	test("serves byte ranges and rejects traversal even when signed", async () => {
		await new LocalObjectStore(dataDir).put({
			bucket: "private",
			key: "uploads/ranged.txt",
			body: "0123456789",
			contentType: "text/plain",
		});
		const response = await objectRequest(
			new Request(signed({ method: "GET", key: "uploads/ranged.txt" }), {
				headers: { Range: "bytes=2-5" },
			}),
		);
		expect(response.status).toBe(206);
		expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
		expect(await response.text()).toBe("2345");

		const traversal = await objectRequest(
			new Request(
				signed({ method: "GET", key: "../outside", expiresInSeconds: 60 }),
			),
		);
		expect(traversal.status).toBe(403);
	});
});
