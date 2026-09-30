import { useNavigate } from "@tanstack/react-router";
import { useHostProjects } from "renderer/hooks/host-projects/useHostProjects";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { getPullRequestTarget } from "renderer/lib/github/getPullRequestTarget";
import { usePullRequestsSplitViewStore } from "renderer/routes/_authenticated/_dashboard/pull-requests/stores/pullRequestsSplitViewStore";

/** Opens a pull request on its in-app page when one of your projects has the repo, else on GitHub. */
export function useOpenPullRequestInApp() {
	const navigate = useNavigate();
	const { projects } = useHostProjects();
	const openUrl = electronTrpc.external.openUrl.useMutation();
	return (url: string) => {
		const target = getPullRequestTarget(url, projects);
		if (target?.projectId) {
			usePullRequestsSplitViewStore.getState().expandDetail();
			void navigate({
				to: "/pull-requests/$prNumber",
				params: { prNumber: String(target.ref.number) },
				search: { project: target.projectId },
			});
			return;
		}
		openUrl.mutate(url);
	};
}
