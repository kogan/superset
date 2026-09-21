import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { Button } from "@superset/ui/button";
import {
	Command,
	CommandInput,
	CommandItem,
	CommandList,
} from "@superset/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@superset/ui/popover";
import { toast } from "@superset/ui/sonner";
import { useState } from "react";
import { LuChevronDown } from "react-icons/lu";
import { useDebouncedValue } from "renderer/hooks/useDebouncedValue";
import { electronTrpc } from "renderer/lib/electron-trpc";

export function JiraBoardPicker({
	board,
	onSelect,
}: {
	board?: { id: number; name: string };
	onSelect: () => void;
}) {
	const { t } = useLingui();
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const debounced = useDebouncedValue(search, 250);
	const utils = electronTrpc.useUtils();
	const boards = electronTrpc.jira.listBoards.useInfiniteQuery(
		{ search: debounced },
		{
			enabled: open,
			getNextPageParam: (page) => page.nextCursor ?? undefined,
			retry: false,
			staleTime: 60_000,
			gcTime: 0,
		},
	);
	const select = electronTrpc.jira.selectBoard.useMutation({
		onSuccess: (settings) => {
			utils.jira.getPreferences.setData(undefined, settings);
			onSelect();
			setOpen(false);
		},
		onError: (error) => toast.error(errorMessage(error)),
	});
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					size="sm"
					aria-label={t({ message: "Team board" })}
				>
					{board?.name ?? <Trans>Choose team board</Trans>}
					<LuChevronDown className="size-3" />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-80 p-0">
				<Command shouldFilter={false}>
					<CommandInput
						placeholder={t({ message: "Search boards…" })}
						value={search}
						onValueChange={setSearch}
					/>
					<CommandList>
						{boards.isPending && (
							<p className="p-3 text-sm text-muted-foreground">
								<Trans>Loading…</Trans>
							</p>
						)}
						{boards.isError && (
							<div className="p-3 text-sm">
								<p role="alert" className="text-destructive">
									{errorMessage(boards.error)}
								</p>
								<Button
									size="sm"
									variant="ghost"
									onClick={() => void boards.refetch()}
								>
									<Trans>Retry</Trans>
								</Button>
							</div>
						)}
						{boards.data?.pages
							.flatMap((page) => page.boards)
							.map((candidate) => (
								<CommandItem
									key={candidate.id}
									value={String(candidate.id)}
									disabled={select.isPending}
									onSelect={() => select.mutate(candidate.id)}
								>
									{candidate.name}
									<span className="ml-auto text-xs text-muted-foreground">
										#{candidate.id}
									</span>
								</CommandItem>
							))}
						{boards.data?.pages.every((page) => page.boards.length === 0) && (
							<p className="p-3 text-sm text-muted-foreground">
								<Trans>No results found.</Trans>
							</p>
						)}
						{boards.hasNextPage && (
							<Button
								className="m-2"
								variant="ghost"
								size="sm"
								disabled={boards.isFetching}
								onClick={() => void boards.fetchNextPage()}
							>
								<Trans>Load more</Trans>
							</Button>
						)}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
