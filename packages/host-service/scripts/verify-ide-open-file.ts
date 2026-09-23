import assert from "node:assert/strict";
import {
	mkdir,
	mkdtemp,
	readdir,
	realpath,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { createServer, request } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { WorkspaceIdeManager } from "../src/runtime/ide/ide";
import { initTerminalBaseEnv } from "../src/terminal/env";

const executable = process.argv[2];
if (!executable)
	throw new Error(
		"Usage: bun scripts/verify-ide-open-file.ts /path/to/code-server/bin/code-server",
	);
const root = await mkdtemp("/tmp/ide-open-");
const workspace = join(root, "worktree");
await mkdir(workspace);
const file = join(workspace, "report #draft?:12");
await writeFile(file, "first\nsecond\nthird\nfourth\n");
initTerminalBaseEnv();
const manager = new WorkspaceIdeManager({
	dataDirectory: join(root, "data-".repeat(30)),
	runtimeExecutable: resolve(executable),
	socketRootDirectory: root,
	resolveWorkspace: () => workspace,
});
const openedSchema = z.object({
	type: z.literal("open"),
	fileURIs: z.array(z.string()),
	folderURIs: z.array(z.string()),
	forceReuseWindow: z.boolean(),
	gotoLineMode: z.boolean().optional(),
});
const received: z.infer<typeof openedSchema>[] = [];
const editorSocket = join(root, "editor.sock");
const editor = createServer((req, res) => {
	let body = "";
	req.setEncoding("utf8");
	req.on("data", (chunk) => {
		body += chunk;
	});
	req.on("end", () => {
		received.push(openedSchema.parse(JSON.parse(body)));
		res.writeHead(200, { "content-type": "application/json" });
		res.end("null");
	});
});
await new Promise<void>((resolveListen) =>
	editor.listen(editorSocket, resolveListen),
);
try {
	await manager.start("first");
	const socketDirectory = (await readdir(root)).find((name) =>
		name.startsWith("superset-ide-"),
	);
	assert.ok(socketDirectory);
	assert.equal((await stat(join(root, socketDirectory))).mode & 0o777, 0o700);
	const sessionSocket = join(root, socketDirectory, "session.sock");
	assert.ok(Buffer.byteLength(sessionSocket) < 104);
	await new Promise<void>((resolveRegistration, reject) => {
		const req = request(
			{
				socketPath: sessionSocket,
				path: "/add-session",
				method: "POST",
				headers: { "content-type": "application/json" },
			},
			(res) => {
				res.resume();
				res.on("end", () =>
					res.statusCode === 200
						? resolveRegistration()
						: reject(new Error("Session registration failed.")),
				);
			},
		);
		req.on("error", reject);
		req.end(
			JSON.stringify({
				entry: {
					socketPath: editorSocket,
					workspace: { folders: [{ uri: { path: workspace } }] },
				},
			}),
		);
	});
	assert.deepEqual(
		await manager.openFile("first", {
			path: "report #draft?:12",
			line: 4,
			column: 6,
		}),
		{ opened: true },
	);
	assert.equal(received.length, 1);
	const located = received[0];
	assert.ok(located);
	assert.equal(located.forceReuseWindow, true);
	assert.equal(located.gotoLineMode, true);
	assert.deepEqual(located.folderURIs, []);
	assert.equal(
		fileURLToPath(located.fileURIs[0] ?? ""),
		`${await realpath(file)}:4:6`,
	);
	await manager.openFile("first", { path: file });
	assert.equal(received[1]?.gotoLineMode, false);
	assert.equal(
		fileURLToPath(received[1]?.fileURIs[0] ?? ""),
		await realpath(file),
	);
	await manager.stop("first");
	await assert.rejects(stat(sessionSocket));
	console.log(
		"PASS: actual code-server session registry and bundled CLI open file/line/column in an existing editor; encoded filenames, short private sockets, long app-data path and cleanup verified.",
	);
} finally {
	await manager.close();
	await new Promise<void>((resolveClose, reject) =>
		editor.close((error) => (error ? reject(error) : resolveClose())),
	);
	await rm(root, { recursive: true, force: true });
}
