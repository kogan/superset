import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { IDE_SUPERVISOR_SOURCE } from "./supervisor";

test.skipIf(process.platform === "win32")(
	"reaps the IDE and its debug child when the host is killed",
	async () => {
		const directory = await mkdtemp(join(tmpdir(), "ide-supervisor-test-"));
		const pidFile = join(directory, "pids.json");
		const sockets = join(directory, "sockets");
		await mkdir(sockets, { mode: 0o700 });
		const ideSource = `
const child = require('node:child_process').spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)']);
process.on('SIGTERM', () => {});
require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify({ ide: process.pid, debug: child.pid, electronMode: process.env.ELECTRON_RUN_AS_NODE ?? null }));
setInterval(() => {}, 1000);
`;
		const hostSource = `
const supervisor = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(IDE_SUPERVISOR_SOURCE)}], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
supervisor.send({ executable: process.execPath, args: ['-e', ${JSON.stringify(ideSource)}], cwd: ${JSON.stringify(directory)}, socketDirectory: ${JSON.stringify(sockets)} });
setInterval(() => {}, 1000);
`;
		const host = spawn(process.execPath, ["-e", hostSource], {
			stdio: "ignore",
		});
		let pids: {
			ide: number;
			debug: number;
			electronMode: string | null;
		} | null = null;
		try {
			const deadline = Date.now() + 10_000;
			while (Date.now() < deadline) {
				try {
					pids = z
						.object({
							ide: z.number().int().positive(),
							debug: z.number().int().positive(),
							electronMode: z.string().nullable(),
						})
						.parse(JSON.parse(await readFile(pidFile, "utf8")));
					break;
				} catch {
					await delay(50);
				}
			}
			if (!pids) throw new Error("The test IDE did not start.");
			expect(alive(pids.ide)).toBe(true);
			expect(alive(pids.debug)).toBe(true);
			expect(pids.electronMode).toBeNull();
			host.kill("SIGKILL");
			const stopDeadline = Date.now() + 7_000;
			while (
				Date.now() < stopDeadline &&
				(alive(pids.ide) || alive(pids.debug))
			)
				await delay(50);
			expect(alive(pids.ide)).toBe(false);
			expect(alive(pids.debug)).toBe(false);
			await expect(stat(sockets)).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			host.kill("SIGKILL");
			if (pids) {
				try {
					process.kill(-pids.ide, "SIGKILL");
				} catch {}
			}
			await rm(directory, { recursive: true, force: true });
		}
	},
	20_000,
);

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
