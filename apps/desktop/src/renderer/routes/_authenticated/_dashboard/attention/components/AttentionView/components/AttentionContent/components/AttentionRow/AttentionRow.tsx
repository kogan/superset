import { Trans } from "@lingui/react/macro";
import { formatRelativeTime } from "@superset/i18n/format";
import {
	LuArrowUpRight,
	LuGitPullRequest,
	LuMessageCircle,
} from "react-icons/lu";
import type { AttentionItem } from "../../../../../../hooks/useAttentionInbox";

export function AttentionRow({
	item,
	onOpen,
}: {
	item: AttentionItem;
	onOpen: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onOpen}
			className="group flex w-full items-start gap-3 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
		>
			<div className="mt-0.5 rounded-md bg-muted p-2 text-muted-foreground">
				{item.kind === "agent" ? (
					<LuMessageCircle className="size-4" />
				) : (
					<LuGitPullRequest className="size-4" />
				)}
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
					<span>
						{item.kind === "agent"
							? item.workspaceName
							: `${item.projectName} #${item.prNumber}`}
					</span>
					{item.updatedAt > 0 && (
						<span>· {formatRelativeTime(item.updatedAt)}</span>
					)}
				</div>
				<p className="mt-1 break-words text-sm font-medium">{item.title}</p>
				<div className="mt-2 flex flex-wrap gap-2 text-xs">
					{item.kind === "agent" ? (
						<span className="rounded bg-amber-500/10 px-2 py-0.5 text-amber-600 dark:text-amber-400">
							<Trans>Needs input</Trans>
						</span>
					) : (
						<>
							{item.reasons.includes("failed-checks") && (
								<span className="rounded bg-destructive/10 px-2 py-0.5 text-destructive">
									<Trans>Failed checks</Trans>
								</span>
							)}
							{item.reasons.includes("reviews") && (
								<span className="rounded bg-blue-500/10 px-2 py-0.5 text-blue-600 dark:text-blue-400">
									<Trans>Review requested</Trans>
								</span>
							)}
						</>
					)}
				</div>
				{item.kind === "pull-request" &&
					item.reasons.includes("failed-checks") && (
						<p className="mt-2 truncate text-xs text-muted-foreground">
							{item.failedCheckNames.join(" · ")}
						</p>
					)}
			</div>
			<LuArrowUpRight className="mt-1 size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
		</button>
	);
}
