import { describe, expect, it } from "bun:test";
import type { LayoutNode, Pane, Tab, WorkspaceState } from "@superset/panes";
import type { PaneViewerData } from "../../../../types";
import { migrateLegacyFilePanes } from "./migrateLegacyFilePanes";

function file(id: string, path = `/${id}.ts`): Pane<PaneViewerData> {
	return { id, kind: "file", data: { filePath: path, mode: "editor" } };
}

function tab(id: string, panes: Pane<PaneViewerData>[]): Tab<PaneViewerData> {
	const first = panes[0];
	if (!first) throw new Error("Test tabs require a pane");
	const layout = panes.slice(1).reduce<LayoutNode>(
		(first, pane) => ({
			type: "split",
			direction: "horizontal",
			first,
			second: { type: "pane", paneId: pane.id },
		}),
		{ type: "pane", paneId: first.id },
	);
	return {
		id,
		createdAt: 0,
		activePaneId: first.id,
		layout,
		panes: Object.fromEntries(panes.map((pane) => [pane.id, pane])),
	};
}

function state(tabs: Tab<PaneViewerData>[]): WorkspaceState<PaneViewerData> {
	return { version: 1, tabs, activeTabId: tabs[0]?.id ?? null };
}

const clean = {
	dirty: false,
	pendingSave: false,
	conflict: null,
	orphaned: false,
	saveError: null,
};

describe("migrateLegacyFilePanes", () => {
	it("consolidates saved files and the explorer into one IDE and queues positions", () => {
		const located = file("second");
		located.data = {
			filePath: "/second.ts",
			mode: "editor",
			pendingPosition: { line: 12, column: 3 },
		};
		const input = state([
			{
				...tab("files", [
					{
						id: "explorer",
						kind: "file-explorer",
						data: { kind: "file-explorer" },
					},
				]),
				titleOverride: "Files",
			},
			tab("first", [file("first")]),
			tab("second", [located]),
		]);
		input.activeTabId = "second";
		const result = migrateLegacyFilePanes({
			state: input,
			workspaceId: "worktree",
			getDocument: () => null,
		});
		expect(result.state.tabs).toHaveLength(1);
		expect(result.state.tabs[0]?.panes.explorer?.data).toEqual({
			kind: "ide",
			workspaceId: "worktree",
		});
		expect(result.state.tabs[0]?.titleOverride).toBeUndefined();
		expect(result.state.activeTabId).toBe("files");
		expect(result.files.map((file) => file.request)).toEqual([
			{ filePath: "/first.ts", position: undefined },
			{ filePath: "/second.ts", position: { line: 12, column: 3 } },
		]);
		expect(input.tabs).toHaveLength(3);
		expect(
			migrateLegacyFilePanes({
				state: result.state,
				workspaceId: "worktree",
				getDocument: () => null,
			}).state,
		).toBe(result.state);
	});

	it("uses the current worktree IDE and preserves IDEs moved from other worktrees", () => {
		const input = state([
			tab("legacy", [file("old")]),
			tab("other", [
				{
					id: "foreign",
					kind: "ide",
					data: { kind: "ide", workspaceId: "other" },
				},
			]),
			tab("current", [
				{ id: "terminal", kind: "terminal", data: { terminalId: "terminal" } },
				{
					id: "ide",
					kind: "ide",
					data: { kind: "ide", workspaceId: "worktree" },
				},
			]),
		]);
		const result = migrateLegacyFilePanes({
			state: input,
			workspaceId: "worktree",
			getDocument: () => null,
		});
		expect(result.state.tabs.map((tab) => tab.id)).toEqual([
			"other",
			"current",
		]);
		expect(result.state.tabs[0]).toBe(input.tabs[1]);
		expect(result.state.tabs[1]?.activePaneId).toBe("ide");
		expect(result.state.activeTabId).toBe("current");
		expect(result.files[0]?.paneId).toBe("ide");
	});

	it.each([
		{ ...clean, dirty: true },
		{ ...clean, pendingSave: true },
		{ ...clean, conflict: { diskContent: "changed" } },
		{ ...clean, orphaned: true },
		{ ...clean, saveError: new Error("Save failed") },
	])("retains recovery documents while converting clean siblings", (document) => {
		const recovery = file("recovery");
		const input = state([tab("split", [recovery, file("saved")])]);
		const result = migrateLegacyFilePanes({
			state: input,
			workspaceId: "worktree",
			getDocument: (path) => (path === "/recovery.ts" ? document : clean),
		});
		expect(result.state.tabs[0]?.panes.recovery).toBe(recovery);
		expect(result.state.tabs[0]?.panes.saved?.kind).toBe("ide");
		expect(result.state.tabs[0]?.activePaneId).toBe("recovery");
		expect(result.files.map((file) => file.request.filePath)).toEqual([
			"/saved.ts",
		]);
		const afterSave = migrateLegacyFilePanes({
			state: result.state,
			workspaceId: "worktree",
			getDocument: () => clean,
		});
		expect(Object.keys(afterSave.state.tabs[0]?.panes ?? {})).toEqual([
			"saved",
		]);
		expect(afterSave.files[0]?.request.filePath).toBe("/recovery.ts");
	});

	it("deduplicates file requests and focuses the active file last", () => {
		const input = state([
			tab("active", [file("active", "/same.ts")]),
			tab("other", [file("other"), file("duplicate", "/same.ts")]),
		]);
		const result = migrateLegacyFilePanes({
			state: input,
			workspaceId: "worktree",
			getDocument: () => null,
		});
		expect(result.files.map((file) => file.request.filePath)).toEqual([
			"/other.ts",
			"/same.ts",
		]);
		expect(result.files[1]?.sourcePaneId).toBe("active");
	});
});
