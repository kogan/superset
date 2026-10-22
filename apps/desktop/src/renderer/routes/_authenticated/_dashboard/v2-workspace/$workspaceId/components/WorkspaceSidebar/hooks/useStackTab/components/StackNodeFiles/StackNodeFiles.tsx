import { Trans } from "@lingui/react/macro";
import { workspaceTrpc } from "@superset/workspace-client";

interface StackNodeFilesProps {
	owner: string;
	repo: string;
	number: number;
}

/** The files changed in one PR of the stack, fetched on expand. */
export function StackNodeFiles({ owner, repo, number }: StackNodeFilesProps) {
	const filesQuery = workspaceTrpc.github.listPullRequestFiles.useQuery(
		{ owner, repo, number },
		{ enabled: !!owner && !!repo, staleTime: 30_000 },
	);

	if (filesQuery.isLoading) {
		return (
			<div className="py-1 pl-7 text-[11px] text-muted-foreground">
				<Trans>Loading files…</Trans>
			</div>
		);
	}

	const files = filesQuery.data ?? [];
	if (files.length === 0) {
		return (
			<div className="py-1 pl-7 text-[11px] text-muted-foreground">
				<Trans>No file changes.</Trans>
			</div>
		);
	}

	return (
		<ul className="mb-1 ml-[15px] flex flex-col border-l border-border pl-2">
			{files.map((file) => (
				<li
					key={file.filename}
					className="flex items-center gap-1.5 rounded-sm px-1.5 py-0.5"
				>
					<span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
						{file.filename}
					</span>
					<span className="shrink-0 font-mono text-[10px] tabular-nums">
						{file.additions > 0 && (
							<span className="text-emerald-500">+{file.additions}</span>
						)}{" "}
						{file.deletions > 0 && (
							<span className="text-destructive">−{file.deletions}</span>
						)}
					</span>
				</li>
			))}
		</ul>
	);
}
