import { Trans, useLingui } from "@lingui/react/macro";
import type { WorkspaceStore } from "@superset/panes";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { MessageSquare, MessageSquareOff } from "lucide-react";
import { useSettings } from "renderer/stores/settings";
import type { StoreApi } from "zustand/vanilla";
import type { PaneViewerData } from "../../../../../../types";
import { DiffPanePRLink } from "./components/DiffPanePRLink";

interface DiffPaneHeaderExtrasProps {
	workspaceId: string;
	store: StoreApi<WorkspaceStore<PaneViewerData>>;
}

export function DiffPaneHeaderExtras({
	workspaceId,
	store,
}: DiffPaneHeaderExtrasProps) {
	const { t } = useLingui();
	const showDiffComments = useSettings((s) => s.showDiffComments);
	const updateSetting = useSettings((s) => s.update);

	const buttonClass = (active: boolean) =>
		cn(
			"flex size-5 shrink-0 items-center justify-center transition-colors",
			active
				? "bg-secondary text-foreground"
				: "text-muted-foreground hover:text-foreground",
		);

	return (
		<div className="flex shrink-0 items-center gap-1">
			<DiffPanePRLink workspaceId={workspaceId} store={store} />
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						onClick={() => updateSetting("showDiffComments", !showDiffComments)}
						aria-label={
							showDiffComments
								? t({
										message: "Hide PR review comments",
									})
								: t({
										message: "Show PR review comments",
									})
						}
						aria-pressed={showDiffComments}
						className={buttonClass(showDiffComments)}
					>
						{showDiffComments ? (
							<MessageSquare className="size-3.5" />
						) : (
							<MessageSquareOff className="size-3.5" />
						)}
					</button>
				</TooltipTrigger>
				<TooltipContent side="bottom">
					{showDiffComments ? (
						<Trans>Hide review comments</Trans>
					) : (
						<Trans>Show review comments</Trans>
					)}
				</TooltipContent>
			</Tooltip>
			<div
				className="mx-1 h-3.5 w-px shrink-0 bg-muted-foreground/30"
				aria-hidden="true"
			/>
		</div>
	);
}
