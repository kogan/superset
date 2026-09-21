import { expect, mock, test } from "bun:test";
import type { LinkedIssue } from "renderer/stores/new-workspace-draft";
import type { SubmitOutcome } from "renderer/stores/workspace-creates/useWorkspaceCreates";
import { linkCreatedJiraWorkspace } from "./linkCreatedJiraWorkspace";

const linkedIssues: LinkedIssue[] = [
	{
		source: "jira",
		slug: "TEAM-12",
		title: "Issue",
		url: "https://jira.example/browse/TEAM-12",
		connectionRevision: "old-connection",
	},
];
test("waits for confirmed creation and links the canonical ID on the captured host and connection", async () => {
	let finish!: (outcome: SubmitOutcome) => void;
	const completed = new Promise<SubmitOutcome>((resolve) => {
		finish = resolve;
	});
	const link = mock(async () => {});
	const refresh = mock(async () => {});
	const pending = linkCreatedJiraWorkspace({
		linkedIssues,
		hostId: "host-a",
		completed,
		link,
		refresh,
	});
	await Promise.resolve();
	expect(link).not.toHaveBeenCalled();
	finish({ ok: true, workspaceId: "canonical-id" });
	await pending;
	expect(link).toHaveBeenCalledWith({
		issueKey: "TEAM-12",
		connectionRevision: "old-connection",
		workspaceId: "canonical-id",
		hostId: "host-a",
		linked: true,
	});
	expect(refresh).toHaveBeenCalledTimes(1);
});
test("canceled or failed creation never links", async () => {
	const link = mock(async () => {});
	const refresh = mock(async () => {});
	await linkCreatedJiraWorkspace({
		linkedIssues,
		hostId: "host-a",
		completed: Promise.resolve({ ok: false, error: "Canceled" }),
		link,
		refresh,
	});
	expect(link).not.toHaveBeenCalled();
	expect(refresh).not.toHaveBeenCalled();
});
test("removed Jira context and unrelated issues never link", async () => {
	const link = mock(async () => {});
	const refresh = mock(async () => {});
	await linkCreatedJiraWorkspace({
		linkedIssues: [{ source: "internal", slug: "OTHER-1", title: "Other" }],
		hostId: "host-a",
		completed: Promise.resolve({ ok: true, workspaceId: "id" }),
		link,
		refresh,
	});
	expect(link).not.toHaveBeenCalled();
	expect(refresh).not.toHaveBeenCalled();
});
test("reports link failure without retrying or reporting creation failure", async () => {
	const link = mock(async () => {
		throw new Error("Connection changed");
	});
	const refresh = mock(async () => {});
	await expect(
		linkCreatedJiraWorkspace({
			linkedIssues,
			hostId: "host-a",
			completed: Promise.resolve({ ok: true, workspaceId: "id" }),
			link,
			refresh,
		}),
	).rejects.toThrow("Connection changed");
	expect(link).toHaveBeenCalledTimes(1);
	expect(refresh).not.toHaveBeenCalled();
});
