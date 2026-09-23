import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const desktopRequire = createRequire(
	resolve(import.meta.dir, "../../../apps/desktop/package.json"),
);
const electron: unknown = desktopRequire("electron");
if (typeof electron !== "string")
	throw new Error(
		"Electron's executable is unavailable. Install desktop dependencies first.",
	);
const temporary = await mkdtemp(join(tmpdir(), "superset-ide-electron-smoke-"));
try {
	const bundled = await Bun.build({
		entrypoints: [join(import.meta.dir, "verify-embedded-ide.ts")],
		target: "node",
		format: "esm",
		outdir: temporary,
		naming: "verify-embedded-ide.mjs",
	});
	if (!bundled.success)
		throw new AggregateError(
			bundled.logs,
			"Failed to bundle the IDE verification script.",
		);
	const child = spawn(
		electron,
		[join(temporary, "verify-embedded-ide.mjs"), ...process.argv.slice(2)],
		{
			env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
			stdio: "inherit",
		},
	);
	const code = await new Promise<number>((resolveExit, reject) => {
		child.once("error", reject);
		child.once("exit", (exitCode) => resolveExit(exitCode ?? 1));
	});
	if (code !== 0)
		throw new Error(`Electron IDE verification exited with status ${code}.`);
} finally {
	await rm(temporary, { recursive: true, force: true });
}
