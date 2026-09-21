import { msg } from "@lingui/core/macro";
import { i18n } from "@superset/i18n";
import { deriveBranchName } from "renderer/routes/_authenticated/utils/deriveBranchName";
import type { NewWorkspaceDraft } from "renderer/stores/new-workspace-draft";
import type { JiraIssue } from "../JiraKanban/utils/groupIssuesByStatus";
export function jiraWorkspaceDraft(
	issue: Pick<JiraIssue, "key" | "summary" | "url">,
	context: { issueKey: string; baseUrl: string; connectionRevision: string },
): Partial<NewWorkspaceDraft> {
	if (
		issue.key !== context.issueKey ||
		new URL(`browse/${encodeURIComponent(issue.key)}`, `${context.baseUrl}/`)
			.href !== issue.url
	)
		throw new Error(
			i18n._(
				msg({
					message:
						"This transition is no longer available. Refresh the issue and try again.",
				}),
			),
		);
	return {
		prompt: `${issue.key}: ${issue.summary}\n${issue.url}`,
		branchName: deriveBranchName({ slug: issue.key, title: issue.summary }),
		branchNameEdited: true,
		branchNameFromProvider: false,
		workspaceName: issue.summary,
		workspaceNameEdited: true,
		linkedIssues: [
			{
				source: "jira",
				slug: issue.key,
				title: issue.summary,
				url: issue.url,
				connectionRevision: context.connectionRevision,
			},
		],
	};
}
