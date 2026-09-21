import type { electronTrpcClient } from "renderer/lib/trpc-client";
import type { LinkedIssue } from "renderer/stores/new-workspace-draft";
import type { SubmitOutcome } from "renderer/stores/workspace-creates/useWorkspaceCreates";

type LinkInput = Parameters<
	typeof electronTrpcClient.jira.setWorkspaceLink.mutate
>[0];
export async function linkCreatedJiraWorkspace({
	linkedIssues,
	hostId,
	completed,
	link,
	refresh,
}: {
	linkedIssues: readonly LinkedIssue[];
	hostId: string;
	completed: Promise<SubmitOutcome>;
	link: (input: LinkInput) => Promise<unknown>;
	refresh: () => Promise<unknown>;
}) {
	const outcome = await completed;
	if (!outcome.ok) return;
	let linked = false;
	for (const issue of linkedIssues) {
		if (issue.source !== "jira") continue;
		await link({
			issueKey: issue.slug,
			connectionRevision: issue.connectionRevision,
			workspaceId: outcome.workspaceId,
			hostId,
			linked: true,
		});
		linked = true;
	}
	if (linked) await refresh();
}
