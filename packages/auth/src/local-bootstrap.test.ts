import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { closeDatabase, db, initializeDatabase } from "@superset/db/client";
import { accounts, organizations, sessions, users } from "@superset/db/schema";
import { eq } from "drizzle-orm";
import { bootstrapLocalAccount } from "./local-bootstrap";

test("local bootstrap authenticates without network and preserves imported identity", async () => {
	const root = await mkdtemp(join(tmpdir(), "superestset-auth-test-"));
	const overrides = {
		SUPERESTSET_LOCAL: "1",
		SUPERESTSET_API_ORIGIN: "http://127.0.0.1:39991",
		SUPERESTSET_DATA_DIR: root,
		SUPERESTSET_MIGRATIONS_DIR: resolve(import.meta.dir, "../../db/drizzle"),
		BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
		NEXT_PUBLIC_API_URL: "http://127.0.0.1:39991",
		NEXT_PUBLIC_WEB_URL: "http://127.0.0.1:39991",
		NEXT_PUBLIC_ADMIN_URL: "http://127.0.0.1:39991",
		NEXT_PUBLIC_MARKETING_URL: "http://127.0.0.1:39991",
	};
	const previous = new Map(
		Object.keys(overrides).map((key) => [key, process.env[key]]),
	);
	previous.set(
		"SUPERESTSET_LOCAL_USER_ID",
		process.env.SUPERESTSET_LOCAL_USER_ID,
	);
	const originalFetch = globalThis.fetch;
	let networkCalls = 0;
	globalThis.fetch = Object.assign(
		async () => {
			networkCalls++;
			throw new Error("Network is forbidden in the local auth probe");
		},
		{ preconnect: originalFetch.preconnect },
	);
	try {
		Object.assign(process.env, overrides);
		delete process.env.SUPERESTSET_LOCAL_USER_ID;
		await initializeDatabase();
		const [first, simultaneous] = await Promise.all([
			bootstrapLocalAccount(),
			bootstrapLocalAccount(),
		]);
		expect(simultaneous).toEqual(first);
		expect(first.organizationIds).toHaveLength(1);
		expect(new Date(first.expiresAt).getTime()).toBeGreaterThan(Date.now());
		const repeated = await bootstrapLocalAccount();
		expect(repeated).toEqual(first);
		expect(await db.select().from(users)).toHaveLength(1);
		expect(await db.select().from(organizations)).toHaveLength(1);
		expect(await db.select().from(sessions)).toHaveLength(1);
		expect(await db.select().from(accounts)).toHaveLength(0);
		const { auth } = await import("./server");
		const authenticated = await auth.api.getSession({
			headers: new Headers({ Authorization: `Bearer ${first.token}` }),
		});
		expect(authenticated?.session.organizationIds).toEqual(
			first.organizationIds,
		);
		expect(authenticated?.session.plan).toBe("enterprise");
		const unauthorized = await auth.api.getSession({
			headers: new Headers({ Authorization: "Bearer invalid" }),
		});
		expect(unauthorized).toBeNull();
		const originalUser = await db.query.users.findFirst();
		if (!originalUser) throw new Error("Missing owner");
		await db
			.update(users)
			.set({ email: "imported@example.test", name: "Imported owner" })
			.where(eq(users.id, originalUser.id));
		const imported = await bootstrapLocalAccount();
		expect(imported.organizationIds).toEqual(first.organizationIds);
		expect(
			(await db.query.users.findFirst({ where: eq(users.id, originalUser.id) }))
				?.name,
		).toBe("Imported owner");
		await db
			.insert(users)
			.values({ email: "other@example.test", name: "Other member" });
		await expect(bootstrapLocalAccount()).rejects.toThrow("multiple users");
		process.env.SUPERESTSET_LOCAL_USER_ID = originalUser.id;
		expect((await bootstrapLocalAccount()).organizationIds).toEqual(
			first.organizationIds,
		);
		expect(networkCalls).toBe(0);
	} finally {
		globalThis.fetch = originalFetch;
		await closeDatabase();
		for (const [key, value] of previous) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		await rm(root, { recursive: true, force: true });
	}
}, 60_000);
