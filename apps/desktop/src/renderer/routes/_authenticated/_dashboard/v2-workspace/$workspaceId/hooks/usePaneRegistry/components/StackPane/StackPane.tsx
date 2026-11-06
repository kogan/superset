import { useStackTab } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceSidebar/hooks/useStackTab";

interface StackPaneProps {
	workspaceId: string;
}

/**
 * The PR stack (chain of dependent PRs on the checked-out branch) as a pane,
 * so it can be opened from the New Tab tool picker alongside Changes/Files.
 * Reuses the same self-contained hook the sidebar's Stack tab renders.
 */
export function StackPane({ workspaceId }: StackPaneProps) {
	const stackTab = useStackTab({ workspaceId });
	return (
		<div className="size-full overflow-y-auto bg-background">
			{stackTab.content}
		</div>
	);
}
