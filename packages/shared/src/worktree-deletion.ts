import { z } from "zod";

export const deletionSkillAgentSchema = z.enum(["claude", "codex"]);
export const worktreeDeletionActionSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("command") }),
	z.object({
		type: z.literal("skill"),
		agent: deletionSkillAgentSchema,
		name: z.string().trim().min(1).max(200).nullable(),
		instructions: z.string().max(20000).default(""),
	}),
]);
export type WorktreeDeletionAction = z.infer<
	typeof worktreeDeletionActionSchema
>;
export type DeletionSkillAgent = z.infer<typeof deletionSkillAgentSchema>;
export const worktreeDeletionSettingsSchema = z.object({
	closeEnabled: z.boolean().default(true),
	closeAction: worktreeDeletionActionSchema.default({ type: "command" }),
});
