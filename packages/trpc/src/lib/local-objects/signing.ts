import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const LOCAL_OBJECTS_ROUTE = "/_objects";

export const buckets = ["private", "public"] as const;
export type Bucket = (typeof buckets)[number];

const methods = ["GET", "PUT"] as const;
export type SignedObjectMethod = (typeof methods)[number];

const grantSchema = z.object({
	v: z.literal(1),
	bucket: z.enum(buckets),
	key: z.string().min(1),
	method: z.enum(methods),
	exp: z.number().int().positive(),
	contentType: z.string().min(1).optional(),
	contentLength: z.number().int().nonnegative().optional(),
});

export type SignedObjectGrant = z.infer<typeof grantSchema>;

const encoder = new TextEncoder();

function base64url(input: string | Uint8Array): string {
	const bytes = typeof input === "string" ? encoder.encode(input) : input;
	return Buffer.from(bytes).toString("base64url");
}

function signPayload(secret: string, payload: string): string {
	return createHmac("sha256", secret).update(payload).digest("base64url");
}

function signaturesMatch(expected: string, actual: string): boolean {
	const expectedBytes = Buffer.from(expected);
	const actualBytes = Buffer.from(actual);
	return (
		expectedBytes.byteLength === actualBytes.byteLength &&
		timingSafeEqual(expectedBytes, actualBytes)
	);
}

export function signObjectGrant({
	secret,
	grant,
}: {
	secret: string;
	grant: SignedObjectGrant;
}): string {
	const payload = base64url(JSON.stringify(grant));
	return `${payload}.${signPayload(secret, payload)}`;
}

export function verifyObjectGrant({
	secret,
	token,
	now = Date.now(),
}: {
	secret: string;
	token: string;
	now?: number;
}): SignedObjectGrant | null {
	const dot = token.indexOf(".");
	if (dot === -1) return null;
	const payload = token.slice(0, dot);
	const signature = token.slice(dot + 1);
	if (
		!/^[A-Za-z0-9_-]+$/.test(payload) ||
		!/^[A-Za-z0-9_-]+$/.test(signature)
	) {
		return null;
	}
	if (!signaturesMatch(signPayload(secret, payload), signature)) return null;

	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
	} catch {
		return null;
	}
	const grant = grantSchema.safeParse(parsed);
	if (!grant.success) return null;
	if (grant.data.exp * 1000 <= now) return null;
	return grant.data;
}

export function signedObjectUrl({
	origin,
	secret,
	grant,
}: {
	origin: string;
	secret: string;
	grant: SignedObjectGrant;
}): string {
	const url = new URL(`${LOCAL_OBJECTS_ROUTE}/${grant.bucket}`, origin);
	url.searchParams.set("key", grant.key);
	url.searchParams.set("token", signObjectGrant({ secret, grant }));
	return url.toString();
}
