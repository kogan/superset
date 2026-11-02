import type { RouterOutputs } from "@superset/trpc";
import { useMemo } from "react";
import { useActiveOrganizationId } from "renderer/hooks/useActiveOrganizationId";
import { cloudTrpc } from "renderer/lib/cloud-trpc";

// Upstream's cloud-workspace PR model, keyed by cloud workspace id. Kept beside
// the fork's by-branch-ref `useCloudPullRequests` (different procedure/shape):
// the fork sidebar looks PRs up by repo+branch, while the cloud-workspaces and
// v2-workspaces surfaces look them up by workspace.
export type CloudWorkspacePullRequestRecord =
	RouterOutputs["cloudWorkspace"]["pullRequests"][number];

export function useCloudWorkspacePullRequests({
	active,
	archived,
}: {
	active: boolean;
	archived: boolean;
}): {
	byWorkspace: ReadonlyMap<string, CloudWorkspacePullRequestRecord[]>;
} {
	const organizationId = useActiveOrganizationId();
	const activeQuery = cloudTrpc.cloudWorkspace.pullRequests.useQuery(
		{ organizationId: organizationId ?? "", archived: false },
		{ enabled: active && organizationId !== null },
	);
	const archivedQuery = cloudTrpc.cloudWorkspace.pullRequests.useQuery(
		{ organizationId: organizationId ?? "", archived: true },
		{ enabled: archived && organizationId !== null },
	);

	return useMemo(() => {
		const byWorkspace = new Map<string, CloudWorkspacePullRequestRecord[]>();
		for (const row of [
			...(activeQuery.data ?? []),
			...(archivedQuery.data ?? []),
		]) {
			const rows = byWorkspace.get(row.cloudWorkspaceId);
			if (rows) rows.push(row);
			else byWorkspace.set(row.cloudWorkspaceId, [row]);
		}
		return { byWorkspace };
	}, [activeQuery.data, archivedQuery.data]);
}
