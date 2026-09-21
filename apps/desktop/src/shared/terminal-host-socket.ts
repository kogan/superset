import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** Unix sockets have a short path limit even when the data directory is deep. */
export function terminalHostSocketPath(dataDir: string): string {
	const id = createHash("sha256").update(resolve(dataDir)).digest("hex").slice(0, 12);
	return join(tmpdir(), `superestset-th-${id}.sock`);
}
