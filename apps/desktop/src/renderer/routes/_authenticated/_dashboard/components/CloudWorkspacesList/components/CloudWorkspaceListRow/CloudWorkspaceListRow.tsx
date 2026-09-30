import { Trans } from "@lingui/react/macro";
import { AvatarStack } from "@superset/ui/atoms/AvatarStack";
import { Button } from "@superset/ui/button";
import { HiMiniXMark } from "react-icons/hi2";
import type { CloudWorkspaceRow } from "renderer/hooks/useCloudWorkspaces";
import { ACTIVE_WITHIN_MS } from "renderer/routes/_authenticated/_dashboard/components/CloudWorkspacePresenceStack";
import { CloudWorkspaceStatus } from "renderer/routes/_authenticated/_dashboard/components/CloudWorkspaceStatus";
import type { CloudPullRequest } from "renderer/routes/_authenticated/_dashboard/hooks/useCloudPullRequests";
import { CloudWorkspacePullRequestsBadge } from "./components/CloudWorkspacePullRequestsBadge";
import { CloudWorkspaceReposBadge } from "./components/CloudWorkspaceReposBadge";

export interface CloudWorkspaceListItem {
	workspace: Pick<
		CloudWorkspaceRow,
		| "id"
		| "name"
		| "presence"
		| "status"
		| "agentStatus"
		| "agentStatusAt"
		| "createdAt"
		| "createdBy"
	>;
	repos: string[];
	pullRequests: CloudPullRequest[];
	isInSidebar: boolean;
	isMine: boolean;
	isRead: boolean;
}

interface CloudWorkspaceListRowProps {
	item: CloudWorkspaceListItem;
	now: Date;
	showCreator: boolean;
	onOpen: () => void;
	onOpenPullRequest: (url: string) => void;
	onOpenRepo: (fullName: string) => void;
	onSetInSidebar: (inSidebar: boolean) => void;
}

export function CloudWorkspaceListRow({
	item,
	now,
	showCreator,
	onOpen,
	onOpenPullRequest,
	onOpenRepo,
	onSetInSidebar,
}: CloudWorkspaceListRowProps) {
	const { workspace, repos, pullRequests, isInSidebar } = item;
	return (
		<tr
			onClick={onOpen}
			className="h-11 cursor-pointer [&:hover>td]:bg-fill-hover [&>td:first-child]:rounded-l-lg [&>td:last-child]:rounded-r-lg"
		>
			<td className="w-full max-w-0 pr-3 pl-4">
				<span className="flex min-w-0 items-center gap-2">
					{showCreator &&
						(workspace.createdBy ? (
							<AvatarStack
								people={[
									{
										id: workspace.createdBy.userId,
										name: workspace.createdBy.name,
										image: workspace.createdBy.image,
									},
								]}
								size={20}
								outlineClassName="outline-transparent"
							/>
						) : (
							<span className="size-5 shrink-0 rounded-full border border-dashed border-muted-foreground" />
						))}
					<button
						type="button"
						onClick={(event) => {
							event.stopPropagation();
							onOpen();
						}}
						className="min-w-0 truncate text-left text-sm font-medium focus-visible:underline focus-visible:outline-none"
					>
						{workspace.name}
					</button>
					<span className="flex min-w-0 shrink-[999] items-center gap-2 overflow-hidden">
						<CloudWorkspaceReposBadge repos={repos} onOpenRepo={onOpenRepo} />
						<CloudWorkspacePullRequestsBadge
							pullRequests={pullRequests}
							onOpenPullRequest={onOpenPullRequest}
						/>
					</span>
				</span>
			</td>
			<td className="w-0 pr-3">
				<AvatarStack
					people={workspace.presence.map((person) => ({
						id: person.userId,
						name: person.name,
						image: person.image,
						isActive:
							now.getTime() - person.lastSeenAt.getTime() < ACTIVE_WITHIN_MS,
					}))}
					size={20}
				/>
			</td>
			<td className="w-0 pr-3 text-right">
				{workspace.status === "deleted" || item.isMine ? null : isInSidebar ? (
					<Button
						variant="outline"
						size="xs"
						onClick={(event) => {
							event.stopPropagation();
							onSetInSidebar(false);
						}}
						className="gap-1 text-xs whitespace-nowrap"
					>
						<HiMiniXMark className="size-3.5" />
						<Trans>Remove from sidebar</Trans>
					</Button>
				) : (
					<Button
						size="xs"
						onClick={(event) => {
							event.stopPropagation();
							onSetInSidebar(true);
						}}
						className="text-xs whitespace-nowrap"
					>
						<Trans>Add to sidebar</Trans>
					</Button>
				)}
			</td>
			<td className="w-0 pr-4">
				<span className="flex min-w-6 justify-end text-xs whitespace-nowrap text-muted-foreground tabular-nums">
					<CloudWorkspaceStatus
						workspace={workspace}
						isRead={item.isRead}
						now={now}
					/>
				</span>
			</td>
		</tr>
	);
}
