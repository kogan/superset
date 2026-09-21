import { AGENT_IDENTITY_LABELS } from "@superset/shared/agent-catalog";
import type { TerminalAgentBinding } from "renderer/hooks/host-service/useTerminalAgentBindings";
import type { HostServiceClient } from "renderer/lib/host-service-client";

type SearchPullRequests =
	HostServiceClient["workspaceCreation"]["searchPullRequests"]["query"];
export type PullRequestsPage = Awaited<ReturnType<SearchPullRequests>>;
export type PrReason = "failed-checks" | "reviews";
export type AttentionFilter = "all" | "agents" | PrReason;
export type AttentionItem =
	| {
			kind: "agent";
			id: string;
			title: string;
			workspaceName: string;
			workspaceId: string;
			terminalId: string;
			updatedAt: number;
	  }
	| {
			kind: "pull-request";
			id: string;
			title: string;
			projectId: string;
			projectName: string;
			prNumber: number;
			url: string;
			reasons: PrReason[];
			failedCheckNames: string[];
			updatedAt: number;
	  };

export interface AttentionPrSnapshot {
	pullRequests: PullRequestsPage["pullRequests"];
	hasMore: boolean;
	incomplete: boolean;
}

export async function fetchAttentionPullRequests({
	search,
	projectIds,
	reason,
	pageLimit,
}: {
	search: SearchPullRequests;
	projectIds: [string, ...string[]];
	reason: PrReason;
	pageLimit: number;
}): Promise<AttentionPrSnapshot> {
	const pullRequests: PullRequestsPage["pullRequests"] = [];
	let incomplete = false;
	let hasMore = false;
	for (let page = 1; page <= pageLimit; page++) {
		const result = await search({
			projectId: projectIds[0],
			projectIds,
			page,
			limit: 100,
			includeClosed: false,
			viewerRelationship: reason === "reviews" ? "needs-review" : "authored",
			...(reason === "failed-checks" ? { query: "status:failure" } : {}),
		});
		pullRequests.push(...result.pullRequests);
		incomplete ||=
			result.searchIncomplete !== false ||
			Boolean(result.repoMismatch) ||
			(reason === "failed-checks" && result.checksUnavailable !== false);
		hasMore = result.hasNextPage;
		if (!hasMore) break;
	}
	return { pullRequests, hasMore, incomplete };
}

export function agentAttentionItems({
	workspaceId,
	workspaceName,
	bindings,
}: {
	workspaceId: string;
	workspaceName: string;
	bindings: readonly TerminalAgentBinding[];
}): AttentionItem[] {
	const sorted = [...bindings].sort(
		(a, b) =>
			a.startedAt - b.startedAt || a.terminalId.localeCompare(b.terminalId),
	);
	const labels = sorted.map(
		(binding) =>
			binding.title ||
			AGENT_IDENTITY_LABELS[binding.agentId] ||
			binding.agentId,
	);
	const occurrences = new Map<string, number>();
	return sorted.flatMap((binding, index): AttentionItem[] => {
		const label = labels[index] ?? binding.agentId;
		const occurrence = (occurrences.get(label) ?? 0) + 1;
		occurrences.set(label, occurrence);
		if (binding.lastEventType !== "PermissionRequest") return [];
		return [
			{
				kind: "agent",
				id: `agent:${workspaceId}:${binding.terminalId}`,
				title:
					labels.filter((name) => name === label).length > 1
						? `${label} ${occurrence}`
						: label,
				workspaceName,
				workspaceId,
				terminalId: binding.terminalId,
				updatedAt: binding.lastEventAt,
			},
		];
	});
}

export function mergeAttentionPullRequests(
	sources: {
		reason: PrReason;
		snapshot: AttentionPrSnapshot;
		projectNames: ReadonlyMap<string, string>;
	}[],
): AttentionItem[] {
	const items = new Map<
		string,
		Extract<AttentionItem, { kind: "pull-request" }>
	>();
	for (const { reason, snapshot, projectNames } of sources) {
		for (const pr of snapshot.pullRequests) {
			if (pr.state !== "open") continue;
			const failedCheckNames = (pr.checks ?? [])
				.filter((check) => check.status === "failure")
				.map((check) => check.name);
			if (reason === "failed-checks" && failedCheckNames.length === 0) continue;
			const id = pr.url.replace(/\/$/, "").toLowerCase();
			const existing = items.get(id);
			if (existing) {
				if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
				existing.failedCheckNames = [
					...new Set([...existing.failedCheckNames, ...failedCheckNames]),
				];
				continue;
			}
			items.set(id, {
				kind: "pull-request",
				id,
				title: pr.title,
				projectId: pr.projectId,
				projectName: projectNames.get(pr.projectId) ?? pr.projectId,
				prNumber: pr.prNumber,
				url: pr.url,
				reasons: [reason],
				failedCheckNames,
				updatedAt: pr.updatedAt ? Date.parse(pr.updatedAt) : 0,
			});
		}
	}
	return [...items.values()].sort(
		(a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
	);
}

export function matchesAttentionFilter(
	item: AttentionItem,
	filter: AttentionFilter,
): boolean {
	if (filter === "all") return true;
	if (item.kind === "agent") return filter === "agents";
	return filter !== "agents" && item.reasons.includes(filter);
}
