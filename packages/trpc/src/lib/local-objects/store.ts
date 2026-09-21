import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
	mkdir,
	open,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Bucket } from "./signing";

export type ObjectRange =
	| { offset: number; length?: number }
	| { suffix: number };

type StoredMetadata = {
	contentType: string;
	cacheControl?: string;
	sizeBytes: number;
	updatedAt: string;
};

const metadataSchema = z.object({
	contentType: z.string().min(1),
	cacheControl: z.string().min(1).optional(),
	sizeBytes: z.number().int().nonnegative(),
	updatedAt: z.string().datetime(),
});

export class ObjectKeyError extends Error {}
export class ObjectRangeError extends Error {}

export type LocalObject = {
	body: ReadableStream<Uint8Array>;
	text(): Promise<string>;
	size: number;
	httpMetadata: { contentType?: string; cacheControl?: string };
	range?: { offset: number; length: number };
};

function objectRoot(dataDir: string): string {
	return path.resolve(dataDir, "objects");
}

function safeRelativeKey(key: string): string {
	if (key.length === 0 || key.includes("\\") || path.isAbsolute(key)) {
		throw new ObjectKeyError("Object key is outside the object store");
	}
	const parts = key.split("/");
	if (parts.some((part) => part === "" || part === "." || part === "..")) {
		throw new ObjectKeyError("Object key is outside the object store");
	}
	return path.join(...parts);
}

function resolveStorePath({
	dataDir,
	bucket,
	kind,
	key,
}: {
	dataDir: string;
	bucket: Bucket;
	kind: "data" | "meta";
	key: string;
}): string {
	const root = objectRoot(dataDir);
	const relative = safeRelativeKey(kind === "meta" ? `${key}.json` : key);
	const resolved = path.resolve(root, bucket, kind, relative);
	const boundary = path.resolve(root, bucket, kind);
	if (resolved !== boundary && resolved.startsWith(`${boundary}${path.sep}`)) {
		return resolved;
	}
	throw new ObjectKeyError("Object key is outside the object store");
}

async function atomicWrite(
	filePath: string,
	body: Uint8Array | string,
): Promise<void> {
	await mkdir(path.dirname(filePath), { recursive: true });
	const temporary = path.join(
		path.dirname(filePath),
		`.${path.basename(filePath)}.${randomUUID()}.tmp`,
	);
	await writeFile(temporary, body);
	await rename(temporary, filePath);
}

function rangeFor(
	size: number,
	range?: ObjectRange,
): { start: number; end: number } | null {
	if (!range) return null;
	if ("suffix" in range) {
		if (!Number.isInteger(range.suffix) || range.suffix <= 0) {
			throw new ObjectRangeError("Invalid object range");
		}
		const length = Math.min(range.suffix, size);
		return { start: size - length, end: size - 1 };
	}
	if (!Number.isInteger(range.offset) || range.offset < 0) {
		throw new ObjectRangeError("Invalid object range");
	}
	if (range.offset >= size)
		throw new ObjectRangeError("Object range is outside the object");
	if (
		range.length !== undefined &&
		(!Number.isInteger(range.length) || range.length <= 0)
	) {
		throw new ObjectRangeError("Invalid object range");
	}
	const requestedEnd =
		range.length === undefined ? size - 1 : range.offset + range.length - 1;
	return { start: range.offset, end: Math.min(requestedEnd, size - 1) };
}

function streamFile(
	filePath: string,
	range: { start: number; end: number } | null,
): ReadableStream<Uint8Array> {
	let stream: ReturnType<typeof createReadStream> | undefined;
	return new ReadableStream<Uint8Array>({
		start(controller) {
			stream = range
				? createReadStream(filePath, { start: range.start, end: range.end })
				: createReadStream(filePath);
			stream.on("data", (chunk) => {
				const bytes =
					typeof chunk === "string"
						? new TextEncoder().encode(chunk)
						: new Uint8Array(chunk);
				controller.enqueue(bytes);
				if ((controller.desiredSize ?? 1) <= 0) stream?.pause();
			});
			stream.on("end", () => controller.close());
			stream.on("error", (error) => controller.error(error));
		},
		pull() {
			stream?.resume();
		},
		cancel() {
			stream?.destroy();
		},
	});
}

export function parseHttpRange(
	header: string | null,
	size: number,
): ObjectRange | undefined {
	if (!header) return undefined;
	const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!match) throw new ObjectRangeError("Invalid object range");
	const startRaw = match[1] ?? "";
	const endRaw = match[2] ?? "";
	if (startRaw === "" && endRaw === "") {
		throw new ObjectRangeError("Invalid object range");
	}
	if (startRaw === "") return { suffix: Number(endRaw) };
	const offset = Number(startRaw);
	if (endRaw === "") return { offset };
	const end = Number(endRaw);
	if (end < offset) throw new ObjectRangeError("Invalid object range");
	return {
		offset,
		length: Math.min(end - offset + 1, Math.max(size - offset, 0)),
	};
}

