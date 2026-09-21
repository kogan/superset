import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

function command(cwd, program, args, env = {}) {
	const result = spawnSync(program, args, {
		cwd,
		encoding: "utf8",
		env: { ...process.env, ...env },
	});
	assert.equal(
		result.status,
		0,
		`${program} ${args.join(" ")}\n${result.stderr}`,
	);
	return result.stdout.trim();
}

function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), "superset-upstream-sync-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const upstream = join(root, "upstream.git");
	const origin = join(root, "origin.git");
	const author = join(root, "author");
	const worker = join(root, "worker");
	const statePath = join(root, "github.json");
	const script = join(root, "sync.sh");
	const git = (cwd, ...args) => command(cwd, "git", args);
	git(root, "init", "--bare", "--initial-branch=main", upstream);
	git(root, "init", "--bare", "--initial-branch=main", origin);
	git(root, "clone", upstream, author);
	git(author, "config", "user.name", "Test");
	git(author, "config", "user.email", "test@example.com");
	git(author, "config", "commit.gpgsign", "false");
	const commit = (name, contents) => {
		writeFileSync(join(author, name), contents);
		git(author, "add", name);
		git(author, "commit", "-m", `Update ${name}`);
		return git(author, "rev-parse", "HEAD");
	};
	commit("shared.txt", "base\n");
	git(author, "push", "origin", "main");
	git(author, "remote", "add", "fork", origin);
	git(author, "push", "fork", "main");
	git(root, "clone", origin, worker);
	git(worker, "config", "commit.gpgsign", "false");
	copyFileSync(fileURLToPath(new URL("./sync.sh", import.meta.url)), script);
	writeFileSync(statePath, JSON.stringify({ calls: [], pr: null }));
	const mock = join(root, "gh");
	writeFileSync(
		mock,
		`#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(process.env.MOCK_GH_STATE, "utf8"));
state.calls.push(args);
const bodyIndex = args.indexOf("--body-file");
if (bodyIndex !== -1) state.body = fs.readFileSync(args[bodyIndex + 1], "utf8");
if (args[0] !== "pr") throw new Error("Unexpected gh command");
switch (args[1]) {
  case "list":
    if (state.pr) console.log(state.pr.number);
    if (state.mergeOnNextList) {
      const cp = require("node:child_process");
      for (const args of [
        ["fetch", "fork"],
        ["checkout", "kogan"],
        ["merge", "--no-ff", "--no-edit", "fork/sync/upstream"],
        ["push", "fork", "HEAD:main"],
      ]) cp.execFileSync("git", args, { cwd: state.mergeOnNextList, stdio: "pipe" });
      state.pr = null;
      delete state.mergeOnNextList;
    }
    break;
  case "create":
    if (state.pr) throw new Error("Duplicate PR");
    state.pr = { number: 1, isDraft: false };
    console.log("https://github.com/test/fork/pull/1");
    break;
  case "edit": if (!state.pr) throw new Error("Missing PR"); break;
  case "view": console.log(state.pr.isDraft); break;
  case "ready": state.pr.isDraft = true; break;
  default: throw new Error("Unexpected gh operation");
}
fs.writeFileSync(process.env.MOCK_GH_STATE, JSON.stringify(state));
`,
	);
	chmodSync(mock, 0o755);
	const run = (extraEnv = {}) =>
		spawnSync("bash", [script], {
			cwd: worker,
			encoding: "utf8",
			env: {
				...process.env,
				PATH: `${root}${delimiter}${process.env.PATH}`,
				UPSTREAM_URL: upstream,
				GH_REPO: "test/fork",
				MOCK_GH_STATE: statePath,
				...extraEnv,
			},
		});
	const success = () => {
		const result = run();
		assert.equal(result.status, 0, result.stdout + result.stderr);
	};
	const state = () => JSON.parse(readFileSync(statePath, "utf8"));
	const upstreamCommit = (name = "upstream.txt", contents = "upstream\n") => {
		git(author, "checkout", "main");
		const sha = commit(name, contents);
		git(author, "push", "origin", "main");
		return sha;
	};
	const forkCommit = (name = "kogan.txt", contents = "custom\n") => {
		git(author, "checkout", "-B", "kogan", "fork/main");
		const sha = commit(name, contents);
		git(author, "push", "fork", "HEAD:main");
		return sha;
	};
	return {
		root,
		upstream,
		origin,
		author,
		worker,
		git,
		commit,
		run,
		success,
		state,
		statePath,
		upstreamCommit,
		forkCommit,
	};
}

test("does nothing when main already contains upstream, including custom commits", (t) => {
	const f = fixture(t);
	const main = f.forkCommit();
	f.success();
	assert.equal(f.git(f.origin, "rev-parse", "main"), main);
	assert.deepEqual(f.state().calls, []);
	assert.equal(f.git(f.origin, "branch", "--list", "sync/upstream"), "");
});

