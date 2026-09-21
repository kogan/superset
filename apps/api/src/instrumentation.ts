import * as Sentry from "@sentry/nextjs";

export async function register() {
	if (
		process.env.NEXT_RUNTIME === "nodejs" &&
		process.env.SUPERESTSET_LOCAL === "1" &&
		process.env.NEXT_PHASE !== "phase-production-build"
	) {
		await (await import("./local-runtime")).startLocalRuntime();
		return;
	}
	if (process.env.NEXT_RUNTIME === "nodejs") {
		await import("../sentry.server.config");
	}

	if (process.env.NEXT_RUNTIME === "edge") {
		await import("../sentry.edge.config");
	}
}

export const onRequestError = Sentry.captureRequestError;
