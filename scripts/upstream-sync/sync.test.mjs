import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
	copyFileSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

function command(cwd, program, args, env = {}) {
	const result = spawnSync(program, args, {
		cwd,
		encoding: "utf8",
		env: {
			...process.env,
			GIT_CONFIG_GLOBAL: "/dev/null",
			GIT_CONFIG_NOSYSTEM: "1",
			...env,
		},
	});
	assert.equal(
		result.status,
		0,
		`${program} ${args.join(" ")}\n${result.stderr}`,
	);
	return result.stdout.trim();
}

async function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), "superset-upstream-sync-"));
	const upstream = join(root, "upstream.git");
	const origin = join(root, "origin.git");
	const author = join(root, "author");
	const worker = join(root, "worker");
	const publisher = join(root, "publisher");
	const bundle = join(root, "candidate.bundle");
	const outputs = join(root, "outputs");
	const requests = join(root, "request.json");
	const response = join(root, "response.json");
	const git = (cwd, ...args) => command(cwd, "git", args);
	git(root, "init", "--bare", "--initial-branch=main", upstream);
	git(root, "init", "--bare", "--initial-branch=main", origin);
	git(root, "clone", upstream, author);
	git(author, "config", "user.name", "Test");
	git(author, "config", "user.email", "test@example.com");
	const commit = (name, contents) => {
		writeFileSync(join(author, name), contents);
		git(author, "add", "--", name);
		git(author, "commit", "-m", `Update ${name}`);
		return git(author, "rev-parse", "HEAD");
	};
	commit("shared.txt", "base\n");
	git(author, "push", "origin", "main");
	git(author, "remote", "add", "fork", origin);
	git(author, "push", "fork", "main");
	git(root, "clone", origin, worker);
	git(root, "clone", origin, publisher);
	for (const file of ["sync.sh", "resolve-conflicts.mjs", "verify-aimc.mjs"]) {
		copyFileSync(
			fileURLToPath(new URL(file, import.meta.url)),
			join(root, file),
		);
	}
	const setResponse = (files, options = {}) =>
		writeFileSync(
			response,
			JSON.stringify({
				status: options.status || 200,
				body: {
					choices: [
						{
							finish_reason: options.finishReason || "stop",
							message: {
								content: JSON.stringify({
									resolved: options.resolved ?? true,
									reason: "Fixture",
									files,
								}),
							},
						},
					],
				},
			}),
		);
	setResponse([{ path: "shared.txt", content: "combined changes\n" }]);
	const server = spawn(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`
import http from 'node:http';
import fs from 'node:fs';
const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  fs.writeFileSync(process.argv[1], JSON.stringify({path:req.url, body:JSON.parse(body)}));
  const response = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  res.writeHead(response.status, {'Content-Type':'application/json'});
  res.end(JSON.stringify(response.body));
});
server.listen(0, '127.0.0.1', () => console.log(server.address().port));
`,
			requests,
			response,
		],
		{ stdio: ["ignore", "pipe", "inherit"] },
	);
	t.after(async () => {
		const closed = once(server, "exit");
		server.kill();
		await closed;
		rmSync(root, { recursive: true, force: true });
	});
	const [port] = await once(server.stdout, "data");
	const aimcBaseUrl = `http://127.0.0.1:${port.toString().trim()}`;
	const run = (mode, env = {}, cwd = worker) =>
		spawnSync("bash", [join(root, "sync.sh"), mode], {
			cwd,
			encoding: "utf8",
			env: {
				...process.env,
				GIT_CONFIG_GLOBAL: "/dev/null",
				GIT_CONFIG_NOSYSTEM: "1",
				UPSTREAM_URL: upstream,
				SYNC_BUNDLE: bundle,
				GITHUB_OUTPUT: outputs,
				AIMC_API_KEY: "fixture-key",
				AIMC_BASE_URL: aimcBaseUrl,
				AIMC_MODEL: "openai/gpt-5.4",
				...env,
			},
		});
	const prepare = () => {
		const result = run("prepare");
		assert.equal(result.status, 0, result.stdout + result.stderr);
		return Object.fromEntries(
			readFileSync(outputs, "utf8")
				.trim()
				.split("\n")
				.map((line) => line.split("=")),
		);
	};
	const publish = (metadata, env = {}) =>
		run(
			"publish",
			{
				BASE_SHA: metadata.base_sha,
				UPSTREAM_SHA: metadata.upstream_sha,
				CANDIDATE_SHA: metadata.candidate_sha,
				...env,
			},
			publisher,
		);
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
		aimcBaseUrl,
		root,
		upstream,
		origin,
		author,
		worker,
		bundle,
		requests,
		git,
		commit,
		run,
		prepare,
		publish,
		setResponse,
		upstreamCommit,
		forkCommit,
	};
}

