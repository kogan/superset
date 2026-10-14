import type { AgentType } from "@superset/shared/agent-command";
export type SupersetManagedBinary = AgentType;
/**
 * Agents Superset integrates with, in setup order. The setup/teardown writers
 * for each id live in agent-setup.ts (AGENT_SETUP_DEFINITIONS) — this file
 * stays free of fs-touching imports so shared consumers (e.g. shell-wrappers)
 * can read the target list without pulling in the writers.
 */
export declare const AGENT_SETUP_TARGETS: readonly [{
    readonly id: "amp";
    readonly managedBinary: true;
}, {
    readonly id: "claude";
    readonly managedBinary: true;
}, {
    readonly id: "codex";
    readonly managedBinary: true;
}, {
    readonly id: "droid";
    readonly managedBinary: true;
}, {
    readonly id: "opencode";
    readonly managedBinary: true;
}, {
    readonly id: "omp";
}, {
    readonly id: "pi";
}, {
    readonly id: "cursor-agent";
}, {
    readonly id: "gemini";
    readonly managedBinary: true;
}, {
    readonly id: "mastracode";
    readonly managedBinary: true;
}, {
    readonly id: "kimi";
    readonly managedBinary: true;
}, {
    readonly id: "grok";
    readonly managedBinary: true;
}, {
    readonly id: "copilot";
    readonly managedBinary: true;
}, {
    readonly id: "vibe";
    readonly managedBinary: true;
}, {
    readonly id: "devin";
    readonly managedBinary: true;
}, {
    readonly id: "muse";
    readonly managedBinary: true;
}, {
    readonly id: "ufo";
    readonly managedBinary: true;
}];
export type AgentSetupTargetId = (typeof AGENT_SETUP_TARGETS)[number]["id"];
export declare const SUPERSET_MANAGED_BINARIES: ("amp" | "claude" | "codex" | "copilot" | "cursor-agent" | "devin" | "droid" | "gemini" | "grok" | "kimi" | "mastracode" | "muse" | "omp" | "opencode" | "pi" | "ufo" | "vibe")[];
//# sourceMappingURL=agent-setup-targets.d.ts.map