import { Trans } from "@lingui/react/macro";
import { workspaceTrpc } from "@superset/workspace-client";
import { Check, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import type { StackNode } from "../../buildStack";
import { StackNodeFiles } from "../StackNodeFiles";

interface StackNodeRowProps {
	node: StackNode;
	isOpen: boolean;
	onToggle: () => void;
	owner: string;
	repo: string;
}

/** Collapse GitHub's status × conclusion into pass vs still-running. */
function isPassed(check: {
	status: string;
	conclusion: string | null;
}): boolean {
	if (check.status !== "completed") return false;
	return (
		check.conclusion === "success" ||
		check.conclusion === "neutral" ||
		check.conclusion === "skipped"
	);
}

/**
 * One PR in the stack: diffstat + state chip + checks badge in the header, its
 * changed files on expand. Diffstat/checks come from a per-node stats query and
 * simply stay hidden until they load (or if they can't be read).
 */
export function StackNodeRow({
	node,
	isOpen,
	onToggle,
	owner,
	repo,
}: StackNodeRowProps) {
	const openUrl = electronTrpc.external.openUrl.useMutation();
	const statsQuery = workspaceTrpc.github.getPullRequestStats.useQuery(
		{ owner, repo, number: node.number },
		{ enabled: !!owner && !!repo, staleTime: 30_000 },
	);
	const stats = statsQuery.data;

	const checks = stats?.checks ?? [];
	const checksRunning = checks.some((check) => check.status !== "completed");
	const checksPassed = checks.filter(isPassed).length;

	return (
		<div>
			<div className="flex items-center gap-1">
				<button
					type="button"
					aria-label={isOpen ? "Collapse files" : "Expand files"}
					aria-expanded={isOpen}
					onClick={onToggle}
					className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
				>
					{isOpen ? (
						<ChevronDown className="size-3.5" aria-hidden />
					) : (
						<ChevronRight className="size-3.5" aria-hidden />
					)}
				</button>
				<button
					type="button"
					onClick={() => openUrl.mutate(node.url)}
					className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
				>
					<span className="flex min-w-0 flex-1 flex-col gap-0.5">
						<span className="flex items-center gap-1.5">
							<span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
								#{node.number}
							</span>
							<span className="min-w-0 truncate text-xs">{node.title}</span>
							{node.isCurrent && (
								<span className="shrink-0 rounded border border-emerald-500/40 px-1 font-mono text-[9px] uppercase tracking-wide text-emerald-500">
									<Trans>You</Trans>
								</span>
							)}
						</span>
						<span className="flex items-center gap-1.5">
							<span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground">
								{node.headRef}
							</span>
							<span className="shrink-0 rounded bg-muted px-1 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
								{node.isDraft ? <Trans>Draft</Trans> : <Trans>Open</Trans>}
							</span>
							{!checksRunning && checks.length > 0 && (
								<span className="flex shrink-0 items-center gap-0.5 font-mono text-[10px] text-emerald-500">
									<Check className="size-3" aria-hidden />
									{checksPassed}
								</span>
							)}
							{checksRunning && (
								<Loader2
									className="size-3 shrink-0 animate-spin text-amber-500"
									aria-hidden
								/>
							)}
						</span>
					</span>
					{stats && (
						<span className="shrink-0 font-mono text-[10px] tabular-nums">
							{stats.additions > 0 && (
								<span className="text-emerald-500">+{stats.additions}</span>
							)}{" "}
							{stats.deletions > 0 && (
								<span className="text-destructive">−{stats.deletions}</span>
							)}
						</span>
					)}
				</button>
			</div>
			{isOpen && (
				<StackNodeFiles owner={owner} repo={repo} number={node.number} />
			)}
		</div>
	);
}