test("creates one PR, preserves custom main, and retains upstream ancestry", (t) => {
	const f = fixture(t);
	const main = f.forkCommit();
	const upstream = f.upstreamCommit();
	f.success();
	assert.equal(f.git(f.origin, "rev-parse", "main"), main);
	f.git(f.origin, "merge-base", "--is-ancestor", upstream, "sync/upstream");
	f.git(f.origin, "merge-base", "--is-ancestor", main, "sync/upstream");
	const firstSync = f.git(f.origin, "rev-parse", "sync/upstream");
	assert.match(f.state().body, new RegExp(upstream));
	f.git(f.worker, "merge", "--no-edit", "origin/main");
	assert.equal(readFileSync(join(f.worker, "kogan.txt"), "utf8"), "custom\n");
	assert.equal(
		readFileSync(join(f.worker, "upstream.txt"), "utf8"),
		"upstream\n",
	);
	f.success();
	assert.equal(
		f.state().calls.filter((call) => call[1] === "create").length,
		1,
	);
	assert.equal(f.git(f.origin, "rev-parse", "sync/upstream"), firstSync);
});

test("updates the same PR and preserves manual commits on the sync branch", (t) => {
	const f = fixture(t);
	f.upstreamCommit();
	f.success();
	f.git(f.author, "fetch", "fork");
	f.git(f.author, "checkout", "-b", "resolution", "fork/sync/upstream");
	const manual = f.commit("resolution.txt", "keep this\n");
	f.git(f.author, "push", "fork", "HEAD:sync/upstream");
	const upstream = f.upstreamCommit("next.txt", "next\n");
	f.success();
	f.git(f.origin, "merge-base", "--is-ancestor", manual, "sync/upstream");
	f.git(f.origin, "merge-base", "--is-ancestor", upstream, "sync/upstream");
	assert.equal(
		f.state().calls.filter((call) => call[1] === "create").length,
		1,
	);
	assert.match(f.state().body, new RegExp(upstream));
});

test("opens a PR even when upstream conflicts with custom main", (t) => {
	const f = fixture(t);
	const main = f.forkCommit("shared.txt", "Kogan version\n");
	const upstream = f.upstreamCommit("shared.txt", "upstream version\n");
	f.success();
	assert.equal(f.state().pr.number, 1);
	assert.equal(f.git(f.origin, "rev-parse", "main"), main);
	assert.equal(f.git(f.origin, "rev-parse", "sync/upstream"), upstream);
	const merge = spawnSync("git", ["merge", "--no-edit", "origin/main"], {
		cwd: f.worker,
	});
	assert.notEqual(merge.status, 0);
});

test("leaves remote branches untouched and drafts the PR on conflicting updates", (t) => {
	const f = fixture(t);
	f.upstreamCommit();
	f.success();
	const main = f.git(f.origin, "rev-parse", "main");
	f.git(f.author, "fetch", "fork");
	f.git(f.author, "checkout", "-b", "resolution", "fork/sync/upstream");
	const manual = f.commit("shared.txt", "resolved\n");
	f.git(f.author, "push", "fork", "HEAD:sync/upstream");
	f.upstreamCommit("shared.txt", "conflicting update\n");
	for (let attempt = 0; attempt < 2; attempt++) {
		assert.notEqual(f.run().status, 0);
		assert.equal(f.git(f.origin, "rev-parse", "main"), main);
		assert.equal(f.git(f.origin, "rev-parse", "sync/upstream"), manual);
		assert.equal(f.state().pr.isDraft, true);
		assert.match(f.state().body, /Update blocked/);
		assert.equal(f.git(f.worker, "status", "--porcelain"), "");
	}
});

test("does not publish anything when fetching upstream fails", (t) => {
	const f = fixture(t);
	const result = f.run({ UPSTREAM_URL: join(f.root, "missing.git") });
	assert.notEqual(result.status, 0);
	assert.deepEqual(f.state().calls, []);
	assert.equal(f.git(f.origin, "branch", "--list", "sync/upstream"), "");
});

test("opens the next PR after a merge without rewriting the reusable branch", (t) => {
	const f = fixture(t);
	f.forkCommit();
	f.upstreamCommit();
	f.success();
	const firstSync = f.git(f.origin, "rev-parse", "sync/upstream");
	f.git(f.author, "fetch", "fork");
	f.git(f.author, "checkout", "kogan");
	f.git(f.author, "merge", "--no-ff", "--no-edit", "fork/sync/upstream");
	f.git(f.author, "push", "fork", "HEAD:main");
	const github = f.state();
	github.pr = null;
	writeFileSync(f.statePath, JSON.stringify(github));
	f.upstreamCommit("next.txt", "next update\n");
	f.success();
	f.git(f.origin, "merge-base", "--is-ancestor", firstSync, "sync/upstream");
	assert.equal(
		f.state().calls.filter((call) => call[1] === "create").length,
		2,
	);
});

test("opens a new PR when the preceding PR merges during synchronization", (t) => {
	const f = fixture(t);
	f.forkCommit();
	f.upstreamCommit();
	f.success();
	const previousSync = f.git(f.origin, "rev-parse", "sync/upstream");
	const upstream = f.upstreamCommit("next.txt", "next update\n");
	const github = f.state();
	github.mergeOnNextList = f.author;
	writeFileSync(f.statePath, JSON.stringify(github));
	f.success();
	f.git(f.origin, "merge-base", "--is-ancestor", previousSync, "main");
	f.git(f.origin, "merge-base", "--is-ancestor", upstream, "sync/upstream");
	assert.ok(f.state().pr);
	assert.equal(
		f.state().calls.filter((call) => call[1] === "create").length,
		2,
	);
});
