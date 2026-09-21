import fs from "node:fs";
import { normalizeTerminalTitle } from "@superset/shared/terminal-title-scanner";
import type { SubagentHarness } from "./subagent-harnesses/types";

export function readTranscriptHead(filePath: string): string | undefined {
	let fd: number | undefined;
	try {
		const stat = fs.statSync(filePath);
		if (!stat.isFile()) return undefined;
		fd = fs.openSync(filePath, "r");
		const buffer = Buffer.alloc(Math.min(stat.size, 64 * 1024));
		const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
		const text = buffer.toString("utf8", 0, read);
		return stat.size > read ? text.slice(0, text.lastIndexOf("\n") + 1) : text;
	} catch {
		return undefined;
	} finally {
		if (fd !== undefined) fs.closeSync(fd);
	}
}

export function readSubagentDescription(
	harness: SubagentHarness,
	transcriptPath: string,
): string | undefined {
	const description = harness.readDescription(transcriptPath);
	if (description?.trim())
		return normalizeTerminalTitle(description) ?? undefined;
	const text = readTranscriptHead(transcriptPath);
	if (!text) return undefined;
	const parsed = harness.parseTranscript(text);
	if (parsed.description?.trim())
		return normalizeTerminalTitle(parsed.description) ?? undefined;
	const prompt = parsed.entries
		.find((entry) => entry.kind === "user" && !/^[<#]/.test(entry.text.trim()))
		?.text.trim();
	if (!prompt) return undefined;
	return normalizeTerminalTitle(prompt.split("\n")[0] ?? "") ?? undefined;
}
