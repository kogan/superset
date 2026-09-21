import type { HostProjectItem } from "renderer/hooks/host-projects/useHostProjects/useHostProjects.utils";
import type { HostWorkspaceItem } from "renderer/hooks/host-workspaces/useHostWorkspaces/useHostWorkspaces.utils";
import type { ProjectQueryTarget } from "../../../hooks/useProjectQueryTargets/useProjectQueryTargets";

export function selectAttentionProjectTargets({
	targets,
	projects,
	workspaces,
}: {
	targets: readonly ProjectQueryTarget[];
	projects: readonly Pick<
		HostProjectItem,
		"projectKey" | "repoOwner" | "repoName"
	>[];
	workspaces: readonly Pick<HostWorkspaceItem, "projectId" | "tags">[];
}): ProjectQueryTarget[] {
	const projectById = new Map(
		projects.map((project) => [project.projectKey, project]),
	);
	const previousCopiesByProject = new Map<string, boolean>();
	for (const workspace of workspaces) {
		if (!workspace.projectId) continue;
		previousCopiesByProject.set(
			workspace.projectId,
			(previousCopiesByProject.get(workspace.projectId) ?? true) &&
				Boolean(workspace.tags?.includes("previous-copies")),
		);
	}
	const sorted = [...targets].sort(
		(a, b) =>
			Number(!a.hostUrl) - Number(!b.hostUrl) ||
			Number(previousCopiesByProject.get(a.projectId) ?? false) -
				Number(previousCopiesByProject.get(b.projectId) ?? false) ||
			a.projectId.localeCompare(b.projectId),
	);
	const repositories = new Set<string>();
	return sorted.filter((target) => {
		const project = projectById.get(target.projectId);
		if (!project?.repoOwner || !project.repoName) return true;
		const key = JSON.stringify([
			target.hostId,
			project.repoOwner.toLowerCase(),
			project.repoName.toLowerCase(),
		]);
		if (repositories.has(key)) return false;
		repositories.add(key);
		return true;
	});
}
