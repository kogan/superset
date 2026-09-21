import { db } from "@superset/db/client";

export type SingleFlightResult<T> = { ran: true; result: T } | { ran: false };
export type SingleFlightTx = typeof db;

declare global {
	var __superestsetRunningJobs: Set<string> | undefined;
}

/** The one API owner excludes overlapping jobs without holding the database
 * connection across network calls or callbacks that also access the database. */
export async function singleFlight<T>(
	job: string,
	fn: (database: SingleFlightTx) => Promise<T>,
): Promise<SingleFlightResult<T>> {
	globalThis.__superestsetRunningJobs ??= new Set();
	const running = globalThis.__superestsetRunningJobs;
	if (running.has(job)) return { ran: false };
	running.add(job);
	try {
		return { ran: true, result: await fn(db) };
	} finally {
		running.delete(job);
	}
}
