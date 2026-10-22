import { Trans } from "@lingui/react/macro";
import { cn } from "@superset/ui/utils";
import { electronTrpc } from "renderer/lib/electron-trpc";
import type { StackNode } from "../../buildStack";

interface StackTabContentProps {
	nodes: StackNode[];
	isLoading: boolean;
	/** The checked-out branch has an open PR (vs. no PR at all). */
	hasPr: boolean;
}

/**
 * Renders the PR stack as a single spine — current branch at the top, trunk
 * below the last node. Each node opens its PR. One PR (or none) is not a
 * stack, so the view explains that instead of drawing a lone dot.
 */
export function StackTabContent({
	nodes,
	isLoading,
	hasPr,
}: StackTabContentProps) {
	const openUrl = electronTrpc.external.openUrl.useMutation();

	if (isLoading && nodes.length === 0) {
		return (
			<div className="px-4 py-3 text-xs text-muted-foreground">
				<Trans>Loading stack…</Trans>
			</div>
		);
	}

	if (nodes.length <= 1) {
		return (
			<div className="px-4 py-3 text-xs text-muted-foreground">
				{hasPr ? (
					<Trans>This branch targets trunk directly — not a stack.</Trans>
				) : (
					<Trans>No pull request for this branch yet.</Trans>
				)}
			</div>
		);
	}

	return (
		<ul aria-label="PR stack" className="flex flex-col py-1 pr-2">
			{nodes.map((node, index) => {
				const isFirst = index === 0;
				const isLast = index === nodes.length - 1;
				return (
					<li key={node.number} className="relative pl-6">
						<span
							aria-hidden
							className={cn(
								"absolute left-[11px] w-px bg-border",
								isFirst ? "top-4 bottom-0" : isLast ? "top-0 h-4" : "inset-y-0",
							)}
						/>
						<span
							aria-hidden
							className={cn(
								"absolute left-2 top-[13px] size-2.5 rounded-full border-2 bg-background",
								node.isCurrent
									? "border-emerald-500 bg-emerald-500"
									: node.isDraft
										? "border-muted-foreground"
										: "border-emerald-500",
							)}
						/>
						<button
							type="button"
							onClick={() => openUrl.mutate(node.url)}
							className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
						>
							<span className="flex min-w-0 flex-1 flex-col gap-0.5">
								<span className="flex items-center gap-1.5">
									<span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
										#{node.number}
									</span>
									<span className="min-w-0 truncate text-xs">{node.title}</span>
								</span>
								<span className="flex items-center gap-1.5">
									<span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground">
										{node.headRef}
									</span>
									{node.isDraft && (
										<span className="shrink-0 rounded bg-muted px-1 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
											<Trans>Draft</Trans>
										</span>
									)}
								</span>
							</span>
							{node.isCurrent && (
								<span className="shrink-0 rounded border border-emerald-500/40 px-1 font-mono text-[9px] uppercase tracking-wide text-emerald-500">
									<Trans>You</Trans>
								</span>
							)}
						</button>
					</li>
				);
			})}
		</ul>
	);
}
