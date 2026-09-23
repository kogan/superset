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

	it("keeps the child's task name when its transcript includes parent metadata", () => {
		const file = transcript([
			{
				type: "session_meta",
				payload: {
					agent_path: "/root/review_checkout",
					parent_thread_id: "parent",
				},
			},
			{ type: "session_meta", payload: { id: "parent" } },
			{
				type: "response_item",
				payload: {
					type: "message",
					role: "user",
					content: "An unrelated task inherited from the parent",
				},
			},
		]);
		expect(readSubagentDescription(getSubagentHarness("codex"), file)).toBe(
			"Review checkout",
		);
	});

	it("does not name an untitled child after an inherited parent prompt or nickname", () => {
		const file = transcript([
			{
				type: "session_meta",
				payload: {
					agent_path: "/root/default",
					agent_nickname: "Carver",
					parent_thread_id: "parent",
				},
			},
			{
				type: "session_meta",
				payload: { agent_path: "/root/parent_task" },
			},
			{
				type: "response_item",
				payload: {
					type: "message",
					role: "user",
					content: "An unrelated task inherited from the parent",
				},
			},
		]);
		expect(
			readSubagentDescription(getSubagentHarness("codex"), file),
		).toBeUndefined();
	});

	it("uses a delegated task prompt when the child's path is a generated identifier", () => {
		const agentPath = "/root/01a0bef7-7643-7363-8d0a-2ecfe716b372";
		const file = transcript([
			{
				type: "session_meta",
				payload: { agent_path: agentPath, parent_thread_id: "parent" },
			},
			{
				type: "response_item",
				payload: {
					type: "message",
					role: "user",
					content: "An unrelated task inherited from the parent",
				},
			},
			{
				type: "response_item",
				payload: {
					type: "agent_message",
					author: "/root",
					recipient: agentPath,
					content: `Message Type: NEW_TASK\nTask name: ${agentPath}\nSender: /root\nPayload:\nReview checkout errors\nOnly inspect the checkout module.`,
				},
			},
		]);
		expect(readSubagentDescription(getSubagentHarness("codex"), file)).toBe(
			"Review checkout errors",
		);
	});

	it("ignores inherited task messages addressed to other agents", () => {
		const file = transcript([
			{
				type: "session_meta",
				payload: { agent_path: "/root/task_e716b372" },
			},
			{
				type: "response_item",
				payload: {
					type: "agent_message",
					author: "/root",
					recipient: "/root/other_task",
					content:
						"Message Type: NEW_TASK\nTask name: /root/other_task\nSender: /root\nPayload:\nUnrelated task",
				},
			},
		]);
		expect(
			readSubagentDescription(getSubagentHarness("codex"), file),
		).toBeUndefined();
	});

	it("humanizes nested Codex task metadata without losing acronyms", () => {
		const file = transcript([
			{
				type: "session_meta",
				payload: {
					source: {
						subagent: {
							thread_spawn: { agent_path: "/root/reviewCheckout_API-tests/" },
						},
					},
				},
			},
		]);
		expect(readSubagentDescription(getSubagentHarness("codex"), file)).toBe(
			"Review Checkout API tests",
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
