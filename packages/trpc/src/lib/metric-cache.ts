import { Redis } from "@upstash/redis";

import { env } from "../env";
import {
	claimLocalCache,
	clearLocalCache,
	isLocalRuntime,
	readLocalCache,
	writeLocalCache,
} from "./local-runtime/cache";

/**
 * Shared cache for the admin dashboard's third-party metrics.
 *
 * These used to be module-level variables. On Fluid Compute that means one
 * cache per instance: a dashboard load usually lands on a cold one, misses,
 * and pays the upstream cost again. Worse for anything with a pending-work
 * handle — the poll that should collect it lands on a different instance,
 * finds no handle, and starts the work over, so it never converges.
 *
 * Redis is already stood up for rate limiting, so these live there instead and
 * every instance sees the same entry.
 */
const redis =
	env.KV_REST_API_URL && env.KV_REST_API_TOKEN
		? new Redis({ url: env.KV_REST_API_URL, token: env.KV_REST_API_TOKEN })
		: null;

const PREFIX = "admin:metrics";

export function isMetricCacheAvailable(): boolean {
	return isLocalRuntime() || redis !== null;
}

export async function readMetricCache<T>(key: string): Promise<T | null> {
	if (isLocalRuntime()) return await readLocalCache<T>(`${PREFIX}:${key}`);
	if (!redis) return null;
	try {
		return await redis.get<T>(`${PREFIX}:${key}`);
	} catch (error) {
		console.error(`[metric-cache] read failed for ${key}:`, error);
		return null;
	}
}

export async function writeMetricCache<T>(
	key: string,
	value: T,
	ttlSeconds: number,
): Promise<void> {
	if (isLocalRuntime()) {
		await writeLocalCache(`${PREFIX}:${key}`, value, ttlSeconds);
		return;
	}
	if (!redis) return;
	try {
		await redis.set(`${PREFIX}:${key}`, value, { ex: ttlSeconds });
	} catch (error) {
		console.error(`[metric-cache] write failed for ${key}:`, error);
	}
}

/**
 * Write only if nothing holds the key, so concurrent instances can agree on
 * which one owns a piece of in-flight work. Returns whether this caller won.
 */
export async function claimMetricCache<T>(
	key: string,
	value: T,
	ttlSeconds: number,
): Promise<boolean> {
	if (isLocalRuntime()) {
		return await claimLocalCache(`${PREFIX}:${key}`, value, ttlSeconds);
	}
	// No shared cache means no way to agree on an owner, and claiming anyway
	// would let every caller start the work the claim exists to serialise.
	if (!redis) return false;
	try {
		const claimed = await redis.set(`${PREFIX}:${key}`, value, {
			nx: true,
			ex: ttlSeconds,
		});
		return claimed === "OK";
	} catch (error) {
		console.error(`[metric-cache] claim failed for ${key}:`, error);
		return false;
	}
}

export async function clearMetricCache(key: string): Promise<void> {
	if (isLocalRuntime()) {
		await clearLocalCache(`${PREFIX}:${key}`);
		return;
	}
	if (!redis) return;
	try {
		await redis.del(`${PREFIX}:${key}`);
	} catch (error) {
		console.error(`[metric-cache] clear failed for ${key}:`, error);
	}
}
