import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { terminalHostSocketPath } from "./terminal-host-socket";

test("a deeply nested data directory still binds an isolated Unix socket", async () => {
	const dataDir = `/tmp/${randomUUID()}/${"deep-directory/".repeat(20)}`;
	const socket = terminalHostSocketPath(dataDir);
	expect(socket).not.toBe(terminalHostSocketPath(`${dataDir}/another`));
	expect(socket).toBe(terminalHostSocketPath(`${dataDir}/.`));
	const server = createServer();
	try {
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(socket, resolve);
		});
		expect(server.listening).toBe(true);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});
