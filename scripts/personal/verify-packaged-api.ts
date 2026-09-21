import assert from "node:assert/strict";
import { type ChildProcess, fork } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
	mkdtemp,
	readdir,
	readFile,
	readlink,
	realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { FORK } from "../../packages/shared/src/standalone";

const appPath = resolve(
	process.argv[2] ?? `apps/desktop/release/mac-arm64/${FORK.name}.app`,
);
const dataDir = await mkdtemp(join(tmpdir(), "superestset-packaged-api-"));
const runtime = join(appPath, "Contents/Resources/local-runtime");
const executable = join(
	appPath,
	`Contents/Frameworks/${FORK.name} Helper.app/Contents/MacOS/${FORK.name} Helper`,
);
const defaults = z
	.record(z.string(), z.string())
	.parse(JSON.parse(await readFile(join(runtime, "defaults.json"), "utf8")));
const appRealPath = await realpath(appPath);
const env = {
	...defaults,
	ELECTRON_RUN_AS_NODE: "1",
	NODE_ENV: "production",
	SUPERESTSET_LOCAL: "1",
	PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
	HOME: process.env.HOME,
	SUPERESTSET_DATA_DIR: dataDir,
	SUPERESTSET_MIGRATIONS_DIR: join(runtime, "migrations"),
	BETTER_AUTH_SECRET: randomBytes(32).toString("base64url"),
	USERCONTENT_TOKEN_SECRET: randomBytes(32).toString("base64url"),
	SECRETS_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
	NEXT_MANUAL_SIG_HANDLE: "true",
	NEXT_TELEMETRY_DISABLED: "1",
	HOSTNAME: "127.0.0.1",
	PORT: "0",
};
delete defaults.USERCONTENT_URL;
delete defaults.STATIC_URL;
delete env.USERCONTENT_URL;
delete env.STATIC_URL;
const readySchema = z.object({
	type: z.literal("ready"),
	origin: z.url().optional(),
	apiOrigin: z.url().optional(),
	token: z.string().optional(),
	organizationIds: z.array(z.string()).optional(),
});
// Chromium resolves *.localhost itself. Node’s DNS resolver does not on every Mac.
function localFetch(input: string, init?: RequestInit) {
	const url = new URL(input);
	if (!url.hostname.endsWith(".localhost")) return fetch(input, init);
	const host = url.host;
	url.hostname = "127.0.0.1";
	return fetch(url, {
		...init,
		headers: { ...Object.fromEntries(new Headers(init?.headers)), host },
	});
}

async function assertSymlinkClosure(root: string, base = root) {
	const entries = await readdir(root, { withFileTypes: true });
	for (const entry of entries) {
		const entryPath = join(root, entry.name);
		if (entry.isSymbolicLink()) {
			const target = await realpath(entryPath);
			assert(
				target === base || target.startsWith(`${base}/`),
				`Packaged symlink escapes app: ${entryPath} -> ${await readlink(entryPath)} -> ${target}`,
			);
			continue;
		}
		if (entry.isDirectory()) await assertSymlinkClosure(entryPath, base);
	}
}

