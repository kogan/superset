import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { useFormat } from "@superset/i18n/react";
import { Button } from "@superset/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import { toast } from "@superset/ui/sonner";
import type { JiraListInput } from "lib/trpc/routers/jira/jira-schema";
import { useState } from "react";
import { LuColumns3, LuRefreshCw } from "react-icons/lu";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { electronTrpcClient } from "renderer/lib/trpc-client";

import { JiraBoardPicker } from "renderer/routes/_authenticated/components/JiraBoardPicker";
import { JiraGithubScope } from "renderer/routes/_authenticated/components/JiraGithubScope";
import { JiraColumnsDialog } from "./components/JiraColumnsDialog";
import { JiraKanban } from "./components/JiraKanban";
import { groupIssuesByStatus } from "./components/JiraKanban/utils/groupIssuesByStatus";
import { JiraMemberFilter } from "./components/JiraMemberFilter";
import type { MemberSelection } from "./components/JiraMemberFilter/JiraMemberFilter";
import { JiraTransitionDialog } from "./components/JiraTransitionDialog";
import { useJiraMovement } from "./hooks/useJiraMovement/useJiraMovement";
import { applyColumnLayout } from "./utils/columnLayout";

export function JiraIssueList({ baseUrl }: { baseUrl: string }) {
	const { t } = useLingui();
	const movement = useJiraMovement();
	const { formatNumber } = useFormat();
	const [mode, setMode] = useState<"team" | "mine">("team");
	const [status, setStatus] = useState<JiraListInput["status"]>("all");
	const [assignee, setAssignee] = useState<MemberSelection>({ kind: "all" });
	const preferences = electronTrpc.jira.getPreferences.useQuery(undefined, {
		retry: false,
	});
	const settings =
		preferences.data?.baseUrl === baseUrl ? preferences.data : undefined;
	const board = settings?.teamBoard;
	const ready = mode === "mine" || Boolean(board);
	const boardColumns = electronTrpc.jira.getBoardColumns.useQuery(
		board?.id ?? 1,
		{
			enabled: mode === "team" && Boolean(board),
			retry: false,
			staleTime: 30_000,
			gcTime: 0,
		},
	);
	const configuredColumns = mode === "team" ? boardColumns.data : undefined;
	const mappedStatuses = configuredColumns?.flatMap(
		(column) => column.statuses,
	);
	const boardError = mode === "team" ? boardColumns.error : null;
	const scope: JiraListInput["scope"] =
		mode === "team" && board
			? { kind: "board", boardId: board.id, assignee }
			: { kind: "mine" };
	const [editingColumns, setEditingColumns] = useState(false);
	const utils = electronTrpc.useUtils();
	const saveColumns = electronTrpc.jira.setColumnLayout.useMutation({
		onSuccess: (next) => {
			utils.jira.getPreferences.setData(undefined, next);
			setEditingColumns(false);
		},
		onError: (error) => toast.error(errorMessage(error)),
	});
	const issuesQuery = electronTrpc.jira.listIssues.useInfiniteQuery(
		{
			scope,
			status,
			visibleStatuses: mappedStatuses?.length ? mappedStatuses : undefined,
		},
		{
			enabled: ready && (mode === "mine" || boardColumns.isSuccess),
			getNextPageParam: (page) => page.nextCursor ?? undefined,
			retry: false,
			staleTime: 30_000,
			gcTime: 0,
		},
	);
	const pages = issuesQuery.data?.pages ?? [];
	const prQueries = electronTrpc.useQueries((trpc) =>
		pages
			.filter((page) => page.issues.length > 0)
			.map((page) =>
				trpc.jira.listPullRequests(
					{ issueKeys: page.issues.map((issue) => issue.key) },
					{ retry: false, staleTime: 120_000, gcTime: 0 },
				),
			),
	);
	const discovered = new Map(
		prQueries
			.flatMap((query) => query.data?.issues ?? [])
			.map((issue) => [issue.key, issue]),
	);
	const prLoading = prQueries.some((query) => query.isFetching);
	const prUnavailable = prQueries.some(
		(query) =>
			query.isError ||
			query.data?.jiraUnavailable ||
			query.data?.githubUnavailable,
	);
	const uniqueIssues = new Map(
		pages.flatMap((page) => page.issues).map((issue) => [issue.id, issue]),
	);
	const issues = [...uniqueIssues.values()].map((issue) => ({
		...issue,
		freshdeskLinks: [
			...new Map(
				[
					...issue.freshdeskLinks,
					...(discovered.get(issue.key)?.freshdeskLinks ?? []),
				].map((link) => [link.url, link]),
			).values(),
		],
		pullRequests: [
			...new Map(
				[
					...issue.pullRequests,
					...(discovered.get(issue.key)?.links ?? []),
				].map((link) => [link.url, link]),
			).values(),
		],
	}));
	const reviewerQueries = electronTrpc.useQueries((trpc) =>
		pages.flatMap((page) => {
			const issueKeys = page.issues.map((issue) => issue.key);
			return issueKeys.length
				? [
						trpc.jira.listReviewers(
							{ issueKeys },
							{ retry: false, staleTime: 30_000, gcTime: 0 },
						),
					]
				: [];
		}),
	);
	const reviewers = new Map(
		reviewerQueries
			.flatMap((query) => query.data?.issues ?? [])
			.flatMap((issue) =>
				issue.reviewers === null
					? []
					: [
							[
								issue.key,
								issue.reviewers.map((reviewer) => reviewer.displayName),
							] as const,
						],
			),
	);
	const reviewersLoading = reviewerQueries.some((query) => query.isPending);
	const refresh = () => {
		if (mode === "team" && board) void boardColumns.refetch();
		void electronTrpcClient.jira.refreshPullRequests
			.mutate()
			.then(() => {
				void issuesQuery.refetch();
				for (const query of [...prQueries, ...reviewerQueries])
					void query.refetch();
			})
			.catch((error: unknown) => toast.error(errorMessage(error)));
	};

	const columns = groupIssuesByStatus(
		issues,
		mode === "team" ? (configuredColumns ?? []) : undefined,
	);
	const orderedColumns = applyColumnLayout(columns, settings?.columnLayout);
	const visibleColumns = orderedColumns.filter((column) => column.visible);
	const visibleCount = formatNumber(
		visibleColumns.reduce((total, column) => total + column.issues.length, 0),
	);
	const hasHiddenColumns = visibleColumns.length < columns.length;
	const shownCount = formatNumber(issues.length);
	const total = issuesQuery.data?.pages[0]?.total;
	const totalCount = total == null ? null : formatNumber(total);

	return (
		<div
			className="flex min-h-0 flex-1 flex-col"
			aria-busy={issuesQuery.isFetching}
		>
			<div className="flex flex-wrap items-center gap-2 border-b px-6 py-3">
				<Button
					variant={mode === "team" ? "secondary" : "ghost"}
					size="sm"
					aria-pressed={mode === "team"}
					onClick={() => setMode("team")}
				>
					<Trans>Team</Trans>
				</Button>
				<Button
					variant={mode === "mine" ? "secondary" : "ghost"}
					size="sm"
					aria-pressed={mode === "mine"}
					onClick={() => setMode("mine")}
				>
					<Trans>My work</Trans>
				</Button>
				{mode === "team" && (
					<>
						<JiraBoardPicker
							board={board}
							onSelect={() => setAssignee({ kind: "all" })}
						/>
						{board && (
							<JiraMemberFilter
								value={assignee}
								onChange={setAssignee}
								issues={issues}
							/>
						)}
					</>
				)}
				<Select
					value={status}
					onValueChange={(value) => {
						if (
							value === "all" ||
							value === "unfinished" ||
							value === "in-progress"
						)
							setStatus(value);
					}}
				>
					<SelectTrigger
						className="h-8 w-36"
						aria-label={t({ message: "Status" })}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">
							<Trans>All statuses</Trans>
						</SelectItem>
						<SelectItem value="unfinished">
							<Trans>Unfinished</Trans>
						</SelectItem>
						<SelectItem value="in-progress">
							<Trans>In progress</Trans>
						</SelectItem>
					</SelectContent>
				</Select>
				<Button
					variant="outline"
					size="sm"
					className="ml-auto"
					disabled={
						!ready ||
						preferences.isPending ||
						preferences.isError ||
						columns.length === 0
					}
					onClick={() => setEditingColumns(true)}
				>
					<LuColumns3 className="size-3.5" />
					<Trans>Columns</Trans>
				</Button>
				<Button
					variant="outline"
					size="sm"
					disabled={!ready || issuesQuery.isFetching}
					onClick={refresh}
				>
					<LuRefreshCw
						className={
							issuesQuery.isFetching
								? "size-3.5 animate-spin motion-reduce:animate-none"
								: "size-3.5"
						}
					/>
					<Trans>Refresh</Trans>
				</Button>
			</div>
			{preferences.isError && (
				<div role="alert" className="px-6 py-3 text-sm text-destructive">
					{errorMessage(preferences.error)}
					<Button
						variant="ghost"
						size="sm"
						onClick={() => void preferences.refetch()}
					>
						<Trans>Retry</Trans>
					</Button>
				</div>
			)}
			{ready && (issuesQuery.isError || boardError) && (
				<div
					className="flex items-center gap-3 border-b bg-destructive/5 px-6 py-3 text-sm"
					role="alert"
				>
					<p className="min-w-0 flex-1 text-destructive select-text">
						{errorMessage(boardError ?? issuesQuery.error)}
					</p>
					<Button
						variant="outline"
						size="sm"
						disabled={issuesQuery.isFetching}
						onClick={refresh}
					>
						<Trans>Retry</Trans>
					</Button>
				</div>
			)}
			<div className="flex items-center justify-between gap-3 border-b px-6 py-2">
				<p className="text-xs text-muted-foreground">
					{prUnavailable ? (
						<Trans>
							Some PR links could not be loaded. Check Jira permissions and
							GitHub CLI access, then refresh.
						</Trans>
					) : (
						<Trans>PR links from Jira tickets and GitHub.</Trans>
					)}
				</p>
				<JiraGithubScope scope={settings?.githubScope} />
			</div>
			{!ready ? (
				<output className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
					{preferences.isPending ? (
						<Trans>Loading…</Trans>
					) : (
						<Trans>Choose a team board to see everyone’s issues.</Trans>
					)}
				</output>
			) : boardError && !configuredColumns ? null : issuesQuery.isPending ? (
				<output className="flex flex-1 items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
					<LuRefreshCw className="size-4 animate-spin motion-reduce:animate-none" />
					<Trans>Loading issues…</Trans>
				</output>
			) : columns.length === 0 ? (
				<output className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
					{!issuesQuery.isError && <Trans>No issues found.</Trans>}
				</output>
			) : visibleColumns.length === 0 ? (
				<output className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
					<Trans>All columns are hidden. Use Columns to show them.</Trans>
				</output>
			) : (
				<JiraKanban
					moveBusy={movement.busy}
					onMove={(issue, statuses) =>
						void movement.controller.start(issue, statuses)
					}
					reviewers={reviewers}
					reviewersLoading={reviewersLoading}
					columns={visibleColumns}
					prLoading={prLoading}
					prUnavailable={prUnavailable}
				/>
			)}
			{editingColumns && (
				<JiraColumnsDialog
					key={`${baseUrl}:${board?.id ?? "mine"}`}
					columns={columns}
					layout={settings?.columnLayout ?? []}
					isSaving={saveColumns.isPending}
					onClose={() => setEditingColumns(false)}
					onSave={(layout) =>
						saveColumns.mutate({ baseUrl, boardId: board?.id ?? null, layout })
					}
				/>
			)}
			<JiraTransitionDialog
				state={movement.state}
				onCancel={movement.controller.cancel}
				onChoose={(id) => void movement.controller.choose(id)}
			/>
			{issuesQuery.data && (
				<div className="flex items-center justify-between gap-3 border-t px-6 py-3">
					<p className="text-xs text-muted-foreground" aria-live="polite">
						{hasHiddenColumns ? (
							<Trans>
								{visibleCount} visible · {shownCount} loaded
							</Trans>
						) : totalCount === null ? (
							<Trans>Loaded issues: {shownCount}</Trans>
						) : (
							<Trans>
								{shownCount} of {totalCount} issues
							</Trans>
						)}
					</p>
					{issuesQuery.hasNextPage && (
						<Button
							variant="outline"
							size="sm"
							disabled={issuesQuery.isFetching}
							onClick={() => void issuesQuery.fetchNextPage()}
						>
							{issuesQuery.isFetchingNextPage ? (
								<Trans>Loading…</Trans>
							) : (
								<Trans>Load more</Trans>
							)}
						</Button>
					)}
				</div>
			)}
		</div>
	);
}
