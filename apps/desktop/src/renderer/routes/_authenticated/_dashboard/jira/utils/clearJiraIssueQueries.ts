import type { QueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { electronTrpc } from "renderer/lib/electron-trpc";

export async function clearJiraIssueQueries(queryClient: QueryClient) {
	const queryKey = getQueryKey(electronTrpc.jira);
	await queryClient.cancelQueries({ queryKey });
	const connectionKey = getQueryKey(electronTrpc.jira.getConnection);
	const predicate = (query: { queryKey: readonly unknown[] }) =>
		JSON.stringify(query.queryKey[0]) !== JSON.stringify(connectionKey[0]);
	for (const query of queryClient
		.getQueryCache()
		.findAll({ queryKey, predicate }))
		query.reset();
	queryClient.removeQueries({ queryKey, predicate });
}
