import { dirname, isAbsolute } from "node:path";
import { z } from "zod";
import type { TerminalAgentBinding, TerminalSubagent } from "../types";
import {
	type CodexProxy,
	type SpawnCodexProxy,
	withCodexProxy,
} from "./codex-proxy";

const threadSchema = z.object({
	id: z.string().min(1),
	parentThreadId: z.string().min(1).nullable(),
	status: z.object({
		type: z.enum(["notLoaded", "idle", "systemError", "active"]),
	}),
	turns: z.array(z.object({ id: z.string(), status: z.string() })),
});
const threadResponseSchema = z.object({ thread: threadSchema });

export type SubagentStopTarget = {
	parentThreadId: string;
	childThreadId: string;
	codexHome: string;
};

export function getSubagentStopTarget(
	binding: TerminalAgentBinding,
	subagent: TerminalSubagent,
): SubagentStopTarget | undefined {
	const parentThreadId = binding.agentSessionId?.trim();
	const childThreadId = subagent.sessionId?.trim() || subagent.id.trim();
	if (
		binding.agentId !== "codex" ||
		binding.endedAt !== undefined ||
		subagent.endedAt !== undefined ||
		!parentThreadId ||
		!childThreadId ||
		childThreadId === parentThreadId
	)
		return;

	const transcriptPath = subagent.transcriptPath;
	const transcriptHome =
		transcriptPath &&
		/[/\\]sessions[/\\]\d{4}[/\\]\d{2}[/\\]\d{2}[/\\][^/\\]+\.jsonl$/.test(
			transcriptPath,
		)
			? dirname(dirname(dirname(dirname(dirname(transcriptPath)))))
			: undefined;
	const accountHome =
		binding.account?.agent === "codex"
			? (binding.account.directory ?? binding.account.selection)
			: undefined;
	const codexHome = accountHome || transcriptHome;
	if (!codexHome || !isAbsolute(codexHome)) return;
	return { parentThreadId, childThreadId, codexHome };
}

async function readThread(
	proxy: CodexProxy,
	threadId: string,
	includeTurns: boolean,
) {
	const response = threadResponseSchema.parse(
		await proxy.request("thread/read", { threadId, includeTurns }),
	);
	if (response.thread.id !== threadId)
		throw new Error("Codex returned a different thread");
	return response.thread;
}

async function verifiedActiveTurn(
	proxy: CodexProxy,
	target: SubagentStopTarget,
): Promise<string> {
	if (target.childThreadId === target.parentThreadId) {
		throw new Error(
			"The parent agent cannot be stopped through a subagent control",
		);
	}
	const child = await readThread(proxy, target.childThreadId, true);
	const visited = new Set([child.id]);
	let ancestorId = child.parentThreadId;
	while (ancestorId !== target.parentThreadId) {
		if (!ancestorId || visited.has(ancestorId) || visited.size >= 16) {
			throw new Error("The subagent does not belong to this parent session");
		}
		visited.add(ancestorId);
		ancestorId = (await readThread(proxy, ancestorId, false)).parentThreadId;
	}
	const activeTurns = child.turns.filter(
		(turn) => turn.status === "inProgress",
	);
	const turn = activeTurns[0];
	if (
		child.status.type !== "active" ||
		activeTurns.length !== 1 ||
		!turn?.id.trim()
	) {
		throw new Error("The subagent has no active turn to stop");
	}
	return turn.id;
}

export async function controlSubagent(
	target: SubagentStopTarget,
	options: {
		mode: "probe" | "stop";
		env: NodeJS.ProcessEnv;
		isStillCurrent: () => boolean;
		spawnProxy?: SpawnCodexProxy;
		timeoutMs?: number;
	},
): Promise<void> {
	await withCodexProxy(
		{
			env: { ...options.env, CODEX_HOME: target.codexHome },
			spawnProxy: options.spawnProxy,
			timeoutMs: options.timeoutMs,
		},
		async (proxy) => {
			const turnId = await verifiedActiveTurn(proxy, target);
			if (!options.isStillCurrent())
				throw new Error("The subagent session has changed");
			if (options.mode === "stop") {
				await proxy.request("turn/interrupt", {
					threadId: target.childThreadId,
					turnId,
				});
			}
		},
	);
}
