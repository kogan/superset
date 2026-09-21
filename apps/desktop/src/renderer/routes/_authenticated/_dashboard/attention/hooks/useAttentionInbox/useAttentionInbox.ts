import { useLingui } from "@lingui/react/macro";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useActiveOrganizationId } from "renderer/hooks/useActiveOrganizationId";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { useHostWorkspaces } from "renderer/routes/_authenticated/providers/HostWorkspacesProvider";
import { useFeaturePreferences } from "renderer/stores/feature-preferences";
import {
	groupProjectTargetsByHost,
	useProjectQueryTargets,
} from "../../../hooks/useProjectQueryTargets/useProjectQueryTargets";
import { useWorkspaceAgentSources } from "../../../providers/DashboardWorkspaceStatusProvider";
import { usePullRequestsSplitViewStore } from "../../../pull-requests/stores/pullRequestsSplitViewStore";
import { navigateToV2Workspace } from "../../../utils/workspace-navigation";
import {
	type AttentionFilter,
	type AttentionItem,
	type AttentionPrSnapshot,
	agentAttentionItems,
	fetchAttentionPullRequests,
	matchesAttentionFilter,
	mergeAttentionPullRequests,
	type PrReason,
} from "./attention-items";
import { selectAttentionProjectTargets } from "./attention-projects";

const NO_PROJECT_FILTERS: string[] = [];
const PR_REASONS: PrReason[] = ["failed-checks", "reviews"];

export interface AttentionSource {
	id: string;
	label: string;
	category: Exclude<AttentionFilter, "all"> | "pull-requests";
	state: "loading" | "ready" | "partial" | "unavailable";
}

