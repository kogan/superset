import { Trans } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import { cn } from "@superset/ui/utils";
import { LuCircleCheck, LuInbox, LuRefreshCw } from "react-icons/lu";
import { useAttentionInbox } from "../../../../hooks/useAttentionInbox";
import { AttentionRow } from "./components/AttentionRow";

export function AttentionContent() {
	const inbox = useAttentionInbox();
	const problems = inbox.sources.filter(
		(source) => source.state === "unavailable",
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
						<Trans>Agents waiting for your input.</Trans>
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
			<div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
				<div className="mx-auto max-w-4xl space-y-4">
					{problems.length > 0 && (
						<div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
							<p className="font-medium">
								<Trans>Some sources could not be fully checked.</Trans>
							</p>
							<p className="mt-1 text-muted-foreground">
								<Trans>Reconnect unavailable hosts, then refresh.</Trans>
							</p>
							<details className="mt-2">
								<summary className="cursor-pointer text-muted-foreground">
									<Trans>Show details</Trans>
								</summary>
								<ul className="mt-2 space-y-1 text-xs text-muted-foreground">
									{problems.map((source) => (
										<li key={source.id}>
											{source.label}: <Trans>Unavailable</Trans>
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
					{!inbox.loading && inbox.items.length === 0 && inbox.complete && (
						<div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
							<LuCircleCheck className="size-8 text-muted-foreground" />
							<p className="font-medium">
								<Trans>You're all caught up</Trans>
							</p>
							<p className="max-w-md text-sm text-muted-foreground">
								<Trans>Items appear here when an agent needs your input.</Trans>
							</p>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
