import { useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { toast } from "@superset/ui/sonner";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { createMovement } from "./movement";
export function useJiraMovement() {
	const { t } = useLingui();
	const utils = electronTrpc.useUtils();
	const queryClient = useQueryClient();
	const success = () => toast.success(t({ message: "Issue moved." }));
	const refreshFailed = (error: unknown) =>
		toast.error(
			t({
				message: "Issue moved, but refreshing failed. Refresh the issue list.",
			}),
			{ description: errorMessage(error) },
		);
	const callbacks = useRef({ utils, success, refreshFailed });
	callbacks.current = { utils, success, refreshFailed };
	const [controller] = useState(() =>
		createMovement({
			list: (issueKey, signal) =>
				electronTrpcClient.jira.listTransitions.query({ issueKey }, { signal }),
			move: (issueKey, transitionId, connectionRevision) =>
				electronTrpcClient.jira.transitionIssue.mutate({
					issueKey,
					transitionId,
					connectionRevision,
				}),
			refresh: () => callbacks.current.utils.jira.listIssues.invalidate(),
			success: () => callbacks.current.success(),
			refreshFailed: (error) => callbacks.current.refreshFailed(error),
		}),
	);
	useEffect(() => {
		controller.activate();
		return () => controller.dispose();
	}, [controller]);
	useEffect(() => {
		const issuesPath = JSON.stringify(
			getQueryKey(electronTrpc.jira.listIssues)[0],
		);
		return queryClient.getQueryCache().subscribe((event) => {
			if (
				JSON.stringify(event.query.queryKey[0]) === issuesPath &&
				(event.type === "removed" ||
					(event.type === "updated" &&
						event.action.type === "setState" &&
						event.query.state.data === undefined))
			)
				controller.cancel();
		});
	}, [controller, queryClient]);
	const state = useSyncExternalStore(
		controller.subscribe,
		controller.getSnapshot,
	);
	return { controller, state, busy: state.kind !== "idle" };
}