export class LocalObjectStore {
	readonly dataDir: string;

	constructor(dataDir: string) {
		this.dataDir = dataDir;
	}

	async put({
		bucket,
		key,
		body,
		contentType,
		cacheControl,
	}: {
		bucket: Bucket;
		key: string;
		body: Uint8Array | string;
		contentType: string;
		cacheControl?: string;
	}): Promise<void> {
		const bytes =
			typeof body === "string" ? new TextEncoder().encode(body) : body;
		const dataPath = resolveStorePath({
			dataDir: this.dataDir,
			bucket,
			kind: "data",
			key,
		});
		const metaPath = resolveStorePath({
			dataDir: this.dataDir,
			bucket,
			kind: "meta",
			key,
		});
		const metadata: StoredMetadata = {
			contentType,
			...(cacheControl ? { cacheControl } : {}),
			sizeBytes: bytes.byteLength,
			updatedAt: new Date().toISOString(),
		};
		await atomicWrite(dataPath, bytes);
		await atomicWrite(metaPath, `${JSON.stringify(metadata)}\n`);
	}

	async copy({
		sourceKey,
		key,
		contentType,
	}: {
		sourceKey: string;
		key: string;
		contentType: string;
	}): Promise<void> {
		const body = await this.bytes({ bucket: "private", key: sourceKey });
		if (!body) throw new Error(`Object not found: ${sourceKey}`);
		await this.put({ bucket: "private", key, body, contentType });
	}

	async delete(keys: readonly string[], bucket: Bucket): Promise<void> {
		await Promise.all(
			keys.flatMap((key) => [
				rm(
					resolveStorePath({
						dataDir: this.dataDir,
						bucket,
						kind: "data",
						key,
					}),
					{
						force: true,
					},
				),
				rm(
					resolveStorePath({
						dataDir: this.dataDir,
						bucket,
						kind: "meta",
						key,
					}),
					{
						force: true,
					},
				),
			]),
		);
	}

	async head({ bucket, key }: { bucket: Bucket; key: string }): Promise<{
		sizeBytes: number;
		contentType: string | null;
		cacheControl?: string;
	} | null> {
		const metadata = await this.metadata({ bucket, key });
		if (!metadata) return null;
		return {
			sizeBytes: metadata.sizeBytes,
			contentType: metadata.contentType,
			...(metadata.cacheControl ? { cacheControl: metadata.cacheControl } : {}),
		};
	}

	async get({
		bucket,
		key,
		range,
	}: {
		bucket: Bucket;
		key: string;
		range?: ObjectRange;
	}): Promise<LocalObject | null> {
		const metadata = await this.metadata({ bucket, key });
		if (!metadata) return null;
		const dataPath = resolveStorePath({
			dataDir: this.dataDir,
			bucket,
			kind: "data",
			key,
		});
		await stat(dataPath).catch(() => {
			throw new Error(`Object metadata exists without bytes: ${key}`);
		});
		const resolvedRange = rangeFor(metadata.sizeBytes, range);
		return {
			body: streamFile(dataPath, resolvedRange),
			text: () => readFile(dataPath, "utf8"),
			size: metadata.sizeBytes,
			httpMetadata: {
				contentType: metadata.contentType,
				...(metadata.cacheControl
					? { cacheControl: metadata.cacheControl }
					: {}),
			},
			...(resolvedRange
				? {
						range: {
							offset: resolvedRange.start,
							length: resolvedRange.end - resolvedRange.start + 1,
						},
					}
				: {}),
		};
	}

	async bytes({
		bucket,
		key,
	}: {
		bucket: Bucket;
		key: string;
	}): Promise<Uint8Array | null> {
		const metadata = await this.metadata({ bucket, key });
		if (!metadata) return null;
		const file = await open(
			resolveStorePath({ dataDir: this.dataDir, bucket, kind: "data", key }),
			"r",
		);
		try {
			const buffer = Buffer.alloc(metadata.sizeBytes);
			await file.read(buffer, 0, metadata.sizeBytes, 0);
			return new Uint8Array(buffer);
		} finally {
			await file.close();
		}
	}

	private async metadata({
		bucket,
		key,
	}: {
		bucket: Bucket;
		key: string;
	}): Promise<StoredMetadata | null> {
		let raw: string;
		try {
			raw = await readFile(
				resolveStorePath({ dataDir: this.dataDir, bucket, kind: "meta", key }),
				"utf8",
			);
		} catch (error) {
			if (
				error instanceof Error &&
				"code" in error &&
				error.code === "ENOENT"
			) {
				return null;
			}
			throw error;
		}
		return metadataSchema.parse(JSON.parse(raw));
	}
}
