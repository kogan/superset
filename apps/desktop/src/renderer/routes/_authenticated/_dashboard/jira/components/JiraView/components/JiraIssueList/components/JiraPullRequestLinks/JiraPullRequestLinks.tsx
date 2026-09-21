import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { toast } from "@superset/ui/sonner";
import type { JiraPullRequest } from "lib/trpc/routers/jira/jira-pull-requests";
import { LuGitPullRequest } from "react-icons/lu";
import { electronTrpcClient } from "renderer/lib/trpc-client";

export function JiraPullRequestLinks({
	links,
	loading,
	unavailable,
}: {
	links: JiraPullRequest[];
	loading: boolean;
	unavailable: boolean;
}) {
	const { t } = useLingui();
	if (links.length === 0)
		return (
			<span className="text-xs text-muted-foreground">
				{loading ? (
					<Trans>Loading PRs…</Trans>
				) : unavailable ? (
					<Trans>PRs unavailable</Trans>
				) : (
					<Trans>No linked PR</Trans>
				)}
			</span>
		);
	return (
		<section
			className="flex flex-wrap gap-1.5"
			aria-label={t({ message: "Pull requests" })}
		>
			{links.map((link) => (
				<a
					key={link.url}
					href={link.url}
					title={`${link.repository}: ${link.title}`}
					onClick={(event) => {
						event.preventDefault();
						void electronTrpcClient.external.openUrl
							.mutate(link.url)
							.catch((error: unknown) => toast.error(errorMessage(error)));
					}}
					className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<LuGitPullRequest
						className={`size-3 ${link.state === "merged" ? "text-purple-500" : link.state === "closed" ? "text-red-500" : "text-emerald-500"}`}
					/>
					<span>#{link.number}</span>
					{link.state && (
						<span className="text-muted-foreground">
							{link.state === "merged" ? (
								<Trans>Merged</Trans>
							) : link.state === "closed" ? (
								<Trans>Closed</Trans>
							) : (
								<Trans>Open</Trans>
							)}
						</span>
					)}
				</a>
			))}
		</section>
	);
}
