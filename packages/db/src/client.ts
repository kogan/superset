import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import {
	type DatabaseOwner,
	type DatabaseSettings,
	databaseSettingsSchema,
	openDatabase,
} from "./runtime";
import * as schema from "./schema";

type DatabaseState = {
	settings: DatabaseSettings;
	opening: Promise<DatabaseOwner>;
	owner?: DatabaseOwner;
	closing?: Promise<void>;
};
declare global {
	var __superestsetDatabase: DatabaseState | undefined;
}

const buildPhase = () => process.env.NEXT_PHASE === "phase-production-build";
const schemaOnly = drizzle.mock({ schema, casing: "snake_case" });

export const db: PgliteDatabase<typeof schema> = new Proxy(schemaOnly, {
	get(target, property) {
		const state = globalThis.__superestsetDatabase;
		const database = state?.owner?.database;
		if (!database || state?.closing) {
			if (buildPhase()) return Reflect.get(target, property, target);
			throw new Error(
				"Personal database is not ready. Await initializeDatabase() in the API process before loading routes.",
			);
		}
		const value = Reflect.get(database, property, database);
		return typeof value === "function" ? value.bind(database) : value;
	},
});

export async function initializeDatabase() {
	if (buildPhase())
		throw new Error(
			"Database initialization is forbidden during the Next.js build.",
		);
	const settings = databaseSettingsSchema.parse(process.env);
	const existing = globalThis.__superestsetDatabase;
	if (existing) {
		if (existing.closing) throw new Error("Personal database is closing.");
		if (
			existing.settings.SUPERESTSET_DATA_DIR !==
				settings.SUPERESTSET_DATA_DIR ||
			existing.settings.SUPERESTSET_MIGRATIONS_DIR !==
				settings.SUPERESTSET_MIGRATIONS_DIR
		) {
			throw new Error(
				"One API process cannot own multiple personal databases.",
			);
		}
		return existing.opening;
	}
	const state: DatabaseState = { settings, opening: openDatabase(settings) };
	globalThis.__superestsetDatabase = state;
	try {
		state.owner = await state.opening;
		return state.owner;
	} catch (error) {
		if (globalThis.__superestsetDatabase === state)
			globalThis.__superestsetDatabase = undefined;
		throw error;
	}
}

export async function closeDatabase(): Promise<void> {
	const state = globalThis.__superestsetDatabase;
	if (!state) return;
	state.closing ??= (async () => {
		try {
			const owner = await state.opening;
			await owner.close();
		} finally {
			if (globalThis.__superestsetDatabase === state)
				globalThis.__superestsetDatabase = undefined;
		}
	})();
	await state.closing;
}
