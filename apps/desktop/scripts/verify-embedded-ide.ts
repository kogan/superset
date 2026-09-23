import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { cp, mkdtemp, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { linguiMacroPlugin } from "@superset/i18n/bun-plugin";
import { patchCodeServerUserSettings } from "../../../packages/host-service/src/runtime/ide/code-server-compatibility";

const runtimePath = process.argv[2];
if (!runtimePath) {
	throw new Error(
		"Usage: bun scripts/verify-embedded-ide.ts /path/to/code-server/bin/code-server",
	);
}
const temporary = await mkdtemp(join(tmpdir(), "superset-ide-check-"));
try {
	const executable = await realpath(resolve(runtimePath));
	if (
		basename(executable) !== "code-server" ||
		basename(dirname(executable)) !== "bin"
	) {
		throw new Error(
			"Provide the pinned code-server runtime's bin/code-server executable",
		);
	}
	const runtimeDirectory = join(temporary, "runtime");
	await cp(dirname(dirname(executable)), runtimeDirectory, {
		recursive: true,
		verbatimSymlinks: true,
		mode: constants.COPYFILE_FICLONE,
	});
	await patchCodeServerUserSettings(runtimeDirectory);
	const build = await Bun.build({
		entrypoints: [
			resolve(import.meta.dir, "../src/main/lib/ide/ide-manager.ts"),
		],
		outdir: temporary,
		target: "node",
		format: "cjs",
		external: ["electron"],
		plugins: [
			{
				name: "local-ide-forwarding",
				setup(builder) {
					builder.onResolve({ filter: /^\.\.\/port-forward$/ }, () => ({
						path: "local-forward",
						namespace: "fixture",
					}));
					builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
						loader: "js",
						contents: `export const portForwardManager = {
						releaseClient: async () => {},
						sync: async () => { throw new Error("This verification covers local IDEs"); }
					};`,
					}));
				},
			},
		],
	});
	if (!build.success) throw new Error(build.logs.map(String).join("\n"));
	const settingsBuild = await Bun.build({
		entrypoints: [
			resolve(
				import.meta.dir,
				"../../../packages/host-service/src/runtime/ide/default-settings.ts",
			),
			resolve(
				import.meta.dir,
				"../../../packages/host-service/src/runtime/ide/branch-changes-extension.ts",
			),
		],
		outdir: temporary,
		target: "node",
		format: "cjs",
		plugins: [linguiMacroPlugin],
	});
	if (!settingsBuild.success)
		throw new Error(settingsBuild.logs.map(String).join("\n"));
	const electron: unknown = createRequire(import.meta.url)("electron");
	if (typeof electron !== "string")
		throw new Error("Electron executable is unavailable");
	const child = spawn(
		electron,
		[
			join(import.meta.dir, "verify-embedded-ide.electron.cjs"),
			join(runtimeDirectory, "bin", "code-server"),
			temporary,
			...process.argv.slice(3),
		],
		{ stdio: "inherit" },
	);
	process.exitCode = await new Promise<number>((resolveExit, reject) => {
		child.once("error", reject);
		child.once("exit", (code) => resolveExit(code ?? 1));
	});
} finally {
	await rm(temporary, { recursive: true, force: true });
}
