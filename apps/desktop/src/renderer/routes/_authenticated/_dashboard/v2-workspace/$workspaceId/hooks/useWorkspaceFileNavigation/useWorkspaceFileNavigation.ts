import type { WorkspaceStore } from "@superset/panes";
import { workspaceTrpc } from "@superset/workspace-client";
import { useCallback, useMemo } from "react";
import { useWorkspace } from "renderer/routes/_authenticated/_dashboard/v2-workspace/providers/WorkspaceProvider";
import {
	isWithinWorkspacePath,
	toAbsoluteWorkspacePath,
	toRelativeWorkspacePath,
} from "shared/absolute-paths";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { FilePaneData, OpenFile, PaneViewerData } from "../../types";
import { openIdePaneInStore } from "../../utils/openIdePaneInStore";
import {
	type RecentFile,
	useRecentlyViewedFiles,
} from "../useRecentlyViewedFiles";
import { useRevealInFinder } from "../useRevealInFinder";
import { openFilePaneInStore } from "./utils/openFilePaneInStore";

export function useWorkspaceFileNavigation({
	store,
}: {
	store: StoreApi<WorkspaceStore<PaneViewerData>>;
}): {
	openFilePane: OpenFile;
	revealPath: (
		path: string,
		options?: {
			isDirectory?: boolean;
		},
	) => void;
	recentFiles: RecentFile[];
	openFilePaths: Set<string>;
} {
	const { workspace } = useWorkspace();
	const workspaceQuery = workspaceTrpc.workspace.get.useQuery({
		id: workspace.id,
	});
	const worktreePath = workspaceQuery.data?.worktreePath ?? "";

	const { recentFiles, recordView } = useRecentlyViewedFiles(workspace.id);
	const revealInFinder = useRevealInFinder(workspace.id);

	const openFilePathsKey = useStore(store, (state) =>
		state.tabs
			.flatMap((tab) =>
				Object.values(tab.panes)
					.filter((pane) => pane.kind === "file")
					.map((pane) => (pane.data as FilePaneData).filePath),
			)
			.join("\u0000"),
	);
	const openFilePaths = useMemo(
		() => new Set(openFilePathsKey ? openFilePathsKey.split("\u0000") : []),
		[openFilePathsKey],
	);

	const openFilePane = useCallback<OpenFile>(
		(filePath, openInNewTab, position) => {
			const absoluteFilePath = worktreePath
				? toAbsoluteWorkspacePath(worktreePath, filePath)
				: filePath;
			if (worktreePath) {
				const relativePath = toRelativeWorkspacePath(
					worktreePath,
					absoluteFilePath,
				);
				if (relativePath && relativePath !== ".") {
					recordView({ relativePath, absolutePath: absoluteFilePath });
				}
			}
			openFilePaneInStore(
				store,
				workspace.id,
				absoluteFilePath,
				openInNewTab,
				position,
			);
		},
		[store, workspace.id, worktreePath, recordView],
	);

	const revealPath = useCallback(
		(path: string, options?: { isDirectory?: boolean }) => {
			const isDirectory = options?.isDirectory === true;
			if (worktreePath && !isWithinWorkspacePath(worktreePath, path)) {
				revealInFinder(path, { isDirectory });
				return;
			}
			if (isDirectory) openIdePaneInStore(store, workspace.id);
			else openFilePane(path);
		},
		[store, worktreePath, revealInFinder, workspace.id, openFilePane],
	);

	return {
		openFilePane,
		revealPath,
		recentFiles,
		openFilePaths,
	};
}
