import {
	asString,
	clip,
	isRecord,
	parseTimestamp,
	type SubagentTranscriptEntry,
	summarizeToolInput,
} from "../subagent-transcript";
import { defineSubagentHarness, type ParsedSubagentTranscript } from "./types";

/** Text of a Codex message content list (`input_text` / `output_text`). */
function codexContentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) =>
			isRecord(part) && typeof part.text === "string" ? part.text : "",
		)
		.filter(Boolean)
		.join("\n");
}

function taskPathDescription(agentPath: string): string | undefined {
	const task = agentPath
		.split("/")
		.filter((part) => part.trim())
		.at(-1)
		?.trim();
	if (
		!task ||
		/^(root|default|general[-_ ]purpose|worker|agent|subagent)$/i.test(task) ||
		/^(?:(?:task|worker|agent|subagent)[_-])?[\da-f-]{8,}$/i.test(task)
	) {
		return undefined;
	}
	const name = task
		.replace(/([a-z\d])([A-Z])/g, "$1 $2")
		.replace(/[_\s-]+/g, " ")
		.trim();
	return name ? name.charAt(0).toUpperCase() + name.slice(1) : undefined;
}

export function parseCodexRolloutTranscript(
	text: string,
): ParsedSubagentTranscript {
	const entries: SubagentTranscriptEntry[] = [];
	let description: string | undefined;
	let ownAgentPath: string | undefined;
	let sawSessionMetadata = false;
	let allowPromptFallback = true;
	let line = 0;
	for (const raw of text.split("\n")) {
		line += 1;
		if (!raw.trim()) continue;
		let record: unknown;
		try {
			record = JSON.parse(raw);
		} catch {
			continue;
		}
		if (!isRecord(record)) continue;
		const payload = isRecord(record.payload) ? record.payload : undefined;
		if (!payload) continue;
		const timestamp = parseTimestamp(record.timestamp);
		const id = typeof payload.id === "string" ? payload.id : `line-${line}`;

		if (record.type === "session_meta") {
			if (sawSessionMetadata) continue;
			sawSessionMetadata = true;
			const source = isRecord(payload.source) ? payload.source : undefined;
			const subagent = isRecord(source?.subagent) ? source.subagent : undefined;
			const spawn = isRecord(subagent?.thread_spawn)
				? subagent.thread_spawn
				: undefined;
			ownAgentPath =
				typeof payload.agent_path === "string"
					? payload.agent_path
					: typeof spawn?.agent_path === "string"
						? spawn.agent_path
						: undefined;
			description = taskPathDescription(ownAgentPath ?? "");
			allowPromptFallback = !(
				ownAgentPath ||
				payload.parent_thread_id ||
				payload.forked_from_id ||
				subagent
			);
			continue;
		}
		if (record.type !== "response_item") continue;

		switch (payload.type) {
			case "message": {
				const body = codexContentText(payload.content).trim();
				if (!body) break;
				if (payload.role === "assistant") {
					entries.push({ id, kind: "assistant", text: clip(body), timestamp });
				} else if (payload.role === "user") {
					entries.push({ id, kind: "user", text: clip(body), timestamp });
				}
				break;
			}
			case "agent_message": {
				const body = codexContentText(payload.content).trim();
				if (!body) break;
				if (
					!description &&
					ownAgentPath &&
					payload.recipient === ownAgentPath &&
					/^Message Type: NEW_TASK\s*$/m.test(body)
				) {
					const taskName = /^Task name:[ \t]*([^\r\n]+)$/m.exec(body)?.[1];
					const prompt = /^Payload:[ \t]*\r?\n([\s\S]*)$/m
						.exec(body)?.[1]
						?.trim();
					description =
						taskPathDescription(taskName ?? "") ?? prompt?.split("\n")[0];
				}
				const author = typeof payload.author === "string" ? payload.author : "";
				entries.push({
					id,
					kind: "user",
					text: clip(author ? `${author}: ${body}` : body),
					timestamp,
				});
				break;
			}
			case "reasoning": {
				const summary = Array.isArray(payload.summary)
					? payload.summary
							.map((part) =>
								isRecord(part) && typeof part.text === "string"
									? part.text
									: "",
							)
							.filter(Boolean)
							.join("\n")
					: "";
				if (!summary.trim()) break;
				entries.push({ id, kind: "thinking", text: clip(summary), timestamp });
				break;
			}
			case "function_call":
			case "custom_tool_call":
				entries.push({
					id,
					kind: "tool_call",
					toolName: typeof payload.name === "string" ? payload.name : "tool",
					text: summarizeToolInput(payload.arguments ?? payload.input),
					timestamp,
				});
				break;
			case "function_call_output":
			case "custom_tool_call_output": {
				let body = asString(payload.output);
				try {
					const parsed = JSON.parse(body);
					if (isRecord(parsed) && typeof parsed.output === "string") {
						body = parsed.output;
					}
				} catch {
					// plain text output
				}
				entries.push({
					id,
					kind: "tool_result",
					text: clip(body.trim()),
					timestamp,
				});
				break;
			}
			default:
				break;
		}
	}
	return { entries, description, allowPromptFallback };
}

/**
 * Codex. A spawned child is its own thread with its own rollout file and
 * its hooks run against that file, so the hook's path is the child's. The
 * rollout's `session_meta` carries the nickname and agent path.
 */
export const codexSubagentHarness = defineSubagentHarness({
	parseTranscript: parseCodexRolloutTranscript,
});