test("does nothing when main already contains upstream", async (t) => {
	const f = await fixture(t);
	const main = f.forkCommit();
	assert.equal(f.prepare().changed, "false");
	assert.equal(f.git(f.origin, "rev-parse", "main"), main);
	assert.equal(existsSync(f.bundle), false);
	assert.equal(existsSync(f.requests), false);
});

test("prepares without remote writes and publishes the exact merge with both histories", async (t) => {
	const f = await fixture(t);
	const main = f.forkCommit();
	const upstream = f.upstreamCommit();
	const metadata = f.prepare();
	assert.equal(f.git(f.origin, "rev-parse", "main"), main);
	assert.equal(f.git(f.origin, "branch", "--list", "sync/upstream"), "");
	assert.equal(existsSync(f.requests), false);
	const result = f.publish(metadata);
	assert.equal(result.status, 0, result.stderr);
	assert.equal(f.git(f.origin, "rev-parse", "main"), metadata.candidate_sha);
	f.git(f.origin, "merge-base", "--is-ancestor", main, "main");
	f.git(f.origin, "merge-base", "--is-ancestor", upstream, "main");
	assert.equal(f.git(f.origin, "show", "main:kogan.txt"), "custom");
});

test("retains manual sync-branch commits even when upstream is already in main", async (t) => {
	const f = await fixture(t);
	f.forkCommit();
	f.git(f.author, "checkout", "-b", "resolution");
	const manual = f.commit("resolution.txt", "keep this\n");
	f.git(f.author, "push", "fork", "HEAD:sync/upstream");
	const metadata = f.prepare();
	assert.equal(f.publish(metadata).status, 0);
	f.git(f.origin, "merge-base", "--is-ancestor", manual, "main");
	assert.equal(f.git(f.origin, "show", "main:resolution.txt"), "keep this");
});

test("resolves a real conflict through AIMC and preserves merge parents", async (t) => {
	const f = await fixture(t);
	const main = f.forkCommit("shared.txt", "Kogan behavior\n");
	const upstream = f.upstreamCommit("shared.txt", "upstream behavior\n");
	const metadata = f.prepare();
	const request = JSON.parse(readFileSync(f.requests, "utf8"));
	assert.equal(request.path, "/chat/completions");
	assert.equal(request.body.model, "openai/gpt-5.4");
	assert.equal(request.body.response_format.json_schema.strict, true);
	const [input] = JSON.parse(request.body.messages[1].content);
	assert.equal(input.base, "base\n");
	assert.equal(input.ours, "Kogan behavior\n");
	assert.equal(input.theirs, "upstream behavior\n");
	assert.equal(f.git(f.origin, "rev-parse", "main"), main);
	assert.equal(f.publish(metadata).status, 0);
	f.git(f.origin, "merge-base", "--is-ancestor", main, "main");
	f.git(f.origin, "merge-base", "--is-ancestor", upstream, "main");
	assert.equal(f.git(f.origin, "show", "main:shared.txt"), "combined changes");
});

