import {
	type OutboxEntry,
	type TurnGroup,
	toolRunKey,
	transcriptItemKey,
} from "@superset/chat/core";
import type {
	ApprovalRequest,
	Item,
	ToolCall,
	UserMessage,
} from "@superset/chat/protocol";
import type { PageLink, PageLinkFinder } from "../../../../utils/pageLinks";
import { turnPageLinks } from "../turnPageLinks";

export type TranscriptRow =
	| {
			kind: "working";
			key: string;
			groupStart: boolean;
			startedAtMs: number;
			completedAtMs: number | undefined;
			running: boolean;
	  }
	| {
			kind: "item";
			key: string;
			groupStart: boolean;
			item: Item;
			/** Pages to show as cards under a tool call. */
			pages?: readonly PageLink[];
			/** Slugs an agent message leaves to the earlier message that shows them. */
			pagesShownEarlier?: string;
			/** An approval whose target tool call is the row right above it. */
			afterTarget?: boolean;
	  }
	| { kind: "outbox"; key: string; groupStart: boolean; entry: OutboxEntry }
	| {
			kind: "tool_run";
			key: string;
			groupStart: boolean;
			items: ToolCall[];
			/** The run's tool calls with the agent's thinking between them, in order. */
			steps: Item[];
			defaultCollapsed: boolean;
			/** Pages to show as cards under the run, so a collapsed run still shows them. */
			pages?: readonly PageLink[];
	  }
	| {
			kind: "turn_status";
			key: string;
			groupStart: boolean;
			status: "failed" | "interrupted";
			message: string | undefined;
	  };

export function transcriptRows(
	groups: readonly TurnGroup[],
	outbox: readonly OutboxEntry[],
	pendingApprovalTargets: ReadonlySet<string>,
	findPageLinks: PageLinkFinder,
	hiddenToolIds: ReadonlySet<string> = new Set(),
): TranscriptRow[] {
	const rows: TranscriptRow[] = [];
	const echoedClientIds = new Set<string>();

	for (const group of groups) {
		let groupStart = true;
		const push = (row: TranscriptRow) => {
			rows.push(row);
			groupStart = false;
		};
		const turn = group.turn;
		let clockPlaced = turn === null;
		const placeClock = () => {
			if (clockPlaced || !turn) return;
			clockPlaced = true;
			push({
				kind: "working",
				key: `working:${group.turnId}`,
				groupStart,
				startedAtMs: turn.startedAtMs,
				completedAtMs: turn.completedAtMs,
				running: turn.status === "running",
			});
		};
		const turnSettled = turn !== null && turn.status !== "running";
		const links = turnPageLinks(group.entries, turnSettled, findPageLinks);
		const lastPrompt = group.entries.findLastIndex(
			(entry) => entry.kind === "item" && entry.item.kind === "user_message",
		);
		let run: Extract<TranscriptRow, { kind: "tool_run" }> | null = null;
		let runAt = -1;
		const unwrapLoneCall = () => {
			const only = run?.steps.length === 1 ? run.items[0] : undefined;
			if (!run || !only) return;
			rows[runAt] = {
				kind: "item",
				key: transcriptItemKey(only),
				groupStart: run.groupStart,
				item: only,
				...(run.pages ? { pages: run.pages } : {}),
			};
		};
		for (const [index, entry] of group.entries.entries()) {
			if (index > lastPrompt) placeClock();
			const tools =
				entry.kind === "tool_run"
					? entry.items
					: entry.item.kind === "tool_call"
						? [entry.item as ToolCall]
						: null;
			if (entry.kind === "item" && !tools) {
				if (hiddenToolIds.has(entry.item.id)) continue;
				if (run && entry.item.kind === "reasoning") {
					run.steps.push(entry.item);
					continue;
				}
				unwrapLoneCall();
				run = null;
				const clientId =
					entry.item.kind === "user_message"
						? (entry.item as UserMessage).clientId
						: undefined;
				if (clientId) echoedClientIds.add(clientId);
				const pages = links.fromTools.get(entry.item.id);
				const pagesShownEarlier = links.shownEarlier.get(entry.item.id);
				const targetId =
					entry.item.kind === "approval_request"
						? (entry.item as ApprovalRequest).targetItemId
						: null;
				const above = groupStart ? undefined : rows.at(-1);
				const afterTarget =
					targetId !== null &&
					((above?.kind === "item" && above.item.id === targetId) ||
						(above?.kind === "tool_run" &&
							above.items.at(-1)?.id === targetId));
				push({
					kind: "item",
					key: transcriptItemKey(entry.item),
					groupStart,
					item: entry.item,
					...(pages ? { pages } : {}),
					...(pagesShownEarlier ? { pagesShownEarlier } : {}),
					...(afterTarget ? { afterTarget } : {}),
				});
				continue;
			}
			if (!tools) continue;
			const items = tools.filter((tool) => !hiddenToolIds.has(tool.id));
			if (items.length === 0) continue;
			const pages = items.flatMap((tool) => links.fromTools.get(tool.id) ?? []);
			const waiting = items.some((tool) => pendingApprovalTargets.has(tool.id));
			if (run) {
				run.items.push(...items);
				run.steps.push(...items);
				if (waiting) run.defaultCollapsed = false;
				if (pages.length > 0) run.pages = [...(run.pages ?? []), ...pages];
				continue;
			}
			run = {
				kind: "tool_run",
				key: toolRunKey(group.turnId, tools, index),
				groupStart,
				items: [...items],
				steps: [...items],
				defaultCollapsed: !waiting,
				...(pages.length > 0 ? { pages } : {}),
			};
			runAt = rows.length;
			push(run);
		}
		unwrapLoneCall();
		placeClock();
		if (turn?.status === "failed" || turn?.status === "interrupted") {
			push({
				kind: "turn_status",
				key: `status:${group.turnId}`,
				groupStart,
				status: turn.status,
				message: turn.error?.message,
			});
		}
	}

	for (const entry of outbox) {
		if (echoedClientIds.has(entry.clientId)) continue;
		rows.push({ kind: "outbox", key: entry.clientId, groupStart: true, entry });
	}
	return rows;
}

/** The id a row registers with the scroller, so a jump can land on it. */
export function rowMessageId(row: TranscriptRow): string {
	if (row.kind === "item") return row.item.id;
	if (row.kind === "tool_run") return row.items[0]?.id ?? row.key;
	return row.key;
}
