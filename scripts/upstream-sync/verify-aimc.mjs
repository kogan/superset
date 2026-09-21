import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = mkdtempSync(join(tmpdir(), "upstream-sync-aimc-"));
const git = (...args) =>
	execFileSync("git", args, { cwd: directory, stdio: "pipe" });
const config = join(directory, "config.json");
const commit = (value) => {
	writeFileSync(config, `${JSON.stringify(value)}\n`);
	git("add", "config.json");
	git("commit", "-m", "Update fixture");
};
try {
	git("init", "--initial-branch=main");
	git("config", "user.name", "Upstream sync verification");
	git("config", "user.email", "upstream-sync@example.invalid");
	git("config", "commit.gpgsign", "false");
	commit({ upstream: false, kogan: false });
	git("branch", "upstream");
	commit({ upstream: false, kogan: true });
	git("checkout", "upstream");
	commit({ upstream: true, kogan: false });
	git("checkout", "main");
	const merge = spawnSync("git", ["merge", "--no-edit", "upstream"], {
		cwd: directory,
	});
	assert.equal(
		merge.status,
		1,
		"The verification fixture must produce a conflict.",
	);
	execFileSync(
		process.execPath,
		[fileURLToPath(new URL("./resolve-conflicts.mjs", import.meta.url))],
		{
			cwd: directory,
			stdio: "inherit",
		},
	);
	assert.deepEqual(JSON.parse(readFileSync(config, "utf8")), {
		upstream: true,
		kogan: true,
	});
	assert.equal(git("ls-files", "--unmerged").length, 0);
	console.log(
		"AIMC resolved the verification conflict while preserving both changes.",
	);
} finally {
	rmSync(directory, { recursive: true, force: true });
}