for (const [name, files, options] of [
	["refusal", [], { resolved: false }],
	["truncation", [], { finishReason: "length" }],
	["unexpected path", [{ path: "../outside.txt", content: "escape" }], {}],
	["missing path", [], {}],
	[
		"unresolved markers",
		[{ path: "shared.txt", content: "<<<<<<< ours\nbroken\n" }],
		{},
	],
	["gateway failure", [], { status: 503 }],
]) {
	test(`does not publish or retain conflict edits after ${name}`, async (t) => {
		const f = await fixture(t);
		const main = f.forkCommit("shared.txt", "Kogan behavior\n");
		f.upstreamCommit("shared.txt", "upstream behavior\n");
		f.setResponse(files, options);
		const result = f.run("prepare");
		assert.notEqual(result.status, 0);
		assert.equal(f.git(f.origin, "rev-parse", "main"), main);
		assert.equal(f.git(f.worker, "status", "--porcelain"), "");
		assert.equal(existsSync(f.bundle), false);
		assert.equal(existsSync(join(f.root, "outside.txt")), false);
	});
}

test("does not overwrite a main commit made while checks were running", async (t) => {
	const f = await fixture(t);
	f.forkCommit();
	f.upstreamCommit();
	const metadata = f.prepare();
	const newerMain = f.forkCommit("later.txt", "human change\n");
	const result = f.publish(metadata);
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /main changed during validation/);
	assert.equal(f.git(f.origin, "rev-parse", "main"), newerMain);
});

test("rejects a bundle that differs from the validated commit", async (t) => {
	const f = await fixture(t);
	const main = f.forkCommit();
	f.upstreamCommit();
	const metadata = f.prepare();
	const result = f.publish(metadata, { CANDIDATE_SHA: main });
	assert.notEqual(result.status, 0);
	assert.equal(f.git(f.origin, "rev-parse", "main"), main);
});

test("does not call AI or publish when fetching upstream fails", async (t) => {
	const f = await fixture(t);
	const result = f.run("prepare", {
		UPSTREAM_URL: join(f.root, "missing.git"),
	});
	assert.notEqual(result.status, 0);
	assert.equal(existsSync(f.bundle), false);
	assert.equal(existsSync(f.requests), false);
});

test("resolves a modify/delete conflict with an explicit deletion", async (t) => {
	const f = await fixture(t);
	f.forkCommit("shared.txt", "Kogan change\n");
	f.git(f.author, "checkout", "main");
	f.git(f.author, "rm", "shared.txt");
	f.git(f.author, "commit", "-m", "Remove obsolete file");
	f.git(f.author, "push", "origin", "main");
	f.setResponse([{ path: "shared.txt", content: null }]);
	const metadata = f.prepare();
	assert.equal(f.publish(metadata).status, 0);
	assert.equal(f.git(f.origin, "ls-tree", "main", "shared.txt"), "");
});

test("rejects binary conflicts without making an AI request", async (t) => {
	const f = await fixture(t);
	const main = f.forkCommit("shared.txt", "Kogan\0binary");
	f.upstreamCommit("shared.txt", "upstream\0binary");
	assert.notEqual(f.run("prepare").status, 0);
	assert.equal(f.git(f.origin, "rev-parse", "main"), main);
	assert.equal(existsSync(f.requests), false);
});

test("verifies AIMC using a synthetic conflict that preserves both changes", async (t) => {
	const f = await fixture(t);
	f.setResponse([
		{ path: "config.json", content: '{"upstream":true,"kogan":true}\n' },
	]);
	const result = spawnSync(
		process.execPath,
		[join(f.root, "verify-aimc.mjs")],
		{
			encoding: "utf8",
			env: {
				...process.env,
				GIT_CONFIG_GLOBAL: "/dev/null",
				GIT_CONFIG_NOSYSTEM: "1",
				AIMC_API_KEY: "fixture-key",
				AIMC_BASE_URL: f.aimcBaseUrl,
				AIMC_MODEL: "openai/gpt-5.4",
			},
		},
	);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /preserving both changes/);
});
