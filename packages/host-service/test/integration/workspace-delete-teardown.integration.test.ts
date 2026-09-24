import { afterEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Server } from "@superset/pty-daemon";
import { externalWorkspacePaths } from "../../src/db/schema";
import { disposeDaemonClient } from "../../src/terminal/daemon-client-singleton";
import {
	initTerminalBaseEnv,
	resetTerminalBaseEnvForTests,
} from "../../src/terminal/env";
import { __resetSessionsForTesting } from "../../src/terminal/terminal";
import { __setAccountShellForTesting } from "../../src/terminal/user-shell";
import { cloudFlows } from "../helpers/cloud-fakes";
import { createFishLikePtySpawner, shellQuote } from "../helpers/fake-pty";
import {
	createFeatureWorktreeScenario,
	type FeatureWorktreeScenario,
} from "../helpers/scenarios";

/**
 * Regression coverage for #6174: the external delete surface (CLI/SDK/MCP →
 * `workspace.delete`) hardcodes `force: true` for its non-interactive git
 * semantics, but teardown must still run — silently skipping it leaks the
 * resources the script provisions.
 */
describe("workspace delete teardown integration", () => {
	let scenario: FeatureWorktreeScenario | null = null;
	let server: Server | null = null;
	let tmp: string | null = null;

	afterEach(async () => {
		__resetSessionsForTesting();
		await disposeDaemonClient();
		resetTerminalBaseEnvForTests();
		__setAccountShellForTesting(undefined);
		delete process.env.SUPERSET_PTY_DAEMON_SOCKET;
		delete process.env.SUPERSET_HOME_DIR;
		if (server) {
			await server.close().catch(() => {});
			server = null;
		}
		if (scenario) {
			await scenario.dispose();
			scenario = null;
		}
		if (tmp) {
			rmSync(tmp, { recursive: true, force: true });
			tmp = null;
		}
	});

	async function setup(teardownScript: string): Promise<{
		scenario: FeatureWorktreeScenario;
		markerPath: string;
	}> {
		tmp = mkdtempSync(join(tmpdir(), "host-service-delete-teardown-it-"));
		const socketPath = join(tmp, "pty-daemon.sock");
		server = new Server({
			socketPath,
			daemonVersion: "0.0.0-delete-teardown-integration-test",
			spawnPty: createFishLikePtySpawner([]),
		});
		await server.listen();

		process.env.SUPERSET_PTY_DAEMON_SOCKET = socketPath;
		process.env.SUPERSET_HOME_DIR = tmp;
		__setAccountShellForTesting("/bin/bash");
		initTerminalBaseEnv({
			HOME: process.env.HOME ?? tmp,
			LANG: "en_US.UTF-8",
			PATH: process.env.PATH ?? "/usr/bin:/bin",
			SHELL: "/bin/bash",
		});

		scenario = await createFeatureWorktreeScenario({
			hostOptions: { apiOverrides: cloudFlows.workspaceDeleteOk() },
		});
		// Script lives in the main repo (gitignored scripts don't exist in
		// worktrees); the marker lands outside the worktree since step 2b
		// deletes the worktree directory.
		const markerPath = join(tmp, "teardown-ran");
		const scriptDir = join(scenario.repo.repoPath, ".superset");
		mkdirSync(scriptDir, { recursive: true });
		writeFileSync(
			join(scriptDir, "teardown.sh"),
			`#!/usr/bin/env bash\n${teardownScript
				.replaceAll("{{WORKTREE}}", shellQuote(scenario.worktreePath))
				.replaceAll("{{MARKER}}", shellQuote(markerPath))}\n`,
			{ mode: 0o755 },
		);
		return { scenario, markerPath };
	}

	test("workspace.delete (external surface) runs teardown before removing the worktree", async () => {
		// `test -d` pins the ordering: the marker only appears if the worktree
		// still exists when teardown runs.
		const { scenario, markerPath } = await setup(
			"test -d {{WORKTREE}} && printf ran > {{MARKER}}",
		);

		const result = await scenario.host.trpc.workspace.delete.mutate({
			id: scenario.featureWorkspaceId,
		});

		expect(result.success).toBe(true);
		expect(result.worktreeRemoved).toBe(true);
		expect(result.warnings).toEqual([]);
		expect(existsSync(markerPath)).toBe(true);
		expect(existsSync(scenario.worktreePath)).toBe(false);
	});

	test("workspace.delete surfaces a failed teardown as a warning without blocking the delete", async () => {
		const { scenario, markerPath } = await setup(
			'echo "external resources not cleaned" >&2\nprintf ran > {{MARKER}}\nexit 7',
		);

		const result = await scenario.host.trpc.workspace.delete.mutate({
			id: scenario.featureWorkspaceId,
		});

		expect(result.success).toBe(true);
		expect(result.worktreeRemoved).toBe(true);
		expect(existsSync(markerPath)).toBe(true);
		expect(existsSync(scenario.worktreePath)).toBe(false);
		const teardownWarning = result.warnings.find((w) =>
			w.includes("Teardown script failed (exit code 7)"),
		);
		expect(teardownWarning).toBeDefined();
		// The warning must carry the script's output tail, not just the exit code.
		expect(teardownWarning).toContain("external resources not cleaned");
	});

	test("workspaceCleanup.destroy with force still runs teardown (git consent only)", async () => {
		const { scenario, markerPath } = await setup("printf ran > {{MARKER}}");

		const result = await scenario.host.trpc.workspaceCleanup.destroy.mutate({
			workspaceId: scenario.featureWorkspaceId,
			force: true,
		});

		expect(result.success).toBe(true);
		expect(result.worktreeRemoved).toBe(true);
		expect(existsSync(markerPath)).toBe(true);
		expect(existsSync(scenario.worktreePath)).toBe(false);
	});

	test("workspaceCleanup.destroy with skipTeardown skips the script (teardown-failed retry contract)", async () => {
		const { scenario, markerPath } = await setup("printf ran > {{MARKER}}");

		const result = await scenario.host.trpc.workspaceCleanup.destroy.mutate({
			workspaceId: scenario.featureWorkspaceId,
			force: true,
			skipTeardown: true,
		});

		expect(result.success).toBe(true);
		expect(result.worktreeRemoved).toBe(true);
		expect(existsSync(markerPath)).toBe(false);
		expect(existsSync(scenario.worktreePath)).toBe(false);
	});
	test("close commands run in the worktree before teardown and removal", async () => {
		const { scenario, markerPath } = await setup(
			"test -f {{MARKER}} && printf teardown >> {{MARKER}}",
		);
		await scenario.host.trpc.config.updateConfig.mutate({
			projectId: scenario.projectId,
			close: [
				`test "$PWD" = ${shellQuote(scenario.worktreePath)} && printf close > ${shellQuote(markerPath)}`,
			],
		});
		const result = await scenario.host.trpc.workspaceCleanup.destroy.mutate({
			workspaceId: scenario.featureWorkspaceId,
			force: true,
		});
		expect(result.worktreeRemoved).toBe(true);
		expect(readFileSync(markerPath, "utf8")).toBe("closeteardown");
	});

	test("closing an imported worktree runs close actions and preserves its files and teardown", async () => {
		const { scenario, markerPath } = await setup(
			"printf teardown > {{MARKER}}.teardown",
		);
		scenario.host.db
			.insert(externalWorkspacePaths)
			.values({ worktreePath: realpathSync(scenario.worktreePath) })
			.run();
		await scenario.host.trpc.config.updateConfig.mutate({
			projectId: scenario.projectId,
			close: [
				`test -d ${shellQuote(scenario.worktreePath)} && printf closed > ${shellQuote(markerPath)}`,
			],
		});
		const result = await scenario.host.trpc.workspaceCleanup.destroy.mutate({
			workspaceId: scenario.featureWorkspaceId,
			force: true,
			deleteBranch: true,
		});
		expect(result).toMatchObject({
			success: true,
			worktreeRemoved: false,
			branchDeleted: false,
		});
		expect(readFileSync(markerPath, "utf8")).toBe("closed");
		expect(existsSync(`${markerPath}.teardown`)).toBe(false);
		expect(existsSync(scenario.worktreePath)).toBe(true);
	});

	test("failed close actions keep the worktree open until explicitly skipped", async () => {
		const { scenario, markerPath } = await setup(
			"printf teardown > {{MARKER}}",
		);
		await scenario.host.trpc.config.updateConfig.mutate({
			projectId: scenario.projectId,
			close: ["exit 7"],
		});
		await expect(
			scenario.host.trpc.workspaceCleanup.destroy.mutate({
				workspaceId: scenario.featureWorkspaceId,
				force: true,
			}),
		).rejects.toThrow("Worktree close action failed");
		expect(existsSync(markerPath)).toBe(false);
		expect(existsSync(scenario.worktreePath)).toBe(true);
		const workspace = scenario.host.db.query.workspaces
			.findFirst({
				where: (row, { eq }) => eq(row.id, scenario.featureWorkspaceId),
			})
			.sync();
		expect(workspace?.archivedAt).toBeNull();
		const result = await scenario.host.trpc.workspaceCleanup.destroy.mutate({
			workspaceId: scenario.featureWorkspaceId,
			force: true,
			skipTeardown: true,
		});
		expect(result.worktreeRemoved).toBe(true);
		expect(existsSync(markerPath)).toBe(false);
	});
	test("closing a workspace on the shared project checkout does not run worktree actions", async () => {
		const { scenario, markerPath } = await setup(
			"printf teardown > {{MARKER}}.teardown",
		);
		await scenario.host.trpc.config.updateConfig.mutate({
			projectId: scenario.projectId,
			close: [`printf closed > ${shellQuote(markerPath)}`],
		});
		const result = await scenario.host.trpc.workspaceCleanup.destroy.mutate({
			workspaceId: scenario.workspaceId,
			force: true,
		});
		expect(result.worktreeRemoved).toBe(false);
		expect(existsSync(markerPath)).toBe(false);
		expect(existsSync(`${markerPath}.teardown`)).toBe(false);
		expect(existsSync(scenario.repo.repoPath)).toBe(true);
	});
});
