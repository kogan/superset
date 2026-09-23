import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// code-server 4.138.0 ships the same browser bundle on all four supported targets.
const UPSTREAM_SHA256 =
	"8eb23271cb8d26980a1f2f5060ee4545840f841be46938be603122cc65691ac7";
const PATCHED_SHA256 =
	"9786f5ce0d3af47837e8f20567287b143bf65bcac04eb26c517aea7d9c25f05b";
const ORIGINAL =
	'get userRoamingDataHome(){return Ue(P.file(this.userDataPath).with({scheme:X.vscodeRemote}),"User")}';
const REPLACEMENT =
	'get userRoamingDataHome(){return Ue(P.file(this.userDataPath).with({scheme:X.vscodeRemote,authority:this.remoteAuthority}),"User")}';

export async function patchCodeServerUserSettings(
	runtimeDirectory: string,
): Promise<void> {
	const path = join(
		runtimeDirectory,
		"lib/vscode/out/vs/code/browser/workbench/workbench.js",
	);
	const content = await readFile(path, "utf8");
	const checksum = createHash("sha256").update(content).digest("hex");
	if (checksum === PATCHED_SHA256) return;
	if (checksum !== UPSTREAM_SHA256 || content.split(ORIGINAL).length !== 2) {
		throw new Error(
			"The IDE workbench does not match the pinned settings compatibility patch.",
		);
	}
	// Upstream local-storage.diff omits the remote authority. File watcher events
	// include it, so they never match the settings URI and live updates are lost.
	const patched = content.replace(ORIGINAL, REPLACEMENT);
	if (createHash("sha256").update(patched).digest("hex") !== PATCHED_SHA256) {
		throw new Error(
			"The IDE settings compatibility patch produced an unexpected checksum.",
		);
	}
	const temporary = join(dirname(path), `.workbench-${randomUUID()}.tmp`);
	try {
		await writeFile(temporary, patched, { flag: "wx", mode: 0o600 });
		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true });
	}
}
