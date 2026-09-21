import { Trans, useLingui } from "@lingui/react/macro";
import { toast } from "@superset/ui/sonner";
import { cn } from "@superset/ui/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	ChevronDown,
	ChevronRight,
	LoaderCircle,
	Pencil,
	Square,
} from "lucide-react";
import { useState } from "react";
import { getTerminalAgentBindingsQueryKey } from "renderer/hooks/host-service/useTerminalAgentBindings";
import { useWorkspaceHostUrl } from "renderer/hooks/host-service/useWorkspaceHostUrl";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { getSubagentLabel } from "renderer/routes/_authenticated/_dashboard/utils/subagent-label";
import {
	buildSubagentSearch,
	navigateToV2Workspace,
} from "renderer/routes/_authenticated/_dashboard/utils/workspace-navigation";
import { getStatusTooltip } from "renderer/screens/main/components/StatusIndicator";
import { useSidebarAgentExpansion } from "renderer/stores/sidebar-agent-expansion";
import type {
	DashboardSidebarRunningAgent,
	DashboardSidebarRunningSubagent,
	RunningAgentStatus,
} from "../../../../hooks/useDashboardSidebarWorkspaceRunningAgents";
import { DashboardSidebarAgentAvatar } from "../DashboardSidebarAgentAvatar";

import { RenameSubagentDialog } from "./components/RenameSubagentDialog";

const STATUS_TEXT_CLASS: Record<RunningAgentStatus, string> = {
	idle: "text-muted-foreground",
	working: "text-amber-500",
	permission: "text-yellow-500",
	failed: "text-red-500",
	review: "text-green-500",
};

interface DashboardSidebarAgentRowProps {
	workspaceId: string;
	agent: DashboardSidebarRunningAgent;
}

