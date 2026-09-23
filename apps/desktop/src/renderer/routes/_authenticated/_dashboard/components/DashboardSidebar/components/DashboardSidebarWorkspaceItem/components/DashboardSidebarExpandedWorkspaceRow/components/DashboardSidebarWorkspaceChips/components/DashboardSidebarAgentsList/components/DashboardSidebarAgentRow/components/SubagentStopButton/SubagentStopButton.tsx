import { useLingui } from "@lingui/react/macro";
import { toast } from "@superset/ui/sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Square } from "lucide-react";
import { getTerminalAgentBindingsQueryKey } from "renderer/hooks/host-service/useTerminalAgentBindings";
import { useWorkspaceHostUrl } from "renderer/hooks/host-service/useWorkspaceHostUrl";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";

export function SubagentStopButton(input: {
	workspaceId: string;
	terminalId: string;
	subagentId: string;
}) {
	const { t } = useLingui();
	const hostUrl = useWorkspaceHostUrl(input.workspaceId);
	const queryClient = useQueryClient();
	const queryKey = [
		"subagent-stop-capability",
		hostUrl,
		input.workspaceId,
		input.terminalId,
		input.subagentId,
	];
	const capability = useQuery({
		queryKey,
		enabled: Boolean(hostUrl),
		staleTime: 30_000,
		retry: false,
		queryFn: () =>
			hostUrl
				? getHostServiceClientByUrl(
						hostUrl,
					).terminalAgents.subagentStopCapability.query(input)
				: Promise.resolve({ supported: false }),
	});
	const stop = useMutation({
		mutationFn: async () => {
			if (!hostUrl || !capability.data?.supported) return;
			await getHostServiceClientByUrl(
				hostUrl,
			).terminalAgents.stopSubagent.mutate(input);
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: getTerminalAgentBindingsQueryKey(input.workspaceId),
			});
			await queryClient.invalidateQueries({ queryKey });
		},
		onError: (error) => {
			console.error("[SubagentStopButton] Failed to stop subagent:", error);
			toast.error(t({ message: "Failed to stop agent" }));
			void queryClient.invalidateQueries({ queryKey });
		},
	});
	const label = t({ message: "Stop subagent" });
	const explanation = capability.data?.supported
		? label
		: t({ message: "Stop this subagent using the agent's own controls." });
	return (
		<span title={explanation}>
			<button
				type="button"
				aria-label={label}
				disabled={!hostUrl || !capability.data?.supported || stop.isPending}
				onClick={(event) => {
					event.stopPropagation();
					stop.mutate();
				}}
				onKeyDown={(event) => event.stopPropagation()}
				className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-40"
			>
				{stop.isPending ? (
					<LoaderCircle className="size-3 animate-spin" aria-hidden />
				) : (
					<Square className="size-3" aria-hidden />
				)}
			</button>
		</span>
	);
}
