import { Trans } from "@lingui/react/macro";
import type { RendererContext } from "@superset/panes";
import { workspaceTrpc } from "@superset/workspace-client";
import { FolderOpen } from "lucide-react";
import { useMemo } from "react";
import { useQuickOpenStore } from "renderer/commandPalette/ui/QuickOpen/quickOpenStore";
import { useStore } from "zustand";
import { FilesTab } from "../../../../components/WorkspaceSidebar/components/FilesTab";
import type { FilePaneData, PaneViewerData } from "../../../../types";

export function FileExplorerPane({
	context,
	workspaceId,
	onOpenFile,
}: {
	context: RendererContext<PaneViewerData>;
	workspaceId: string;
	onOpenFile: (path: string, openInNewTab?: boolean) => void;
}) {
	const openQuickOpenFor = useQuickOpenStore((state) => state.openFor);
	const hasEditor = useStore(context.store, (state) => {
		const tab = state.getPane(context.pane.id);
		return Boolean(
			tab &&
				Object.values(state.getTab(tab.tabId)?.panes ?? {}).some(
					(pane) => pane.kind === "file",
				),
		);
	});
	const status = workspaceTrpc.git.getStatus.useQuery(
		{ workspaceId },
		{ staleTime: 30_000 },
	);
	const selectedFilePath = useStore(context.store, (state) => {
		const location = state.getPane(context.pane.id);
		const tab = location && state.getTab(location.tabId);
		const activePane = tab?.activePaneId && tab.panes[tab.activePaneId];
		return activePane && activePane.kind === "file"
			? (activePane.data as FilePaneData).filePath
			: undefined;
	});
	const pendingReveal = useMemo(
		() =>
			selectedFilePath
				? { path: selectedFilePath, isDirectory: false }
				: undefined,
		[selectedFilePath],
	);
	const open = (path: string, openInNewTab?: boolean) => {
		const location = context.store.getState().getPane(context.pane.id);
		if (location) context.store.getState().setActiveTab(location.tabId);
		onOpenFile(path, openInNewTab);
		if (!hasEditor && !openInNewTab && location) {
			context.store
				.getState()
				.resizeSplit({ tabId: location.tabId, path: [], splitPercentage: 28 });
		}
	};
	return (
		<div className="flex h-full min-h-0 min-w-0 flex-1">
			<div
				className={
					hasEditor
						? "flex min-h-0 min-w-0 flex-1 flex-col"
						: "flex min-h-0 w-72 max-w-[45%] shrink-0 flex-col border-r"
				}
			>
				<FilesTab
					workspaceId={workspaceId}
					onSelectFile={open}
					selectedFilePath={selectedFilePath}
					pendingReveal={pendingReveal}
					gitStatus={status.data}
					onSearch={() => openQuickOpenFor({ workspaceId })}
				/>
			</div>
			{!hasEditor && (
				<div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
					<FolderOpen className="size-9 opacity-50" />
					<Trans>Select a file to open</Trans>
				</div>
			)}
		</div>
	);
}
