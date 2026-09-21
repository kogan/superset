import type { PGlite } from "@electric-sql/pglite";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { z } from "zod";

const appliedMigrationSchema = z.array(
	z.object({ hash: z.string(), created_at: z.coerce.number() }),
);

export async function migrateDatabase(
	client: PGlite,
	migrationsFolder: string,
) {
	const migrations = readMigrationFiles({ migrationsFolder });
	await client.exec(`
		CREATE SCHEMA IF NOT EXISTS drizzle;
		CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
			id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint
		);
	`);
	return client.transaction(async (tx) => {
		const applied = appliedMigrationSchema.parse(
			(
				await tx.query(
					"SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id",
				)
			).rows,
		);
		for (const [index, entry] of applied.entries()) {
			const expected = migrations[index];
			if (
				!expected ||
				expected.hash !== entry.hash ||
				expected.folderMillis !== entry.created_at
			) {
				throw new Error(
					`Database migration history differs at position ${index}; restore the matching app version before opening this data.`,
				);
			}
		}
		for (const migration of migrations.slice(applied.length)) {
			for (const statement of migration.sql) {
				// Historical files contain compound statements; prepared queries reject them.
				await tx.exec(statement);
			}
			await tx.query(
				"INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
				[migration.hash, migration.folderMillis],
			);
		}
		return {
			applied: migrations.length - applied.length,
			total: migrations.length,
		};
	});
}
