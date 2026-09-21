import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { msg } from "@lingui/core/macro";
import { i18n } from "@superset/i18n";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	jiraBaseUrlSchema,
	jiraColumnLayoutSchema,
	jiraColumnSchema,
	teamBoardSchema,
} from "./jira-schema";

export const githubScopeSchema = z
	.string()
	.trim()
	.max(200)
	.regex(/^[A-Za-z0-9][A-Za-z0-9-]*(?:\/[A-Za-z0-9_.-]+)?$/);
const preferencesSchema = z.object({
	baseUrl: jiraBaseUrlSchema.optional(),
	teamBoard: teamBoardSchema.optional(),
	columns: z.array(jiraColumnSchema).min(1).max(20).optional(),
	columnLayout: jiraColumnLayoutSchema.optional(),
	githubScope: githubScopeSchema.optional(),
});
export type JiraPreferences = z.infer<typeof preferencesSchema>;

export function createJiraPreferences(directory: string) {
	const filename = join(directory, "jira-preferences.json");
	return {
		async read(): Promise<JiraPreferences> {
			try {
				return preferencesSchema.parse(
					JSON.parse(await readFile(filename, "utf8")),
				);
			} catch (error) {
				if (
					error instanceof Error &&
					"code" in error &&
					error.code === "ENOENT"
				)
					return {};
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: i18n._(msg({ message: "Could not read Jira preferences." })),
				});
			}
		},
		async write(preferences: JiraPreferences) {
			const temporaryFile = `${filename}.${randomUUID()}.tmp`;
			try {
				await mkdir(directory, { recursive: true, mode: 0o700 });
				await writeFile(
					temporaryFile,
					JSON.stringify(preferencesSchema.parse(preferences)),
					{ mode: 0o600, flag: "wx" },
				);
				await rename(temporaryFile, filename);
			} catch {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: i18n._(msg({ message: "Could not save Jira preferences." })),
				});
			} finally {
				await rm(temporaryFile, { force: true }).catch(() => {});
			}
		},
	};
}
