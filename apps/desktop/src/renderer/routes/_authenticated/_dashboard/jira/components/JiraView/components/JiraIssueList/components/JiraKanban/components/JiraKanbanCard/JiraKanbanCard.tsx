import { useDraggable } from "@dnd-kit/core";
import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { useFormat } from "@superset/i18n/react";
import { Badge } from "@superset/ui/badge";
import { Button } from "@superset/ui/button";
import { toast } from "@superset/ui/sonner";
import { cn } from "@superset/ui/utils";
import {
	LuArrowUpRight,
	LuGripVertical,
	LuTriangleAlert,
} from "react-icons/lu";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { JiraPullRequestLinks } from "../../../JiraPullRequestLinks";
import { JiraReviewerNames } from "../../../JiraReviewerNames";
import { JiraWorkspaceLinks } from "../../../JiraWorkspaceLinks";
import type { JiraIssue } from "../../utils/groupIssuesByStatus";
import { JiraFreshdeskLinks } from "./components/JiraFreshdeskLinks";

export function JiraKanbanCard({
	issue,
	columnStatus,
	issueReviewers,
	reviewersLoading,
	prLoading,
	prUnavailable,
	moveBusy,
	onMove,
}: {
	issue: JiraIssue;
	columnStatus: string;
	issueReviewers: string[] | undefined;
	reviewersLoading: boolean;
	prLoading: boolean;
	prUnavailable: boolean;
	moveBusy: boolean;
	onMove: (issue: JiraIssue) => void;
}) {
	const { t } = useLingui();
	const { formatDateTime } = useFormat();
	const { setNodeRef, setActivatorNodeRef, attributes, listeners, isDragging } =
		useDraggable({ id: issue.id, disabled: moveBusy });
	const reviewerNeeded =
		issue.status === "Needs QA" && issueReviewers?.length === 0;
	return (
		<article
			ref={setNodeRef}
			style={{
				opacity: isDragging ? 0.4 : undefined,
			}}
			data-reviewer-needed={reviewerNeeded || undefined}
			className={cn(
				"rounded-md border bg-background p-3 shadow-sm",
				reviewerNeeded &&
					"border-l-4 border-amber-400 bg-amber-500/20 ring-1 ring-amber-500/35",
			)}
		>
			<div className="mb-2 flex justify-between gap-2">
				<Button
					ref={setActivatorNodeRef}
					variant="ghost"
					size="sm"
					className="touch-none cursor-grab"
					disabled={moveBusy}
					{...listeners}
					{...attributes}
					tabIndex={-1}
					aria-label={t({ message: "Drag issue" })}
				>
					<LuGripVertical aria-hidden="true" />
				</Button>
				<Button
					variant="ghost"
					size="sm"
					disabled={moveBusy}
					onClick={() => onMove(issue)}
				>
					<Trans>Move to</Trans>
				</Button>
			</div>
			{reviewerNeeded && (
				<p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-amber-400 px-2 py-1 text-xs font-semibold text-amber-950">
					<LuTriangleAlert className="size-3.5" aria-hidden="true" />
					<Trans>Reviewer needed</Trans>
				</p>
			)}
			<a
				href={issue.url}
				title={t({ message: "Open in browser" })}
				onClick={(event) => {
					event.preventDefault();
					void electronTrpcClient.external.openUrl
						.mutate(issue.url)
						.catch((error: unknown) => toast.error(errorMessage(error)));
				}}
				className="group block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<span className="mb-2 flex items-center gap-1 font-mono text-xs text-muted-foreground">
					{issue.key}
					<LuArrowUpRight className="size-3" />
				</span>
				<p className="break-words text-sm font-medium leading-relaxed group-hover:underline">
					{issue.summary}
				</p>
				<div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
					{columnStatus !== issue.status && (
						<Badge variant="secondary">{issue.status}</Badge>
					)}
					{issue.priority && <Badge variant="outline">{issue.priority}</Badge>}
					<span className="min-w-0 break-words">{issue.project}</span>
				</div>
				<time
					dateTime={issue.updated}
					className="mt-3 block text-xs text-muted-foreground"
				>
					{formatDateTime(new Date(issue.updated))}
				</time>
			</a>
			<p className="mt-3 text-xs text-muted-foreground">
				<Trans>Assignee</Trans>:{" "}
				<span className="text-foreground">
					{issue.assignee?.displayName ?? <Trans>Unassigned</Trans>}
				</span>
			</p>
			<p className="mt-1 text-xs text-muted-foreground">
				<Trans>Reviewers</Trans>:{" "}
				<span className="text-foreground">
					<JiraReviewerNames
						names={issueReviewers}
						loading={reviewersLoading}
					/>
				</span>
			</p>
			<JiraFreshdeskLinks links={issue.freshdeskLinks} />
			<div className="mt-3">
				<JiraWorkspaceLinks issue={issue} />
			</div>
			<div className="mt-3 border-t pt-3">
				<JiraPullRequestLinks
					links={issue.pullRequests}
					loading={prLoading}
					unavailable={prUnavailable}
				/>
			</div>
		</article>
	);
}
