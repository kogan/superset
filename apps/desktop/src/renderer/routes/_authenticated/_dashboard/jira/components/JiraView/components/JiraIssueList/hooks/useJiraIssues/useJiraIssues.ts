import type { JiraListInput } from "lib/trpc/routers/jira/jira-schema";
import { useEffect } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";

export function useJiraIssues(input: JiraListInput, enabled: boolean) {
	const query = electronTrpc.jira.listIssues.useInfiniteQuery(input, {
		enabled,
		getNextPageParam: (page) => page.nextCursor ?? undefined,
		retry: false,
		staleTime: 30_000,
		gcTime: 0,
	});
	const { data, hasNextPage, isFetching, isError, fetchNextPage } = query;
	useEffect(() => {
		if (enabled && data && hasNextPage && !isFetching && !isError) {
			void fetchNextPage();
		}
	}, [data, enabled, hasNextPage, isFetching, isError, fetchNextPage]);
	return query;
}
