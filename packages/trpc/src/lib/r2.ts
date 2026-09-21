import {
	CopyObjectCommand,
	DeleteObjectsCommand,
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
	type Bucket,
	LocalObjectStore,
	ObjectRangeError,
	signedObjectUrl,
} from "./local-objects";

export type { Bucket };

let client: S3Client | null = null;

async function cloudEnv() {
	const { env } = await import("../env");
	return env;
}

async function s3(): Promise<S3Client> {
	if (!client) {
		const env = await cloudEnv();
		client = new S3Client({
			region: "auto",
			endpoint: env.R2_ENDPOINT,
			credentials: {
				accessKeyId: env.R2_ACCESS_KEY_ID,
				secretAccessKey: env.R2_SECRET_ACCESS_KEY,
			},
			forcePathStyle: true,
			requestChecksumCalculation: "WHEN_REQUIRED",
			responseChecksumValidation: "WHEN_REQUIRED",
		});
	}
	return client;
}

async function bucketName(bucket: Bucket): Promise<string> {
	const env = await cloudEnv();
	return bucket === "public" ? env.R2_PUBLIC_BUCKET : env.R2_PRIVATE_BUCKET;
}

function localRuntime(): {
	store: LocalObjectStore;
	origin: string;
	secret: string;
} | null {
	const dataDir = process.env.SUPERESTSET_DATA_DIR;
	if (!dataDir) return null;
	const origin = process.env.USERCONTENT_URL ?? process.env.STATIC_URL;
	const secret = process.env.USERCONTENT_TOKEN_SECRET;
	if (!origin || !secret) {
		throw new Error(
			"Local object storage needs USERCONTENT_URL or STATIC_URL and USERCONTENT_TOKEN_SECRET",
		);
	}
	return { store: new LocalObjectStore(dataDir), origin, secret };
}

function isMissing(error: unknown): boolean {
	const candidate = error as {
		name?: string;
		$metadata?: { httpStatusCode?: number };
	};
	return (
		candidate?.name === "NoSuchKey" ||
		candidate?.name === "NotFound" ||
		candidate?.$metadata?.httpStatusCode === 404
	);
}

function parseRangeHeader(range: string) {
	const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
	if (!match) throw new ObjectRangeError("Invalid object range");
	const startRaw = match[1] ?? "";
	const endRaw = match[2] ?? "";
	if (startRaw === "" && endRaw !== "") return { suffix: Number(endRaw) };
	if (startRaw === "") throw new ObjectRangeError("Invalid object range");
	const offset = Number(startRaw);
	if (endRaw === "") return { offset };
	const end = Number(endRaw);
	if (end < offset) throw new ObjectRangeError("Invalid object range");
	return { offset, length: end - offset + 1 };
}

export async function putObject({
	key,
	body,
	contentType,
	bucket,
	cacheControl,
}: {
	key: string;
	body: Uint8Array | string;
	contentType: string;
	bucket: Bucket;
	cacheControl?: string;
}): Promise<void> {
	const local = localRuntime();
	if (local) {
		await local.store.put({ bucket, key, body, contentType, cacheControl });
		return;
	}

	const [cloudClient, bucketValue] = await Promise.all([
		s3(),
		bucketName(bucket),
	]);
	await cloudClient.send(
		new PutObjectCommand({
			CacheControl: cacheControl,
			Bucket: bucketValue,
			Key: key,
			Body: body,
			ContentType: contentType,
		}),
	);
}

export async function copyObject({
	sourceKey,
	key,
	contentType,
}: {
	sourceKey: string;
	key: string;
	contentType: string;
}): Promise<void> {
	const local = localRuntime();
	if (local) {
		await local.store.copy({ sourceKey, key, contentType });
		return;
	}

	const [cloudClient, bucket] = await Promise.all([
		s3(),
		bucketName("private"),
	]);
	await cloudClient.send(
		new CopyObjectCommand({
			Bucket: bucket,
			CopySource: `${bucket}/${sourceKey}`,
			Key: key,
			ContentType: contentType,
			MetadataDirective: "REPLACE",
		}),
	);
}

