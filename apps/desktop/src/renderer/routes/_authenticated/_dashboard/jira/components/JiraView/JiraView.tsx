import { Trans } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { Button } from "@superset/ui/button";
import { useNavigate } from "@tanstack/react-router";
import { LuRefreshCw, LuSettings } from "react-icons/lu";
import { SiJira } from "react-icons/si";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useSetSettingsSearchQuery } from "renderer/stores/settings-state";
import { JiraIssueList } from "./components/JiraIssueList";

export function JiraView() {
	const connection = electronTrpc.jira.getConnection.useQuery(undefined, {
		retry: false,
	});
	const navigate = useNavigate();
	const setSettingsSearchQuery = useSetSettingsSearchQuery();
	const openSettings = () => {
		setSettingsSearchQuery("Jira");
		void navigate({ to: "/settings/integrations" });
	};

	return (
		<div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
			<div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-5">
				<div>
					<h1 className="flex items-center gap-2 font-semibold text-xl tracking-tight">
						<SiJira className="size-5 text-muted-foreground" />
						<Trans>Jira</Trans>
					</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						<Trans>Your team’s issues and pull requests.</Trans>
					</p>
				</div>
				<Button variant="outline" size="sm" onClick={openSettings}>
					<LuSettings className="size-4" />
					<Trans>Settings</Trans>
				</Button>
			</div>
			{connection.isPending ? (
				<output className="flex flex-1 items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
					<LuRefreshCw className="size-4 animate-spin motion-reduce:animate-none" />
					<Trans>Loading…</Trans>
				</output>
			) : connection.isError ? (
				<div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-sm">
					<p className="text-destructive" role="alert">
						{errorMessage(connection.error)}
					</p>
					<Button
						variant="outline"
						size="sm"
						onClick={() => void connection.refetch()}
					>
						<Trans>Try again</Trans>
					</Button>
				</div>
			) : connection.data.status === "connected" ? (
				<JiraIssueList
					key={JSON.stringify(connection.data)}
					baseUrl={connection.data.baseUrl}
				/>
			) : (
				<div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
					<SiJira className="size-9 text-muted-foreground" />
					<p className="max-w-sm text-sm text-muted-foreground">
						<Trans>
							Connect your Jira site in Settings to see your issues.
						</Trans>
					</p>
					<Button onClick={openSettings}>
						<Trans>Connect</Trans>
					</Button>
				</div>
			)}
		</div>
	);
}
