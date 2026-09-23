import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { ensureCodeServer } from "../src/runtime/ide/code-server-runtime";
import {
	type IdeConnection,
	WorkspaceIdeManager,
} from "../src/runtime/ide/ide";
import { initTerminalBaseEnv } from "../src/terminal/env";

const exec = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "superset-ide-smoke-"));
const dataDirectory = join(root, "ide");
const folders = new Map([
	["first", join(root, "repo")],
	["second", join(root, "worktree")],
]);
const executable = process.argv[2]
	? resolve(process.argv[2])
	: await ensureCodeServer(join(dataDirectory, "runtime"));
initTerminalBaseEnv();
const manager = new WorkspaceIdeManager({
	dataDirectory,
	runtimeExecutable: executable,
	resolveWorkspace: (workspaceId) => {
		const folder = folders.get(workspaceId);
		if (!folder) throw new Error("Unknown smoke workspace.");
		return folder;
	},
});

async function login(connection: IdeConnection): Promise<string> {
	const origin = `http://127.0.0.1:${connection.port}`;
	const anonymous = await fetch(origin, { redirect: "manual" });
	assert.equal(anonymous.status, 302);
	assert.match(anonymous.headers.get("location") ?? "", /login/);
	await anonymous.body?.cancel();
	const denied = await fetch(`${origin}/login`, {
		method: "POST",
		body: new URLSearchParams({ password: "incorrect" }),
		redirect: "manual",
	});
	assert.equal(denied.headers.get("set-cookie"), null);
	await denied.body?.cancel();
	const response = await fetch(`${origin}/login`, {
		method: "POST",
		body: new URLSearchParams({ password: connection.password }),
		redirect: "manual",
	});
	assert.equal(response.status, 302);
	const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
	assert.ok(cookie);
	await response.body?.cancel();
	const workbench = await fetch(
		`${origin}/?folder=${encodeURIComponent(connection.folderPath)}`,
		{
			headers: { Cookie: cookie },
		},
	);
	assert.equal(workbench.status, 200);
	assert.match(await workbench.text(), /workbench/i);
	return cookie;
}

function workspaceData(workspaceId: string): string {
	return join(
		dataDirectory,
		"workspaces",
		createHash("sha256").update(workspaceId).digest("hex"),
	);
}

