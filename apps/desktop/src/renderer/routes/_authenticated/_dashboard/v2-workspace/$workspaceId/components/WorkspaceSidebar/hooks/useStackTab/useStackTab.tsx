import { useLingui } from "@lingui/react/macro";
import { workspaceTrpc } from "@superset/workspace-client";
import { useMemo } from "react";
import { LuLayers } from "react-icons/lu";
import type { SidebarTabDefinition } from "../../types";
import { buildStack, type StackPullRequest } from "./buildStack";
import { StackTabContent } from "./components/StackTabContent";

interface UseStackTabParams {
	workspaceId: string;
}

/**
 * "Stack" tab: the chain of dependent PRs built on the checked-out branch.
 * The current PR gives the repo + head branch; the repo's open PRs give the
 * head/base links that {@link buildStack} walks into a chain.
 */
export function useStackTab({
	workspaceId,
}: UseStackTabParams): SidebarTabDefinition {
	const { t } = useLingui();

	const currentPrQuery = workspaceTrpc.git.getPullRequest.useQuery(
		{ workspaceId },
		{ enabled: !!workspaceId, refetchInterval: 15_000, staleTime: 10_000 },
	);
	const current = currentPrQuery.data ?? null;
	const owner = current?.repoOwner ?? "";
	const repo = current?.repoName ?? "";
	const headRef = current?.headRefName ?? "";

	const listQuery = workspaceTrpc.github.listPRs.useQuery(
		{ owner, repo, state: "open", perPage: 100 },
		{ enabled: !!owner && !!repo, staleTime: 15_000, refetchInterval: 30_000 },
	);

	const nodes = useMemo(() => {
		if (!headRef) return [];
		const prs: StackPullRequest[] = (listQuery.data ?? []).map((pr) => ({
			number: pr.number,
			title: pr.title,
			headRef: pr.head.ref,
			baseRef: pr.base.ref,
			url: pr.html_url,
			isDraft: pr.draft ?? false,
			state: pr.state,
		}));
		return buildStack(prs, headRef);
	}, [listQuery.data, headRef]);

	const isLoading =
		currentPrQuery.isLoading || (!!owner && !!repo && listQuery.isLoading);

	return {
		id: "stack",
		label: t({ message: "Stack" }),
		icon: LuLayers,
		badge: nodes.length > 1 ? nodes.length : undefined,
		content: (
			<StackTabContent nodes={nodes} isLoading={isLoading} hasPr={!!current} />
		),
	};
}
