import { useLingui } from "@lingui/react/macro";
import { workspaceTrpc } from "@superset/workspace-client";
import { useMemo } from "react";
import { LuLayers } from "react-icons/lu";
import { useHostProjects } from "renderer/hooks/host-projects/useHostProjects";
import type { SidebarTabDefinition } from "../../types";
import { buildStack, type StackPullRequest } from "./buildStack";
import { StackTabContent } from "./components/StackTabContent";

interface UseStackTabParams {
	workspaceId: string;
}

/**
 * "Stack" tab: the chain of dependent PRs built on the checked-out branch.
 *
 * The repo is read from the workspace's project (NOT its linked PR) so a
 * worktree with a stack but no linked PR still works; the current branch is
 * read live from git; and the workspace's linked PR — if any — is surfaced as
 * a marker on the matching node.
 */
export function useStackTab({
	workspaceId,
}: UseStackTabParams): SidebarTabDefinition {
	const { t } = useLingui();

	const workspaceQuery = workspaceTrpc.workspace.get.useQuery(
		{ id: workspaceId },
		{ enabled: !!workspaceId, staleTime: 30_000 },
	);
	const { projects } = useHostProjects();
	const project = projects.find(
		(candidate) => candidate.id === workspaceQuery.data?.projectId,
	);
	const owner = project?.repoOwner ?? "";
	const repo = project?.repoName ?? "";

	// The PR linked to the workspace record (if any) — marked on its node so you
	// can see at a glance which stack PR this worktree is wired to.
	const linkedPrQuery = workspaceTrpc.git.getPullRequest.useQuery(
		{ workspaceId },
		{ enabled: !!workspaceId, staleTime: 15_000 },
	);
	const linkedPrNumber = linkedPrQuery.data?.number ?? null;

	// The checked-out branch, read live from git — so the chain re-roots and the
	// "you are here" marker follows branch switches in the worktree.
	const branchesQuery = workspaceTrpc.git.listBranches.useQuery(
		{ workspaceId },
		{ enabled: !!workspaceId, refetchInterval: 15_000, staleTime: 5_000 },
	);
	const headRef =
		branchesQuery.data?.branches.find((branch) => branch.isHead)?.name ?? "";

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
		workspaceQuery.isLoading ||
		branchesQuery.isLoading ||
		(!!owner && !!repo && listQuery.isLoading);

	return {
		id: "stack",
		label: t({ message: "Stack" }),
		icon: LuLayers,
		badge: nodes.length > 1 ? nodes.length : undefined,
		content: (
			<StackTabContent
				nodes={nodes}
				isLoading={isLoading}
				hasPr={nodes.length >= 1}
				owner={owner}
				repo={repo}
				workspaceId={workspaceId}
				linkedPrNumber={linkedPrNumber}
				onRefresh={() => {
					void listQuery.refetch();
					void branchesQuery.refetch();
					void linkedPrQuery.refetch();
				}}
			/>
		),
	};
}
