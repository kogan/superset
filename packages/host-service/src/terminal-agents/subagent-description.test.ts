import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	readSubagentDescription,
	readTranscriptHead,
} from "./subagent-description";
import { getSubagentHarness } from "./subagent-harnesses";

const directories: string[] = [];
afterEach(() => {
	for (const directory of directories.splice(0))
		fs.rmSync(directory, { recursive: true, force: true });
});
function transcript(records: unknown[]): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-name-"));
	directories.push(directory);
	const file = path.join(directory, "agent-child.jsonl");
	fs.writeFileSync(
		file,
		records.map((record) => JSON.stringify(record)).join("\n"),
	);
	return file;
}

describe("subagent task descriptions", () => {
	it("prefers Claude task metadata and normalizes control characters", () => {
		const file = transcript([
			{ type: "user", message: { content: "Long detailed instructions" } },
		]);
		fs.writeFileSync(
			file.replace(/\.jsonl$/, ".meta.json"),
			JSON.stringify({ description: "  Review\u0000 payments  " }),
		);
		expect(readSubagentDescription(getSubagentHarness("claude"), file)).toBe(
			"Review payments",
		);
	});

	it("uses a readable Codex task path instead of a generic role or random nickname", () => {
		const file = transcript([
			{
				type: "session_meta",
				payload: {
					agent_path: "/root/audit_checkout",
					agent_nickname: "Carver",
				},
			},
		]);
		expect(readSubagentDescription(getSubagentHarness("codex"), file)).toBe(
			"Audit checkout",
		);
	});

	it("falls back to the task prompt, skipping setup messages and limiting length", () => {
		const file = transcript([
			{
				type: "response_item",
				payload: {
					type: "message",
					role: "user",
					content: "# AGENTS.md instructions",
				},
			},
			{
				type: "response_item",
				payload: {
					type: "message",
					role: "user",
					content: "Review checkout errors\nDetails follow",
				},
			},
		]);
		expect(readSubagentDescription(getSubagentHarness("codex"), file)).toBe(
			"Review checkout errors",
		);
		fs.writeFileSync(
			file,
			JSON.stringify({ type: "user", message: { content: "x".repeat(500) } }),
		);
		expect(
			readSubagentDescription(getSubagentHarness("claude"), file),
		).toHaveLength(200);
	});

	it("reads only a bounded transcript header and tolerates a missing or partial file", () => {
		const file = transcript([
			{ type: "session_meta", payload: { agent_path: "/root/check_tests" } },
		]);
		fs.appendFileSync(file, `\n${"x".repeat(100_000)}`);
		expect(readTranscriptHead(file)?.length).toBeLessThan(64 * 1024);
		expect(readSubagentDescription(getSubagentHarness("codex"), file)).toBe(
			"Check tests",
		);
		fs.writeFileSync(file, '{"unfinished"');
		expect(
			readSubagentDescription(getSubagentHarness("codex"), file),
		).toBeUndefined();
		expect(readTranscriptHead(`${file}.missing`)).toBeUndefined();
	});
});
