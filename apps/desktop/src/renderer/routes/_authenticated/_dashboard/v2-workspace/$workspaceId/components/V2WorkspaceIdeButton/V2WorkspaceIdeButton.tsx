import { Trans } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import { CodeXml } from "lucide-react";
import { useFeaturePreferences } from "renderer/stores/feature-preferences";

interface V2WorkspaceIdeButtonProps {
	onOpenIde: () => void;
}

/**
 * Persistent "IDE" button in the workspace top bar. Opens (or focuses) the
 * worktree's embedded IDE pane. Hidden when the Embedded IDE feature is off,
 * mirroring the gate on the add-tab-menu and empty-state entry points.
 */
export function V2WorkspaceIdeButton({ onOpenIde }: V2WorkspaceIdeButtonProps) {
	const ideEnabled = useFeaturePreferences((state) => state.embeddedIde);
	if (!ideEnabled) return null;

	return (
		<Button
			variant="ghost"
			size="sm"
			className="h-7 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground"
			onClick={onOpenIde}
		>
			<CodeXml className="size-3.5" />
			<Trans>IDE</Trans>
		</Button>
	);
}
