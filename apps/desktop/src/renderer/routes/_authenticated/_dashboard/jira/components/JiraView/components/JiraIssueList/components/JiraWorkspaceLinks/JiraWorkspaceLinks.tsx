import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { Button } from "@superset/ui/button";
import {
	Command,
	CommandEmpty,
	CommandInput,
	CommandItem,
	CommandList,
} from "@superset/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@superset/ui/popover";
import { toast } from "@superset/ui/sonner";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { LuCheck, LuFolderGit2, LuLink, LuPlus } from "react-icons/lu";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { useHostWorkspaces } from "renderer/routes/_authenticated/providers/HostWorkspacesProvider";
import { useNewWorkspaceDraftStore } from "renderer/stores/new-workspace-draft";
import type { JiraIssue } from "../JiraKanban/utils/groupIssuesByStatus";
import { jiraWorkspaceDraft } from "./jiraWorkspaceDraft";

export function JiraWorkspaceLinks({
	issue,
}: {
	issue: Pick<JiraIssue, "key" | "summary" | "url">;
}) {
	const issueKey = issue.key;
	const generation = useRef(0);
	const creating = useRef(false);
	const [isCreating, setIsCreating] = useState(false);
	useEffect(
		() => () => {
			generation.current++;
		},
		[],
	);
	const { t } = useLingui();
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);
	const { workspaces } = useHostWorkspaces();
	const utils = electronTrpc.useUtils();
	const links = electronTrpc.jira.listWorkspaceLinks.useQuery(undefined, {
		staleTime: 30_000,
	});
	const context = electronTrpc.jira.getWorkspaceContext.useQuery(
		{ issueKey },
		{ enabled: open, retry: false, staleTime: 0 },
	);
	const createWorkspace = async () => {
		if (creating.current) return;
		creating.current = true;
		setIsCreating(true);
		const current = ++generation.current;
		try {
			const context = await electronTrpcClient.jira.getWorkspaceContext.query({
				issueKey,
			});
			if (current !== generation.current) return;
			const patch = jiraWorkspaceDraft(issue, context);
			useNewWorkspaceDraftStore.getState().resetDraft();
			useNewWorkspaceDraftStore.getState().updateDraft(patch);
			setOpen(false);
			await navigate({ to: "/new-workspace" });
		} catch (error) {
			if (current === generation.current) toast.error(errorMessage(error));
		} finally {
			if (current === generation.current) {
				creating.current = false;
				setIsCreating(false);
			}
		}
	};
	const setLink = electronTrpc.jira.setWorkspaceLink.useMutation({
		onSuccess: () => utils.jira.listWorkspaceLinks.invalidate(),
		onError: (error) => toast.error(errorMessage(error)),
	});
	const choices = workspaces
		.filter((workspace) => !workspace.archivedAt)
		.map((workspace) => {
			const saved = links.data?.find(
				(link) =>
					link.issueKey === issueKey &&
					link.workspaceId === workspace.id &&
					link.hostId === workspace.hostId,
			);
			const keys: string[] =
				`${workspace.name} ${workspace.branch}`
					.toUpperCase()
					.match(/(?<![A-Z0-9])[A-Z][A-Z0-9_]*-\d+(?![A-Z0-9])/g) ?? [];
			return { workspace, linked: saved?.linked ?? keys.includes(issueKey) };
		});
	return (
		<section
			aria-label={t({ message: "Workspaces" })}
			className="flex flex-wrap items-center gap-1.5"
		>
			{choices
				.filter((choice) => choice.linked)
				.map(({ workspace }) => (
					<button
						key={`${workspace.hostId}:${workspace.id}`}
						type="button"
						className="flex max-w-full items-center gap-1 rounded border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-xs text-blue-600 hover:bg-blue-500/20 dark:text-blue-300"
						title={workspace.branch}
						onClick={() =>
							void navigate({
								to: "/v2-workspace/$workspaceId",
								params: { workspaceId: workspace.id },
							})
						}
					>
						<LuFolderGit2 className="size-3.5 shrink-0" />
						<span className="truncate">{workspace.name}</span>
					</button>
				))}
			<Popover
				open={open}
				onOpenChange={(next) => {
					setOpen(next);
					if (!next) {
						generation.current++;
						creating.current = false;
						setIsCreating(false);
					}
				}}
			>
				<PopoverTrigger asChild>
					<Button
						variant="ghost"
						size="sm"
						className="h-7 px-1.5 text-xs text-muted-foreground"
						aria-label={t({ message: "Link workspace" })}
					>
						<LuLink className="size-3" />
						<Trans>Workspaces</Trans>
					</Button>
				</PopoverTrigger>
				<PopoverContent align="start" className="w-80 p-0">
					<Command>
						<CommandInput
							placeholder={t({ message: "Search workspaces..." })}
						/>
						<CommandList>
							<CommandItem
								value="new workspace"
								forceMount
								disabled={isCreating}
								onSelect={() => void createWorkspace()}
							>
								<LuPlus className="size-4" />
								<Trans>New workspace</Trans>
							</CommandItem>
							<CommandEmpty>
								<Trans>No workspaces found.</Trans>
							</CommandEmpty>
							{choices.map(({ workspace, linked }) => (
								<CommandItem
									key={`${workspace.hostId}:${workspace.id}`}
									value={`${workspace.name} ${workspace.branch} ${workspace.id}`}
									disabled={
										setLink.isPending ||
										links.isPending ||
										links.isError ||
										!context.data ||
										context.isFetching ||
										context.isError
									}
									onSelect={() =>
										context.data &&
										setLink.mutate({
											connectionRevision: context.data.connectionRevision,
											issueKey,
											workspaceId: workspace.id,
											hostId: workspace.hostId,
											linked: !linked,
										})
									}
								>
									<LuCheck
										className={
											linked ? "size-4 shrink-0" : "size-4 shrink-0 opacity-0"
										}
									/>
									<div className="min-w-0">
										<p className="truncate">{workspace.name}</p>
										<p className="truncate text-xs text-muted-foreground">
											{workspace.branch}
										</p>
									</div>
								</CommandItem>
							))}
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
		</section>
	);
}
