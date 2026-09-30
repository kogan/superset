import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { buildDeletionSkillCommand } from "./worktree-deletion";

describe("deletion skill command", () => {
	test.each([
		"claude",
		"codex",
	] as const)("%s forks the selected history in a separate noninteractive session", (agent) => {
		const command = buildDeletionSkillCommand({
			command: "/usr/bin/printf",
			baseArgs: ["%s\n"],
			completionPath: "/tmp/test-skill-completion",
			action: {
				type: "skill",
				agent,
				name: "work-note",
				instructions: "Record 'quotes', $(printf unsafe), and `printf unsafe`.",
			},
			worktreePath: "/tmp/worktree's dir",
			sessionId: "existing-session-id",
		});
		const result = spawnSync("/bin/bash", ["-c", command], {
			encoding: "utf8",
		});
		expect(result.status).toBe(0);
		expect(result.stdout).toStartWith(
			agent === "claude"
				? "-p\n--resume\nexisting-session-id\n--fork-session\n/work-note"
				: "exec\nfork\nexisting-session-id\n$work-note",
		);
		expect(result.stdout).toContain(
			"Record 'quotes', $(printf unsafe), and `printf unsafe`.",
		);
		expect(result.stdout).toContain("/tmp/worktree's dir");
	});
	test("a new run gets repository context without resuming an unrelated session", () => {
		const command = buildDeletionSkillCommand({
			command: "/usr/bin/printf",
			baseArgs: ["%s\n"],
			completionPath: "/tmp/test-skill-completion",
			action: {
				type: "skill",
				agent: "claude",
				name: "work-note",
				instructions: "",
			},
			worktreePath: "/tmp/worktree",
		});
		const result = spawnSync("/bin/bash", ["-c", command], {
			encoding: "utf8",
		});
		expect(result.stdout).toStartWith("-p\n/work-note");
		expect(result.stdout).toContain("No prior session");
		expect(result.stdout).not.toContain("--resume");
	});
});
