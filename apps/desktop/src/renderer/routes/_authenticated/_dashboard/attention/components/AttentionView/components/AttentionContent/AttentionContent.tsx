import { Trans, useLingui } from "@lingui/react/macro";
import { formatNumber } from "@superset/i18n/format";
import { Button } from "@superset/ui/button";
import { cn } from "@superset/ui/utils";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { LuCircleCheck, LuInbox, LuRefreshCw } from "react-icons/lu";
import {
	type AttentionFilter,
	useAttentionInbox,
} from "../../../../hooks/useAttentionInbox";
import { AttentionRow } from "./components/AttentionRow";

export function AttentionContent() {
	const { t } = useLingui();
	const navigate = useNavigate();
	const [filter, setFilter] = useState<AttentionFilter>("all");
	const inbox = useAttentionInbox(filter);
	const filters: { value: AttentionFilter; label: string }[] = [
		{ value: "all", label: t({ message: "All" }) },
		{ value: "agents", label: t({ message: "Agents" }) },
		{ value: "failed-checks", label: t({ message: "Failed checks" }) },
		{ value: "reviews", label: t({ message: "Review requests" }) },
	];
	const problems = inbox.sources.filter(
		(source) => source.state === "unavailable" || source.state === "partial",
	);
	return (
		<div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
			<header className="flex items-center gap-4 border-b px-6 py-5">
				<div className="min-w-0">
					<h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
						<LuInbox className="size-5 text-muted-foreground" />
						<Trans>Attention</Trans>
					</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						<Trans>
							Agent input, failed checks on your PRs, and reviews requested from
							you.
						</Trans>
					</p>
				</div>
				<div className="drag min-w-4 flex-1 self-stretch" />
				<Button
					variant="outline"
					size="sm"
					onClick={inbox.refresh}
					disabled={inbox.refreshing}
				>
					<LuRefreshCw
						className={cn(
							"size-4",
							inbox.refreshing && "animate-spin motion-reduce:animate-none",
						)}
					/>
					<Trans>Refresh</Trans>
				</Button>
			</header>
			<fieldset
				className="flex min-w-0 flex-wrap gap-2 border-b px-6 py-3"
				aria-label={t({ message: "Attention filters" })}
			>
				{filters.map(({ value, label }) => (
					<button
						key={value}
						type="button"
						aria-pressed={filter === value}
						onClick={() => setFilter(value)}
						className={cn(
							"flex items-center gap-2 rounded-md px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
							filter === value
								? "bg-accent font-medium text-accent-foreground"
								: "text-muted-foreground hover:bg-muted",
						)}
					>
						{label}
						<span className="rounded bg-background/60 px-1.5 text-xs tabular-nums">
							{formatNumber(inbox.count(value))}
						</span>
					</button>
				))}
			</fieldset>
			<div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
				<div className="mx-auto max-w-4xl space-y-4">
					{!inbox.githubEnabled && (
						<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 text-sm text-muted-foreground">
							<Trans>
								Pull requests are turned off. Only agent input is shown.
							</Trans>
							<Button
								variant="outline"
								size="sm"
								onClick={() => void navigate({ to: "/settings/behavior" })}
							>
								<Trans>Settings</Trans>
							</Button>
						</div>
					)}
					{problems.length > 0 && (
						<div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
							<p className="font-medium">
								<Trans>Some sources could not be fully checked.</Trans>
							</p>
							<p className="mt-1 text-muted-foreground">
								<Trans>
									Load more results, reconnect unavailable hosts, or check your
									GitHub connection, then refresh.
								</Trans>
							</p>
							{problems.some((source) => source.category !== "agents") && (
								<a
									href="https://github.com/pulls"
									target="_blank"
									rel="noreferrer"
									className="mt-2 inline-block underline"
								>
									<Trans>Open on GitHub</Trans>
								</a>
							)}
							<details className="mt-2">
								<summary className="cursor-pointer text-muted-foreground">
									<Trans>Show details</Trans>
								</summary>
								<ul className="mt-2 space-y-1 text-xs text-muted-foreground">
									{problems.map((source) => (
										<li key={source.id}>
											{source.label}:{" "}
											{source.state === "unavailable" ? (
												<Trans>Unavailable</Trans>
											) : (
												<Trans>Partial results</Trans>
											)}
										</li>
									))}
								</ul>
							</details>
						</div>
					)}
					{inbox.items.length > 0 && (
						<ul className="space-y-2">
							{inbox.items.map((item) => (
								<li key={item.id}>
									<AttentionRow item={item} onOpen={() => inbox.open(item)} />
								</li>
							))}
						</ul>
					)}
					{inbox.loading && (
						<output className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
							<LuRefreshCw className="size-4 animate-spin motion-reduce:animate-none" />
							<Trans>Checking for items needing attention…</Trans>
						</output>
					)}
					{!inbox.loading && inbox.items.length === 0 && (
						<div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
							{inbox.complete ? (
								<LuCircleCheck className="size-8 text-muted-foreground" />
							) : (
								<LuInbox className="size-8 text-muted-foreground" />
							)}
							<p className="font-medium">
								{inbox.complete && filter === "all" ? (
									<Trans>You're all caught up</Trans>
								) : (
									<Trans>No loaded items match this filter</Trans>
								)}
							</p>
							<p className="max-w-md text-sm text-muted-foreground">
								{inbox.complete && filter === "all" ? (
									<Trans>
										Items appear here when an agent needs input, your PR checks
										fail, or someone requests your review.
									</Trans>
								) : (
									<Trans>
										Choose another filter or refresh to check again.
									</Trans>
								)}
							</p>
						</div>
					)}
					{inbox.canLoadMore && (
						<div className="flex justify-center">
							<Button
								variant="outline"
								onClick={inbox.loadMore}
								disabled={inbox.refreshing}
							>
								<Trans>Load more</Trans>
							</Button>
						</div>
					)}
					<p className="pt-2 text-center text-xs text-muted-foreground">
						<Trans>
							Connected projects only. Refreshes every minute while this page is
							open.
						</Trans>
					</p>
				</div>
			</div>
		</div>
	);
}
