import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { closeDatabase, db, initializeDatabase } from "./client";
import { migrateDatabase } from "./migrate";

const migrations = resolve(import.meta.dir, "../drizzle");

test("personal database migrates, rolls back, serializes transactions and persists across owners", async () => {
	const root = await mkdtemp(join(tmpdir(), "superestset-db-test-"));
	const previous = {
		SUPERESTSET_DATA_DIR: process.env.SUPERESTSET_DATA_DIR,
		SUPERESTSET_MIGRATIONS_DIR: process.env.SUPERESTSET_MIGRATIONS_DIR,
		NEXT_PHASE: process.env.NEXT_PHASE,
	};
	try {
		process.env.SUPERESTSET_DATA_DIR = root;
		process.env.SUPERESTSET_MIGRATIONS_DIR = migrations;
		process.env.NEXT_PHASE = "phase-production-build";
		expect(db.query.users).toBeDefined();
		await expect(initializeDatabase()).rejects.toThrow("forbidden");
		expect(await readdir(root)).toEqual([]);
		delete process.env.NEXT_PHASE;
		expect(() => db.query).toThrow("not ready");
		const [first, duplicate] = await Promise.all([
			initializeDatabase(),
			initializeDatabase(),
		]);
		expect(first).toBe(duplicate);
		expect(first.migrations.total).toBeGreaterThanOrEqual(119);
		expect(first.migrations.applied).toBe(first.migrations.total);
		expect(await migrateDatabase(first.database.$client, migrations)).toEqual({
			applied: 0,
			total: first.migrations.total,
		});
		await db.execute(
			sql`create table runtime_probe (id integer primary key, value integer not null)`,
		);
		await db.execute(sql`insert into runtime_probe values (1, 0)`);
		await expect(
			db.transaction(async (tx) => {
				await tx.execute(sql`update runtime_probe set value = 999`);
				throw new Error("rollback probe");
			}),
		).rejects.toThrow("rollback probe");
		await Promise.all(
			Array.from({ length: 20 }, () =>
				db.transaction(async (tx) => {
					await tx.execute(sql`select pg_advisory_xact_lock(4812::bigint)`);
					const result = await tx.execute<{ value: number }>(
						sql`select value from runtime_probe for update`,
					);
					const row = result.rows[0];
					if (!row) throw new Error("Counter row missing");
					await new Promise((resolve) => setTimeout(resolve, 1));
					await tx.execute(
						sql`update runtime_probe set value = ${row.value + 1}`,
					);
				}),
			),
		);
		expect(
			(
				await db.execute<{ value: number }>(
					sql`select value from runtime_probe`,
				)
			).rows,
		).toEqual([{ value: 20 }]);
		expect(
			(
				await db.execute<{ similarity: number }>(
					sql`select similarity('superestset', 'superset')`,
				)
			).rows[0]?.similarity,
		).toBeGreaterThan(0);
		await db.execute(
			sql`select * from ingest.maintain_webhook_payload_partitions(16, 7)`,
		);
		await db.execute(
			sql`insert into ingest.webhook_payloads values (gen_random_uuid(), current_timestamp, '{"probe":true}'::jsonb)`,
		);
		expect(
			(
				await db.execute<{ partition: string }>(
					sql`select tableoid::regclass::text as partition from ingest.webhook_payloads`,
				)
			).rows[0]?.partition,
		).toMatch(/webhook_payloads_\d{8}/);
		process.env.SUPERESTSET_DATA_DIR = join(root, "other");
		await expect(initializeDatabase()).rejects.toThrow(
			"multiple personal databases",
		);
		process.env.SUPERESTSET_DATA_DIR = root;
		await Promise.all([closeDatabase(), closeDatabase()]);
		expect(() => db.query).toThrow("not ready");
		const reopened = await initializeDatabase();
		expect(reopened.migrations.applied).toBe(0);
		expect(
			(
				await db.execute<{ value: number }>(
					sql`select value from runtime_probe`,
				)
			).rows,
		).toEqual([{ value: 20 }]);
		await db.execute(
			sql`update drizzle.__drizzle_migrations set hash = 'changed' where id = 1`,
		);
		await expect(
			migrateDatabase(reopened.database.$client, migrations),
		).rejects.toThrow("history differs");
	} finally {
		await closeDatabase();
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		await rm(root, { recursive: true, force: true });
	}
}, 60_000);
