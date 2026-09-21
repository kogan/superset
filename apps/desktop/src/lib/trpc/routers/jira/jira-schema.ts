import { msg } from "@lingui/core/macro";
import { i18n } from "@superset/i18n";
import { z } from "zod";

export const jiraBaseUrlSchema = z
	.string()
	.trim()
	.min(1)
	.max(2048)
	.transform((value, ctx) => {
		let url: URL;
		try {
			url = new URL(value);
		} catch {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: i18n._(msg({ message: "Enter a valid Jira server URL." })),
			});
			return z.NEVER;
		}
		const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
		if (
			(url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
			url.username ||
			url.password ||
			url.href.includes("?") ||
			url.href.includes("#")
		) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: i18n._(
					msg({
						message:
							"Use an HTTPS Jira server URL without a username, password, query, or fragment.",
					}),
				),
			});
			return z.NEVER;
		}
		return url.href.replace(/\/+$/, "");
	});

const jiraTokenSchema = z
	.string()
	.trim()
	.min(1)
	.max(8192)
	.regex(/^[^\r\n]+$/);
const commonCredentialsSchema = z.object({
	baseUrl: jiraBaseUrlSchema,
	token: jiraTokenSchema,
});
const patCredentialsSchema = commonCredentialsSchema.extend({
	kind: z.literal("pat"),
});
const cloudCredentialsSchema = commonCredentialsSchema.extend({
	kind: z.literal("cloud-api-token"),
	email: z.string().trim().email().max(320),
});
const scopedInputSchema = cloudCredentialsSchema.extend({
	kind: z.literal("cloud-scoped-token"),
});
const scopedCredentialsSchema = scopedInputSchema.extend({
	cloudId: z.string().uuid(),
});

export const jiraConnectInputSchema = z.discriminatedUnion("kind", [
	patCredentialsSchema,
	cloudCredentialsSchema,
	scopedInputSchema,
]);
const jiraCredentialsSchema = z.discriminatedUnion("kind", [
	patCredentialsSchema,
	cloudCredentialsSchema,
	scopedCredentialsSchema,
]);

export const jiraBoardIdSchema = z.number().int().positive().safe();
export const jiraIssueInputSchema = z.object({
	issueKey: z
		.string()
		.max(100)
		.regex(/^[A-Z][A-Z0-9_]*-[1-9]\d*$/),
});
export const jiraConnectionRevisionSchema = z
	.string()
	.max(80)
	.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:\d+$/);
export const jiraTransitionInputSchema = jiraIssueInputSchema.extend({
	connectionRevision: jiraConnectionRevisionSchema,
	transitionId: z.string().min(1).max(100).regex(/^\d+$/),
});
const jiraMemberIdSchema = z
	.string()
	.min(1)
	.max(255)
	.refine((value) => [...value].every((char) => char.charCodeAt(0) >= 32));
export const jiraAssigneeSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("all") }),
	z.object({ kind: z.literal("me") }),
	z.object({ kind: z.literal("unassigned") }),
	z.object({ kind: z.literal("member"), id: jiraMemberIdSchema }),
]);
export const jiraListInputSchema = z.object({
	scope: z.discriminatedUnion("kind", [
		z.object({ kind: z.literal("mine") }),
		z.object({
			kind: z.literal("board"),
			boardId: jiraBoardIdSchema,
			assignee: jiraAssigneeSchema,
		}),
	]),
	status: z.enum(["all", "unfinished", "in-progress"]),
	visibleStatuses: z
		.array(z.string().min(1).max(100))
		.min(1)
		.max(50)
		.optional(),
	cursor: z
		.union([
			z.number().int().nonnegative().safe(),
			z.string().min(1).max(16384),
		])
		.optional(),
});
export const jiraBoardListInputSchema = z.object({
	search: z.string().trim().max(100).default(""),
	cursor: z.number().int().nonnegative().safe().optional(),
});
export const jiraMemberSearchInputSchema = z.object({
	search: z.string().trim().min(2).max(100),
});
export const jiraColumnSchema = z.object({
	name: z.string().min(1).max(100),
	statuses: z.array(z.string().min(1).max(100)).min(1).max(20),
});
export type JiraColumn = z.infer<typeof jiraColumnSchema>;
export const jiraColumnLayoutSchema = z
	.array(
		z.object({
			key: z.string().min(1).max(4096),
			visible: z.boolean(),
		}),
	)
	.max(100)
	.refine(
		(columns) => new Set(columns.map(({ key }) => key)).size === columns.length,
	);
export type JiraColumnLayout = z.infer<typeof jiraColumnLayoutSchema>;
export const teamBoardSchema = z.object({
	id: jiraBoardIdSchema,
	name: z.string().min(1),
});

const currentStoredConnectionSchema = z.intersection(
	jiraCredentialsSchema,
	z.object({
		version: z.literal(2),
		displayName: z.string().min(1),
	}),
);
const legacyStoredConnectionSchema = commonCredentialsSchema
	.extend({
		version: z.literal(1),
		displayName: z.string().min(1),
	})
	.transform(
		(connection): z.infer<typeof currentStoredConnectionSchema> => ({
			...connection,
			version: 2,
			kind: "pat",
		}),
	);
export const storedJiraConnectionSchema = z.union([
	currentStoredConnectionSchema,
	legacyStoredConnectionSchema,
]);

export type JiraConnectInput = z.infer<typeof jiraConnectInputSchema>;
export type JiraCredentials = z.infer<typeof jiraCredentialsSchema>;
export type JiraListInput = z.infer<typeof jiraListInputSchema>;
export type StoredJiraConnection = z.infer<
	typeof currentStoredConnectionSchema
>;

type ConnectedJiraMetadata = {
	status: "connected";
	baseUrl: string;
	displayName: string;
};
export type JiraConnectionView =
	| { status: "disconnected" }
	| (ConnectedJiraMetadata & { kind: "pat" })
	| (ConnectedJiraMetadata & {
			kind: "cloud-api-token" | "cloud-scoped-token";
			email: string;
	  });
