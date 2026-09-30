import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

test("checked-in local placeholders satisfy the API and tRPC environment schemas", async () => {
	const root = resolve(import.meta.dir, "../..");
	const environment: Record<string, string> = { NODE_ENV: "production" };
	for (const line of (
		await readFile(resolve(root, ".env.local.example"), "utf8")
	).split("\n")) {
		const match = line.match(/^([A-Z][A-Z0-9_]*)=(.+)$/);
		if (match) environment[match[1]] = match[2];
	}
	const child = Bun.spawn(
		[
			process.execPath,
			"--no-env-file",
			"-e",
			'await import("./apps/api/src/env.ts"); await import("./packages/trpc/src/env.ts");',
		],
		{ cwd: root, env: environment, stdout: "pipe", stderr: "pipe" },
	);
	const [status, stderr] = await Promise.all([
		child.exited,
		new Response(child.stderr).text(),
	]);
	expect(stderr).not.toContain("Invalid environment variables");
	expect(status).toBe(0);
});
