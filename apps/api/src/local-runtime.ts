import { publicLocalEnvironment } from "@superset/shared/standalone";

let started: Promise<void> | undefined;

/** Next binds its listener and sets PORT before calling instrumentation. */
export function startLocalRuntime(): Promise<void> {
	started ??= (async () => {
		const port = Number(process.env.PORT);
		if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
			throw new Error("Missing bound API port");
		const contentOrigin = process.env.USERCONTENT_URL;
		if (
			!contentOrigin ||
			!["127.0.0.1", "frame.usercontent.localhost"].includes(
				new URL(contentOrigin).hostname,
			)
		)
			throw new Error("Missing local content origin");
		const apiOrigin = `http://127.0.0.1:${port}`;
		Object.assign(
			process.env,
			publicLocalEnvironment({ apiOrigin, contentOrigin }),
		);
		// Keep Next's public-variable replacement out of server runtime values.
		process.env.SUPERESTSET_API_ORIGIN = apiOrigin;
		const { initializeDatabase, closeDatabase } = await import(
			"@superset/db/client"
		);
		await initializeDatabase();
		const { bootstrapLocalAccount } = await import(
			"@superset/auth/local-bootstrap"
		);
		const session = await bootstrapLocalAccount();
		process.send?.({ type: "ready", apiOrigin, ...session });
		let stopping = false;
		const stop = async () => {
			if (stopping) return;
			stopping = true;
			await closeDatabase();
			process.exit(0);
		};
		process.on("disconnect", () => {
			void stop();
		});
		process.on("message", (message) => {
			if (message === "shutdown") void stop();
		});
	})();
	return started;
}
