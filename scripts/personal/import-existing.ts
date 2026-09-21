import { createHash } from "node:crypto";
import {
	copyFile,
	lstat,
	mkdir,
	readFile,
	realpath,
	writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { openDatabase } from "../../packages/db/src/runtime";

const identifier = z.string().regex(/^[a-z_][a-z0-9_]*$/);
const tableName = z.string().regex(/^(auth|public|ingest)\.[a-z_][a-z0-9_]*$/);
const manifestSchema = z.object({
	version: z.literal(1),
	activationAllowed: z.literal(false),
	migrations: z.array(
		z.object({ hash: z.string(), created_at: z.coerce.number() }),
	),
	counts: z.record(tableName, z.number().int().nonnegative()),
	excludedTables: z.array(tableName),
	excludedCounts: z
		.record(tableName, z.number().int().nonnegative())
		.optional(),
	files: z.array(
		z.object({
			path: z.string(),
			sha256: z.string().regex(/^[a-f0-9]{64}$/),
			bytes: z.number().int().nonnegative(),
			kind: z.enum(["sqlite", "json", "postgres", "object", "object-metadata"]),
		}),
	),
	externallyOwnedPaths: z.array(
		z.object({
			database: z.string(),
			table: z.string(),
			rowId: z.string(),
			column: z.string(),
			path: z.string(),
			ownership: z.literal("external"),
		}),
	),
	objects: z.object({ status: z.string() }).passthrough(),
});
const constraintsSchema = z.array(
	z.object({
		name: z.string(),
		child_schema: identifier,
		child_table: identifier,
		parent_schema: identifier,
		parent_table: identifier,
		child_columns: z.array(identifier),
		parent_columns: z.array(identifier),
	}),
);

function quote(value: string): string {
	return `"${identifier.parse(value)}"`;
}
function tableSql(value: string): string {
	return tableName.parse(value).split(".").map(quote).join(".");
}

export function normalizeDump(source: string): string {
	return source
		.split("\n")
		.filter((line) => {
			if (/^\\(?:un)?restrict [A-Za-z0-9]+$/.test(line)) return false;
			if (line.startsWith("\\"))
				throw new Error("Unsupported psql command in snapshot");
			return true;
		})
		.join("\n");
}

async function containedFile(root: string, file: string): Promise<string> {
	if (isAbsolute(file)) throw new Error("Snapshot paths must be relative");
	const full = await realpath(resolve(root, file));
	const remainder = relative(root, full);
	if (
		remainder === ".." ||
		remainder.startsWith(`..${sep}`) ||
		isAbsolute(remainder)
	)
		throw new Error("Snapshot path escapes its directory");
	if (!(await lstat(full)).isFile())
		throw new Error("Snapshot entry is not a file");
	return full;
}

export async function restoreExistingSnapshot(input: {
	snapshot: string;
	destination: string;
	migrations: string;
}) {
	const snapshot = await realpath(input.snapshot);
	const destination = resolve(input.destination);
	if (destination.split(sep).includes(".superestset"))
		throw new Error(
			"Import into a staging directory, never the installed application's home",
		);
	if (destination === snapshot || destination.startsWith(snapshot + sep))
		throw new Error("Destination must be outside the immutable snapshot");
	const manifestBytes = await readFile(resolve(snapshot, "manifest.json"));
	const manifest = manifestSchema.parse(
		JSON.parse(manifestBytes.toString("utf8")),
	);
	for (const file of manifest.files) {
		const bytes = await readFile(await containedFile(snapshot, file.path));
		if (
			bytes.length !== file.bytes ||
			createHash("sha256").update(bytes).digest("hex") !== file.sha256
		)
			throw new Error(`Snapshot checksum mismatch: ${file.path}`);
	}
	const sqlFile = manifest.files.find(
		(file) => file.kind === "postgres" && file.path === "metadata.sql",
	);
	if (!sqlFile) throw new Error("Snapshot lacks its PostgreSQL data export");
	await mkdir(destination, { mode: 0o700 });
	const data = resolve(destination, "data");
	const owner = await openDatabase({
		SUPERESTSET_DATA_DIR: data,
		SUPERESTSET_MIGRATIONS_DIR: resolve(input.migrations),
	});
	try {
		const targetMigrations = z
			.array(z.object({ hash: z.string(), created_at: z.coerce.number() }))
			.parse(
				(
					await owner.database.$client.query(
						"SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id",
					)
				).rows,
			);
		if (
			JSON.stringify(targetMigrations) !== JSON.stringify(manifest.migrations)
		)
			throw new Error(
				"Source migration history differs; import requires matching schema before upgrade",
			);
		const dump = normalizeDump(
			await readFile(resolve(snapshot, "metadata.sql"), "utf8"),
		);
		await owner.database.$client.transaction(async (tx) => {
			await tx.exec("SET LOCAL session_replication_role = replica");
			try {
				await tx.exec(dump);
			} catch (error) {
				throw new Error(
					error instanceof Error ? error.message : "PostgreSQL restore failed",
				);
			}
			for (const [table, expected] of Object.entries(manifest.counts)) {
				const result = z
					.array(z.object({ count: z.number() }))
					.parse(
						(
							await tx.query(
								`SELECT count(*)::int AS count FROM ${tableSql(table)}`,
							)
						).rows,
					);
				if (result[0]?.count !== expected)
					throw new Error(`Imported row count differs for ${table}`);
			}
			const constraints = constraintsSchema.parse(
				(
					await tx.query(`
				SELECT fk.conname AS name, ns.nspname AS child_schema, c.relname AS child_table,
				pn.nspname AS parent_schema, p.relname AS parent_table,
				ARRAY(SELECT a.attname FROM unnest(fk.conkey) WITH ORDINALITY k(id,ord) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.id ORDER BY k.ord) AS child_columns,
				ARRAY(SELECT a.attname FROM unnest(fk.confkey) WITH ORDINALITY k(id,ord) JOIN pg_attribute a ON a.attrelid=p.oid AND a.attnum=k.id ORDER BY k.ord) AS parent_columns
				FROM pg_constraint fk JOIN pg_class c ON c.oid=fk.conrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace
				JOIN pg_class p ON p.oid=fk.confrelid JOIN pg_namespace pn ON pn.oid=p.relnamespace
				WHERE fk.contype='f' AND ns.nspname IN ('auth','public','ingest')
			`)
				).rows,
			);
			for (const constraint of constraints) {
				const required = constraint.child_columns
					.map((column) => `c.${quote(column)} IS NOT NULL`)
					.join(" AND ");
				const matches = constraint.child_columns
					.map((column, index) => {
						const parent = constraint.parent_columns[index];
						if (!parent) throw new Error("Malformed foreign key definition");
						return `p.${quote(parent)}=c.${quote(column)}`;
					})
					.join(" AND ");
				const invalid = await tx.query(
					`SELECT 1 FROM ${quote(constraint.child_schema)}.${quote(constraint.child_table)} c WHERE ${required} AND NOT EXISTS (SELECT 1 FROM ${quote(constraint.parent_schema)}.${quote(constraint.parent_table)} p WHERE ${matches}) LIMIT 1`,
				);
				if (invalid.rows.length)
					throw new Error(`Imported foreign key violation: ${constraint.name}`);
			}
		});
		const pageVersions = z
			.array(
				z.object({
					storage_key: z.string(),
					sha256: z.string(),
					size_bytes: z.number(),
				}),
			)
			.parse(
				(
					await owner.database.$client.query(
						"SELECT storage_key,sha256,size_bytes FROM public.page_versions",
					)
				).rows,
			);
		for (const version of pageVersions) {
			const object = manifest.files.find(
				(file) =>
					file.kind === "object" &&
					file.path === `objects/private/data/${version.storage_key}`,
			);
			if (
				!object ||
				object.sha256 !== version.sha256 ||
				object.bytes !== version.size_bytes
			)
				throw new Error(
					"Page version object is missing or differs from its metadata",
				);
		}
	} finally {
		await owner.close();
	}
	for (const file of manifest.files.filter(
		(entry) =>
			entry.kind === "sqlite" ||
			entry.kind === "json" ||
			entry.kind === "object" ||
			entry.kind === "object-metadata",
	)) {
		const homeFile = file.kind === "sqlite" || file.kind === "json";
		if (!file.path.startsWith(homeFile ? "home/" : "objects/"))
			throw new Error("Snapshot file is outside its expected directory");
		const destinationFile = resolve(
			data,
			homeFile ? file.path.slice(5) : file.path,
		);
		const remainder = relative(data, destinationFile);
		if (
			remainder.startsWith(`..${sep}`) ||
			remainder === ".." ||
			isAbsolute(remainder)
		)
			throw new Error("Application snapshot path escapes staging");
		await mkdir(dirname(destinationFile), { recursive: true, mode: 0o700 });
		await copyFile(await containedFile(snapshot, file.path), destinationFile);
	}
	const receipt = {
		version: 1,
		snapshotSha256: createHash("sha256").update(manifestBytes).digest("hex"),
		dataDirectory: data,
		counts: manifest.counts,
		excludedTables: manifest.excludedTables,
		excludedCounts: manifest.excludedCounts,
		externallyOwnedPaths: manifest.externallyOwnedPaths,
		objects: manifest.objects,
		activationAllowed: false,
		requiredBeforeActivation: [
			...(manifest.objects.status === "complete"
				? []
				: ["Copy object content and verify Page references"]),
			"Create independently owned repositories/worktrees and remap paths",
			"Select imported user identity and bootstrap new credentials",
		],
	};
	await writeFile(
		resolve(destination, "receipt.json"),
		`${JSON.stringify(receipt, null, 2)}\n`,
		{ mode: 0o600 },
	);
	return receipt;
}

if (import.meta.main) {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			snapshot: { type: "string" },
			destination: { type: "string" },
			migrations: { type: "string" },
		},
	});
	if (!values.snapshot || !values.destination || !values.migrations)
		throw new Error(
			"Usage: bun scripts/personal/import-existing.ts --snapshot PATH --destination NEW_STAGING_PATH --migrations packages/db/drizzle",
		);
	const receipt = await restoreExistingSnapshot({
		snapshot: values.snapshot,
		destination: values.destination,
		migrations: values.migrations,
	});
	console.info(
		JSON.stringify({
			dataDirectory: receipt.dataDirectory,
			tables: Object.keys(receipt.counts).length,
			externalPaths: receipt.externallyOwnedPaths.length,
			activationAllowed: false,
		}),
	);
}
