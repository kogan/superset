import { realpath, stat } from "node:fs/promises";
import { request } from "node:http";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

export interface IdeFileTarget {
	path: string;
	line?: number;
	column?: number;
}

export class IdeFileError extends Error {
	constructor(
		readonly code: "BAD_REQUEST" | "FORBIDDEN" | "NOT_FOUND",
		message: string,
	) {
		super(message);
		this.name = "IdeFileError";
	}
}

export async function resolveIdeFile(
	workspaceRoot: string,
	path: string,
): Promise<string> {
	let root: string;
	let file: string;
	try {
		[root, file] = await Promise.all([
			realpath(workspaceRoot),
			realpath(resolve(workspaceRoot, path)),
		]);
	} catch {
		throw new IdeFileError(
			"NOT_FOUND",
			"The file is not available in this worktree.",
		);
	}
	const withinRoot = relative(root, file);
	if (
		withinRoot === ".." ||
		withinRoot.startsWith(`..${sep}`) ||
		isAbsolute(withinRoot)
	) {
		throw new IdeFileError(
			"FORBIDDEN",
			"The file must be inside this worktree.",
		);
	}
	if (!(await stat(file)).isFile()) {
		throw new IdeFileError(
			"BAD_REQUEST",
			"Open IDE file requires a regular file, not a directory.",
		);
	}
	return file;
}

export function ideFileArguments(
	filePath: string,
	target: IdeFileTarget,
): string[] {
	const goto =
		target.line !== undefined ||
		target.column !== undefined ||
		filePath.toLowerCase().endsWith(".code-workspace");
	const path = goto
		? `${filePath}:${target.line ?? 1}:${target.column ?? 1}`
		: filePath;
	return [
		"--reuse-window",
		...(goto ? ["--goto"] : []),
		"--file-uri",
		pathToFileURL(path).href,
	];
}

const editorSessionSchema = z.object({
	socketPath: z.string().min(1).optional(),
});

export function connectedEditorSocket(
	sessionSocket: string,
	filePath: string,
	signal: AbortSignal,
): Promise<string | undefined> {
	return new Promise((resolveSocket, reject) => {
		const req = request(
			{
				socketPath: sessionSocket,
				path: `/session?filePath=${encodeURIComponent(filePath)}`,
				method: "GET",
				signal,
				timeout: 1000,
			},
			(response) => {
				let body = "";
				response.setEncoding("utf8");
				response.on("data", (chunk: string) => {
					body += chunk;
					if (body.length > 8192)
						req.destroy(new Error("Invalid IDE session response."));
				});
				response.on("error", reject);
				response.on("end", () => {
					try {
						if (response.statusCode !== 200)
							throw new Error("IDE session is not ready.");
						resolveSocket(
							editorSessionSchema.parse(JSON.parse(body)).socketPath,
						);
					} catch (error) {
						reject(error);
					}
				});
			},
		);
		req.once("timeout", () =>
			req.destroy(new Error("IDE session lookup timed out.")),
		);
		req.once("error", reject);
		req.end();
	});
}
