import { msg } from "@lingui/core/macro";
import { i18n } from "@superset/i18n";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { descriptionFreshdeskLinks, parseFreshdeskUrl } from "./jira-freshdesk";
import {
	descriptionPullRequests,
	parsePullRequestUrl,
} from "./jira-pull-requests";
import type {
	JiraConnectInput,
	JiraCredentials,
	JiraListInput,
	jiraBoardListInputSchema,
	jiraIssueInputSchema,
	jiraMemberSearchInputSchema,
	jiraTransitionInputSchema,
} from "./jira-schema";

const jiraUserSchema = z.object({
	displayName: z.string().min(1),
	active: z.boolean(),
});

const jiraAssigneeResponseSchema = z
	.object({
		displayName: z.string().min(1),
		accountId: z.string().min(1).optional(),
		name: z.string().min(1).optional(),
	})
	.refine((user) => user.accountId || user.name);
const jiraBoardSchema = z.object({
	id: z.number().int().positive().safe(),
	name: z.string().min(1),
});
const jiraBoardsSchema = z.object({
	values: z.array(jiraBoardSchema),
	startAt: z.number().int().nonnegative().safe(),
	isLast: z.boolean(),
});
const jiraBoardConfigurationSchema = jiraBoardSchema.extend({
	filter: z.object({
		id: z
			.string()
			.regex(/^\d+$/)
			.or(z.number().int().positive().safe())
			.transform(String),
	}),
});

const jiraIssueSchema = z.object({
	id: z.string().min(1),
	key: z.string().min(1),
	fields: z.object({
		summary: z.string(),
		description: z.unknown().optional(),
		assignee: jiraAssigneeResponseSchema.nullish(),
		status: z.object({
			name: z.string(),
			statusCategory: z.object({ key: z.string() }),
		}),
		project: z.object({ name: z.string() }),
		priority: z.object({ name: z.string() }).nullish(),
		updated: z.string().refine((value) => Number.isFinite(Date.parse(value))),
	}),
});
const jiraSearchSchema = z.object({
	startAt: z.number().int().nonnegative().safe(),
	total: z.number().int().nonnegative().safe(),
	issues: z.array(jiraIssueSchema),
});
const jiraCloudSearchSchema = z.object({
	issues: z.array(jiraIssueSchema),
	isLast: z.boolean().optional(),
	nextPageToken: z.string().min(1).max(16384).nullish(),
});
const jiraTenantSchema = z.object({ cloudId: z.string().uuid() });
const jiraTransitionsSchema = z.object({
	transitions: z.array(
		z.object({
			id: z.string().regex(/^\d+$/),
			name: z.string().min(1),
			to: z.object({ name: z.string().min(1) }),
			isAvailable: z.boolean().optional(),
			fields: z
				.record(
					z.string(),
					z.object({
						name: z.string().min(1),
						required: z.boolean(),
						hasDefaultValue: z.boolean().optional(),
					}),
				)
				.default({}),
		}),
	),
});

function apiBaseUrl(credentials: JiraCredentials) {
	return credentials.kind === "cloud-scoped-token"
		? `https://api.atlassian.com/ex/jira/${credentials.cloudId}/`
		: `${credentials.baseUrl}/`;
}

function authorization(credentials: JiraCredentials) {
	return credentials.kind === "pat"
		? `Bearer ${credentials.token}`
		: `Basic ${Buffer.from(`${credentials.email}:${credentials.token}`, "utf8").toString("base64")}`;
}

function mapIssues(issues: z.infer<typeof jiraIssueSchema>[], baseUrl: string) {
	return issues.map(({ id, key, fields }) => ({
		id,
		key,
		summary: fields.summary,
		pullRequests: descriptionPullRequests(fields.description),
		freshdeskLinks: descriptionFreshdeskLinks(fields.description),
		assignee: fields.assignee ? mapMember(fields.assignee) : null,
		status: fields.status.name,
		statusCategory: fields.status.statusCategory.key,
		project: fields.project.name,
		priority: fields.priority?.name ?? null,
		updated: fields.updated,
		url: new URL(`browse/${encodeURIComponent(key)}`, `${baseUrl}/`).href,
	}));
}

function mapMember(user: z.infer<typeof jiraAssigneeResponseSchema>) {
	const id = user.accountId ?? user.name;
	if (!id) throw invalidResponse();
	return { id, displayName: user.displayName };
}

function quoteJql(value: string) {
	return JSON.stringify(value);
}

type JiraRequest = (url: string, init: RequestInit) => Promise<Response>;

