import type { JiraColumn } from "lib/trpc/routers/jira/jira-schema";
import type { electronTrpcClient } from "renderer/lib/trpc-client";

export type JiraIssue = Awaited<
	ReturnType<typeof electronTrpcClient.jira.listIssues.query>
>["issues"][number];

export type StatusColumn = {
	key: string;
	layoutKeys?: string[];
	status: string;
	statuses: string[];
	category: string;
	issues: JiraIssue[];
};
const categoryOrder: Record<string, number> = {
	new: 0,
	indeterminate: 1,
	done: 2,
};

export function groupIssuesByStatus(
	issues: JiraIssue[],
	configuredColumns?: (JiraColumn & { key?: string; category?: string })[],
): StatusColumn[] {
	if (configuredColumns) {
		return configuredColumns.map((column) => {
			const matches = issues.filter((issue) =>
				column.statuses.includes(issue.status),
			);
			return {
				key: column.key ?? JSON.stringify(column.statuses),
				layoutKeys: [
					JSON.stringify(column.statuses),
					...column.statuses.flatMap((status) =>
						Object.keys(categoryOrder).map((category) =>
							JSON.stringify([category, status]),
						),
					),
				],
				status: column.name,
				statuses: column.statuses,
				category: column.category ?? matches[0]?.statusCategory ?? "new",
				issues: matches,
			};
		});
	}
	const columns = new Map<string, StatusColumn>();
	for (const issue of issues) {
		const key = JSON.stringify([issue.statusCategory, issue.status]);
		const column = columns.get(key);
		if (column) column.issues.push(issue);
		else
			columns.set(key, {
				key,
				status: issue.status,
				statuses: [issue.status],
				category: issue.statusCategory,
				issues: [issue],
			});
	}
	return [...columns.values()].sort(
		(a, b) =>
			(categoryOrder[a.category] ?? 3) - (categoryOrder[b.category] ?? 3) ||
			a.status.localeCompare(b.status),
	);
}