export function useAttentionInbox(filter: AttentionFilter) {
	const { t } = useLingui();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const organizationId = useActiveOrganizationId();
	const githubEnabled = useFeaturePreferences((state) => state.pullRequests);
	const {
		workspaces,
		cache,
		isReady,
		isComplete: workspacesComplete,
		hostsSettled,
	} = useHostWorkspaces();
	const agents = useWorkspaceAgentSources();
	useEffect(() => {
		void queryClient.invalidateQueries({
			predicate: (query) =>
				query.queryKey[0] === "terminal-agent-bindings" &&
				query.state.dataUpdatedAt < Date.now() - 30_000,
			refetchType: "active",
		});
	}, [queryClient]);
	const projects = useProjectQueryTargets(NO_PROJECT_FILTERS);
	const [pageLimit, setPageLimit] = useState(1);
	const targets = groupProjectTargetsByHost(
		selectAttentionProjectTargets({
			targets: projects.targets,
			projects: projects.projects,
			workspaces,
		}),
	).flatMap((host) => {
		const sorted = [...host.projects].sort((a, b) =>
			a.projectId.localeCompare(b.projectId),
		);
		const chunks = [];
		for (let index = 0; index < sorted.length; index += 50) {
			const batch = sorted.slice(index, index + 50);
			const [first, ...rest] = batch;
			if (!first) continue;
			const projectIds: [string, ...string[]] = [
				first.projectId,
				...rest.map((project) => project.projectId),
			];
			for (const reason of PR_REASONS)
				chunks.push({
					hostId: host.hostId,
					hostUrl:
						host.hostId && cache.isSandboxHost(host.hostId)
							? null
							: host.hostUrl,
					projectIds,
					projects: batch,
					reason,
				});
		}
		return chunks;
	});
	const prQueries = useQueries({
		queries: targets.map((target) => {
			const key = [
				"attention-pull-requests",
				organizationId,
				target.hostId,
				target.hostUrl,
				target.projectIds,
				target.reason,
			];
			return {
				queryKey: [...key, pageLimit],
				enabled:
					githubEnabled &&
					projects.isReady &&
					isReady &&
					hostsSettled &&
					Boolean(organizationId) &&
					Boolean(target.hostUrl),
				queryFn: () => {
					if (!target.hostUrl) throw new Error("Host unavailable");
					return fetchAttentionPullRequests({
						search: getHostServiceClientByUrl(target.hostUrl).workspaceCreation
							.searchPullRequests.query,
						projectIds: target.projectIds,
						reason: target.reason,
						pageLimit,
					});
				},
				placeholderData: () =>
					queryClient.getQueryData<AttentionPrSnapshot>([
						...key,
						pageLimit - 1,
					]),
				staleTime: 30_000,
				refetchInterval: 60_000,
				retry: false,
			};
		}),
	});
	const workspaceById = new Map(
		workspaces.map((workspace) => [workspace.id, workspace]),
	);
	const sources: AttentionSource[] = [];
	const agentItems: AttentionItem[] = [];
	if (!isReady || !hostsSettled)
		sources.push({
			id: "workspace-membership",
			label: t({ message: "Workspaces" }),
			category: "agents",
			state: "loading",
		});
	if (isReady && !workspacesComplete)
		sources.push({
			id: "workspace-coverage",
			label: t({ message: "Workspaces" }),
			category: "agents",
			state: "unavailable",
		});
	for (const source of agents.sources) {
		const workspace = workspaceById.get(source.workspaceId);
		if (!workspace) continue;
		const workspaceName = workspace.name || workspace.branch || workspace.id;
		sources.push({
			id: source.workspaceId,
			label: workspaceName,
			category: "agents",
			state: source.state,
		});
		if (source.state === "ready")
			agentItems.push(
				...agentAttentionItems({
					workspaceId: workspace.id,
					workspaceName,
					bindings: source.bindings,
				}),
			);
	}
	const prSources: Parameters<typeof mergeAttentionPullRequests>[0] = [];
	let hasMore = false;
	if (githubEnabled) {
		if (!projects.isReady)
			sources.push({
				id: "project-membership",
				label: t({ message: "Pull requests" }),
				category: "pull-requests",
				state: "loading",
			});
		if (projects.isReady && !projects.isComplete)
			sources.push({
				id: "project-coverage",
				label: t({ message: "Pull requests" }),
				category: "pull-requests",
				state: "unavailable",
			});
		targets.forEach((target, index) => {
			const query = prQueries[index];
			const categoryLabel =
				target.reason === "reviews"
					? t({ message: "Review requests" })
					: t({ message: "Failed checks" });
			sources.push({
				id: `${target.hostId}:${target.projectIds.join(",")}:${target.reason}`,
				label: `${categoryLabel} · ${target.projects.map((project) => project.projectName).join(", ")}`,
				category: target.reason,
				state:
					!target.hostUrl || query?.isError
						? "unavailable"
						: query?.isPending
							? "loading"
							: query?.data?.incomplete || query?.data?.hasMore
								? "partial"
								: "ready",
			});
			if (projects.isReady && query?.data && !query.isError && target.hostUrl) {
				prSources.push({
					reason: target.reason,
					snapshot: query.data,
					projectNames: new Map(
						target.projects.map((project) => [
							project.projectId,
							project.projectName,
						]),
					),
				});
				hasMore ||= query.data.hasMore;
			}
		});
	}
	const items = [
		...agentItems.sort((a, b) => b.updatedAt - a.updatedAt),
		...mergeAttentionPullRequests(prSources),
	];
	const visibleSources = sources.filter(
		(source) =>
			filter === "all" ||
			source.category === filter ||
			(source.category === "pull-requests" && filter !== "agents"),
	);
	const open = (item: AttentionItem) => {
		if (item.kind === "agent") {
			void navigateToV2Workspace(item.workspaceId, navigate, {
				search: {
					terminalId: item.terminalId,
					focusRequestId: crypto.randomUUID(),
				},
			});
		} else {
			usePullRequestsSplitViewStore.getState().expandDetail();
			void navigate({
				to: "/pull-requests/$prNumber",
				params: { prNumber: String(item.prNumber) },
				search: { project: item.projectId },
			});
		}
	};
	return {
		items: items.filter((item) => matchesAttentionFilter(item, filter)),
		count: (value: AttentionFilter) =>
			items.filter((item) => matchesAttentionFilter(item, value)).length,
		sources: visibleSources,
		complete: sources.every((source) => source.state === "ready"),
		loading: visibleSources.some((source) => source.state === "loading"),
		refreshing:
			agents.sources.some((source) => source.isFetching) ||
			(githubEnabled && prQueries.some((query) => query.isFetching)),
		githubEnabled,
		canLoadMore: githubEnabled && hasMore && pageLimit < 10,
		loadMore: () => setPageLimit((limit) => Math.min(limit + 1, 10)),
		refresh: () => {
			agents.refresh();
			void cache.refetchAll();
			if (githubEnabled)
				void queryClient.invalidateQueries({
					predicate: (query) =>
						query.queryKey[0] === "host-service" &&
						query.queryKey.includes("projects"),
				});
			if (githubEnabled)
				prQueries.forEach((query, index) => {
					if (targets[index]?.hostUrl) void query.refetch();
				});
		},
		open,
	};
}
