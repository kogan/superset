import { Trans } from "@lingui/react/macro";
import { formatRelativeTime } from "@superset/i18n/format";
import { LuArrowUpRight, LuMessageCircle } from "react-icons/lu";
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
				<LuMessageCircle className="size-4" />
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
					<span>{item.workspaceName}</span>
					{item.updatedAt > 0 && (
						<span>· {formatRelativeTime(item.updatedAt)}</span>
					)}
				</div>
				<p className="mt-1 break-words text-sm font-medium">{item.title}</p>
				<div className="mt-2 flex flex-wrap gap-2 text-xs">
					<span className="rounded bg-amber-500/10 px-2 py-0.5 text-amber-600 dark:text-amber-400">
						<Trans>Needs input</Trans>
					</span>
				</div>
			</div>
			<LuArrowUpRight className="mt-1 size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
		</button>
	);
}
