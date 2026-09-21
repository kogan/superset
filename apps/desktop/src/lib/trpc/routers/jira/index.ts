import { randomUUID } from "node:crypto";
import { msg } from "@lingui/core/macro";
import { i18n } from "@superset/i18n";
import { TRPCError } from "@trpc/server";
import * as electron from "electron";
import { SUPERSET_HOME_DIR } from "main/lib/app-environment";
import { z } from "zod";
import { publicProcedure, router } from "../..";
import { createJiraClient } from "./jira-client";
import type { JiraFreshdeskLink } from "./jira-freshdesk";
import { createJiraPreferences, githubScopeSchema } from "./jira-preferences";
import {
	createJiraGithubClient,
	type JiraPullRequest,
} from "./jira-pull-requests";
import {
	type JiraConnectionView,
	jiraBaseUrlSchema,
	jiraBoardIdSchema,
	jiraBoardListInputSchema,
	jiraColumnLayoutSchema,
	jiraConnectInputSchema,
	jiraConnectionRevisionSchema,
	jiraIssueInputSchema,
	jiraListInputSchema,
	jiraMemberSearchInputSchema,
	jiraTransitionInputSchema,
	type StoredJiraConnection,
} from "./jira-schema";
import { createJiraStorage } from "./jira-storage";
import {
	createJiraWorkspaceStorage,
	jiraWorkspaceLinkSchema,
} from "./jira-workspaces";

function connectionView(
	connection: StoredJiraConnection,
): Exclude<JiraConnectionView, { status: "disconnected" }> {
	const metadata = {
		status: "connected",
		baseUrl: connection.baseUrl,
		displayName: connection.displayName,
	} satisfies Pick<JiraConnectionView, "status"> & {
		baseUrl: string;
		displayName: string;
	};
	return connection.kind === "pat"
		? { ...metadata, kind: connection.kind }
		: { ...metadata, kind: connection.kind, email: connection.email };
}

