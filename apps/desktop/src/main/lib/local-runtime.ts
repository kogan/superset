import { type ChildProcess, fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { publicLocalEnvironment } from "@superset/shared/standalone";
import { app } from "electron";
import { z } from "zod";
import { nodeExecutable } from "./node-executable";

const secretsSchema = z.object({
	auth: z.string().min(43),
	content: z.string().min(43),
	encryption: z.string().length(44),
});
const loopbackOrigin = z.url().refine((value) => {
	const url = new URL(value);
	return (
		url.protocol === "http:" &&
		["127.0.0.1", "frame.usercontent.localhost"].includes(url.hostname) &&
		url.port !== "" &&
		url.pathname === "/"
	);
});
const apiReadySchema = z.object({
	type: z.literal("ready"),
	apiOrigin: loopbackOrigin,
	token: z.string().min(20),
	expiresAt: z.iso.datetime(),
	organizationIds: z.array(z.uuid()).min(1),
});
const contentReadySchema = z.object({
	type: z.literal("ready"),
	origin: loopbackOrigin,
});

let activeShutdown: (() => Promise<void>) | undefined;

export async function stopLocalServices() {
	await activeShutdown?.();
}

function installationSecrets(dataDir: string) {
	mkdirSync(dataDir, { recursive: true, mode: 0o700 });
	const path = join(dataDir, "installation-secrets.json");
	try {
		writeFileSync(
			path,
			JSON.stringify({
				auth: randomBytes(32).toString("base64url"),
				content: randomBytes(32).toString("base64url"),
				encryption: randomBytes(32).toString("base64"),
			}),
			{ flag: "wx", mode: 0o600 },
		);
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "EEXIST"))
			throw error;
	}
	chmodSync(path, 0o600);
	return secretsSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

function startChild<Result>(
	entry: string,
	env: NodeJS.ProcessEnv,
	schema: z.ZodType<Result>,
) {
	const child = fork(entry, [], {
		execPath: nodeExecutable(),
		cwd: join(entry, ".."),
		env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
		stdio: ["ignore", "pipe", "pipe", "ipc"],
	});
	// Logs deliberately contain no IPC payloads: startup sends a session over IPC.
	child.stdout?.on("data", (data) =>
		console.log(`[local-service] ${String(data).trimEnd()}`),
	);
	child.stderr?.on("data", (data) =>
		console.error(`[local-service] ${String(data).trimEnd()}`),
	);
	const ready = new Promise<Result>((resolve, reject) => {
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error("Local service startup timed out"));
		}, 120_000);
		child.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.once("exit", (code) => {
			clearTimeout(timer);
			reject(new Error(`Local service exited during startup (${code})`));
		});
		child.on("message", (message) => {
			const parsed = schema.safeParse(message);
			if (parsed.success) {
				clearTimeout(timer);
				resolve(parsed.data);
			}
		});
	});
	return { child, ready };
}

async function stopChild(child: ChildProcess) {
	if (child.exitCode !== null || child.signalCode !== null) return;
	await new Promise<void>((resolve) => {
		const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
		child.once("exit", () => {
			clearTimeout(timer);
			resolve();
		});
		if (child.connected) child.send("shutdown");
		else child.kill("SIGTERM");
	});
}

export async function startLocalServices(dataDir: string) {
	const resources = app.isPackaged
		? process.resourcesPath
		: join(app.getAppPath(), "dist");
	const runtime = join(resources, "local-runtime");
	const secrets = installationSecrets(dataDir);
	const defaults = z
		.record(z.string(), z.string())
		.parse(JSON.parse(readFileSync(join(runtime, "defaults.json"), "utf8")));
	const serviceEnv: NodeJS.ProcessEnv = {
		...defaults,
		NODE_ENV: "production",
		SUPERESTSET_LOCAL: "1",
		PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
		HOME: process.env.HOME,
		TMPDIR: process.env.TMPDIR,
		SUPERESTSET_DATA_DIR: dataDir,
		SUPERESTSET_MIGRATIONS_DIR: join(runtime, "migrations"),
		BETTER_AUTH_SECRET: secrets.auth,
		USERCONTENT_TOKEN_SECRET: secrets.content,
		SECRETS_ENCRYPTION_KEY: secrets.encryption,
		NEXT_TELEMETRY_DISABLED: "1",
		NEXT_MANUAL_SIG_HANDLE: "true",
		PORT: "0",
		HOSTNAME: "127.0.0.1",
	};
	delete serviceEnv.USERCONTENT_URL;
	delete serviceEnv.STATIC_URL;
	const children: ChildProcess[] = [];
	let shutdown: Promise<void> | undefined;
	const stop = () =>
		(shutdown ??= Promise.all(children.map(stopChild)).then(() => {}));
	activeShutdown = stop;
	try {
		const content = startChild(
			join(runtime, "content.cjs"),
			serviceEnv,
			contentReadySchema,
		);
		children.push(content.child);
		const contentReady = await content.ready;
		Object.assign(
			serviceEnv,
			publicLocalEnvironment({
				apiOrigin: "http://127.0.0.1:1",
				contentOrigin: contentReady.origin,
			}),
		);
		const api = startChild(
			join(runtime, "api/apps/api/server.js"),
			serviceEnv,
			apiReadySchema,
		);
		children.push(api.child);
		const session = await api.ready;
		const publicEnvironment = publicLocalEnvironment({
			apiOrigin: session.apiOrigin,
			contentOrigin: contentReady.origin,
		});
		writeFileSync(
			join(dataDir, "runtime.json"),
			JSON.stringify({
				apiOrigin: session.apiOrigin,
				contentOrigin: contentReady.origin,
			}),
			{ mode: 0o600 },
		);
		return { session, publicEnvironment, stop };
	} catch (error) {
		await stop();
		throw error;
	}
}