/** The object's response, streaming, or null when it does not exist. */
export async function getObject(
	key: string,
	{ range, bucket = "private" }: { range?: string; bucket?: Bucket } = {},
): Promise<Response | null> {
	const local = localRuntime();
	if (local) {
		const object = await local.store.get({
			bucket,
			key,
			range: range ? parseRangeHeader(range) : undefined,
		});
		if (!object) return null;
		return new Response(object.body, {
			status: object.range ? 206 : 200,
			headers: {
				...(object.httpMetadata.contentType
					? { "Content-Type": object.httpMetadata.contentType }
					: {}),
				...(object.range
					? {
							"Content-Range": `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`,
						}
					: {}),
			},
		});
	}

	try {
		const [cloudClient, bucketValue] = await Promise.all([
			s3(),
			bucketName(bucket),
		]);
		const result = await cloudClient.send(
			new GetObjectCommand({
				Bucket: bucketValue,
				Key: key,
				Range: range,
			}),
		);
		if (!result.Body) return null;
		return new Response(result.Body.transformToWebStream(), {
			status: result.ContentRange ? 206 : 200,
			headers: {
				...(result.ContentType ? { "Content-Type": result.ContentType } : {}),
				...(result.ContentRange
					? { "Content-Range": result.ContentRange }
					: {}),
			},
		});
	} catch (error) {
		if (isMissing(error)) return null;
		throw error;
	}
}

/** Size and stored content type, or null when the object does not exist. */
export async function headObject(
	key: string,
	{ bucket = "private" }: { bucket?: Bucket } = {},
): Promise<{ sizeBytes: number; contentType: string | null } | null> {
	const local = localRuntime();
	if (local) return await local.store.head({ bucket, key });

	try {
		const [cloudClient, bucketValue] = await Promise.all([
			s3(),
			bucketName(bucket),
		]);
		const result = await cloudClient.send(
			new HeadObjectCommand({ Bucket: bucketValue, Key: key }),
		);
		return {
			sizeBytes: result.ContentLength ?? 0,
			contentType: result.ContentType ?? null,
		};
	} catch (error) {
		if (isMissing(error)) return null;
		throw error;
	}
}

export async function objectExists(
	key: string,
	{ bucket = "private" }: { bucket?: Bucket } = {},
): Promise<boolean> {
	return (await headObject(key, { bucket })) !== null;
}

/** Deletes are idempotent and batched; a missing key is not an error. */
export async function deleteObjects(
	keys: readonly string[],
	{ bucket = "private" }: { bucket?: Bucket } = {},
): Promise<void> {
	const local = localRuntime();
	if (local) {
		await local.store.delete(keys, bucket);
		return;
	}

	const [cloudClient, bucketValue] = await Promise.all([
		s3(),
		bucketName(bucket),
	]);
	for (let i = 0; i < keys.length; i += 1000) {
		const batch = keys.slice(i, i + 1000);
		const result = await cloudClient.send(
			new DeleteObjectsCommand({
				Bucket: bucketValue,
				Delete: {
					Objects: batch.map((key) => ({ Key: key })),
					Quiet: true,
				},
			}),
		);
		const failed = (result.Errors ?? []).filter(
			(entry) => entry.Code !== "NoSuchKey",
		);
		if (failed.length > 0) {
			throw new Error(
				`R2 delete failed for ${failed.length} object(s), first: ${failed[0]?.Key} (${failed[0]?.Code})`,
			);
		}
	}
}

export async function presignedGetUrl(
	key: string,
	expiresInSeconds = 60 * 60,
): Promise<string> {
	const local = localRuntime();
	if (local) {
		return signedObjectUrl({
			origin: local.origin,
			secret: local.secret,
			grant: {
				v: 1,
				bucket: "private",
				key,
				method: "GET",
				exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
			},
		});
	}

	const [cloudClient, bucket] = await Promise.all([
		s3(),
		bucketName("private"),
	]);
	return getSignedUrl(
		cloudClient,
		new GetObjectCommand({ Bucket: bucket, Key: key }),
		{ expiresIn: expiresInSeconds },
	);
}

export async function presignedPutUrl({
	key,
	contentType,
	contentLength,
	expiresInSeconds = 15 * 60,
}: {
	key: string;
	contentType: string;
	contentLength: number;
	expiresInSeconds?: number;
}): Promise<{ url: string; headers: Record<string, string> }> {
	const local = localRuntime();
	if (local) {
		return {
			url: signedObjectUrl({
				origin: local.origin,
				secret: local.secret,
				grant: {
					v: 1,
					bucket: "private",
					key,
					method: "PUT",
					contentType,
					contentLength,
					exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
				},
			}),
			headers: { "Content-Type": contentType },
		};
	}

	const [cloudClient, bucket] = await Promise.all([
		s3(),
		bucketName("private"),
	]);
	const url = await getSignedUrl(
		cloudClient,
		new PutObjectCommand({
			Bucket: bucket,
			Key: key,
			ContentType: contentType,
			ContentLength: contentLength,
		}),
		{
			expiresIn: expiresInSeconds,
			signableHeaders: new Set(["content-type", "content-length"]),
		},
	);
	return { url, headers: { "Content-Type": contentType } };
}
