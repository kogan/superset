import { expect, test } from "bun:test";
import { resolveNames } from "renderer/routes/_authenticated/components/DashboardNewWorkspaceModal/components/DashboardNewWorkspaceForm/PromptGroup/hooks/useSubmitWorkspace/resolveNames";
import { useNewWorkspaceDraftStore } from "renderer/stores/new-workspace-draft";
import { jiraWorkspaceDraft } from "./jiraWorkspaceDraft";

const issue = {
	key: "TEAM-12",
	summary: "Fix [] unsafe / branch: name?",
	url: "https://jira.example/context/browse/TEAM-12",
};
const context = {
	issueKey: issue.key,
	baseUrl: "https://jira.example/context",
	connectionRevision: "revision",
};
test("seeds editable ticket context through the existing branch sanitizer without choosing a project or checkout", () => {
	const patch = jiraWorkspaceDraft(issue, context);
	expect(patch.selectedProjectId).toBeUndefined();
	expect(patch.checkout).toBeUndefined();
	expect(patch.hostId).toBeUndefined();
	expect(patch.prompt).toContain(issue.key);
	expect(patch.prompt).toContain(issue.url);
	expect(patch.workspaceName).toBe(issue.summary);
	expect(patch.linkedIssues).toEqual([
		{
			source: "jira",
			slug: issue.key,
			title: issue.summary,
			url: issue.url,
			connectionRevision: "revision",
		},
	]);
	const names = resolveNames({
		...useNewWorkspaceDraftStore.getState(),
		...patch,
	});
	expect(names.branchName?.startsWith("team-12-")).toBe(true);
	expect(names.branchName).not.toMatch(/[[\] ?:]/);
});
test("refuses a ticket from another Jira site or issue key", () => {
	expect(() =>
		jiraWorkspaceDraft(issue, { ...context, baseUrl: "https://other.example" }),
	).toThrow();
	expect(() =>
		jiraWorkspaceDraft(issue, { ...context, issueKey: "TEAM-13" }),
	).toThrow();
});
