import {
	DndContext,
	DragOverlay,
	MouseSensor,
	TouchSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { toast } from "@superset/ui/sonner";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useHostProjects } from "renderer/hooks/host-projects/useHostProjects";
import { getPullRequestTarget } from "renderer/lib/getPullRequestTarget";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { usePullRequestsSplitViewStore } from "renderer/routes/_authenticated/_dashboard/pull-requests/stores/pullRequestsSplitViewStore";
import { JiraKanbanCard } from "./components/JiraKanbanCard";
import { JiraKanbanColumn } from "./components/JiraKanbanColumn";
import type { JiraIssue, StatusColumn } from "./utils/groupIssuesByStatus";
export function JiraKanban({
	columns,
	reviewers,
	reviewersLoading,
	prLoading,
	prUnavailable,
	moveBusy,
	onMove,
}: {
	columns: StatusColumn[];
	reviewers: ReadonlyMap<string, string[]>;
	reviewersLoading: boolean;
	prLoading: boolean;
	prUnavailable: boolean;
	moveBusy: boolean;
	onMove: (issue: JiraIssue, statuses?: string[]) => void;
}) {
	const { t } = useLingui();
	const navigate = useNavigate();
	const { projects } = useHostProjects();
	const openPullRequest = (url: string) => {
		const target = getPullRequestTarget(url, projects);
		if (target) {
			usePullRequestsSplitViewStore.getState().expandDetail();
			void navigate({
				to: "/pull-requests/$prNumber",
				params: { prNumber: target.prNumber },
				search: { project: target.projectId },
			});
			return;
		}
		void electronTrpcClient.external.openUrl
			.mutate(url)
			.catch((error: unknown) => toast.error(errorMessage(error)));
	};
	const [dragged, setDragged] = useState<JiraIssue | null>(null);
	const issues = columns.flatMap((column) => column.issues);
	const sensors = useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
		useSensor(TouchSensor, {
			activationConstraint: { delay: 200, tolerance: 5 },
		}),
	);
	return (
		<DndContext
			sensors={sensors}
			accessibility={{
				screenReaderInstructions: {
					draggable: t({
						message: "Use Move to to choose a status with the keyboard.",
					}),
				},
				announcements: {
					onDragStart: () => t({ message: "Dragging issue." }),
					onDragOver: () => undefined,
					onDragEnd: () => t({ message: "Drag ended." }),
					onDragCancel: () => t({ message: "Move canceled." }),
				},
			}}
			onDragStart={({ active }) =>
				setDragged(issues.find((issue) => issue.id === active.id) ?? null)
			}
			onDragCancel={() => setDragged(null)}
			onDragEnd={({ active, over }) => {
				setDragged(null);
				if (moveBusy || !over) return;
				const issue = issues.find((issue) => issue.id === active.id);
				const column = columns.find((column) => column.key === over.id);
				if (
					issue &&
					column &&
					!column.issues.some((item) => item.id === issue.id)
				)
					onMove(issue, column.statuses);
			}}
		>
			<section
				aria-label={t({ message: "Kanban" })}
				className="flex min-h-0 flex-1 gap-4 overflow-x-auto p-6"
			>
				{columns.map((column) => (
					<JiraKanbanColumn
						key={column.key}
						column={column}
						disabled={moveBusy}
					>
						{column.issues.map((issue) => (
							<JiraKanbanCard
								key={issue.id}
								issue={issue}
								columnStatus={column.status}
								issueReviewers={reviewers.get(issue.key)}
								reviewersLoading={reviewersLoading}
								prLoading={prLoading}
								prUnavailable={prUnavailable}
								moveBusy={moveBusy}
								onMove={onMove}
								onOpenPullRequest={openPullRequest}
							/>
						))}
					</JiraKanbanColumn>
				))}
			</section>
			<DragOverlay>
				{dragged && (
					<div className="w-72 rounded-md border bg-background p-3 shadow-lg">
						<span className="text-xs text-muted-foreground">{dragged.key}</span>
						<p className="text-sm font-medium">{dragged.summary}</p>
					</div>
				)}
			</DragOverlay>
		</DndContext>
	);
}
