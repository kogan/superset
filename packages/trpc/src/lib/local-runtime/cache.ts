import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

type CacheRecord<T> = {
	expiresAt: number;
	value: T;
};

type RateRecord = {
	expiresAt: number;
	hits: number[];
};

export type LocalRateLimit = {
	limit(key: string): Promise<{ success: boolean }>;
};

const locks = new Map<string, Promise<unknown>>();

export function isLocalRuntime(): boolean {
	return /^(1|true|yes)$/i.test(process.env.SUPERESTSET_LOCAL ?? "");
}

function dataDir(): string {
	const value = process.env.SUPERESTSET_DATA_DIR;
	if (!value) {
		throw new Error("SUPERESTSET_DATA_DIR is required for SUPERESTSET_LOCAL");
	}
	return value;
}

function hashed(name: string): string {
	return createHash("sha256").update(name).digest("hex");
}

function cachePath(namespace: string, key: string): string {
	return path.join(dataDir(), "cache", namespace, `${hashed(key)}.json`);
}

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const previous = locks.get(key) ?? Promise.resolve();
	let release!: () => void;
	const current = new Promise<void>((resolve) => {
		release = resolve;
	});
	const entry = previous.then(() => current);
	locks.set(key, entry);
	await previous;
	try {
		return await fn();
	} finally {
		release();
		if (locks.get(key) === entry) locks.delete(key);
	}
}

async function readJson<T>(filePath: string): Promise<T | null> {
	try {
		return JSON.parse(await readFile(filePath, "utf8")) as T;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, `${JSON.stringify(value)}\n`);
}

export async function readLocalCache<T>(key: string): Promise<T | null> {
	const filePath = cachePath("values", key);
	const record = await readJson<CacheRecord<T>>(filePath);
	if (!record) return null;
	if (record.expiresAt <= Date.now()) {
		await rm(filePath, { force: true });
		return null;
	}
	return record.value;
}

export async function writeLocalCache<T>(
	key: string,
	value: T,
	ttlSeconds: number,
): Promise<void> {
	const filePath = cachePath("values", key);
	await writeJson(filePath, {
		expiresAt: Date.now() + ttlSeconds * 1000,
		value,
	} satisfies CacheRecord<T>);
}

export async function claimLocalCache<T>(
	key: string,
	value: T,
	ttlSeconds: number,
): Promise<boolean> {
	const filePath = cachePath("values", key);
	return await withLock(filePath, async () => {
		const existing = await readLocalCache<T>(key);
		if (existing !== null) return false;
		await writeLocalCache(key, value, ttlSeconds);
		return true;
	});
}

export async function clearLocalCache(key: string): Promise<void> {
	await rm(cachePath("values", key), { force: true });
}

export function createLocalSlidingWindowRateLimit({
	prefix,
	limit,
	windowSeconds,
}: {
	prefix: string;
	limit: number;
	windowSeconds: number;
}): LocalRateLimit {
	return {
		async limit(key: string) {
			const cacheKey = `${prefix}:${key}`;
			const filePath = cachePath("ratelimit", cacheKey);
			return await withLock(filePath, async () => {
				const now = Date.now();
				const windowStart = now - windowSeconds * 1000;
				const existing = await readJson<RateRecord>(filePath);
				const hits = (existing?.hits ?? []).filter((hit) => hit > windowStart);
				const success = hits.length < limit;
				if (success) hits.push(now);
				await writeJson(filePath, {
					expiresAt: now + windowSeconds * 1000,
					hits,
				} satisfies RateRecord);
				return { success };
			});
		},
	};
}
