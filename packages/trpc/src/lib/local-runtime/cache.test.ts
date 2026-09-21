import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	claimLocalCache,
	clearLocalCache,
	createLocalSlidingWindowRateLimit,
	readLocalCache,
	writeLocalCache,
} from "./cache";

let dataDir: string;
let previousDataDir: string | undefined;

beforeEach(async () => {
	dataDir = await mkdtemp(path.join(tmpdir(), "superestset-local-cache-"));
	previousDataDir = process.env.SUPERESTSET_DATA_DIR;
	process.env.SUPERESTSET_DATA_DIR = dataDir;
});

afterEach(async () => {
	if (previousDataDir === undefined) delete process.env.SUPERESTSET_DATA_DIR;
	else process.env.SUPERESTSET_DATA_DIR = previousDataDir;
	await rm(dataDir, { recursive: true, force: true });
});

describe("local runtime cache", () => {
	test("reads, claims, clears and expires values", async () => {
		await writeLocalCache("metric:one", { ok: true }, 60);
		expect(await readLocalCache("metric:one")).toEqual({ ok: true });
		expect(await claimLocalCache("metric:one", { ok: false }, 60)).toBe(false);

		expect(await claimLocalCache("metric:two", "owner", 60)).toBe(true);
		expect(await readLocalCache("metric:two")).toBe("owner");

		await clearLocalCache("metric:two");
		expect(await readLocalCache("metric:two")).toBeNull();

		await writeLocalCache("metric:expired", "gone", -1);
		expect(await readLocalCache("metric:expired")).toBeNull();
	});

	test("enforces a file-backed sliding window", async () => {
		const limiter = createLocalSlidingWindowRateLimit({
			prefix: "test",
			limit: 2,
			windowSeconds: 60,
		});

		expect(await limiter.limit("user-1")).toEqual({ success: true });
		expect(await limiter.limit("user-1")).toEqual({ success: true });
		expect(await limiter.limit("user-1")).toEqual({ success: false });
		expect(await limiter.limit("user-2")).toEqual({ success: true });
	});
});
