import { describe, expect, it } from "bun:test";
import { groupIssuesByStatus, type JiraIssue } from "./groupIssuesByStatus";

function issue(id: string, status: string, statusCategory: string): JiraIssue {
	return {
		id,
		key: id,
		summary: id,
		assignee: null,
		pullRequests: [],
		freshdeskLinks: [],
		status,
		statusCategory,
		project: "Team",
		priority: null,
		updated: "2026-09-17T08:00:00Z",
		url: `https://jira.example.com/browse/${id}`,
	};
}

describe("Jira Kanban status columns", () => {
	it("groups custom Jira statuses in workflow category order and preserves ticket order", () => {
		const issues = [
			issue("REV-1", "In Review", "indeterminate"),
			issue("BACK-1", "Backlog", "new"),
			issue("REV-2", "In Review", "indeterminate"),
			issue("PROG-1", "In Progress", "indeterminate"),
		];
		const columns = groupIssuesByStatus(issues);
		expect(columns.map((column) => column.status)).toEqual([
			"Backlog",
			"In Progress",
			"In Review",
		]);
		expect(columns[2]?.issues.map((issue) => issue.id)).toEqual([
			"REV-1",
			"REV-2",
		]);
		expect(issues.map((issue) => issue.id)).toEqual([
			"REV-1",
			"BACK-1",
			"REV-2",
			"PROG-1",
		]);
	});
	it("keeps identically named statuses in different categories separate and retains unknown categories", () => {
		const columns = groupIssuesByStatus([
			issue("A", "Ready", "new"),
			issue("B", "Ready", "indeterminate"),
			issue("C", "Waiting", "custom"),
		]);
		expect(columns).toHaveLength(3);
		expect(new Set(columns.map((column) => column.key)).size).toBe(3);
		expect(columns[2]?.issues[0]?.id).toBe("C");
		expect(groupIssuesByStatus([])).toEqual([]);
	});
});

it("preserves configured column order and groups multiple statuses", () => {
	const columns = groupIssuesByStatus(
		[
			issue("LIVE-1", "Live", "done"),
			issue("DEV-1", "In Development", "indeterminate"),
			issue("QA-1", "Needs QA", "indeterminate"),
			issue("QA-2", "Being QA'd", "indeterminate"),
		],
		[
			{ name: "HPQ", statuses: ["HPQ"] },
			{ name: "On hold / blocked", statuses: ["Blocked/On Hold"] },
			{ name: "In dev", statuses: ["In Development", "Needs QA"] },
			{ name: "QA", statuses: ["Being QA'd"] },
			{ name: "Monitoring", statuses: ["Monitoring"] },
		],
	);
	expect(columns.map((column) => column.status)).toEqual([
		"HPQ",
		"On hold / blocked",
		"In dev",
		"QA",
		"Monitoring",
	]);
	expect(columns[0]?.issues).toEqual([]);
	expect(columns[2]?.issues.map((ticket) => ticket.id)).toEqual([
		"DEV-1",
		"QA-1",
	]);
	expect(columns[3]?.issues.map((ticket) => ticket.id)).toEqual(["QA-2"]);
	expect(
		columns
			.flatMap((column) => column.issues)
			.some((ticket) => ticket.status === "Live"),
	).toBe(false);
});

it("shows empty board columns with stable keys and categories before any issues load", () => {
	const columns = groupIssuesByStatus(
		[],
		[
			{
				key: "board-qa",
				name: "QA",
				statuses: ["Being QA'd"],
				category: "indeterminate",
			},
			{ key: "board-empty", name: "Empty", statuses: [], category: "new" },
		],
	);
	expect(
		columns.map(({ key, status, category, issues }) => ({
			key,
			status,
			category,
			issues,
		})),
	).toEqual([
		{ key: "board-qa", status: "QA", category: "indeterminate", issues: [] },
		{ key: "board-empty", status: "Empty", category: "new", issues: [] },
	]);
});
