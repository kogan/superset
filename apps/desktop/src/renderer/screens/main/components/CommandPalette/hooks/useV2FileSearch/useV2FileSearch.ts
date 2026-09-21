import type { AppRouter } from "@superset/host-service";
import { useMaybeWorkspaceClient } from "@superset/workspace-client";
import { useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useDebouncedValue } from "renderer/hooks/useDebouncedValue";

type FsSearchMatch =
	inferRouterOutputs<AppRouter>["filesystem"]["searchFiles"]["matches"][number];
type FsContentMatch =
	inferRouterOutputs<AppRouter>["filesystem"]["searchContent"]["matches"][number];

export const SEARCH_LIMIT = 100;
export type FileSearchMode = "files" | "content";
type SearchResponse =
	| { mode: "files"; matches: FsSearchMatch[] }
	| { mode: "content"; matches: FsContentMatch[] };

export function useV2FileSearch({
	workspaceId,
	query,
	mode,
	includePattern,
	excludePattern,
}: {
	workspaceId: string | undefined;
	query: string;
	mode: FileSearchMode;
	includePattern: string;
	excludePattern: string;
}) {
	const trimmedQuery = query.trim();
	const debouncedQuery = useDebouncedValue(trimmedQuery, 150);
	const workspaceClient = useMaybeWorkspaceClient();
	const isDebouncing = trimmedQuery !== debouncedQuery;
	const enabled =
		Boolean(workspaceClient && workspaceId && trimmedQuery) && !isDebouncing;
	const { data, isFetching, error, refetch } = useQuery({
		queryKey: [
			"v2-file-search",
			workspaceId,
			debouncedQuery,
			mode,
			includePattern,
			excludePattern,
		],
		queryFn: async ({ signal }): Promise<SearchResponse> => {
			if (!workspaceClient || !workspaceId)
				throw new Error("workspace client unavailable");
			const input = {
				workspaceId,
				query: debouncedQuery,
				includePattern,
				excludePattern,
				includeHidden: false,
				limit: SEARCH_LIMIT + 1,
			};
			if (mode === "content") {
				const result =
					await workspaceClient.trpcClient.filesystem.searchContent.query(
						input,
						{ signal },
					);
				return { mode, matches: result.matches };
			}
			const result =
				await workspaceClient.trpcClient.filesystem.searchFiles.query(input, {
					signal,
				});
			return { mode, matches: result.matches };
		},
		enabled,
		retry: false,
		gcTime: 60_000,
	});
	const current = enabled ? data : undefined;
	const results =
		current?.mode === "files"
			? current.matches.slice(0, SEARCH_LIMIT).map((match) => ({
					id: match.absolutePath,
					name: match.name,
					path: match.absolutePath,
					relativePath: match.relativePath,
				}))
			: [];
	return {
		results,
		contentResults:
			current?.mode === "content" ? current.matches.slice(0, SEARCH_LIMIT) : [],
		isFetching: Boolean(trimmedQuery) && (isDebouncing || isFetching),
		error: enabled ? error : null,
		hasMore: (current?.matches.length ?? 0) > SEARCH_LIMIT,
		refetch,
	};
}
