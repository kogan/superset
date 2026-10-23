import { Trans } from "@lingui/react/macro";
import { cn } from "@superset/ui/utils";
import { ChevronUp, GitBranch, RotateCw } from "lucide-react";
import { useState } from "react";
import type { StackNode } from "../../buildStack";
import { StackNodeRow } from "../StackNodeRow";

interface StackTabContentProps {
	nodes: StackNode[];
	isLoading: boolean;
	/** The checked-out branch has an open PR (vs. no PR at all). */
	hasPr: boolean;
	owner: string;
	repo: string;
	workspaceId: string;
	/** The PR number linked to the workspace record, or null if none. */
	linkedPrNumber: number | null;
	onRefresh: () => void;
}

/**
 * Renders the PR stack as a single spine — current branch at the top, trunk
 * below the last node. A header names the trunk and offers refresh /
 * collapse-all; each node opens its PR and expands to the files it changes.
 * One PR (or none) is not a stack, so the view says so instead of a lone dot.
 */
export function StackTabContent({
	nodes,
	isLoading,
	hasPr,
	owner,
	repo,
	workspaceId,
	linkedPrNumber,
	onRefresh,
}: StackTabContentProps) {
	const [expanded, setExpanded] = useState<ReadonlySet<number>>(
		() => new Set(),
	);
	const toggle = (prNumber: number) =>
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(prNumber)) next.delete(prNumber);
			else next.add(prNumber);
			return next;
		});

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

	const trunkRef = nodes[nodes.length - 1]?.baseRef ?? null;

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
				<span className="text-xs font-semibold">
					<Trans>Stack</Trans>
				</span>
				{trunkRef && (
					<span className="flex min-w-0 items-center gap-1 rounded-full border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
						<GitBranch className="size-2.5 shrink-0" aria-hidden />
						<span className="truncate">{trunkRef}</span>
					</span>
				)}
				<span className="flex-1" />
				<button
					type="button"
					aria-label="Refresh"
					onClick={onRefresh}
					className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
				>
					<RotateCw className="size-3" aria-hidden />
				</button>
				<button
					type="button"
					aria-label="Collapse all"
					onClick={() => setExpanded(new Set())}
					className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
				>
					<ChevronUp className="size-3.5" aria-hidden />
				</button>
			</div>

			<ul
				aria-label="PR stack"
				className="flex min-h-0 flex-1 flex-col overflow-y-auto py-1 pr-2"
			>
				{nodes.map((node, index) => (
					<li key={node.number} className="relative pl-6">
						{/* Trunk always follows, so every PR node's spine runs downward. */}
						<span
							aria-hidden
							className={cn(
								"absolute left-[11px] w-px bg-border",
								index === 0 ? "top-4 bottom-0" : "inset-y-0",
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
						<StackNodeRow
							node={node}
							isOpen={expanded.has(node.number)}
							onToggle={() => toggle(node.number)}
							owner={owner}
							repo={repo}
							workspaceId={workspaceId}
							isLinked={node.number === linkedPrNumber}
						/>
					</li>
				))}

				{trunkRef && (
					<li className="relative pl-6">
						<span
							aria-hidden
							className="absolute left-[11px] top-0 h-[13px] w-px bg-border"
						/>
						<span
							aria-hidden
							className="absolute left-[9px] top-[11px] size-2 rounded-full bg-muted-foreground"
						/>
						<div className="flex items-center gap-1 py-1 pl-[26px]">
							<span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
								{trunkRef}
							</span>
							<span className="shrink-0 rounded bg-muted px-1 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
								<Trans>trunk</Trans>
							</span>
						</div>
					</li>
				)}
			</ul>
		</div>
	);
}
