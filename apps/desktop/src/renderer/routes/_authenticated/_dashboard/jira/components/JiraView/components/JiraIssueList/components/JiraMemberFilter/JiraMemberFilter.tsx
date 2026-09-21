import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { Button } from "@superset/ui/button";
import {
	Command,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "@superset/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@superset/ui/popover";
import type { JiraListInput } from "lib/trpc/routers/jira/jira-schema";
import { useState } from "react";
import { LuChevronDown, LuUserRound } from "react-icons/lu";
import { useDebouncedValue } from "renderer/hooks/useDebouncedValue";
import { electronTrpc } from "renderer/lib/electron-trpc";
import type { JiraIssue } from "../JiraKanban/utils/groupIssuesByStatus";

type Assignee = Extract<JiraListInput["scope"], { kind: "board" }>["assignee"];
export type MemberSelection =
	| Exclude<Assignee, { kind: "member" }>
	| (Extract<Assignee, { kind: "member" }> & { displayName: string });
export function JiraMemberFilter({
	value,
	onChange,
	issues,
}: {
	value: MemberSelection;
	onChange: (value: MemberSelection) => void;
	issues: JiraIssue[];
}) {
	const { t } = useLingui();
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const debounced = useDebouncedValue(search.trim(), 250);
	const members = electronTrpc.jira.searchMembers.useQuery(
		{ search: debounced },
		{
			enabled: open && debounced.length >= 2,
			retry: false,
			staleTime: 60_000,
			gcTime: 0,
		},
	);
	const known = new Map(
		issues.flatMap((issue) =>
			issue.assignee ? [[issue.assignee.id, issue.assignee] as const] : [],
		),
	);
	for (const member of members.data ?? []) known.set(member.id, member);
	if (value.kind === "member") known.set(value.id, value);
	const options = [...known.values()]
		.filter((member) =>
			member.displayName.toLowerCase().includes(search.toLowerCase()),
		)
		.sort((a, b) => a.displayName.localeCompare(b.displayName));
	const select = (next: MemberSelection) => {
		onChange(next);
		setOpen(false);
		setSearch("");
	};
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					size="sm"
					aria-label={t({ message: "Filter by member" })}
				>
					<LuUserRound className="size-3.5" />
					{value.kind === "member" ? (
						value.displayName
					) : value.kind === "me" ? (
						<Trans>Assigned to me</Trans>
					) : value.kind === "unassigned" ? (
						<Trans>Unassigned</Trans>
					) : (
						<Trans>All assignees</Trans>
					)}
					<LuChevronDown className="size-3" />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-72 p-0">
				<Command shouldFilter={false}>
					<CommandInput
						placeholder={t({ message: "Search people..." })}
						value={search}
						onValueChange={setSearch}
					/>
					<CommandList>
						<CommandItem value="all" onSelect={() => select({ kind: "all" })}>
							<Trans>All assignees</Trans>
						</CommandItem>
						<CommandItem value="me" onSelect={() => select({ kind: "me" })}>
							<Trans>Assigned to me</Trans>
						</CommandItem>
						<CommandItem
							value="unassigned"
							onSelect={() => select({ kind: "unassigned" })}
						>
							<Trans>Unassigned</Trans>
						</CommandItem>
						<CommandSeparator />
						{options.map((member) => (
							<CommandItem
								key={member.id}
								value={member.id}
								onSelect={() => select({ kind: "member", ...member })}
							>
								{member.displayName}
							</CommandItem>
						))}
						{debounced.length >= 2 && members.isFetching && (
							<p className="p-3 text-xs text-muted-foreground">
								<Trans>Loading…</Trans>
							</p>
						)}
						{debounced.length >= 2 && members.isError && (
							<div className="p-3 text-xs">
								<p role="alert" className="text-destructive">
									{errorMessage(members.error)}
								</p>
								<Button
									size="sm"
									variant="ghost"
									onClick={() => void members.refetch()}
								>
									<Trans>Retry</Trans>
								</Button>
							</div>
						)}
						{search.length < 2 && (
							<p className="p-3 text-xs text-muted-foreground">
								<Trans>Type at least 2 characters to find more people.</Trans>
							</p>
						)}
						{search.length >= 2 &&
							!members.isFetching &&
							options.length === 0 && (
								<p className="p-3 text-xs text-muted-foreground">
									<Trans>No results found.</Trans>
								</p>
							)}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
