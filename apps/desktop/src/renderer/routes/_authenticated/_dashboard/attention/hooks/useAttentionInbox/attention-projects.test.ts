import { describe, expect, test } from "bun:test";
import type { ProjectQueryTarget } from "../../../hooks/useProjectQueryTargets/useProjectQueryTargets";
import { selectAttentionProjectTargets } from "./attention-projects";

type Selection = Parameters<typeof selectAttentionProjectTargets>[0];
const copy: ProjectQueryTarget = {
	projectId: "a-copy",
	projectName: "Copias anteriores",
	hostId: "host",
	hostUrl: "http://localhost:1234",
};
const current: ProjectQueryTarget = {
	...copy,
	projectId: "z-current",
	projectName: "Current project",
};
const projects: Selection["projects"] = [
	{ projectKey: copy.projectId, repoOwner: "owner", repoName: "repo" },
	{ projectKey: current.projectId, repoOwner: "Owner", repoName: "Repo" },
];
const workspaces: Selection["workspaces"] = [
	{ projectId: copy.projectId, tags: ["previous-copies"] },
	{ projectId: current.projectId, tags: [] },
];

describe("attention project selection", () => {
	test("uses the current project for a duplicate repo regardless of labels or input order", () => {
		for (const targets of [
			[copy, current],
			[current, copy],
		]) {
			expect(
				selectAttentionProjectTargets({ targets, projects, workspaces }),
			).toEqual([current]);
		}
	});
	test("keeps a previous copy when it is the only project for a repo", () => {
		expect(
			selectAttentionProjectTargets({ targets: [copy], projects, workspaces }),
		).toEqual([copy]);
	});
	test("keeps separate repositories and targets served by different hosts", () => {
		const other = { ...current, projectId: "other", hostId: "another-host" };
		const differentRepo = { ...current, projectId: "different-repo" };
		const selected = selectAttentionProjectTargets({
			targets: [copy, current, other, differentRepo],
			projects: [
				...projects,
				{ projectKey: "other", repoOwner: "owner", repoName: "repo" },
				{
					projectKey: "different-repo",
					repoOwner: "owner",
					repoName: "another-repo",
				},
			],
			workspaces,
		});
		expect(selected).toHaveLength(3);
		expect(selected).toContainEqual(current);
		expect(selected).toContainEqual(other);
		expect(selected).toContainEqual(differentRepo);
	});
	test("does not merge projects whose repository identity is unknown", () => {
		expect(
			selectAttentionProjectTargets({
				targets: [copy, current],
				projects: projects.map((project) => ({
					...project,
					repoOwner: null,
					repoName: null,
				})),
				workspaces,
			}),
		).toHaveLength(2);
	});
	test("a mixed project remains current when only some workspaces are previous copies", () => {
		expect(
			selectAttentionProjectTargets({
				targets: [current, copy],
				projects,
				workspaces: [...workspaces, { projectId: copy.projectId, tags: [] }],
			}),
		).toEqual([copy]);
	});
	test("prefers an available target if its duplicate cannot be reached", () => {
		expect(
			selectAttentionProjectTargets({
				targets: [copy, { ...current, hostUrl: null }],
				projects,
				workspaces,
			}),
		).toEqual([copy]);
	});
});
