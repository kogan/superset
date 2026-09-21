import {
	CreateBucketCommand,
	GetObjectCommand,
	HeadBucketCommand,
	PutBucketCorsCommand,
	S3Client,
	S3ServiceException,
} from "@aws-sdk/client-s3";
import { z } from "zod";
import { assertEnv, type UsercontentEnv } from "../src/env";
import { app } from "../src/index";

const settings = z
	.object({
		R2_ENDPOINT: z
			.string()
			.url()
			.refine((value) => {
				const url = new URL(value);
				return (
					url.protocol === "http:" &&
					["localhost", "127.0.0.1"].includes(url.hostname)
				);
			}),
		R2_ACCESS_KEY_ID: z.string().min(1),
		R2_SECRET_ACCESS_KEY: z.string().min(1),
		R2_PRIVATE_BUCKET: z.string().min(1),
		R2_PUBLIC_BUCKET: z.string().min(1),
		USERCONTENT_URL: z.string().url(),
		USERCONTENT_TOKEN_SECRET: z.string().min(32),
		DESKTOP_VITE_PORT: z.coerce.number().int().positive(),
	})
	.parse(process.env);

const contentUrl = new URL(settings.USERCONTENT_URL);
if (!contentUrl.hostname.endsWith(".localhost")) {
	throw new Error("Personal Pages must use a localhost content URL");
}
const client = new S3Client({
	region: "us-east-1",
	endpoint: settings.R2_ENDPOINT,
	credentials: {
		accessKeyId: settings.R2_ACCESS_KEY_ID,
		secretAccessKey: settings.R2_SECRET_ACCESS_KEY,
	},
	forcePathStyle: true,
	requestChecksumCalculation: "WHEN_REQUIRED",
	responseChecksumValidation: "WHEN_REQUIRED",
});

for (const bucket of [settings.R2_PRIVATE_BUCKET, settings.R2_PUBLIC_BUCKET]) {
	try {
		await client.send(new HeadBucketCommand({ Bucket: bucket }));
	} catch (error) {
		if (
			!(error instanceof S3ServiceException) ||
			error.$metadata.httpStatusCode !== 404
		)
			throw error;
		await client.send(new CreateBucketCommand({ Bucket: bucket }));
	}
	await client.send(
		new PutBucketCorsCommand({
			Bucket: bucket,
			CORSConfiguration: {
				CORSRules: [
					{
						AllowedOrigins: [`http://localhost:${settings.DESKTOP_VITE_PORT}`],
						AllowedMethods: ["GET", "HEAD", "PUT"],
						AllowedHeaders: ["*"],
						ExposeHeaders: ["ETag"],
					},
				],
			},
		}),
	);
}

const env: UsercontentEnv = {
	USERCONTENT_URL: settings.USERCONTENT_URL,
	MEDIA_URL: `http://media.usercontent.localhost:${contentUrl.port}`,
	APP_URL: `http://localhost:${settings.DESKTOP_VITE_PORT}`,
	FRAME_ANCESTORS: `http://localhost:${settings.DESKTOP_VITE_PORT} file:`,
	USERCONTENT_TOKEN_SECRET: settings.USERCONTENT_TOKEN_SECRET,
	PRIVATE: {
		async get(key, options) {
			const range = options?.range;
			const rangeHeader = range
				? "suffix" in range
					? `bytes=-${range.suffix}`
					: `bytes=${range.offset ?? 0}-${range.length === undefined ? "" : (range.offset ?? 0) + range.length - 1}`
				: undefined;
			try {
				const object = await client.send(
					new GetObjectCommand({
						Bucket: settings.R2_PRIVATE_BUCKET,
						Key: key,
						Range: rangeHeader,
					}),
				);
				if (!object.Body) return null;
				const bytes = await object.Body.transformToByteArray();
				const body = new Blob([new Uint8Array(bytes)]);
				const match = object.ContentRange?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
				return {
					body: body.stream(),
					text: () => body.text(),
					size: match ? Number(match[3]) : body.size,
					httpMetadata: { contentType: object.ContentType },
					range: match
						? { offset: Number(match[1]), length: body.size }
						: undefined,
				};
			} catch (error) {
				if (
					error instanceof S3ServiceException &&
					error.$metadata.httpStatusCode === 404
				)
					return null;
				throw error;
			}
		},
	},
};
assertEnv(env);

const server = Bun.serve({
	hostname: "127.0.0.1",
	port: Number(contentUrl.port),
	fetch: (request) => app.fetch(request, env),
});
console.info(`[personal-pages] ready on ${server.hostname}:${server.port}`);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
	process.on(signal, () => {
		server.stop(true);
		client.destroy();
		process.exit(0);
	});
}