try {
	await mkdir(folders.get("first") ?? "", { recursive: true });
	await exec("git", ["init", "-b", "main", join(root, "repo")]);
	await exec("git", [
		"-C",
		join(root, "repo"),
		"-c",
		"user.name=IDE smoke",
		"-c",
		"user.email=ide-smoke@example.invalid",
		"commit",
		"--allow-empty",
		"-m",
		"smoke",
	]);
	await exec("git", [
		"-C",
		join(root, "repo"),
		"worktree",
		"add",
		"-b",
		"ide-smoke",
		join(root, "worktree"),
	]);
	const [first, duplicate, second] = await Promise.all([
		manager.start("first"),
		manager.start("first"),
		manager.start("second"),
	]);
	assert.deepEqual(first, duplicate);
	assert.notEqual(first.port, second.port);
	assert.notEqual(first.password, second.password);
	assert.equal(first.folderPath, join(root, "repo"));
	assert.equal(second.folderPath, join(root, "worktree"));
	const [firstCookie] = await Promise.all([login(first), login(second)]);
	const crossWorkspace = await fetch(`http://127.0.0.1:${second.port}/`, {
		headers: { Cookie: firstCookie },
		redirect: "manual",
	});
	assert.equal(crossWorkspace.status, 302);
	await crossWorkspace.body?.cancel();
	assert.equal(manager.getForwardPorts("first")[0]?.port, first.port);
	assert.deepEqual(manager.getForwardPorts("unknown"), []);

	const vsixDirectory = join(root, "extension-package");
	await mkdir(join(vsixDirectory, "extension"), { recursive: true });
	await writeFile(
		join(vsixDirectory, "extension", "package.json"),
		JSON.stringify({
			name: "ide-smoke",
			publisher: "superset",
			version: "1.0.0",
			displayName: "Superset IDE verification",
			engines: { vscode: "^1.90.0" },
			main: "./extension.js",
			activationEvents: ["*"],
			extensionKind: ["workspace"],
		}),
	);
	await writeFile(
		join(vsixDirectory, "extension", "extension.js"),
		"exports.activate = () => {};\n",
	);
	await writeFile(
		join(vsixDirectory, "extension.vsixmanifest"),
		'<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="en-US" Id="ide-smoke" Version="1.0.0" Publisher="superset"/><DisplayName>IDE smoke</DisplayName><Description xml:space="preserve">Verification</Description></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets></PackageManifest>',
	);
	await writeFile(
		join(vsixDirectory, "[Content_Types].xml"),
		'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="js" ContentType="application/javascript"/><Default Extension="vsixmanifest" ContentType="text/xml"/></Types>',
	);
	const vsix = join(root, "smoke.vsix");
	await exec("zip", ["-q", "-r", vsix, "."], { cwd: vsixDirectory });
	const cliArgs = (workspaceId: string) => [
		"--user-data-dir",
		join(workspaceData(workspaceId), "user-data"),
		"--extensions-dir",
		join(workspaceData(workspaceId), "extensions"),
		"--config",
		join(workspaceData(workspaceId), "config.yaml"),
	];
	await exec(executable, [...cliArgs("first"), "--install-extension", vsix], {
		timeout: 60_000,
	});
	const installed = await exec(executable, [
		...cliArgs("first"),
		"--list-extensions",
	]);
	const isolated = await exec(executable, [
		...cliArgs("second"),
		"--list-extensions",
	]);
	assert.match(installed.stdout, /superset\.ide-smoke/);
	assert.doesNotMatch(isolated.stdout, /superset\.ide-smoke/);

	const settings = join(
		workspaceData("first"),
		"user-data",
		"User",
		"settings.json",
	);
	assert.equal(
		JSON.parse(await readFile(settings, "utf8"))["workbench.colorTheme"],
		"Dark Modern",
	);
	assert.equal(
		JSON.parse(await readFile(settings, "utf8"))["files.hotExit"],
		"off",
	);
	assert.deepEqual(await manager.getTheme("first"), { theme: "dark" });
	assert.deepEqual(await manager.setTheme("first", "light"), {
		theme: "light",
	});
	assert.deepEqual(await manager.getTheme("first"), { theme: "light" });
	assert.equal((await manager.start("first")).sessionId, first.sessionId);
	assert.equal(
		JSON.parse(await readFile(settings, "utf8"))["workbench.colorTheme"],
		"Light Modern",
	);
	await mkdir(join(workspaceData("first"), "user-data", "User"), {
		recursive: true,
	});
	await writeFile(
		settings,
		'{"editor.fontSize":17,"workbench.colorTheme":"Light Modern","files.hotExit":"onExit"}\n',
	);
	await manager.stop("first");
	assert.deepEqual(manager.getForwardPorts("first"), []);
	await assert.rejects(fetch(`http://127.0.0.1:${first.port}/healthz`));
	const reopened = await manager.start("first");
	assert.notEqual(reopened.sessionId, first.sessionId);
	assert.notEqual(reopened.password, first.password);
	assert.equal(
		JSON.parse(await readFile(settings, "utf8"))["editor.fontSize"],
		17,
	);
	assert.equal(
		JSON.parse(await readFile(settings, "utf8"))["workbench.colorTheme"],
		"Light Modern",
	);
	assert.equal(
		JSON.parse(await readFile(settings, "utf8"))["files.hotExit"],
		"off",
	);
	await login(reopened);
	console.log(
		"PASS: authenticated IDE, two actual worktrees, independent cookies/extensions, VSIX install, restart/state restore, and stopped-port cleanup.",
	);
	console.log(
		process.versions.electron
			? `Host runtime: Electron ${process.versions.electron} in Node mode.`
			: `Host runtime: Node ${process.versions.node}.`,
	);
} finally {
	await manager.close();
	await rm(root, { recursive: true, force: true });
}