export function createJiraRouter({
	preferences = createJiraPreferences(SUPERSET_HOME_DIR),
	workspaceLinks = createJiraWorkspaceStorage(SUPERSET_HOME_DIR),
	github = createJiraGithubClient(),
	client = createJiraClient({
		request: (url, init) => electron.net.fetch(url, init),
	}),
	storage = createJiraStorage({
		directory: SUPERSET_HOME_DIR,
		encryption: electron.safeStorage,
	}),
}: {
	client?: ReturnType<typeof createJiraClient>;
	preferences?: ReturnType<typeof createJiraPreferences>;
	workspaceLinks?: ReturnType<typeof createJiraWorkspaceStorage>;
	github?: ReturnType<typeof createJiraGithubClient>;
	storage?: ReturnType<typeof createJiraStorage>;
} = {}) {
	const connectionEpoch = randomUUID();
	let connectionGeneration = 0;
	const connectionRevision = () => `${connectionEpoch}:${connectionGeneration}`;
	let writes: Promise<unknown> = Promise.resolve();
	const prCache = new Map<
		string,
		{
			expiresAt: number;
			links: JiraPullRequest[];
			freshdeskLinks: JiraFreshdeskLink[];
		}
	>();
	let prGeneration = 0;
	const clearPrCache = () => {
		prGeneration++;
		prCache.clear();
	};
	function serialize<Result>(
		operation: () => Promise<Result>,
	): Promise<Result> {
		const result = writes.then(operation, operation);
		writes = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	async function requireConnection() {
		const connection = await storage.read();
		if (!connection)
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: i18n._(
					msg({ message: "Connect Jira in Settings to see your tickets." }),
				),
			});
		return connection;
	}

	function requireRevision(revision: string) {
		if (revision !== connectionRevision())
			throw new TRPCError({
				code: "CONFLICT",
				message: i18n._(
					msg({
						message:
							"This transition is no longer available. Refresh the issue and try again.",
					}),
				),
			});
	}

	return router({
		listTransitions: publicProcedure
			.input(jiraIssueInputSchema)
			.query(async ({ input }) => {
				const captured = await serialize(async () => ({
					credentials: await requireConnection(),
					connectionRevision: connectionRevision(),
				}));
				return {
					connectionRevision: captured.connectionRevision,
					transitions: await client.listTransitions({
						credentials: captured.credentials,
						...input,
					}),
				};
			}),
		transitionIssue: publicProcedure
			.input(jiraTransitionInputSchema)
			.mutation(({ input }) =>
				serialize(async () => {
					requireRevision(input.connectionRevision);
					await client.transitionIssue({
						credentials: await requireConnection(),
						issueKey: input.issueKey,
						transitionId: input.transitionId,
					});
					clearPrCache();
				}),
			),
		listWorkspaceLinks: publicProcedure.query(async () =>
			workspaceLinks.list((await requireConnection()).baseUrl),
		),

		getWorkspaceContext: publicProcedure
			.input(jiraIssueInputSchema)
			.query(({ input }) =>
				serialize(async () => ({
					issueKey: input.issueKey,
					baseUrl: (await requireConnection()).baseUrl,
					connectionRevision: connectionRevision(),
				})),
			),
		setWorkspaceLink: publicProcedure
			.input(
				jiraWorkspaceLinkSchema.extend({
					connectionRevision: jiraConnectionRevisionSchema,
				}),
			)
			.mutation(({ input }) =>
				serialize(async () => {
					requireRevision(input.connectionRevision);
					workspaceLinks.set((await requireConnection()).baseUrl, input);
				}),
			),
		listReviewers: publicProcedure
			.input(
				z.object({
					issueKeys: z
						.array(z.string().regex(/^[A-Z][A-Z0-9_]*-\d+$/))
						.min(1)
						.max(100),
				}),
			)
			.query(async ({ input }) =>
				client.listReviewers({
					credentials: await requireConnection(),
					...input,
				}),
			),
		getPreferences: publicProcedure.query(() => preferences.read()),
		getBoardColumns: publicProcedure
			.input(jiraBoardIdSchema)
			.query(async ({ input }) =>
				client.getBoardColumns({
					credentials: await requireConnection(),
					boardId: input,
				}),
			),
		setColumnLayout: publicProcedure
			.input(
				z.object({
					baseUrl: jiraBaseUrlSchema,
					boardId: jiraBoardIdSchema.nullable(),
					layout: jiraColumnLayoutSchema,
				}),
			)
			.mutation(({ input }) =>
				serialize(async () => {
					const connection = await requireConnection();
					const previous = await preferences.read();
					const current =
						previous.baseUrl === connection.baseUrl ? previous : {};
					if (
						input.baseUrl !== connection.baseUrl ||
						input.boardId !== (current.teamBoard?.id ?? null)
					) {
						throw new TRPCError({
							code: "CONFLICT",
							message: i18n._(
								msg({
									message:
										"The Jira board changed. Reopen Columns and try again.",
								}),
							),
						});
					}
					const next = {
						...current,
						baseUrl: connection.baseUrl,
						columnLayout: input.layout,
					};
					await preferences.write(next);
					return next;
				}),
			),
		refreshPullRequests: publicProcedure.mutation(() => {
			clearPrCache();
		}),
		setGithubScope: publicProcedure
			.input(githubScopeSchema)
			.mutation(({ input }) =>
				serialize(async () => {
					const connection = await requireConnection();
					const previous = await preferences.read();
					const next = {
						...(previous.baseUrl === connection.baseUrl ? previous : {}),
						baseUrl: connection.baseUrl,
						githubScope: input,
					};
					await preferences.write(next);
					clearPrCache();
					return next;
				}),
			),
		listPullRequests: publicProcedure
			.input(
				z.object({
					issueKeys: z
						.array(
							z
								.string()
								.max(100)
								.regex(/^[A-Z][A-Z0-9_]*-[1-9]\d*$/),
						)
						.min(1)
						.max(100),
				}),
			)
			.query(async ({ input }) => {
				const generation = prGeneration;
				const credentials = await requireConnection();
				const settings = await preferences.read();
				const keys = [...new Set(input.issueKeys)];
				const links = new Map<string, JiraPullRequest[]>();
				const freshdeskLinks = new Map<string, JiraFreshdeskLink[]>();
				const pendingKeys = keys.filter((key) => {
					const cached = prCache.get(key);
					if (cached && cached.expiresAt > Date.now()) {
						links.set(key, cached.links);
						freshdeskLinks.set(key, cached.freshdeskLinks);
						return false;
					}
					prCache.delete(key);
					return true;
				});
				let nextIndex = 0;
				let jiraUnavailable = false;
				await Promise.all(
					Array.from({ length: Math.min(4, pendingKeys.length) }, async () => {
						for (;;) {
							const key = pendingKeys[nextIndex++];
							if (!key) return;
							try {
								const remote = await client.listRemoteLinks({
									credentials,
									issueKey: key,
								});
								links.set(key, remote.pullRequests);
								freshdeskLinks.set(key, remote.freshdeskLinks);
							} catch {
								jiraUnavailable = true;
							}
						}
					}),
				);
				let githubUnavailable = false;
				const githubScope =
					settings.baseUrl === credentials.baseUrl
						? settings.githubScope
						: undefined;
				if (githubScope) {
					try {
						const missing = pendingKeys.filter(
							(key) => !links.get(key)?.length,
						);
						for (const result of await github.search({
							scope: githubScope,
							issueKeys: missing,
						}))
							links.set(result.key, result.links);
					} catch {
						githubUnavailable = true;
					}
				}
				if (
					!jiraUnavailable &&
					!githubUnavailable &&
					generation === prGeneration
				) {
					for (const key of pendingKeys)
						prCache.set(key, {
							expiresAt: Date.now() + 120_000,
							links: links.get(key) ?? [],
							freshdeskLinks: freshdeskLinks.get(key) ?? [],
						});
					while (prCache.size > 500) {
						const oldest = prCache.keys().next();
						if (oldest.done) break;
						prCache.delete(oldest.value);
					}
				}
				return {
					issues: keys.map((key) => ({
						key,
						links: links.get(key) ?? [],
						freshdeskLinks: freshdeskLinks.get(key) ?? [],
					})),
					jiraUnavailable,
					githubUnavailable,
				};
			}),
		getConnection: publicProcedure.query(
			async (): Promise<JiraConnectionView> => {
				const connection = await storage.read();
				return connection
					? connectionView(connection)
					: { status: "disconnected" };
			},
		),
		connect: publicProcedure
			.input(jiraConnectInputSchema)
			.mutation(({ input }) =>
				serialize(async () => {
					const { displayName, credentials } =
						await client.testConnection(input);
					const connection: StoredJiraConnection = {
						...credentials,
						displayName,
						version: 2,
					};
					await storage.write(connection);
					connectionGeneration++;
					clearPrCache();
					return connectionView(connection);
				}),
			),
		disconnect: publicProcedure.mutation(() =>
			serialize(async () => {
				await storage.remove();
				connectionGeneration++;
				clearPrCache();
			}),
		),
		selectBoard: publicProcedure
			.input(jiraBoardIdSchema)
			.mutation(({ input }) =>
				serialize(async () => {
					const connection = await requireConnection();
					const board = await client.getBoard({
						credentials: connection,
						boardId: input,
					});
					const previous = await preferences.read();
					const next = {
						...(previous.baseUrl === connection.baseUrl ? previous : {}),
						baseUrl: connection.baseUrl,
						teamBoard: { id: board.id, name: board.name },
						columnLayout:
							previous.baseUrl === connection.baseUrl &&
							previous.teamBoard?.id === board.id
								? previous.columnLayout
								: undefined,
						columns:
							previous.baseUrl === connection.baseUrl &&
							previous.teamBoard?.id === board.id
								? previous.columns
								: undefined,
					};
					await preferences.write(next);
					return next;
				}),
			),
		listBoards: publicProcedure
			.input(jiraBoardListInputSchema)
			.query(async ({ input }) =>
				client.listBoards({ credentials: await requireConnection(), ...input }),
			),
		searchMembers: publicProcedure
			.input(jiraMemberSearchInputSchema)
			.query(async ({ input }) =>
				client.searchMembers({
					credentials: await requireConnection(),
					...input,
				}),
			),
		listIssues: publicProcedure
			.input(jiraListInputSchema)
			.query(async ({ input }) =>
				client.listIssues({ credentials: await requireConnection(), ...input }),
			),
	});
}