export function createJiraClient({
	request,
	timeoutMs = 15_000,
}: {
	request: JiraRequest;
	timeoutMs?: number;
}) {
	async function requestJson({
		credentials,
		url,
		body,
	}: {
		credentials?: JiraCredentials;
		url: URL;
		body?: { transition: { id: string } };
	}): Promise<unknown> {
		const signal = AbortSignal.timeout(timeoutMs);
		try {
			const response = await request(url.href, {
				method: body ? "POST" : "GET",
				body: body ? JSON.stringify(body) : undefined,
				headers: {
					Accept: "application/json",
					// Chromium's browser identity triggers Jira's browser-only CSRF
					// checks on token-authenticated POSTs from the main process.
					"User-Agent": "SuperestSet",
					...(body ? { "Content-Type": "application/json" } : {}),
					...(credentials ? { Authorization: authorization(credentials) } : {}),
				},
				credentials: "omit",
				redirect: "manual",
				signal,
			});
			if (response.status >= 300 && response.status < 400) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: i18n._(
						msg({
							message: "Jira redirected the request. Check your server URL.",
						}),
					),
				});
			}
			if (response.status === 401 || response.status === 403) {
				throw new TRPCError({
					code: response.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN",
					message: i18n._(
						msg({
							message:
								"Jira denied access. Check your credentials and permissions.",
						}),
					),
				});
			}
			if (!response.ok) {
				throw new TRPCError({
					code: "BAD_GATEWAY",
					message: i18n._(
						msg({
							message:
								"Jira could not complete the request. Check your server URL and try again.",
						}),
					),
				});
			}
			if (response.status === 204) return null;
			try {
				return await response.json();
			} catch {
				if (signal.aborted) throw signal.reason;
				throw invalidResponse();
			}
		} catch (error) {
			if (error instanceof TRPCError) throw error;
			throw new TRPCError({
				code: signal.aborted ? "TIMEOUT" : "SERVICE_UNAVAILABLE",
				message: i18n._(
					msg({
						message:
							"Could not reach Jira. Check your network or VPN and try again.",
					}),
				),
			});
		}
	}

	function transitionsUrl(credentials: JiraCredentials, issueKey: string) {
		const version = credentials.kind === "pat" ? 2 : 3;
		return new URL(
			`rest/api/${version}/issue/${encodeURIComponent(issueKey)}/transitions`,
			apiBaseUrl(credentials),
		);
	}

	async function listTransitions({
		credentials,
		issueKey,
	}: {
		credentials: JiraCredentials;
	} & z.infer<typeof jiraIssueInputSchema>) {
		const url = transitionsUrl(credentials, issueKey);
		url.searchParams.set("expand", "transitions.fields");
		const result = jiraTransitionsSchema.safeParse(
			await requestJson({ credentials, url }),
		);
		if (!result.success) throw invalidResponse();
		return result.data.transitions
			.filter((transition) => transition.isAvailable !== false)
			.map((transition) => ({
				id: transition.id,
				name: transition.name,
				status: transition.to.name,
				requiredFields: Object.values(transition.fields)
					.filter((field) => field.required && !field.hasDefaultValue)
					.map((field) => field.name),
			}));
	}

	async function getReviewerFields(credentials: JiraCredentials) {
		const version = credentials.kind === "pat" ? 2 : 3;
		const availableFields = z
			.array(z.object({ id: z.string(), name: z.string() }))
			.parse(
				await requestJson({
					credentials,
					url: new URL(`rest/api/${version}/field`, apiBaseUrl(credentials)),
				}),
			);
		return availableFields.filter((field) =>
			/^(?:(?:code|qa)\s+)?reviewers?$/i.test(field.name.trim()),
		);
	}

	async function getBoard({
		credentials,
		boardId,
	}: {
		credentials: JiraCredentials;
		boardId: number;
	}) {
		const result = jiraBoardConfigurationSchema.safeParse(
			await requestJson({
				credentials,
				url: new URL(
					`rest/agile/1.0/board/${boardId}/configuration`,
					apiBaseUrl(credentials),
				),
			}),
		);
		if (!result.success || result.data.id !== boardId) throw invalidResponse();
		return result.data;
	}

	return {
		getBoard,
		listTransitions,
		async transitionIssue(
			input: { credentials: JiraCredentials } & Pick<
				z.infer<typeof jiraTransitionInputSchema>,
				"issueKey" | "transitionId"
			>,
		) {
			const available = await listTransitions(input);
			const transition = available.find(
				(item) => item.id === input.transitionId,
			);
			if (!transition)
				throw new TRPCError({
					code: "CONFLICT",
					message: i18n._(
						msg({
							message:
								"This transition is no longer available. Refresh the issue and try again.",
						}),
					),
				});
			if (transition.requiredFields.length > 0)
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: i18n._(
						msg({
							message:
								"Complete the required fields in Jira before moving this issue.",
						}),
					),
				});
			await requestJson({
				credentials: input.credentials,
				url: transitionsUrl(input.credentials, input.issueKey),
				body: { transition: { id: input.transitionId } },
			});
		},
		async listRemoteLinks({
			credentials,
			issueKey,
		}: {
			credentials: JiraCredentials;
			issueKey: string;
		}) {
			const version = credentials.kind === "pat" ? 2 : 3;
			const url = new URL(
				`rest/api/${version}/issue/${encodeURIComponent(issueKey)}/remotelink`,
				apiBaseUrl(credentials),
			);
			const result = z
				.array(
					z.object({
						object: z.object({ url: z.string(), title: z.string().optional() }),
					}),
				)
				.safeParse(await requestJson({ credentials, url }));
			if (!result.success) throw invalidResponse();
			return {
				pullRequests: result.data.flatMap(({ object }) => {
					const link = parsePullRequestUrl(object.url);
					return link ? [{ ...link, title: object.title ?? link.title }] : [];
				}),
				freshdeskLinks: result.data.flatMap(({ object }) => {
					const link = parseFreshdeskUrl(object.url);
					return link ? [link] : [];
				}),
			};
		},
		async listBoards({
			credentials,
			search,
			cursor = 0,
		}: { credentials: JiraCredentials } & z.infer<
			typeof jiraBoardListInputSchema
		>) {
			const url = new URL("rest/agile/1.0/board", apiBaseUrl(credentials));
			url.searchParams.set("startAt", String(cursor));
			url.searchParams.set("maxResults", "50");
			if (search) url.searchParams.set("name", search);
			const result = jiraBoardsSchema.safeParse(
				await requestJson({ credentials, url }),
			);
			if (!result.success || result.data.startAt !== cursor)
				throw invalidResponse();
			const { values, isLast } = result.data;
			return {
				boards: values,
				nextCursor:
					isLast || values.length === 0 ? null : cursor + values.length,
			};
		},
		async searchMembers({
			credentials,
			search,
		}: { credentials: JiraCredentials } & z.infer<
			typeof jiraMemberSearchInputSchema
		>) {
			const cloud = credentials.kind !== "pat";
			const url = new URL(
				`rest/api/${cloud ? 3 : 2}/user/search`,
				apiBaseUrl(credentials),
			);
			url.searchParams.set(cloud ? "query" : "username", search);
			url.searchParams.set("maxResults", "50");
			const result = z
				.array(jiraAssigneeResponseSchema)
				.safeParse(await requestJson({ credentials, url }));
			if (!result.success) throw invalidResponse();
			return result.data.map(mapMember);
		},
		async testConnection(input: JiraConnectInput) {
			let credentials: JiraCredentials;
			if (input.kind === "cloud-scoped-token") {
				const tenant = jiraTenantSchema.safeParse(
					await requestJson({
						url: new URL("/_edge/tenant_info", input.baseUrl),
					}),
				);
				if (!tenant.success) throw invalidResponse();
				credentials = { ...input, cloudId: tenant.data.cloudId };
			} else {
				credentials = input;
			}
			const version = credentials.kind === "pat" ? 2 : 3;
			const url = new URL(
				`rest/api/${version}/myself`,
				apiBaseUrl(credentials),
			);
			const result = jiraUserSchema.safeParse(
				await requestJson({ credentials, url }),
			);
			if (!result.success) throw invalidResponse();
			if (!result.data.active) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: i18n._(msg({ message: "Your Jira account is inactive." })),
				});
			}
			return { displayName: result.data.displayName, credentials };
		},

		async listReviewers({
			credentials,
			issueKeys,
		}: {
			credentials: JiraCredentials;
			issueKeys: string[];
		}) {
			const version = credentials.kind === "pat" ? 2 : 3;
			const fields = await getReviewerFields(credentials);
			if (fields.length === 0) return { fieldNames: [], issues: [] };
			const url = new URL(
				version === 3 ? "rest/api/3/search/jql" : "rest/api/2/search",
				apiBaseUrl(credentials),
			);
			url.searchParams.set(
				"jql",
				`key IN (${issueKeys.map(quoteJql).join(", ")})`,
			);
			url.searchParams.set("fields", fields.map((field) => field.id).join(","));
			url.searchParams.set("maxResults", "100");
			const response = z
				.object({
					issues: z.array(
						z.object({
							key: z.string(),
							fields: z.record(z.string(), z.unknown()),
						}),
					),
				})
				.parse(await requestJson({ credentials, url }));
			return {
				fieldNames: fields.map((field) => field.name),
				issues: response.issues.map((issue) => {
					const reviewers = new Map<string, ReturnType<typeof mapMember>>();
					for (const field of fields) {
						const value = issue.fields[field.id];
						if (value === undefined) return { key: issue.key, reviewers: null };
						const parsed = z
							.array(jiraAssigneeResponseSchema)
							.safeParse(
								value === null ? [] : Array.isArray(value) ? value : [value],
							);
						if (!parsed.success) return { key: issue.key, reviewers: null };
						for (const user of parsed.data) {
							const member = mapMember(user);
							reviewers.set(member.id, member);
						}
					}
					return { key: issue.key, reviewers: [...reviewers.values()] };
				}),
			};
		},

		async listIssues({
			credentials,
			scope,
			status,
			visibleStatuses,
			cursor,
		}: JiraListInput & { credentials: JiraCredentials }) {
			const cloud = credentials.kind !== "pat";
			if (
				(cloud && typeof cursor === "number") ||
				(!cloud && typeof cursor === "string")
			) {
				throw invalidResponse();
			}
			const url = new URL(
				cloud ? "rest/api/3/search/jql" : "rest/api/2/search",
				apiBaseUrl(credentials),
			);
			const clauses: string[] = [];
			if (scope.kind === "mine") {
				const reviewerFields = await getReviewerFields(credentials);
				const involvement = [
					"assignee = currentUser()",
					...reviewerFields
						.filter((field) => /^customfield_\d+$/.test(field.id))
						.map(
							(field) =>
								`cf[${field.id.slice("customfield_".length)}] = currentUser()`,
						),
				];
				clauses.push(
					involvement.length === 1
						? "assignee = currentUser()"
						: `(${involvement.join(" OR ")})`,
				);
			} else {
				const board = await getBoard({ credentials, boardId: scope.boardId });
				clauses.push(`filter = ${board.filter.id}`);
				switch (scope.assignee.kind) {
					case "all":
						break;
					case "me":
						clauses.push("assignee = currentUser()");
						break;
					case "unassigned":
						clauses.push("assignee IS EMPTY");
						break;
					case "member":
						clauses.push(`assignee = ${quoteJql(scope.assignee.id)}`);
						break;
				}
			}
			if (visibleStatuses)
				clauses.push(`status IN (${visibleStatuses.map(quoteJql).join(", ")})`);
			clauses.push('issuetype != "Epic"');
			if (status === "unfinished") clauses.push("statusCategory != Done");
			if (status === "in-progress")
				clauses.push('statusCategory = "In Progress"');
			url.searchParams.set(
				"jql",
				`${clauses.join(" AND ")} ORDER BY updated DESC`,
			);
			url.searchParams.set(
				"fields",
				"summary,status,project,priority,updated,assignee,description",
			);
			url.searchParams.set("maxResults", "50");
			if (cloud) {
				if (typeof cursor === "string")
					url.searchParams.set("nextPageToken", cursor);
				const result = jiraCloudSearchSchema.safeParse(
					await requestJson({ credentials, url }),
				);
				if (!result.success) throw invalidResponse();
				const { issues, isLast, nextPageToken } = result.data;
				if (
					isLast !== true &&
					((nextPageToken === cursor && nextPageToken != null) ||
						(isLast === false && !nextPageToken))
				) {
					throw invalidResponse();
				}
				return {
					issues: mapIssues(issues, credentials.baseUrl),
					total: null,
					nextCursor:
						isLast === true || issues.length === 0
							? null
							: (nextPageToken ?? null),
				};
			}
			const startAt = cursor ?? 0;
			url.searchParams.set("startAt", String(startAt));
			const result = jiraSearchSchema.safeParse(
				await requestJson({ credentials, url }),
			);
			if (!result.success || result.data.startAt !== startAt)
				throw invalidResponse();
			const { issues, total } = result.data;
			const next = Number(startAt) + issues.length;
			return {
				issues: mapIssues(issues, credentials.baseUrl),
				total,
				nextCursor: issues.length > 0 && next < total ? next : null,
			};
		},
	};
}

function invalidResponse() {
	return new TRPCError({
		code: "BAD_GATEWAY",
		message: i18n._(
			msg({
				message:
					"Jira returned an unexpected response. Check your server URL and try again.",
			}),
		),
	});
}
