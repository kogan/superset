import { msg } from "@lingui/core/macro";
import { useLingui as useTranslation } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { errorMessage } from "@superset/i18n/errors";
import { CommandPrimitive, CommandSeparator } from "@superset/ui/command";
import { Loader2, SearchIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";
import type { RecentFile } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useRecentlyViewedFiles";
import { RECENT_DISPLAY_LIMIT } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useRecentlyViewedFiles";
import { useFileSearch } from "renderer/screens/main/components/WorkspaceView/RightSidebar/FilesView/hooks/useFileSearch/useFileSearch";
import { useFeaturePreferences } from "renderer/stores/feature-preferences";
import { ContentResultItem } from "./components/ContentResultItem";
import { FileResultItem } from "./components/FileResultItem";
import { useV2FileSearch } from "./hooks/useV2FileSearch";
import {
	type FileSearchMode,
	SEARCH_LIMIT,
} from "./hooks/useV2FileSearch/useV2FileSearch";

// 48px input + 10 * 40px items
const MAX_DIALOG_HEIGHT = 448;

export interface CommandPaletteProps {
	workspaceId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSelectFile: (
		filePath: string,
		location?: { line: number; column: number },
	) => void;
	variant?: "v1" | "v2";
	recentlyViewedFiles?: RecentFile[];
	openFilePaths?: Set<string>;
}

function getFileName(relativePath: string): string {
	const segments = relativePath.split("/");
	return segments[segments.length - 1] ?? relativePath;
}

export function CommandPalette({
	workspaceId,
	open,
	onOpenChange,
	onSelectFile,
	variant = "v1",
	recentlyViewedFiles,
	openFilePaths,
}: CommandPaletteProps) {
	const { _: translate } = useTranslation();

	const [query, setQuery] = useState("");
	const [selectedMode, setMode] = useState<FileSearchMode>("files");
	const contentSearchEnabled = useFeaturePreferences(
		(state) => state.fileContentSearch,
	);
	const mode = contentSearchEnabled ? selectedMode : "files";
	const [filtersOpen, setFiltersOpen] = useState(false);
	const [includePattern, setIncludePattern] = useState("");
	const [excludePattern, setExcludePattern] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	const v1Search = useFileSearch({
		workspaceId: variant === "v1" && open ? workspaceId : undefined,
		searchTerm: variant === "v1" ? query : "",
		includePattern: variant === "v1" ? includePattern : "",
		excludePattern: variant === "v1" ? excludePattern : "",
		limit: SEARCH_LIMIT,
	});

	const v2Search = useV2FileSearch({
		workspaceId: variant === "v2" && open ? workspaceId : undefined,
		query: variant === "v2" ? query : "",
		mode,
		includePattern,
		excludePattern,
	});

	const rawResults =
		variant === "v2" ? v2Search.results : v1Search.searchResults;
	const trimmedQuery = query.trim();
	const hasQuery = trimmedQuery.length > 0;
	const showRecentSection =
		variant === "v2" &&
		mode === "files" &&
		!query.trim() &&
		!includePattern &&
		!excludePattern &&
		Boolean(recentlyViewedFiles);
	const isFetching =
		variant === "v2" ? v2Search.isFetching : v1Search.isFetching;
	const searchError = variant === "v2" ? v2Search.error : null;

	const orderedRecent = useMemo<RecentFile[]>(() => {
		if (!showRecentSection || !recentlyViewedFiles) return [];
		const openSet = openFilePaths ?? new Set<string>();
		const openFiles: RecentFile[] = [];
		const rest: RecentFile[] = [];
		for (const file of recentlyViewedFiles) {
			if (openSet.has(file.absolutePath)) {
				openFiles.push(file);
			} else {
				rest.push(file);
			}
		}
		return [...openFiles, ...rest].slice(0, RECENT_DISPLAY_LIMIT);
	}, [showRecentSection, recentlyViewedFiles, openFilePaths]);

	const filteredRecent = useMemo<RecentFile[]>(() => {
		if (!showRecentSection) return [];
		if (!hasQuery) return orderedRecent;
		const needle = trimmedQuery.toLowerCase();
		return orderedRecent.filter((file) =>
			file.relativePath.toLowerCase().includes(needle),
		);
	}, [showRecentSection, hasQuery, trimmedQuery, orderedRecent]);

	const recentAbsSet = useMemo(
		() => new Set(filteredRecent.map((f) => f.absolutePath)),
		[filteredRecent],
	);

	const dedupedResults = useMemo(() => {
		if (!showRecentSection) return rawResults;
		return rawResults.filter((r) => !recentAbsSet.has(r.path));
	}, [showRecentSection, rawResults, recentAbsSet]);

	const handleOpenChange = useCallback(
		(nextOpen: boolean) => {
			onOpenChange(nextOpen);
			if (!nextOpen) setQuery("");
		},
		[onOpenChange],
	);

	const handleSelectFile = useCallback(
		(filePath: string, location?: { line: number; column: number }) => {
			onSelectFile(filePath, location);
			handleOpenChange(false);
		},
		[onSelectFile, handleOpenChange],
	);

	useEffect(() => {
		if (open) requestAnimationFrame(() => inputRef.current?.focus());
	}, [open]);

	const showHeading = showRecentSection && filteredRecent.length > 0;
	const showSeparator =
		showRecentSection && filteredRecent.length > 0 && dedupedResults.length > 0;
	const showEmptyState =
		filteredRecent.length === 0 &&
		dedupedResults.length === 0 &&
		v2Search.contentResults.length === 0 &&
		!isFetching &&
		!searchError;

	return (
		<DialogPrimitive.Root open={open} onOpenChange={handleOpenChange} modal>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50" />
				<DialogPrimitive.Content
					className="fixed left-[50%] z-50 w-full max-w-[672px] translate-x-[-50%] overflow-hidden rounded-lg border shadow-lg"
					style={{ top: `calc(50% - ${MAX_DIALOG_HEIGHT / 2}px)` }}
				>
					<DialogPrimitive.Title className="sr-only">
						<Trans>Search files</Trans>
					</DialogPrimitive.Title>
					<DialogPrimitive.Description className="sr-only">
						<Trans>Search filenames and text in your workspace</Trans>
					</DialogPrimitive.Description>

					<CommandPrimitive
						shouldFilter={false}
						className="bg-popover text-popover-foreground flex h-full w-full flex-col overflow-hidden rounded-md"
					>
						<div className="flex h-12 items-center gap-2 border-b px-3">
							<SearchIcon className="size-5 shrink-0 opacity-50" />
							<CommandPrimitive.Input
								ref={inputRef}
								placeholder={translate(
									mode === "content" && variant === "v2"
										? msg({ message: "Search file contents..." })
										: msg({ message: "Search files..." }),
								)}
								aria-label={translate(msg({ message: "Search files" }))}
								value={query}
								onValueChange={setQuery}
								className="flex h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
							/>
							{isFetching && (
								<Loader2
									className="size-4 shrink-0 animate-spin text-muted-foreground"
									aria-hidden="true"
								/>
							)}
							<button
								type="button"
								className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
								onClick={() => setFiltersOpen((v) => !v)}
								aria-label={translate(
									filtersOpen
										? msg({ message: "Hide filters" })
										: msg({ message: "Show filters" }),
								)}
								aria-expanded={filtersOpen}
							>
								{filtersOpen ? (
									<LuChevronDown className="size-4" />
								) : (
									<LuChevronRight className="size-4" />
								)}
							</button>
						</div>

						{variant === "v2" && contentSearchEnabled && (
							<fieldset
								className="flex gap-1 border-b px-3 py-2"
								aria-label={translate(msg({ message: "Search mode" }))}
							>
								<button
									type="button"
									aria-pressed={mode === "files"}
									onClick={() => {
										setMode("files");
										inputRef.current?.focus();
									}}
									className="rounded px-3 py-1 text-xs text-muted-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground"
								>
									<Trans>Filenames</Trans>
								</button>
								<button
									type="button"
									aria-pressed={mode === "content"}
									onClick={() => {
										setMode("content");
										inputRef.current?.focus();
									}}
									className="rounded px-3 py-1 text-xs text-muted-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground"
								>
									<Trans>File contents</Trans>
								</button>
							</fieldset>
						)}
						{filtersOpen && (
							<div className="grid grid-cols-2 gap-2 border-b px-3 py-2">
								<input
									aria-label={translate(
										msg({ message: "files to include (glob)" }),
									)}
									value={includePattern}
									onChange={(e) => setIncludePattern(e.target.value)}
									placeholder={translate(
										msg({ message: "files to include (glob)" }),
									)}
									className="h-8 rounded border bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground"
								/>
								<input
									aria-label={translate(
										msg({ message: "files to exclude (glob)" }),
									)}
									value={excludePattern}
									onChange={(e) => setExcludePattern(e.target.value)}
									placeholder={translate(
										msg({ message: "files to exclude (glob)" }),
									)}
									className="h-8 rounded border bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground"
								/>
							</div>
						)}

						<CommandPrimitive.List className="max-h-[400px] overflow-x-hidden overflow-y-auto scroll-py-1 p-1">
							{isFetching && (
								<output className="block px-3 py-4 text-sm text-muted-foreground">
									<Trans>Searching...</Trans>
								</output>
							)}
							{searchError && (
								<div
									role="alert"
									className="px-3 py-4 text-sm text-destructive"
								>
									<p>{errorMessage(searchError)}</p>
									<button
										type="button"
										onClick={() => void v2Search.refetch()}
										className="mt-2 underline"
									>
										<Trans>Retry</Trans>
									</button>
								</div>
							)}
							{showEmptyState && (
								<CommandPrimitive.Empty className="py-6 text-center text-sm text-muted-foreground">
									{hasQuery ? (
										<Trans>No results found.</Trans>
									) : (
										<Trans>Type to search your workspace</Trans>
									)}
								</CommandPrimitive.Empty>
							)}

							{showHeading && (
								<div className="px-2 pt-2 pb-1 text-muted-foreground text-xs">
									<Trans>Recently Viewed</Trans>
								</div>
							)}

							{filteredRecent.map((file) => (
								<FileResultItem
									key={`recent:${file.absolutePath}`}
									value={`recent:${file.absolutePath}`}
									fileName={getFileName(file.relativePath)}
									relativePath={file.relativePath}
									onSelect={() => handleSelectFile(file.absolutePath)}
								/>
							))}

							{showSeparator && (
								<CommandSeparator alwaysRender className="my-1" />
							)}

							{dedupedResults.map((file) => (
								<FileResultItem
									key={file.id}
									value={file.path}
									fileName={file.name}
									relativePath={file.relativePath}
									onSelect={() => handleSelectFile(file.path)}
								/>
							))}
							{v2Search.contentResults.map((match) => (
								<ContentResultItem
									key={`${match.absolutePath}:${match.line}:${match.column}`}
									match={match}
									query={trimmedQuery}
									onSelect={() =>
										handleSelectFile(match.absolutePath, {
											line: match.line,
											column: match.column,
										})
									}
								/>
							))}
						</CommandPrimitive.List>
						{v2Search.hasMore && (
							<output className="border-t px-3 py-2 text-xs text-muted-foreground">
								<Trans>
									Showing the first {SEARCH_LIMIT} results. Narrow your search
									or add a filter.
								</Trans>
							</output>
						)}
					</CommandPrimitive>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
