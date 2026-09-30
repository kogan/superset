import { useLingui } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useHostWorkspaces } from "renderer/routes/_authenticated/providers/HostWorkspacesProvider";
import { useWorkspaceAgentSources } from "../../../providers/DashboardWorkspaceStatusProvider";
import { navigateToV2Workspace } from "../../../utils/workspace-navigation";
import { type AttentionItem, agentAttentionItems } from "./attention-items";

interface AttentionSource {
	id: string;
	label: string;
	state: "loading" | "ready" | "unavailable";
}

export function useAttentionInbox() {
	const { t } = useLingui();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
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
	const workspaceById = new Map(
		workspaces.map((workspace) => [workspace.id, workspace]),
	);
	const sources: AttentionSource[] = [];
	const agentItems: AttentionItem[] = [];
	if (!isReady || !hostsSettled)
		sources.push({
			id: "workspace-membership",
			label: t({ message: "Workspaces" }),
			state: "loading",
		});
	if (isReady && !workspacesComplete)
		sources.push({
			id: "workspace-coverage",
			label: t({ message: "Workspaces" }),
			state: "unavailable",
		});
	for (const source of agents.sources) {
		const workspace = workspaceById.get(source.workspaceId);
		if (!workspace) continue;
		const workspaceName = workspace.name || workspace.branch || workspace.id;
		sources.push({
			id: source.workspaceId,
			label: workspaceName,
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
	return {
		items: agentItems.sort((a, b) => b.updatedAt - a.updatedAt),
		sources,
		complete: sources.every((source) => source.state === "ready"),
		loading: sources.some((source) => source.state === "loading"),
		refreshing: agents.sources.some((source) => source.isFetching),
		refresh: () => {
			agents.refresh();
			void cache.refetchAll();
		},
		open: (item: AttentionItem) => {
			void navigateToV2Workspace(item.workspaceId, navigate, {
				search: {
					terminalId: item.terminalId,
					focusRequestId: crypto.randomUUID(),
				},
			});
		},
	};
}
