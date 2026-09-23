import { expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { patchCodeServerUserSettings } from "./code-server-compatibility";

test("refuses an unexpected runtime bundle without modifying it", async () => {
	const runtime = await mkdtemp(join(tmpdir(), "ide-compatibility-test-"));
	const directory = join(runtime, "lib/vscode/out/vs/code/browser/workbench");
	try {
		await mkdir(directory, { recursive: true });
		const path = join(directory, "workbench.js");
		const unexpected =
			'get userRoamingDataHome(){return Ue(P.file(this.userDataPath).with({scheme:X.vscodeRemote}),"User")}';
		await writeFile(path, unexpected);
		await expect(patchCodeServerUserSettings(runtime)).rejects.toThrow(
			"does not match",
		);
		expect(await readFile(path, "utf8")).toBe(unexpected);
		expect(await readdir(directory)).toEqual(["workbench.js"]);
	} finally {
		await rm(runtime, { recursive: true, force: true });
	}
});
