import type { JiraColumnLayout } from "lib/trpc/routers/jira/jira-schema";
import { groupIssuesByStatus } from "../../components/JiraKanban/utils/groupIssuesByStatus";

export function applyColumnLayout<
	Column extends { key: string; layoutKeys?: string[] },
>(
	columns: readonly Column[],
	layout: JiraColumnLayout = [],
): (Column & { visible: boolean })[] {
	return columns
		.map((column, index) => {
			const exact = layout.findIndex((entry) => entry.key === column.key);
			const matches = layout.flatMap((entry, position) =>
				column.layoutKeys?.includes(entry.key) ? [{ ...entry, position }] : [],
			);
			return {
				column: {
					...column,
					visible:
						exact >= 0
							? layout[exact].visible
							: matches.length === 0 || matches.some((entry) => entry.visible),
				},
				position:
					exact >= 0 ? exact : (matches[0]?.position ?? layout.length + index),
			};
		})
		.sort((a, b) => a.position - b.position)
		.map(({ column }) => column);
}

export function mergeColumnLayout(
	draft: JiraColumnLayout,
	saved: JiraColumnLayout,
): JiraColumnLayout {
	const keys = new Set(draft.map(({ key }) => key));
	return [...draft, ...saved.filter(({ key }) => !keys.has(key))];
}

export function getVisibleBoardStatuses(
	columns: Parameters<typeof groupIssuesByStatus>[1],
	layout: JiraColumnLayout = [],
): string[] {
	const visibleColumns = applyColumnLayout(
		groupIssuesByStatus([], columns),
		layout,
	).filter((column) => column.visible);
	return [
		...new Set(visibleColumns.flatMap((column) => column.statuses)),
	].sort();
}
