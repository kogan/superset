import type { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import { setWorkspaceSidebarTab } from "../setWorkspaceSidebarTab";

export function showAllWorkspaceChanges(
	collections: ReturnType<typeof useCollections>,
	workspaceId: string,
): void {
	if (!collections.v2WorkspaceLocalState.get(workspaceId)) {
		setWorkspaceSidebarTab(collections, workspaceId, "changes");
		return;
	}
	collections.v2WorkspaceLocalState.update(workspaceId, (draft) => {
		draft.sidebarState.activeTab = "changes";
		draft.sidebarState.changesFilter = { kind: "all" };
	});
}
