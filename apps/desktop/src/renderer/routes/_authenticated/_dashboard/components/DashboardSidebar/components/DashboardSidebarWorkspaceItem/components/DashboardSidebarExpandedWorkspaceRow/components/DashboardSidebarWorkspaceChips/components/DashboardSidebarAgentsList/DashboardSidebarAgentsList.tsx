import { useLingui } from "@lingui/react/macro";
import { AGENT_IDENTITY_LABELS } from "@superset/shared/agent-catalog";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { useSidebarAgentExpansionStore } from "renderer/stores/sidebar-agent-expansion";
import type { DashboardSidebarRunningAgent } from "../../hooks/useDashboardSidebarWorkspaceRunningAgents";
import { DashboardSidebarAgentAvatar } from "./components/DashboardSidebarAgentAvatar";
import { DashboardSidebarAgentRow } from "./components/DashboardSidebarAgentRow";

interface DashboardSidebarAgentsListProps {
	workspaceId: string;
	agents: DashboardSidebarRunningAgent[];
}

export function DashboardSidebarAgentsList({
	workspaceId,
	agents,
}: DashboardSidebarAgentsListProps) {
	const { t } = useLingui();
	const collapsedGroups = useSidebarAgentExpansionStore(
		(state) => state.collapsed,
	);
	const toggleGroup = useSidebarAgentExpansionStore((state) => state.toggle);
	const modelGroups = useMemo(() => {
		const groups = new Map<
			string,
			{
				modelId: string;
				label: string;
				agents: [
					DashboardSidebarRunningAgent,
					...DashboardSidebarRunningAgent[],
				];
			}
		>();
		for (const agent of agents) {
			const existing = groups.get(agent.agentId);
			if (existing) {
				existing.agents.push(agent);
				continue;
			}
			groups.set(agent.agentId, {
				modelId: agent.agentId,
				label: AGENT_IDENTITY_LABELS[agent.agentId] ?? agent.agentId,
				agents: [agent],
			});
		}
		return [...groups.values()];
	}, [agents]);

	return (
		<ul
			aria-label={t({ message: "Agents" })}
			className="min-w-0 border-l border-border/60 pl-2"
		>
			{modelGroups.map((group) => {
				if (group.agents.length === 1) {
					return (
						<li key={group.modelId}>
							<DashboardSidebarAgentRow
								workspaceId={workspaceId}
								agent={group.agents[0]}
							/>
						</li>
					);
				}

				const collapsed = collapsedGroups.has(
					JSON.stringify([workspaceId, "model", group.modelId]),
				);
				return (
					<li key={group.modelId} className="min-w-0">
						<button
							type="button"
							onClick={(event) => {
								event.stopPropagation();
								toggleGroup([workspaceId, "model", group.modelId]);
							}}
							onKeyDown={(event) => event.stopPropagation()}
							aria-expanded={!collapsed}
							className="flex h-6 w-full min-w-0 items-center gap-1 rounded-sm px-1.5 text-left text-xs text-muted-foreground hover:bg-fill-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
						>
							{collapsed ? (
								<ChevronRight className="size-3 shrink-0" aria-hidden />
							) : (
								<ChevronDown className="size-3 shrink-0" aria-hidden />
							)}
							<DashboardSidebarAgentAvatar agent={group.agents[0]} />
							<span className="min-w-0 flex-1 truncate">{group.label}</span>
							<span className="shrink-0 text-[10px] text-muted-foreground">
								{group.agents.length}
							</span>
						</button>
						{!collapsed && (
							<ul className="ml-[7px] border-l border-border/50 pl-1">
								{group.agents.map((agent) => (
									<li key={agent.sourceKey}>
										<DashboardSidebarAgentRow
											workspaceId={workspaceId}
											agent={agent}
										/>
									</li>
								))}
							</ul>
						)}
					</li>
				);
			})}
		</ul>
	);
}
