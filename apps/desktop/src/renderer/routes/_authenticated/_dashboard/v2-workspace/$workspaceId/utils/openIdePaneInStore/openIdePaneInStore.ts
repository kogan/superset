import { msg } from "@lingui/core/macro";
import { i18n } from "@superset/i18n";
import type { WorkspaceStore } from "@superset/panes";
import { toast } from "@superset/ui/sonner";
import { useFeaturePreferences } from "renderer/stores/feature-preferences";
import type { StoreApi } from "zustand/vanilla";
import {
	type IdeFileRequest,
	ideRuntimeRegistry,
} from "../../hooks/usePaneRegistry/components/IdePane/ideRuntimeRegistry";
import type { PaneViewerData } from "../../types";

export function openIdePaneInStore(
	store: StoreApi<WorkspaceStore<PaneViewerData>>,
	workspaceId: string,
	request?: IdeFileRequest,
): string | null {
	if (!useFeaturePreferences.getState().embeddedIde) {
		toast.error(
			i18n._(
				msg({
					message: "Enable Embedded IDE in Settings > General > Features.",
				}),
			),
		);
		return null;
	}
	const state = store.getState();
	for (const tab of state.tabs) {
		for (const pane of Object.values(tab.panes)) {
			if (
				pane.kind !== "ide" ||
				!("workspaceId" in pane.data) ||
				pane.data.workspaceId !== workspaceId
			)
				continue;
			if (request) ideRuntimeRegistry.queueFile(pane.id, request);
			state.setActiveTab(tab.id);
			state.setActivePane({ tabId: tab.id, paneId: pane.id });
			return pane.id;
		}
	}
	const paneId = crypto.randomUUID();
	if (request) ideRuntimeRegistry.queueFile(paneId, request);
	state.addTab({
		panes: [{ id: paneId, kind: "ide", data: { kind: "ide", workspaceId } }],
	});
	return paneId;
}
