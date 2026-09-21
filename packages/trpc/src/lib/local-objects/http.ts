import type { Bucket } from "./signing";
import { buckets, verifyObjectGrant } from "./signing";
import {
	type LocalObjectStore,
	ObjectKeyError,
	ObjectRangeError,
	parseHttpRange,
} from "./store";

function isBucket(value: string): value is Bucket {
	return buckets.includes(value as Bucket);
}

function noStore(body: string, status: number): Response {
	return new Response(body, {
		status,
		headers: { "Cache-Control": "no-store" },
	});
}

function contentLength(request: Request): number | null {
	const raw = request.headers.get("content-length");
	if (raw === null || !/^\d+$/.test(raw)) return null;
	return Number(raw);
}

export async function handleLocalObjectRequest({
	request,
	store,
	secret,
}: {
	request: Request;
	store: LocalObjectStore;
	secret: string;
}): Promise<Response | null> {
	const url = new URL(request.url);
	const match = /^\/_objects\/([^/]+)$/.exec(url.pathname);
	if (!match) return null;
	const bucketRaw = match[1] ?? "";
	if (!isBucket(bucketRaw)) return noStore("Unknown bucket", 400);

	const key = url.searchParams.get("key");
	const token = url.searchParams.get("token");
	if (!key || !token) return noStore("Forbidden", 403);
	const grant = verifyObjectGrant({ secret, token });
	if (
		!grant ||
		grant.bucket !== bucketRaw ||
		grant.key !== key ||
		grant.method !== request.method
	) {
		return noStore("Forbidden", 403);
	}

	if (request.method === "PUT") {
		const declaredType = request.headers.get("content-type");
		const declaredLength = contentLength(request);
		if (
			grant.contentType === undefined ||
			grant.contentLength === undefined ||
			declaredType !== grant.contentType ||
			declaredLength !== grant.contentLength
		) {
			return noStore("Forbidden", 403);
		}
		const body = new Uint8Array(await request.arrayBuffer());
		if (body.byteLength !== grant.contentLength)
			return noStore("Forbidden", 403);
		try {
			await store.put({
				bucket: grant.bucket,
				key: grant.key,
				body,
				contentType: grant.contentType,
			});
		} catch (error) {
			if (error instanceof ObjectKeyError) return noStore("Forbidden", 403);
			throw error;
		}
		return new Response(null, {
			status: 204,
			headers: { "Cache-Control": "no-store" },
		});
	}

	if (request.method !== "GET") return noStore("Forbidden", 403);

	let head: Awaited<ReturnType<LocalObjectStore["head"]>>;
	try {
		head = await store.head({ bucket: grant.bucket, key: grant.key });
	} catch (error) {
		if (error instanceof ObjectKeyError) return noStore("Forbidden", 403);
		throw error;
	}
	if (!head) return noStore("Not found", 404);

	let range: ReturnType<typeof parseHttpRange>;
	try {
		range = parseHttpRange(request.headers.get("range"), head.sizeBytes);
	} catch (error) {
		if (error instanceof ObjectRangeError) {
			return noStore("Range not satisfiable", 416);
		}
		throw error;
	}

	let object: Awaited<ReturnType<LocalObjectStore["get"]>>;
	try {
		object = await store.get({ bucket: grant.bucket, key: grant.key, range });
	} catch (error) {
		if (error instanceof ObjectKeyError) return noStore("Forbidden", 403);
		if (error instanceof ObjectRangeError) {
			return noStore("Range not satisfiable", 416);
		}
		throw error;
	}
	if (!object) return noStore("Not found", 404);

	const headers = new Headers({
		"Content-Type": head.contentType ?? "application/octet-stream",
		"Content-Length": String(object.range?.length ?? object.size),
		"Accept-Ranges": "bytes",
		"Cache-Control": head.cacheControl ?? "private, max-age=300",
	});
	if (object.range) {
		headers.set(
			"Content-Range",
			`bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`,
		);
	}
	return new Response(object.body, {
		status: object.range ? 206 : 200,
		headers,
	});
}
