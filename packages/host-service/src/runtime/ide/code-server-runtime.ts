import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import { access, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { patchCodeServerUserSettings } from "./code-server-compatibility";

export const CODE_SERVER_VERSION = "4.138.0";

const RELEASES: Record<string, { platform: string; sha256: string }> = {
	"darwin-arm64": {
		platform: "macos-arm64",
		sha256: "1ecf699868e64bb9094a7d3ffcac50bb903354a32137dfc4017cb9479ef6b456",
	},
	"darwin-x64": {
		platform: "macos-amd64",
		sha256: "bd1a54d03e03d3b0ec75705f48c39c5f6b309a36a2c7ee878f746a6e5f9aa2ae",
	},
	"linux-arm64": {
		platform: "linux-arm64",
		sha256: "fbebf4b18e97a5a48b7b105be0161d411e54ccfb53a1ffb1673c16518024fa30",
	},
	"linux-x64": {
		platform: "linux-amd64",
		sha256: "5d63f26c5dabc2acd29610b9b27f413b016aa67019e2cfcdf54031625e18f535",
	},
};

const execFileAsync = promisify(execFile);
const pendingInstalls = new Map<string, Promise<string>>();

export class IdeUnavailableError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "IdeUnavailableError";
	}
}

export async function ensureCodeServer(
	runtimeDirectory: string,
): Promise<string> {
	const existing = pendingInstalls.get(runtimeDirectory);
	if (existing) return existing;
	const install = installCodeServer(runtimeDirectory).catch(
		(error: unknown) => {
			if (error instanceof IdeUnavailableError) throw error;
			throw new IdeUnavailableError(
				`Could not prepare the IDE runtime: ${error instanceof Error ? error.message : String(error)}`,
				{ cause: error },
			);
		},
	);
	pendingInstalls.set(runtimeDirectory, install);
	try {
		return await install;
	} finally {
		if (pendingInstalls.get(runtimeDirectory) === install) {
			pendingInstalls.delete(runtimeDirectory);
		}
	}
}

async function installCodeServer(runtimeDirectory: string): Promise<string> {
	const release = RELEASES[`${process.platform}-${process.arch}`];
	if (!release) {
		throw new IdeUnavailableError(
			"The embedded IDE currently supports macOS and Linux on Apple Silicon, ARM64, and x64.",
		);
	}
	const name = `code-server-${CODE_SERVER_VERSION}-${release.platform}`;
	const destination = join(runtimeDirectory, name);
	const executable = join(destination, "bin", "code-server");
	if (await isExecutable(executable)) {
		await patchCodeServerUserSettings(destination);
		return executable;
	}

	await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
	const staging = await mkdtemp(join(runtimeDirectory, ".install-"));
	try {
		const archive = join(staging, "release.tar.gz");
		const response = await fetch(
			`https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/${name}.tar.gz`,
			{ signal: AbortSignal.timeout(10 * 60_000) },
		);
		if (!response.ok || !response.body) {
			throw new Error(`Runtime download failed (HTTP ${response.status}).`);
		}
		const digest = createHash("sha256");
		const hashStream = new Transform({
			transform(chunk: Buffer, _encoding, callback) {
				digest.update(chunk);
				callback(null, chunk);
			},
		});
		await pipeline(
			Readable.from(response.body),
			hashStream,
			createWriteStream(archive, { flags: "wx", mode: 0o600 }),
		);
		if (digest.digest("hex") !== release.sha256) {
			throw new Error("Runtime download did not match its published checksum.");
		}
		const { stdout } = await execFileAsync("tar", ["-tzf", archive], {
			maxBuffer: 16 * 1024 * 1024,
			timeout: 60_000,
		});
		for (const entry of stdout.split("\n").filter(Boolean)) {
			const parts = entry.replaceAll("\\", "/").split("/");
			if (parts[0] !== name || parts.includes("..")) {
				throw new Error("Runtime archive contains an invalid path.");
			}
		}
		await execFileAsync("tar", ["-xzf", archive, "-C", staging], {
			timeout: 120_000,
		});
		if (!(await isExecutable(join(staging, name, "bin", "code-server")))) {
			throw new Error("Runtime archive does not contain code-server.");
		}
		await patchCodeServerUserSettings(join(staging, name));
		try {
			await rename(join(staging, name), destination);
		} catch (error) {
			if (!(await isExecutable(executable))) throw error;
			await patchCodeServerUserSettings(destination);
		}
		return executable;
	} catch (error) {
		throw new IdeUnavailableError(
			`Could not install the IDE runtime: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		);
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}

async function isExecutable(path: string): Promise<boolean> {
	try {
		await access(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}
