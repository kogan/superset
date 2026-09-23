import { Trans } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import { useNavigate } from "@tanstack/react-router";
import { GitCompareArrows } from "lucide-react";
import { useV2UserPreferences } from "renderer/hooks/useV2UserPreferences";
import { useWorkspace } from "renderer/routes/_authenticated/_dashboard/v2-workspace/providers/WorkspaceProvider";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import { showAllWorkspaceChanges } from "../../../../../../utils/showAllWorkspaceChanges";

export function IdeChangesButton({ workspaceId }: { workspaceId: string }) {
	const collections = useCollections();
	const { workspace } = useWorkspace();
	const { setRightSidebarOpen } = useV2UserPreferences();
	const navigate = useNavigate();

	return (
		<Button
			variant="ghost"
			size="sm"
			className="h-6 gap-1 text-xs"
			onClick={() => {
				showAllWorkspaceChanges(collections, workspaceId);
				setRightSidebarOpen(true);
				if (workspace.id !== workspaceId) {
					void navigate({
						to: "/v2-workspace/$workspaceId",
						params: { workspaceId },
					});
				}
			}}
		>
			<GitCompareArrows className="size-3" />
			<Trans>Changes</Trans>
		</Button>
	);
}
