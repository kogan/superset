import { join } from "node:path";
import { withSentryConfig } from "@sentry/nextjs";
import { config as dotenvConfig } from "dotenv";
import type { NextConfig } from "next";

if (process.env.NODE_ENV !== "production") {
	dotenvConfig({
		path: join(process.cwd(), "../../.env"),
		override: true,
		quiet: true,
	});
}

const config: NextConfig = {
	output: "standalone",
	outputFileTracingRoot: join(process.cwd(), "../.."),
	serverExternalPackages: ["@electric-sql/pglite"],
	reactCompiler: true,
	typescript: { ignoreBuildErrors: true },
	// Compiles @lingui/core/macro, reached through @superset/shared, at build
	// time. Version must stay in lockstep with @lingui/core.
	experimental: {
		swcPlugins: [["@lingui/swc-plugin", {}]],
	},
};

export default process.env.SUPERESTSET_LOCAL === "1"
	? config
	: withSentryConfig(config, {
			org: "superset-sh",
			project: "api",
			silent: !process.env.CI,
			authToken: process.env.SENTRY_AUTH_TOKEN,
			widenClientFileUpload: true,
			tunnelRoute: "/monitoring",
			disableLogger: true,
			automaticVercelMonitors: true,
		});
