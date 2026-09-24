import { AGENT_IDENTITY_LABELS } from "@superset/shared/agent-catalog";
import type { TerminalAgentBinding } from "renderer/hooks/host-service/useTerminalAgentBindings";

export interface AttentionItem {
	kind: "agent";
	id: string;
	title: string;
	workspaceName: string;
	workspaceId: string;
	terminalId: string;
	updatedAt: number;
}

export function agentAttentionItems({
	workspaceId,
	workspaceName,
	bindings,
}: {
	workspaceId: string;
	workspaceName: string;
	bindings: readonly TerminalAgentBinding[];
}): AttentionItem[] {
	const sorted = [...bindings].sort(
		(a, b) =>
			a.startedAt - b.startedAt || a.terminalId.localeCompare(b.terminalId),
	);
	const labels = sorted.map(
		(binding) =>
			binding.title ||
			AGENT_IDENTITY_LABELS[binding.agentId] ||
			binding.agentId,
	);
	const occurrences = new Map<string, number>();
	return sorted.flatMap((binding, index): AttentionItem[] => {
		const label = labels[index] ?? binding.agentId;
		const occurrence = (occurrences.get(label) ?? 0) + 1;
		occurrences.set(label, occurrence);
		const waitingChildren =
			binding.subagents?.filter(
				(child) => child.needsInput && child.endedAt === undefined,
			) ?? [];
		if (
			binding.lastEventType !== "PermissionRequest" &&
			waitingChildren.length === 0
		)
			return [];
		return [
			{
				kind: "agent",
				id: `agent:${workspaceId}:${binding.terminalId}`,
				title:
					labels.filter((name) => name === label).length > 1
						? `${label} ${occurrence}`
						: label,
				workspaceName,
				workspaceId,
				terminalId: binding.terminalId,
				updatedAt: Math.max(
					binding.lastEventAt,
					...waitingChildren.map((child) => child.lastEventAt),
				),
			},
		];
	});
}
