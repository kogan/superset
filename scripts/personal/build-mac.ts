import {
	cp,
	mkdir,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { publicLocalEnvironment } from "../../packages/shared/src/standalone";
import { macSigning } from "./mac-signing";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const desktop = join(root, "apps/desktop");
const runtime = join(desktop, "dist/local-runtime");
const signing = macSigning(process.argv, process.env.CSC_NAME);
const selfSignedBuild = signing.mode === "self-signed";
const signedBuild = signing.mode !== "ad-hoc";
const fingerprint = signing.mode === "ad-hoc" ? undefined : signing.identity;
if (signedBuild) {
	const identities = Bun.spawnSync([
		"security",
		"find-identity",
		"-v",
		"-p",
		"codesigning",
		...(process.env.CSC_KEYCHAIN ? [process.env.CSC_KEYCHAIN] : []),
	]);
	const identityLines = identities.stdout.toString().split("\n");
	const identityAvailable = identityLines.some(
		(line) =>
			line.trim().split(/\s+/)[1] === fingerprint &&
			(selfSignedBuild || line.includes('"Developer ID Application:')),
	);
	if (identities.exitCode !== 0 || !identityAvailable) {
		throw new Error(
			selfSignedBuild
				? "The selected signing certificate and private key must be unlocked and trusted for code signing in your keychain. See DEVELOPMENT.md. No build was started."
				: "Signed builds require a valid Developer ID Application certificate and its private key in your macOS keychain. See DEVELOPMENT.md. No build was started.",
		);
	}
	if (selfSignedBuild)
		console.warn(
			"[build-mac] Self-signed build: reuse this certificate for updates. This does not provide Apple notarization or Gatekeeper approval.",
		);
} else {
	console.warn(
		"[build-mac] Ad-hoc development build. Do not publish these artifacts to the update feed; they cannot update installed releases.",
	);
}
if (process.argv.includes("--main-only")) {
	await stat(join(desktop, "dist/renderer/index.html"));
	await stat(join(desktop, "dist/preload/index.js"));
}

// Only checked-in placeholders enter build artifacts. Never read the developer's .env.
const defaults: Record<string, string> = {};
for (const line of (
	await readFile(join(root, ".env.local.example"), "utf8")
).split("\n")) {
	const match = line.match(/^([A-Z][A-Z0-9_]*)=(.+)$/);
	if (match) defaults[match[1]] = match[2];
}
Object.assign(
	defaults,
	publicLocalEnvironment({
		apiOrigin: "http://127.0.0.1:1",
		contentOrigin: "http://127.0.0.1:1",
	}),
	{
		SUPERESTSET_LOCAL: "1",
		NEXT_TELEMETRY_DISABLED: "1",
		NODE_ENV: "production",
		DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/pglite",
		DATABASE_URL_UNPOOLED: "postgres://unused:unused@127.0.0.1:1/pglite",
		KV_REST_API_URL: "http://127.0.0.1:1/unconfigured",
		KV_URL: "redis://127.0.0.1:1",
		QSTASH_URL: "http://127.0.0.1:1/unconfigured",
		SLACK_BILLING_WEBHOOK_URL: "http://127.0.0.1:1/unconfigured",
		DURABLE_STREAMS_URL: "http://127.0.0.1:1/unconfigured",
		SANDBOX_GATE_ORIGIN: "http://127.0.0.1:1/unconfigured",
		GH_APP_SLUG: "superestset-unconfigured",
		NEXT_PUBLIC_DESKTOP_URL: "superestset://app",
		APPLE_CLIENT_ID: "disabled",
		APPLE_CLIENT_SECRET: "disabled",
		APPLE_APP_BUNDLE_IDENTIFIER: "com.deexi333.superestset",
	},
);
// The launcher replaces these three on every start with install-specific secrets.
delete defaults.BETTER_AUTH_SECRET;
delete defaults.USERCONTENT_TOKEN_SECRET;
delete defaults.SECRETS_ENCRYPTION_KEY;
const buildEnv: NodeJS.ProcessEnv = {
	...process.env,
	...defaults,
	NEXT_PHASE: "phase-production-build",
	BETTER_AUTH_SECRET: "build-only-not-a-runtime-secret-000000000000000",
	USERCONTENT_TOKEN_SECRET: "build-only-not-a-runtime-secret-000000000000000",
	SECRETS_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
	CSC_IDENTITY_AUTO_DISCOVERY: signedBuild ? "true" : "false",
	CSC_NAME: fingerprint,
	SUPERESTSET_BUILD_MAIN_ONLY: process.argv.includes("--main-only") ? "1" : "0",
};
// Do not inherit upstream telemetry/deploy credentials from the invoking shell.
for (const key of Object.keys(buildEnv))
	if (/SENTRY|POSTHOG|VERCEL_ENV/.test(key)) delete buildEnv[key];
Object.assign(buildEnv, {
	NEXT_PUBLIC_POSTHOG_KEY: "disabled",
	NEXT_PUBLIC_POSTHOG_HOST: "http://127.0.0.1:1",
	POSTHOG_PROJECT_ID: "0",
	POSTHOG_API_KEY: "disabled",
});

async function run(args: string[], cwd = root) {
	console.log(`[build-mac] ${args.join(" ")}`);
	const child = Bun.spawn(args, {
		cwd,
		env: buildEnv,
		stdout: "inherit",
		stderr: "inherit",
	});
	if ((await child.exited) !== 0)
		throw new Error(`Build step failed: ${args.join(" ")}`);
}

await run(["bun", "run", "--filter=@superset/i18n", "build"]);
if (!process.argv.includes("--skip-api"))
	await run(["bun", "run", "build"], join(root, "apps/api"));
await run(["bun", "run", "generate:icons"], desktop);
if (!process.argv.includes("--skip-desktop"))
	await run(["bun", "run", "compile:app"], desktop);
const sdkStore = join(root, "node_modules/.bun");
const sdkEntry = (await readdir(sdkStore)).find((name) =>
	name.startsWith("@anthropic-ai+claude-agent-sdk-darwin-arm64@"),
);
if (!sdkEntry) throw new Error("Missing bundled Claude agent binary");
await cp(
	join(
		sdkStore,
		sdkEntry,
		"node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude",
	),
	join(desktop, "dist/resources/bin/claude-agent"),
);
await mkdir(runtime, { recursive: true });
await rm(join(runtime, "api"), { recursive: true, force: true });
await cp(join(root, "apps/api/.next/standalone"), join(runtime, "api"), {
	recursive: true,
	verbatimSymlinks: true,
});
await cp(
	join(root, "apps/api/.next/static"),
	join(runtime, "api/apps/api/.next/static"),
	{ recursive: true },
);
await cp(join(root, "packages/db/drizzle"), join(runtime, "migrations"), {
	recursive: true,
});
await writeFile(
	join(runtime, "defaults.json"),
	JSON.stringify(defaults, null, 2),
);
const serverFile = join(runtime, "api/apps/api/server.js");
const server = await readFile(serverFile, "utf8");
const portFallback = "parseInt(process.env.PORT, 10) || 3000";
if (!server.includes(portFallback))
	throw new Error(
		"Next standalone port format changed; inspect before packaging",
	);
await writeFile(
	serverFile,
	server.replace(portFallback, "Number(process.env.PORT ?? 0)"),
);
await run([
	"bun",
	"build",
	"apps/usercontent/scripts/standalone.ts",
	"--target=node",
	"--format=cjs",
	`--outfile=${join(runtime, "content.cjs")}`,
]);
await run(["bun", "run", "copy:native-modules"], desktop);
await run(["bun", "run", "validate:native-runtime"], desktop);
await run(
	[
		"bun",
		"x",
		"electron-builder",
		"--config",
		"electron-builder.ts",
		...(signedBuild ? ["--config.forceCodeSigning=true"] : []),
		...(selfSignedBuild
			? ["--config.mac.timestamp=none", "--config.mac.notarize=false"]
			: []),
		"--mac",
		...(process.argv.includes("--dir") ? ["dir"] : ["dmg", "zip"]),
		"--arm64",
		"--publish",
		"never",
	],
	desktop,
);
if (!process.argv.includes("--dir")) {
	await run([
		"bun",
		"run",
		"scripts/personal/verify-mac-release.ts",
		...(signedBuild ? [] : ["--ad-hoc"]),
	]);
}
