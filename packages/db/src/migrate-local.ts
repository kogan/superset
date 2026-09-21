import { closeDatabase, initializeDatabase } from "./client";

try {
	const owner = await initializeDatabase();
	console.info(
		`Personal database ready: ${owner.migrations.applied} migrations applied, ${owner.migrations.total} total.`,
	);
} finally {
	await closeDatabase();
}
