import { agentStatusFromEvent } from "@superset/shared/agent-status";
import type { PaneStatus } from "shared/tabs-types";

/**
 * Derive a terminal agent's UI status from its host binding. `permission` is
 * deliberately not seen-gated — it's a live blocking state that must show
 * until the agent resolves it.
 */
export function deriveTerminalAgentStatus({
	lastEventType,
	lastEventAt,
	lastSeenAt,
	subagents,
}: {
	lastEventType: string;
	lastEventAt: number;
	lastSeenAt: number | undefined;
	subagents?: readonly { needsInput?: true; endedAt?: number }[];
}): PaneStatus {
	if (
		subagents?.some((child) => child.needsInput && child.endedAt === undefined)
	)
		return "permission";
	const status = agentStatusFromEvent(lastEventType);
	if (status === "review") {
		return lastEventAt > (lastSeenAt ?? 0) ? "review" : "idle";
	}
	return status ?? "idle";
}
