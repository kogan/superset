import { cn } from "@superset/ui/utils";
import type { MouseEventHandler, SyntheticEvent } from "react";
import { useDashboardSidebarWorkspacePorts } from "renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/providers/DashboardSidebarPortsProvider";
import { useInlineWorkspacePortsEnabled } from "renderer/stores/inline-workspace-ports";
import type { DashboardSidebarWorkspaceIndentation } from "../../../../../../types";
import { DashboardSidebarAgentsList } from "./components/DashboardSidebarAgentsList";
import { DashboardSidebarPortsChip } from "./components/DashboardSidebarPortsChip";
import type { DashboardSidebarRunningAgent } from "./hooks/useDashboardSidebarWorkspaceRunningAgents";

interface DashboardSidebarWorkspaceChipsProps {
	workspaceId: string;
	agents: DashboardSidebarRunningAgent[];
	agentsExpanded: boolean;
	agentsRegionId: string;
	isInSection?: boolean;
	indentation?: DashboardSidebarWorkspaceIndentation;
	/** Invoked when the strip itself (not one of its chips) is clicked. */
	onClick?: MouseEventHandler<HTMLDivElement>;
}

function stopChipDragStart(event: SyntheticEvent<HTMLDivElement>) {
	if (
		event.target instanceof Element &&
		(!event.currentTarget.contains(event.target) ||
			event.target.closest("button"))
	) {
		event.stopPropagation();
	}
}

export function DashboardSidebarWorkspaceChips({
	workspaceId,
	agents,
	agentsExpanded,
	agentsRegionId,
	isInSection = false,
	indentation,
	onClick,
}: DashboardSidebarWorkspaceChipsProps) {
	const inlineWorkspacePortsEnabled = useInlineWorkspacePortsEnabled();

	const portGroup = useDashboardSidebarWorkspacePorts(workspaceId);
	const ports = inlineWorkspacePortsEnabled ? (portGroup?.ports ?? []) : [];

	if (ports.length === 0 && agents.length === 0) {
		return null;
	}

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: clicks on the strip's empty area mirror the row click; chips are real buttons
		// biome-ignore lint/a11y/useKeyWithClickEvents: keyboard activation lives on the workspace row button; the strip click is a pointer convenience
		<div
			className={cn(
				"flex min-w-0 flex-col gap-0.5 pr-2",
				(ports.length > 0 || agentsExpanded) && "pb-1",
				indentation === "top-level"
					? agents.length > 0
						? "pl-[42px]"
						: "pl-[26px]"
					: indentation === "grouped" || isInSection
						? "pl-[50px]"
						: "pl-[42px]",
				onClick && "cursor-pointer",
			)}
			onMouseDown={stopChipDragStart}
			onTouchStart={stopChipDragStart}
			onClick={(event) => {
				if (!onClick) return;
				const target = event.target;
				if (!(target instanceof Element)) return;
				if (!event.currentTarget.contains(target)) return;
				const interactiveTarget = target.closest(
					"button, a, [role='button'], [role='menuitem']",
				);
				if (
					interactiveTarget &&
					event.currentTarget.contains(interactiveTarget)
				) {
					return;
				}
				onClick(event);
			}}
		>
			{agents.length > 0 && (
				<div id={agentsRegionId} hidden={!agentsExpanded}>
					<DashboardSidebarAgentsList
						workspaceId={workspaceId}
						agents={agents}
					/>
				</div>
			)}
			{ports.length > 0 && (
				<div className="flex h-6 items-center">
					<DashboardSidebarPortsChip ports={ports} />
				</div>
			)}
		</div>
	);
}
