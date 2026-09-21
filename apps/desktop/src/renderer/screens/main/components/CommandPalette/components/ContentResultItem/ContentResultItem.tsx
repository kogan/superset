import type { AppRouter } from "@superset/host-service";
import { CommandPrimitive } from "@superset/ui/command";
import type { inferRouterOutputs } from "@trpc/server";
import { FileIcon } from "renderer/lib/fileIcons";

type ContentMatch =
	inferRouterOutputs<AppRouter>["filesystem"]["searchContent"]["matches"][number];

export function ContentResultItem({
	match,
	query,
	onSelect,
}: {
	match: ContentMatch;
	query: string;
	onSelect: () => void;
}) {
	const fileName = match.relativePath.split("/").at(-1) ?? match.relativePath;
	const matchIndex = match.preview.toLowerCase().indexOf(query.toLowerCase());
	return (
		<CommandPrimitive.Item
			value={`${match.absolutePath}:${match.line}:${match.column}`}
			onSelect={onSelect}
			className="flex cursor-default flex-col gap-1 rounded-sm px-2 py-2 text-sm outline-hidden data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
		>
			<div className="flex w-full min-w-0 items-center gap-2">
				<FileIcon fileName={fileName} className="size-3.5 shrink-0" />
				<span className="truncate text-xs">{match.relativePath}</span>
				<span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
					{match.line}:{match.column}
				</span>
			</div>
			<div className="w-full truncate pl-5 font-mono text-xs text-muted-foreground">
				{matchIndex < 0 ? (
					match.preview
				) : (
					<>
						{match.preview.slice(0, matchIndex)}
						<mark className="rounded-sm bg-amber-400/25 text-foreground">
							{match.preview.slice(matchIndex, matchIndex + query.length)}
						</mark>
						{match.preview.slice(matchIndex + query.length)}
					</>
				)}
			</div>
		</CommandPrimitive.Item>
	);
}
