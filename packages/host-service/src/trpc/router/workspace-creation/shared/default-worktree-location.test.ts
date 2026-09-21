import { afterEach, describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	defaultWorktreesRoot,
	projectWorktreesRoot,
} from "./worktree-paths.ts";

const previousHome = process.env.SUPERSET_HOME_DIR;

afterEach(() => {
	if (previousHome === undefined) delete process.env.SUPERSET_HOME_DIR;
	else process.env.SUPERSET_HOME_DIR = previousHome;
});

describe("defaultWorktreesRoot", () => {
	it("uses the existing Superset folders by default", () => {
		delete process.env.SUPERSET_HOME_DIR;
		expect(defaultWorktreesRoot()).toBe(
			join(homedir(), ".superset", "worktrees"),
		);
	});

	it("honors SUPERSET_HOME_DIR", () => {
		process.env.SUPERSET_HOME_DIR = "/tmp/superestset-home";
		expect(defaultWorktreesRoot()).toBe("/tmp/superestset-home/worktrees");
		expect(projectWorktreesRoot("project-id")).toBe(
			"/tmp/superestset-home/worktrees/project-id",
		);
	});
});