const children: ChildProcess[] = [];
function start(entry: string, overrides: Record<string, string> = {}) {
	const child = fork(entry, [], {
		execPath: executable,
		cwd: dataDir,
		env: { ...env, ...overrides },
		stdio: ["ignore", "pipe", "pipe", "ipc"],
	});
	children.push(child);
	child.stdout?.on("data", (data) => process.stdout.write(data));
	child.stderr?.on("data", (data) => process.stderr.write(data));
	return new Promise<z.infer<typeof readySchema>>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("Packaged service startup timed out")),
			120_000,
		);
		child.once("exit", (code) => {
			clearTimeout(timer);
			reject(new Error(`Packaged service exited: ${code}`));
		});
		child.once("error", reject);
		child.on("message", (message) => {
			const ready = readySchema.safeParse(message);
			if (ready.success) {
				clearTimeout(timer);
				resolve(ready.data);
			}
		});
	});
}
async function stop() {
	await Promise.all(
		children.splice(0).map(
			(child) =>
				new Promise<void>((resolve) => {
					if (child.exitCode !== null || child.signalCode !== null) {
						resolve();
						return;
					}
					const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
					child.once("exit", () => {
						clearTimeout(timer);
						resolve();
					});
					if (child.connected) child.send("shutdown");
					else child.kill();
				}),
		),
	);
}
try {
	await assertSymlinkClosure(appRealPath);
	let previousOrg: string | undefined;
	let pageId: string | undefined;
	for (let attempt = 0; attempt < 2; attempt++) {
		const content = await start(join(runtime, "content.cjs"));
		assert(content.origin);
		assert.equal((await localFetch(`${content.origin}/health`)).status, 200);
		const api = await start(join(runtime, "api/apps/api/server.js"), {
			USERCONTENT_URL: content.origin,
			STATIC_URL: content.origin,
		});
		assert(api.apiOrigin && api.token && api.organizationIds?.length);
		const headers = { authorization: `Bearer ${api.token}` };
		async function rpc(method: string, input: unknown, mutation = false) {
			const serialized = JSON.stringify({ json: input });
			const response = await fetch(
				`${api.apiOrigin}/api/trpc/${method}${mutation ? "" : `?input=${encodeURIComponent(serialized)}`}`,
				mutation
					? {
							method: "POST",
							headers: { ...headers, "content-type": "application/json" },
							body: serialized,
						}
					: { headers },
			);
			assert.equal(response.status, 200, `${method}: ${response.status}`);
			return (await response.json()).result.data.json;
		}
		const sessionResponse = await fetch(
			`${api.apiOrigin}/api/auth/get-session`,
			{ headers },
		);
		assert.equal(sessionResponse.status, 200);
		const session = await sessionResponse.json();
		assert.equal(session.session.activeOrganizationId, api.organizationIds[0]);
		const organizations = await fetch(
			`${api.apiOrigin}/api/trpc/organization.list`,
			{ headers },
		);
		assert.equal(
			organizations.status,
			200,
			"Authenticated tRPC must work in the packaged API",
		);
		const unauthenticated = await fetch(
			`${api.apiOrigin}/api/trpc/organization.list`,
		);
		assert.equal(unauthenticated.status, 401);
		if (attempt === 0) {
			const document =
				"<!doctype html><html><body><h1>Packaged persistence probe</h1></body></html>";
			const upload = await rpc(
				"page.assets.upload",
				{
					kind: "document",
					name: "index.html",
					contentType: "text/html",
					sizeBytes: Buffer.byteLength(document),
					sha256: createHash("sha256").update(document).digest("hex"),
				},
				true,
			);
			assert.equal(new URL(upload.upload.url).origin, content.origin);
			assert.equal(
				(
					await localFetch(upload.upload.url, {
						method: "PUT",
						headers: upload.upload.headers,
						body: document,
					})
				).status,
				204,
			);
			const published = await rpc(
				"page.publish",
				{
					fileId: upload.fileId,
					filename: "index.html",
					title: "Packaged persistence probe",
					visibility: "just_me",
				},
				true,
			);
			pageId = published.id;
		}
		assert(pageId);
		const page = await rpc("page.get", { id: pageId });
		assert.equal(
			new URL(page.viewUrl).hostname,
			`${pageId}.frame.usercontent.localhost`,
		);
		const rendered = await localFetch(page.viewUrl);
		assert.equal(rendered.status, 200);
		assert.equal(rendered.headers.get("origin-agent-cluster"), "?1");
		assert.equal(rendered.headers.get("x-content-type-options"), "nosniff");
		assert.equal(rendered.headers.get("referrer-policy"), "no-referrer");
		assert.equal(rendered.headers.get("x-robots-tag"), "noindex, nofollow");
		assert.match(
			rendered.headers.get("content-security-policy") ?? "",
			/frame-ancestors/,
		);
		assert.equal(
			rendered.headers.get("superset-storage-key"),
			`pages/${pageId}/versions/1/index.html`,
		);
		assert.match(await rendered.text(), /Packaged persistence probe/);
		if (previousOrg)
			assert.equal(
				api.organizationIds[0],
				previousOrg,
				"Local identity must survive a restart",
			);
		previousOrg = api.organizationIds[0];
		console.log(
			JSON.stringify({
				attempt,
				auth: "passed",
				protectedRoute: "passed",
				localPages: "passed",
				pageSecurityHeaders: "passed",
				symlinkClosure: "passed",
				dataDir,
				apiOrigin: api.apiOrigin,
				contentOrigin: content.origin,
			}),
		);
		await stop();
	}
} finally {
	await stop();
}
