import type { JiraColumnLayout } from "lib/trpc/routers/jira/jira-schema";

export function applyColumnLayout<Column extends { key: string }>(
	columns: readonly Column[],
	layout: JiraColumnLayout = [],
): (Column & { visible: boolean })[] {
	const remaining = new Map(columns.map((column) => [column.key, column]));
	const ordered: (Column & { visible: boolean })[] = [];
	for (const entry of layout) {
		const column = remaining.get(entry.key);
		if (column) {
			ordered.push({ ...column, visible: entry.visible });
			remaining.delete(entry.key);
		}
	}
	return [
		...ordered,
		...[...remaining.values()].map((column) => ({ ...column, visible: true })),
	];
}

export function mergeColumnLayout(
	draft: JiraColumnLayout,
	saved: JiraColumnLayout,
): JiraColumnLayout {
	const keys = new Set(draft.map(({ key }) => key));
	return [...draft, ...saved.filter(({ key }) => !keys.has(key))];
}
