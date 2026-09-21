import { getTableColumns, type SQL, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { db } from "../client";

export function buildConflictUpdateColumns<
	T extends PgTable,
	Q extends keyof T["_"]["columns"],
>(table: T, columns: Q[]): Record<Q, SQL> {
	const cls = getTableColumns(table);
	return columns.reduce(
		(acc, column) => {
			const col = cls[column as string];
			acc[column] = sql.raw(`excluded.${col?.name}`);
			return acc;
		},
		{} as Record<Q, SQL>,
	);
}

export async function getCurrentTxid(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
): Promise<number> {
	const result = await tx.execute<{ txid: string }>(
		sql`SELECT pg_current_xact_id()::xid::text as txid`,
	);

	const raw = result.rows[0]?.txid;
	const txid = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
	if (!Number.isSafeInteger(txid)) {
		throw new Error(`Failed to get valid Electric txid: ${raw}`);
	}

	return txid;
}

export async function withConnectionLock<T>(
	connectionId: string,
	fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
	return db.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtextextended(${connectionId}::text, 0))`,
		);
		return fn(tx);
	});
}
