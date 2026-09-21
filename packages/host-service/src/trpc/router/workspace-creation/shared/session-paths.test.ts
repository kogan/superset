import { afterEach, describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	defaultSessionsRoot,
	safeResolveSessionPath,
} from "./session-paths.ts";

const previousHome = process.env.SUPERSET_HOME_DIR;

afterEach(() => {
	if (previousHome === undefined) delete process.env.SUPERSET_HOME_DIR;
	else process.env.SUPERSET_HOME_DIR = previousHome;
});

describe("defaultSessionsRoot", () => {
	it("uses the existing Superset folders by default", () => {
		delete process.env.SUPERSET_HOME_DIR;
		expect(defaultSessionsRoot()).toBe(
			join(homedir(), ".superset", "sessions"),
		);
	});

	it("honors SUPERSET_HOME_DIR", () => {
		process.env.SUPERSET_HOME_DIR = "/tmp/superestset-home";
		expect(defaultSessionsRoot()).toBe("/tmp/superestset-home/sessions");
		expect(safeResolveSessionPath("one")).toBe(
			"/tmp/superestset-home/sessions/one",
		);
	});
});
