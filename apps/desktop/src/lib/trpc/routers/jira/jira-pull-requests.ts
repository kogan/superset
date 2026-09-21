import { msg } from "@lingui/core/macro";
import { i18n } from "@superset/i18n";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { execWithShellEnv } from "../workspaces/utils/shell-env";

export type JiraPullRequest = {
	url: string;
	number: number;
	repository: string;
	title: string;
	state: "open" | "closed" | "merged" | null;
};

export function parsePullRequestUrl(value: string): JiraPullRequest | null {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if (
		url.protocol !== "https:" ||
		url.hostname !== "github.com" ||
		url.port ||
		url.username ||
		url.password
	)
		return null;
	const match = url.pathname.match(
		/^\/([A-Za-z0-9_.-]+\/([A-Za-z0-9_.-]+))\/pull\/([1-9]\d*)(?:\/|$)/,
	);
	if (!match?.[1] || !match[3]) return null;
	const number = Number(match[3]);
	if (!Number.isSafeInteger(number)) return null;
	return {
		url: `https://github.com/${match[1]}/pull/${number}`,
		number,
		repository: match[1],
		title: `#${number}`,
		state: null,
	};
}

export function descriptionPullRequests(
	description: unknown,
): JiraPullRequest[] {
	const links = new Map<string, JiraPullRequest>();
	const pending: unknown[] = [description];
	while (pending.length > 0) {
		const node = pending.pop();
		if (typeof node === "string") {
			for (const match of node.matchAll(
				/https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9]\d*(?!\d)/g,
			)) {
				const link = parsePullRequestUrl(match[0]);
				if (link) links.set(link.url, link);
			}
		} else if (Array.isArray(node)) pending.push(...node);
		else {
			const record = z.record(z.string(), z.unknown()).safeParse(node);
			if (record.success) pending.push(...Object.values(record.data));
		}
	}
	return [...links.values()];
}

const searchResponseSchema = z.object({
	total_count: z.number().int().nonnegative(),
	incomplete_results: z.boolean(),
	items: z.array(
		z.object({
			html_url: z.string(),
			title: z.string(),
			body: z.string().nullish(),
			state: z.enum(["open", "closed"]),
			pull_request: z.object({ merged_at: z.string().nullish() }),
		}),
	),
});
type GithubCommand = (args: string[]) => Promise<string>;

export function createJiraGithubClient({
	command = async (args) =>
		(
			await execWithShellEnv("gh", args, {
				timeout: 20_000,
				maxBuffer: 8 * 1024 * 1024,
			})
		).stdout,
}: {
	command?: GithubCommand;
} = {}) {
	return {
		async search({ scope, issueKeys }: { scope: string; issueKeys: string[] }) {
			const qualifier = scope.includes("/") ? `repo:${scope}` : `org:${scope}`;
			const results: { key: string; links: JiraPullRequest[] }[] = [];
			for (let index = 0; index < issueKeys.length; index += 5) {
				const keys = issueKeys.slice(index, index + 5);
				const query = `is:pr ${qualifier} in:title,body ${keys.map((key) => `"${key}"`).join(" OR ")}`;
				let response: z.infer<typeof searchResponseSchema>;
				try {
					response = searchResponseSchema.parse(
						JSON.parse(
							await command([
								"api",
								"--hostname",
								"github.com",
								"--method",
								"GET",
								"search/issues",
								"-f",
								`q=${query}`,
								"-f",
								"per_page=100",
							]),
						),
					);
				} catch {
					throw new TRPCError({
						code: "BAD_GATEWAY",
						message: i18n._(
							msg({
								message:
									"Could not load GitHub PRs. Check GitHub CLI access and try again.",
							}),
						),
					});
				}
				if (
					response.incomplete_results ||
					response.total_count > response.items.length
				) {
					throw new TRPCError({
						code: "BAD_GATEWAY",
						message: i18n._(
							msg({
								message:
									"GitHub returned incomplete PR results. Try a narrower repository scope.",
							}),
						),
					});
				}
				for (const key of keys) {
					const links = response.items.flatMap((item) => {
						const keysInText =
							`${item.title}\n${item.body ?? ""}`.match(
								/\b[A-Z][A-Z0-9_]*-\d+\b/gi,
							) ?? [];
						if (
							!keysInText.some(
								(candidate) => candidate.toUpperCase() === key.toUpperCase(),
							)
						)
							return [];
						const link = parsePullRequestUrl(item.html_url);
						if (!link) return [];
						const expected = scope.toLowerCase();
						if (
							scope.includes("/")
								? link.repository.toLowerCase() !== expected
								: link.repository.split("/")[0]?.toLowerCase() !== expected
						)
							return [];
						return [
							{
								...link,
								title: item.title,
								state: item.pull_request.merged_at ? "merged" : item.state,
							} satisfies JiraPullRequest,
						];
					});
					results.push({ key, links });
				}
			}
			return results;
		},
	};
}
