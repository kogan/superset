import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createWorkspaceStore, type WorkspaceStore } from "@superset/panes";
import { useFeaturePreferences } from "renderer/stores/feature-preferences";
import type { StoreApi } from "zustand/vanilla";
import type { PaneViewerData } from "../../../../types";
import { ideRuntimeRegistry } from "../../../usePaneRegistry/components/IdePane/ideRuntimeRegistry";
import { openFilePaneInStore } from "./openFilePaneInStore";

const stores: Array<StoreApi<WorkspaceStore<PaneViewerData>>> = [];
function makeStore() {
	const store = createWorkspaceStore<PaneViewerData>();
	store.getState().addTab({
		panes: [{ kind: "terminal", data: { terminalId: "terminal" } }],
	});
	stores.push(store);
	return store;
}

beforeEach(() =>
	useFeaturePreferences.getState().setEnabled("embeddedIde", true),
);
afterEach(async () => {
	for (const store of stores.splice(0)) {
		for (const tab of store.getState().tabs) {
			for (const pane of Object.values(tab.panes))
				await ideRuntimeRegistry.close(pane.id);
		}
	}
	useFeaturePreferences.getState().setEnabled("embeddedIde", true);
});

describe("openFilePaneInStore", () => {
	it.each([
		false,
		true,
	])("opens files in the workspace IDE without persisting the navigation request (new tab: %s)", (newTab) => {
		const store = makeStore();
		openFilePaneInStore(store, "workspace-a", "/test.md", newTab, {
			line: 42,
			column: 7,
		});
		const active = store.getState().getActivePane();
		if (!active) throw new Error("Expected an active IDE pane");
		expect(active.pane.kind).toBe("ide");
		expect(active.pane.data).toEqual({
			kind: "ide",
			workspaceId: "workspace-a",
		});
		expect(ideRuntimeRegistry.getPendingFile(active.pane.id)).toEqual({
			filePath: "/test.md",
			position: { line: 42, column: 7 },
		});
		expect(store.getState().tabs).toHaveLength(2);
	});
	it("reuses the originating workspace IDE and preserves its pane data", () => {
		const store = makeStore();
		store.getState().addTab({
			panes: [
				{
					id: "other-ide",
					kind: "ide",
					data: { kind: "ide", workspaceId: "workspace-b" },
				},
			],
		});
		openFilePaneInStore(store, "workspace-a", "/first.ts", true);
		const first = store.getState().getActivePane();
		if (!first) throw new Error("Expected an active IDE pane");
		const firstTab = store.getState().tabs[0];
		if (!firstTab) throw new Error("Expected the terminal tab");
		store.getState().setActiveTab(firstTab.id);
		openFilePaneInStore(store, "workspace-a", "/second.ts", true);
		const active = store.getState().getActivePane();
		expect(active?.pane.id).toBe(first.pane.id);
		expect(active?.pane.data).toBe(first.pane.data);
		expect(ideRuntimeRegistry.getPendingFile("other-ide")).toBeNull();
		expect(store.getState().tabs).toHaveLength(3);
	});
	it("normalizes invalid positions before queuing them", () => {
		const store = makeStore();
		openFilePaneInStore(store, "workspace-a", "/test.ts", false, {
			line: -3.5,
			column: -8,
		});
		const active = store.getState().getActivePane();
		if (!active) throw new Error("Expected an active IDE pane");
		expect(ideRuntimeRegistry.getPendingFile(active.pane.id)?.position).toEqual(
			{ line: 1, column: 1 },
		);
	});
	it("does not create an editor or queue a file while disabled", () => {
		const store = makeStore();
		useFeaturePreferences.getState().setEnabled("embeddedIde", false);
		openFilePaneInStore(store, "workspace-a", "/test.ts");
		expect(store.getState().tabs).toHaveLength(1);
		expect(store.getState().getActivePane()?.pane.kind).toBe("terminal");
	});
});
