import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildArgvCommand,
	envOverlayPrefix,
} from "@superset/shared/agent-prompt-launch";
import type { SlashCommand } from "@superset/shared/slash-commands";
import {
	type DeletionSkillAgent,
	type WorktreeDeletionAction,
	worktreeDeletionSettingsSchema,
} from "@superset/shared/worktree-deletion";
import { and, desc, eq } from "drizzle-orm";
import type { HostDb } from "../../db";
import { terminalAgentBindings } from "../../db/schema";
import { scanClaudeSlashCommands } from "../../trpc/router/agent-tooling/scan-claude";
import {
	dedupeFirstWins,
	scanSkillsDir,
} from "../../trpc/router/agent-tooling/scan-fs";
import { resolveHostAgentConfig } from "../../trpc/router/agents/agents";
import { resolveDefaultAccountEnv } from "../../trpc/router/usage/default-account";
import { getProjectConfigPath } from "../setup/config";

export const DELETION_SKILL_TIMEOUT_MS = 10 * 60 * 1000;

export function readWorktreeDeletionSettings(repoPath: string) {
	const path = getProjectConfigPath(repoPath);
	return worktreeDeletionSettingsSchema.parse(
		existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {},
	);
}

function skillAgentConfig(db: HostDb, agent: DeletionSkillAgent) {
	const config = resolveHostAgentConfig(db, agent);
	if (!config)
		throw new Error(
			`Configure ${agent} in Agent commands before running a deletion skill.`,
		);
	return {
		config,
		env: { ...resolveDefaultAccountEnv(db, agent), ...config.env },
	};
}

export async function listDeletionSkills(args: {
	db: HostDb;
	repoPath: string;
	agent: DeletionSkillAgent;
	homeDir?: string;
}): Promise<SlashCommand[]> {
	const { env } = skillAgentConfig(args.db, args.agent);
	const home = args.homeDir ?? homedir();
	if (args.agent === "claude") {
		const commands = await scanClaudeSlashCommands({
			worktreePath: args.repoPath,
			configDir: env.CLAUDE_CONFIG_DIR || join(home, ".claude"),
		});
		return commands.filter((command) => command.entryKind === "skill");
	}
	const configDir = env.CODEX_HOME || join(home, ".codex");
	const roots = [
		{ path: join(args.repoPath, ".agents", "skills"), source: "project" },
		{ path: join(args.repoPath, ".codex", "skills"), source: "project" },
		{ path: join(home, ".agents", "skills"), source: "global" },
		{ path: join(configDir, "skills"), source: "global" },
	] as const;
	return dedupeFirstWins(
		(
			await Promise.all(
				roots.map((root) =>
					scanSkillsDir(root.path, { source: root.source, trigger: "$" }),
				),
			)
		).flat(),
	);
}

export function buildDeletionSkillCommand(args: {
	command: string;
	baseArgs: string[];
	action: Extract<WorktreeDeletionAction, { type: "skill" }> & { name: string };
	completionPath: string;
	worktreePath: string;
	sessionId?: string;
}): string {
	const { action, sessionId } = args;
	const prompt = [
		`${action.agent === "claude" ? "/" : "$"}${action.name}`,
		"Run this skill before Superset deletes this worktree. Complete its work now. Do not delete the worktree yourself.",
		`Worktree: ${args.worktreePath}`,
		sessionId
			? "Use the conversation history and repository changes as context."
			: "No prior session for this agent is available. Inspect branch commits and working-tree changes; do not invent conversation history.",
		action.instructions,
		`Only after every step of the skill succeeds, write exactly "completed" to this completion file: ${args.completionPath}. If blocked, needing input, or unable to finish, do not create that file.`,
	]
		.filter(Boolean)
		.join("\n\n");
	const modeArgs =
		action.agent === "claude"
			? ["-p", ...(sessionId ? ["--resume", sessionId, "--fork-session"] : [])]
			: ["exec", ...(sessionId ? ["fork", sessionId] : [])];
	return buildArgvCommand([
		args.command,
		...args.baseArgs,
		...modeArgs,
		prompt,
	]);
}

export async function resolveDeletionSkillCommand(args: {
	db: HostDb;
	workspaceId: string;
	worktreePath: string;
	repoPath: string;
	action: Extract<WorktreeDeletionAction, { type: "skill" }>;
	homeDir?: string;
}): Promise<{ command: string; completionPath: string } | null> {
	const { action } = args;
	if (action.name === null) return null;
	const { config, env } = skillAgentConfig(args.db, action.agent);
	const skills = await listDeletionSkills({
		...args,
		repoPath: args.worktreePath,
		agent: action.agent,
	});
	if (!skills.some((skill) => skill.name === action.name)) {
		throw new Error(
			`Deletion skill '${action.name}' is not installed for ${action.agent} in this worktree.`,
		);
	}
	const bindings = args.db
		.select()
		.from(terminalAgentBindings)
		.where(
			and(
				eq(terminalAgentBindings.workspaceId, args.workspaceId),
				eq(terminalAgentBindings.agentId, action.agent),
			),
		)
		.orderBy(desc(terminalAgentBindings.lastEventAt))
		.all();
	const binding = bindings.find(
		(row) =>
			row.agentSessionId &&
			(!row.definitionId ||
				row.definitionId === config.id ||
				row.definitionId === action.agent),
	);
	const completionPath = join(
		tmpdir(),
		`superset-deletion-${randomUUID()}.done`,
	);
	const command = buildDeletionSkillCommand({
		command: config.command,
		baseArgs: config.args,
		action: { ...action, name: action.name },
		completionPath,
		worktreePath: args.worktreePath,
		sessionId: binding?.agentSessionId ?? undefined,
	});
	return { command: `${envOverlayPrefix(env)}${command}`, completionPath };
}
