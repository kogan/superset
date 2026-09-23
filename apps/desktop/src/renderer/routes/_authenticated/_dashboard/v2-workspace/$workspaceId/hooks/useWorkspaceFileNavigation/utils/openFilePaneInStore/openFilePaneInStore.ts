import type { WorkspaceStore } from "@superset/panes";
import type { StoreApi } from "zustand/vanilla";
import type { FilePosition, PaneViewerData } from "../../../../types";
import { openIdePaneInStore } from "../../../../utils/openIdePaneInStore";

export function openFilePaneInStore(
	store: StoreApi<WorkspaceStore<PaneViewerData>>,
	workspaceId: string,
	filePath: string,
	_openInNewTab?: boolean,
	position?: FilePosition,
): void {
	const pendingPosition =
		position && Number.isFinite(position.line)
			? {
					line: Math.max(1, Math.trunc(position.line)),
					column:
						position.column !== undefined && Number.isFinite(position.column)
							? Math.max(1, Math.trunc(position.column))
							: undefined,
				}
			: undefined;
	openIdePaneInStore(store, workspaceId, {
		filePath,
		position: pendingPosition,
	});
}
