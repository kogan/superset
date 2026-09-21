import type { electronTrpcClient } from "renderer/lib/trpc-client";
import type { JiraIssue } from "../../components/JiraKanban/utils/groupIssuesByStatus";
export type TransitionLookup = Awaited<
	ReturnType<typeof electronTrpcClient.jira.listTransitions.query>
>;
export type JiraTransition = TransitionLookup["transitions"][number];
export type MoveTarget = { issue: JiraIssue; statuses?: string[] };
export type MovementState =
	| { kind: "idle" }
	| { kind: "loading"; target: MoveTarget }
	| {
			kind: "choosing";
			target: MoveTarget;
			transitions: JiraTransition[];
			connectionRevision: string;
	  }
	| { kind: "moving"; target: MoveTarget }
	| { kind: "error"; target: MoveTarget; error: unknown };
type Dependencies = {
	list: (issueKey: string, signal: AbortSignal) => Promise<TransitionLookup>;
	move: (
		issueKey: string,
		transitionId: string,
		connectionRevision: string,
	) => Promise<void>;
	refresh: () => Promise<void>;
	success: () => void;
	refreshFailed: (error: unknown) => void;
};
export function createMovement(dependencies: Dependencies) {
	let state: MovementState = { kind: "idle" };
	let generation = 0;
	let active = true;
	let abort: AbortController | undefined;
	const listeners = new Set<() => void>();
	const publish = (next: MovementState) => {
		state = next;
		for (const listener of listeners) listener();
	};
	const current = (id: number) => active && generation === id;
	async function apply(
		target: MoveTarget,
		transition: JiraTransition,
		connectionRevision: string,
		id: number,
	) {
		if (!current(id) || transition.requiredFields.length) return;
		publish({ kind: "moving", target });
		try {
			await dependencies.move(
				target.issue.key,
				transition.id,
				connectionRevision,
			);
			if (!current(id)) return;
			dependencies.success();
			try {
				await dependencies.refresh();
			} catch (error) {
				if (current(id)) dependencies.refreshFailed(error);
			}
			if (current(id)) publish({ kind: "idle" });
		} catch (error) {
			if (current(id)) publish({ kind: "error", target, error });
		}
	}
	return {
		getSnapshot: () => state,
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		activate: () => {
			active = true;
		},
		dispose: () => {
			active = false;
			generation++;
			abort?.abort();
		},
		cancel: () => {
			if (state.kind === "moving") return;
			generation++;
			abort?.abort();
			publish({ kind: "idle" });
		},
		async start(issue: JiraIssue, statuses?: string[]) {
			if (!active || state.kind !== "idle" || statuses?.includes(issue.status))
				return;
			const target: MoveTarget = { issue, statuses };
			const id = ++generation;
			abort = new AbortController();
			publish({ kind: "loading", target });
			try {
				const lookup = await dependencies.list(issue.key, abort.signal);
				if (!current(id)) return;
				const transitions = lookup.transitions.filter(
					(transition) => !statuses || statuses.includes(transition.status),
				);
				const [only] = transitions;
				if (
					statuses &&
					transitions.length === 1 &&
					only &&
					!only.requiredFields.length
				)
					await apply(target, only, lookup.connectionRevision, id);
				else
					publish({
						kind: "choosing",
						target,
						transitions,
						connectionRevision: lookup.connectionRevision,
					});
			} catch (error) {
				if (current(id)) publish({ kind: "error", target, error });
			}
		},
		async choose(transitionId: string) {
			if (!active || state.kind !== "choosing") return;
			const transition = state.transitions.find(
				(item) => item.id === transitionId,
			);
			if (transition)
				await apply(
					state.target,
					transition,
					state.connectionRevision,
					generation,
				);
		},
	};
}
