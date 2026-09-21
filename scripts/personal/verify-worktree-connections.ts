import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// Run the real SQLite/Git connection check with the same Electron ABI as the Mac app.
const desktop = resolve(import.meta.dir, "../../apps/desktop");
const require = createRequire(resolve(desktop, "package.json"));
const electron: string = require("electron");
const outfile = resolve(
	desktop,
	"node_modules/.cache/workspace-connections-test.cjs",
);
mkdirSync(resolve(desktop, "node_modules/.cache"), { recursive: true });
const result = await Bun.build({
	entrypoints: [
		resolve(desktop, "src/main/lib/workspace-connections/connect.node-test.ts"),
	],
	target: "node",
	format: "cjs",
	external: ["better-sqlite3"],
	throw: true,
});
const output = result.outputs[0];
if (!output) throw new Error("Connection test bundle was not generated");
await Bun.write(outfile, output);
const child = Bun.spawn([electron, "--test", outfile], {
	cwd: desktop,
	env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
	stdout: "inherit",
	stderr: "inherit",
});
process.exit(await child.exited);