export function DashboardSidebarAgentRow({
	workspaceId,
	agent,
}: DashboardSidebarAgentRowProps) {
	const { t } = useLingui();
	const navigate = useNavigate();
	const hostUrl = useWorkspaceHostUrl(workspaceId);
	const queryClient = useQueryClient();
	const { expanded: subagentsExpanded, toggle: toggleSubagents } =
		useSidebarAgentExpansion([workspaceId, "subagents", agent.sourceKey]);
	const [isStopping, setIsStopping] = useState(false);
	const [renamingSubagent, setRenamingSubagent] =
		useState<DashboardSidebarRunningSubagent | null>(null);
	const hasSubagents = agent.subagents.length > 0;

	const handleOpen = () => {
		void navigateToV2Workspace(workspaceId, navigate, {
			search: {
				terminalId: agent.terminalId,
				focusRequestId: crypto.randomUUID(),
			},
		});
	};

	const handleOpenSubagent = (subagent: DashboardSidebarRunningSubagent) => {
		void navigateToV2Workspace(workspaceId, navigate, {
			search: {
				...buildSubagentSearch({
					terminalId: agent.terminalId,
					subagentId: subagent.id,
					agentId: agent.agentId,
					...(subagent.agentType ? { agentType: subagent.agentType } : {}),
				}),
				focusRequestId: crypto.randomUUID(),
			},
		});
	};

	const statusLabel =
		agent.status === "idle"
			? t({ message: "Idle" })
			: getStatusTooltip(agent.status);
	const stopLabel = hasSubagents
		? t({ message: "Stop agent and subagents" })
		: t({ message: "Stop agent" });

	const handleStop = async () => {
		if (!hostUrl || isStopping) return;
		setIsStopping(true);
		try {
			const client = getHostServiceClientByUrl(hostUrl);
			await client.terminal.writeInput.mutate({
				terminalId: agent.terminalId,
				workspaceId,
				data: "\u0003",
			});
			await client.terminalAgents.clearWorkspaceStatuses.mutate({
				workspaceId,
				terminalId: agent.terminalId,
			});
			await queryClient.invalidateQueries({
				queryKey: getTerminalAgentBindingsQueryKey(workspaceId),
			});
		} catch (error) {
			console.error("[DashboardSidebarAgentRow] Failed to stop agent:", error);
			toast.error(t({ message: "Failed to stop agent" }));
		} finally {
			setIsStopping(false);
		}
	};

	const handleRename = async (subagentId: string, name: string) => {
		if (!hostUrl) throw new Error("Workspace host is unavailable");
		await getHostServiceClientByUrl(
			hostUrl,
		).terminalAgents.renameSubagent.mutate({
			workspaceId,
			terminalId: agent.terminalId,
			subagentId,
			name,
		});
		await queryClient.invalidateQueries({
			queryKey: getTerminalAgentBindingsQueryKey(workspaceId),
		});
	};

	return (
		<>
			{renamingSubagent && (
				<RenameSubagentDialog
					name={renamingSubagent.customName ?? ""}
					automaticName={getSubagentLabel({
						...renamingSubagent,
						customName: undefined,
					})}
					onClose={() => setRenamingSubagent(null)}
					onSave={(name) => handleRename(renamingSubagent.id, name)}
				/>
			)}
			<div className="group flex h-7 min-w-0 items-center gap-0.5 rounded-sm px-1.5 hover:bg-fill-hover">
				<button
					type="button"
					onClick={(event) => {
						event.stopPropagation();
						handleOpen();
					}}
					onKeyDown={(event) => event.stopPropagation()}
					title={`${agent.label}: ${statusLabel}`}
					className="flex min-w-0 flex-1 items-center gap-1.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
				>
					<DashboardSidebarAgentAvatar agent={agent} />
					<span className="min-w-0 flex-1 truncate text-xs">{agent.label}</span>
					{hasSubagents && (
						<span className="shrink-0 text-[10px] text-muted-foreground">
							+{agent.subagents.length}
						</span>
					)}
					<span
						className={cn(
							"shrink-0 text-[10px]",
							STATUS_TEXT_CLASS[agent.status],
						)}
					>
						{statusLabel}
					</span>
				</button>
				{hasSubagents && (
					<button
						type="button"
						onClick={(event) => {
							event.stopPropagation();
							toggleSubagents();
						}}
						aria-label={
							subagentsExpanded
								? t({ message: "Collapse subagents" })
								: t({ message: "Expand subagents" })
						}
						aria-expanded={subagentsExpanded}
						className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
					>
						{subagentsExpanded ? (
							<ChevronDown className="size-3" aria-hidden />
						) : (
							<ChevronRight className="size-3" aria-hidden />
						)}
					</button>
				)}
				<button
					type="button"
					onClick={(event) => {
						event.stopPropagation();
						void handleStop();
					}}
					disabled={!hostUrl || isStopping}
					aria-label={stopLabel}
					title={stopLabel}
					className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
				>
					{isStopping ? (
						<LoaderCircle className="size-3 animate-spin" aria-hidden />
					) : (
						<Square className="size-3" aria-hidden />
					)}
				</button>
			</div>
			{hasSubagents && subagentsExpanded && (
				<div className="mb-1 ml-[15px] border-l border-border pl-2">
					{agent.subagents.map((subagent) => (
						<div
							key={subagent.id}
							className="group flex min-w-0 items-center gap-0.5 rounded-sm px-1.5 py-0.5 text-muted-foreground hover:bg-muted"
						>
							<button
								type="button"
								onClick={(event) => {
									event.stopPropagation();
									handleOpenSubagent(subagent);
								}}
								onKeyDown={(event) => event.stopPropagation()}
								title={getSubagentLabel(subagent)}
								className="flex min-w-0 flex-1 items-center gap-1.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							>
								<span className="min-w-0 flex-1 truncate text-xs">
									{getSubagentLabel(subagent)}
								</span>
								<span className="shrink-0 text-[10px]">
									<Trans>Subagent</Trans>
								</span>
							</button>
							<button
								type="button"
								onClick={(event) => {
									event.stopPropagation();
									setRenamingSubagent(subagent);
								}}
								onKeyDown={(event) => event.stopPropagation()}
								disabled={!hostUrl}
								aria-label={t({ message: "Rename subagent" })}
								title={t({ message: "Rename subagent" })}
								className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40"
							>
								<Pencil className="size-3" aria-hidden />
							</button>
							<button
								type="button"
								onClick={(event) => {
									event.stopPropagation();
									void handleStop();
								}}
								disabled={!hostUrl || isStopping}
								aria-label={stopLabel}
								title={stopLabel}
								className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 disabled:pointer-events-none disabled:opacity-40"
							>
								<Square className="size-3" aria-hidden />
							</button>
						</div>
					))}
				</div>
			)}
		</>
	);
}
