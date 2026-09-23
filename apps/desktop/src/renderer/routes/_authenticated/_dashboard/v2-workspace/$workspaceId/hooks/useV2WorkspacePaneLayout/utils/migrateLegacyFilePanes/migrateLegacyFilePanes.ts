import {
	findFirstPaneId,
	type LayoutNode,
	type Pane,
	removePaneFromLayout,
	type Tab,
	type WorkspaceState,
} from "@superset/panes";
import type { SharedFileDocument } from "../../../../state/fileDocumentStore";
import type { FilePosition, PaneViewerData } from "../../../../types";

type RecoveryState = Pick<
	SharedFileDocument,
	"dirty" | "pendingSave" | "conflict" | "orphaned" | "saveError"
>;

export interface MigratedFileRequest {
	sourcePaneId: string;
	paneId: string;
	request: { filePath: string; position?: FilePosition };
}

export function migrateLegacyFilePanes({
	state,
	workspaceId,
	getDocument,
}: {
	state: WorkspaceState<PaneViewerData>;
	workspaceId: string;
	getDocument: (filePath: string) => RecoveryState | null;
}): { state: WorkspaceState<PaneViewerData>; files: MigratedFileRequest[] } {
	const allPanes = state.tabs.flatMap((tab) => Object.values(tab.panes));
	const legacy = allPanes.filter((pane) => {
		if (pane.kind === "file-explorer") return true;
		if (pane.kind !== "file" || !("filePath" in pane.data)) return false;
		const document = getDocument(pane.data.filePath);
		return !(
			document?.dirty ||
			document?.pendingSave ||
			document?.conflict ||
			document?.orphaned ||
			document?.saveError
		);
	});
	if (legacy.length === 0) return { state, files: [] };

	const activePaneId = state.tabs.find(
		(tab) => tab.id === state.activeTabId,
	)?.activePaneId;
	const existingIde = allPanes.find(
		(pane) =>
			pane.kind === "ide" &&
			"kind" in pane.data &&
			pane.data.kind === "ide" &&
			pane.data.workspaceId === workspaceId,
	);
	const target = existingIde ?? legacy[0];
	if (!target) return { state, files: [] };
	const migratedIds = new Set(legacy.map((pane) => pane.id));
	const tabs: Tab<PaneViewerData>[] = [];
	for (const tab of state.tabs) {
		if (!Object.keys(tab.panes).some((id) => migratedIds.has(id))) {
			tabs.push(tab);
			continue;
		}
		const panes: Record<string, Pane<PaneViewerData>> = {};
		let layout: LayoutNode | null = tab.layout;
		for (const pane of Object.values(tab.panes)) {
			if (!migratedIds.has(pane.id)) {
				panes[pane.id] = pane;
			} else if (pane.id === target.id) {
				panes[pane.id] = {
					id: pane.id,
					kind: "ide",
					pinned: pane.pinned,
					data: { kind: "ide", workspaceId },
				};
			} else if (layout) {
				layout = removePaneFromLayout(layout, pane.id);
			}
		}
		if (!layout || Object.keys(panes).length === 0) continue;
		const entirelyMigrated = Object.keys(tab.panes).every((id) =>
			migratedIds.has(id),
		);
		tabs.push({
			...tab,
			titleOverride: entirelyMigrated ? undefined : tab.titleOverride,
			panes,
			layout,
			activePaneId:
				tab.activePaneId && panes[tab.activePaneId]
					? tab.activePaneId
					: findFirstPaneId(layout),
		});
	}

	const filesByPath = new Map<string, MigratedFileRequest>();
	const orderedLegacy = [
		...legacy.filter((pane) => pane.id !== activePaneId),
		...legacy.filter((pane) => pane.id === activePaneId),
	];
	for (const pane of orderedLegacy) {
		if (pane.kind !== "file" || !("filePath" in pane.data)) continue;
		filesByPath.delete(pane.data.filePath);
		filesByPath.set(pane.data.filePath, {
			sourcePaneId: pane.id,
			paneId: target.id,
			request: {
				filePath: pane.data.filePath,
				position: pane.data.pendingPosition,
			},
		});
	}
	const targetTab = tabs.find((tab) => target.id in tab.panes);
	if (activePaneId && migratedIds.has(activePaneId) && targetTab) {
		const index = tabs.indexOf(targetTab);
		tabs[index] = { ...targetTab, activePaneId: target.id };
	}
	const activeTabId =
		activePaneId && migratedIds.has(activePaneId)
			? (targetTab?.id ?? null)
			: tabs.some((tab) => tab.id === state.activeTabId)
				? state.activeTabId
				: (targetTab?.id ?? tabs[0]?.id ?? null);
	return {
		state: { ...state, tabs, activeTabId },
		files: [...filesByPath.values()],
	};
}
