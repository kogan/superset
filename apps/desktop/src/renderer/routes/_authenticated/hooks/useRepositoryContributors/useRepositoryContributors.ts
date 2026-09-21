import { useQuery } from "@tanstack/react-query";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import type { ProjectQueryTarget } from "renderer/routes/_authenticated/_dashboard/hooks/useProjectQueryTargets";

export function useRepositoryContributors(
	target: ProjectQueryTarget | undefined,
	enabled: boolean,
) {
	return useQuery({
		queryKey: [
			"pullRequests",
			"repoContributors",
			target?.projectId,
			target?.hostUrl,
		],
		queryFn: async () => {
			if (!target?.hostUrl) return [];
			return getHostServiceClientByUrl(
				target.hostUrl,
			).workspaceCreation.getRepoContributors.query({
				projectId: target.projectId,
			});
		},
		enabled: enabled && Boolean(target?.hostUrl),
		staleTime: 5 * 60_000,
		gcTime: 10 * 60_000,
	});
}
