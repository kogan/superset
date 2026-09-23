import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { alert } from "@superset/ui/atoms/Alert";
import { Button } from "@superset/ui/button";
import { toast } from "@superset/ui/sonner";
import { CodeXml, Loader2, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useWorkspaceHostTarget } from "renderer/hooks/host-service/useWorkspaceHostUrl";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { useFeaturePreferences } from "renderer/stores/feature-preferences";
import { IdeChangesButton } from "./components/IdeChangesButton";
import { IdeThemeSelect } from "./components/IdeThemeSelect";
import { ideRuntimeRegistry } from "./ideRuntimeRegistry";

export function IdePane({
	paneId,
	workspaceId,
	onFocus,
}: {
	paneId: string;
	workspaceId: string;
	onFocus: () => void;
}) {
	const { t } = useLingui();
	const ideEnabled = useFeaturePreferences((state) => state.embeddedIde);
	const host = useWorkspaceHostTarget(workspaceId);
	const placeholder = useRef<HTMLDivElement>(null);
	const focus = useRef(onFocus);
	focus.current = onFocus;
	const subscribe = useCallback(
		(listener: () => void) => ideRuntimeRegistry.subscribe(paneId, listener),
		[paneId],
	);
	const snapshot = useCallback(
		() => ideRuntimeRegistry.getState(paneId),
		[paneId],
	);
	const state = useSyncExternalStore(subscribe, snapshot);
	const pendingFileSnapshot = useCallback(
		() => ideRuntimeRegistry.getPendingFile(paneId),
		[paneId],
	);
	const pendingFile = useSyncExternalStore(subscribe, pendingFileSnapshot);
	const hostKind = host.status === "ready" ? host.kind : null;
	const hostUrl = host.status === "ready" ? host.url : null;
	const open = useCallback(() => {
		if (!ideEnabled || !hostKind || !hostUrl) return;
		void ideRuntimeRegistry.open(paneId, async (isCurrent) => {
			const connection = await getHostServiceClientByUrl(
				hostUrl,
			).ide.start.mutate({ workspaceId });
			if (!isCurrent()) return null;
			return electronTrpcClient.ide.prepare.mutate({
				paneId,
				workspaceId,
				connection,
				target:
					hostKind === "local"
						? { kind: "local" }
						: { kind: "remote", hostUrl },
			});
		});
	}, [paneId, workspaceId, hostKind, hostUrl, ideEnabled]);

	useEffect(() => {
		if (state.status === "idle") open();
	}, [open, state.status]);
	useEffect(() => {
		if (state.status !== "ready" || !placeholder.current) return;
		ideRuntimeRegistry.attach(paneId, placeholder.current, () =>
			focus.current(),
		);
		return () => ideRuntimeRegistry.detach(paneId);
	}, [paneId, state]);
	useEffect(() => {
		if (!pendingFile || !hostUrl || state.status !== "ready") return;
		void ideRuntimeRegistry
			.openNextFile(paneId, async ({ filePath, position }) => {
				await getHostServiceClientByUrl(hostUrl).ide.openFile.mutate({
					workspaceId,
					path: filePath,
					line: position?.line,
					column: position?.column,
				});
			})
			.catch((error: unknown) => toast.error(errorMessage(error)));
	}, [hostUrl, paneId, pendingFile, state.status, workspaceId]);

	const stop = () =>
		alert({
			title: t({ message: "Stop IDE?" }),
			description: t({
				message:
					"Save your files first. This ends IDE terminals and debugging sessions in this worktree.",
			}),
			actions: [
				{ label: t({ message: "Cancel" }), variant: "ghost" },
				{
					label: t({ message: "Stop" }),
					variant: "destructive",
					onClick: async () => {
						try {
							if (!(await ideRuntimeRegistry.canClose(paneId))) {
								toast.error(
									t({ message: "Save your files before closing the IDE." }),
								);
								return;
							}
							await ideRuntimeRegistry.stop(paneId);
							if (hostUrl) {
								await getHostServiceClientByUrl(hostUrl).ide.stop.mutate({
									workspaceId,
								});
							}
						} catch (error) {
							toast.error(errorMessage(error));
						}
					},
				},
			],
		});

	return (
		<div className="flex h-full min-h-0 flex-1 flex-col">
			{state.status === "ready" ? (
				<>
					<div className="flex h-8 shrink-0 items-center justify-between border-b px-2 text-xs text-muted-foreground">
						<IdeChangesButton workspaceId={workspaceId} />
						<div className="flex items-center gap-1">
							{hostUrl && (
								<IdeThemeSelect hostUrl={hostUrl} workspaceId={workspaceId} />
							)}
							<Button
								variant="ghost"
								size="sm"
								className="h-6 gap-1 text-xs"
								onClick={stop}
							>
								<Square className="size-3" />
								<Trans>Stop IDE</Trans>
							</Button>
						</div>
					</div>
					<div ref={placeholder} className="min-h-0 flex-1" />
				</>
			) : !ideEnabled ? (
				<div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
					<Trans>
						Enable Embedded IDE in Settings &gt; General &gt; Features.
					</Trans>
				</div>
			) : (
				<div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center text-sm">
					{state.status === "loading" || !hostKind ? (
						<Loader2 className="size-6 animate-spin" />
					) : (
						<CodeXml className="size-8 text-muted-foreground" />
					)}
					{state.status === "error" ? (
						<>
							<p className="max-w-lg text-muted-foreground">
								{errorMessage(state.error)}
							</p>
							<Button onClick={open}>
								<Trans>Retry</Trans>
							</Button>
						</>
					) : state.status === "loading" || !hostKind ? (
						<p className="max-w-md text-muted-foreground">
							<Trans>
								Preparing IDE. First use downloads the editor runtime.
							</Trans>
						</p>
					) : (
						<Button onClick={open}>
							<Trans>Open IDE</Trans>
						</Button>
					)}
				</div>
			)}
		</div>
	);
}
