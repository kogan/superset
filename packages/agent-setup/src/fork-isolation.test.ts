import { expect, spyOn, test } from "bun:test";
import fs from "node:fs";
import { getClaudeGlobalSettingsJsonContent } from "./agent-wrappers-claude-codex-opencode";
import {
	getManagedNotifyHookCommand,
	isManagedArtifactGuardCommand,
	isManagedNotifyCommand,
} from "./agent-wrappers-common";
import { getKimiConfigTomlContent } from "./agent-wrappers-kimi";
import {
	getMuseSettingsJsonContent,
	getMuseSettingsJsonWithoutManagedHooks,
} from "./agent-wrappers-muse";

test("fork recognizers reject original absolute and dynamic hooks", () => {
	for (const command of [
		"/Users/person/.superset/hooks/notify.sh",
		"$SUPERSET_HOME_DIR/hooks/notify.sh",
		"/repo/superset-dev-data/hooks/notify.sh",
	]) {
		expect(
			isManagedNotifyCommand(
				command,
				"/Users/person/.superestset/hooks/superestset-notify.sh",
			),
		).toBe(false);
	}
	expect(
		isManagedNotifyCommand(
			getManagedNotifyHookCommand("claude"),
			"/Users/person/.superestset/hooks/superestset-notify.sh",
		),
	).toBe(true);
	expect(
		isManagedArtifactGuardCommand(
			"$SUPERSET_HOME_DIR/hooks/artifact-guard.sh",
			"/Users/person/.superestset/hooks/superestset-artifact-guard.sh",
		),
	).toBe(false);
});

test("Claude merge retains original hook and adds exactly one fork hook on repeated provisioning", () => {
	const original = {
		type: "command",
		command:
			'[ -n "$SUPERSET_HOME_DIR" ] && "$SUPERSET_HOME_DIR/hooks/notify.sh" || true',
	};
	const initial = JSON.stringify({ hooks: { Stop: [{ hooks: [original] }] } });
	const exists = spyOn(fs, "existsSync").mockReturnValue(true);
	const read = spyOn(fs, "readFileSync").mockReturnValue(initial);
	try {
		const notifyPath = "/Users/person/.superestset/hooks/superestset-notify.sh";
		const once = getClaudeGlobalSettingsJsonContent(notifyPath);
		if (once === null)
			throw new Error("Fixture should produce merged settings");
		read.mockReturnValue(once);
		const twice = getClaudeGlobalSettingsJsonContent(notifyPath);
		expect(twice).toBe(once);
		expect(twice).toContain(original.command.replaceAll('"', '\\"'));
		expect(twice).toContain("superestset-notify.sh");
	} finally {
		read.mockRestore();
		exists.mockRestore();
	}
});

test("Kimi original managed block survives fork merge", () => {
	const original =
		'# >>> superset-managed-kimi-hooks v1 (do not edit) >>>\n[[hooks]]\nevent = "Stop"\ncommand = \'"$SUPERSET_HOME_DIR/hooks/notify.sh"\'\n# <<< superset-managed-kimi-hooks v1 <<<';
	const merged = getKimiConfigTomlContent(original);
	expect(merged).toContain(original);
	expect(getKimiConfigTomlContent(merged)).toBe(merged);
});

test("Muse original single-valued pointer and shared env allowlist remain untouched", () => {
	const original = JSON.stringify({
		managed_hooks_path: "/Users/person/.superset/hooks/muse/hooks.json",
		managed_hooks_env_vars: ["SUPERSET_HOME_DIR", "SUPERSET_TERMINAL_ID"],
	});
	expect(
		getMuseSettingsJsonContent(
			original,
			"/Users/person/.superestset/hooks/muse/hooks.json",
		),
	).toBeNull();
	expect(getMuseSettingsJsonWithoutManagedHooks(original)).toBeNull();
});
