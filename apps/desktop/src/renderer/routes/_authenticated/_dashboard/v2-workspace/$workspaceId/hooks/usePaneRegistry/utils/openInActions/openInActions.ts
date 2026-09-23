import { msg } from "@lingui/core/macro";
import { i18n } from "@superset/i18n";
import type { ContextMenuActionConfig, RendererContext } from "@superset/panes";
import type { PaneViewerData } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types";
import { isWithinWorkspacePath } from "shared/absolute-paths";
import { terminalContextMenuLinkStore } from "../../components/TerminalPane/contextMenuLinkStore";
import {
	runFileLinkAction,
	runFolderLinkAction,
	runUrlLinkAction,
} from "../runTerminalLinkAction";

const URL_LABELS = [
	msg({ message: "Split Pane" }),
	msg({ message: "New Tab" }),
	msg({ message: "External Browser" }),
] as const;

const FILE_LABELS = [
	msg({ message: "IDE" }),
	msg({ message: "Editor" }),
] as const;

const FOLDER_LABELS = [
	msg({ message: "IDE" }),
	msg({ message: "Editor" }),
	msg({ message: "Finder" }),
] as const;

export function openInActions(
	ctx: RendererContext<PaneViewerData>,
): ContextMenuActionConfig<PaneViewerData>[] {
	const entry = terminalContextMenuLinkStore.get(ctx.pane.id);
	const link = entry?.link;
	if (!entry || !link) return [];

	if (link.kind === "url") {
		const { url } = link;
		return [
			{
				key: "open-in-pane",
				label: i18n._(URL_LABELS[0]),
				onSelect: () => runUrlLinkAction(entry.deps, url, "pane"),
			},
			{
				key: "open-in-new-tab",
				label: i18n._(URL_LABELS[1]),
				onSelect: () => runUrlLinkAction(entry.deps, url, "newTab"),
			},
			{
				key: "open-in-external",
				label: i18n._(URL_LABELS[2]),
				onSelect: () => runUrlLinkAction(entry.deps, url, "external"),
			},
		];
	}

	const path = link.resolvedPath;
	if (!path) return [];

	if (link.isDirectory) {
		const canReveal =
			!entry.deps.worktreePath ||
			isWithinWorkspacePath(entry.deps.worktreePath, path);
		return [
			...(canReveal
				? [
						{
							key: "open-in-ide",
							label: i18n._(FOLDER_LABELS[0]),
							onSelect: () => runFolderLinkAction(entry.deps, path, "reveal"),
						},
					]
				: []),
			{
				key: "open-in-editor",
				label: i18n._(FOLDER_LABELS[1]),
				onSelect: () => runFolderLinkAction(entry.deps, path, "external"),
			},
			{
				key: "open-in-finder",
				label: i18n._(FOLDER_LABELS[2]),
				onSelect: () => runFolderLinkAction(entry.deps, path, "finder"),
			},
		];
	}

	const file = { path, row: link.row, col: link.col };
	return [
		{
			key: "open-in-ide",
			label: i18n._(FILE_LABELS[0]),
			onSelect: () => runFileLinkAction(entry.deps, file, "pane"),
		},
		{
			key: "open-in-editor",
			label: i18n._(FILE_LABELS[1]),
			onSelect: () => runFileLinkAction(entry.deps, file, "external"),
		},
	];
}
