import { create } from "zustand";

type AgentGroup =
	| [workspaceId: string, kind: "workspace"]
	| [workspaceId: string, kind: "model" | "subagents", id: string];

const MAX_COLLAPSED_GROUPS = 2000;

// Session-only state survives row remounts without persisting entity IDs to localStorage.
export const useSidebarAgentExpansionStore = create<{
	collapsed: Set<string>;
	toggle: (group: AgentGroup) => void;
}>((set) => ({
	collapsed: new Set(),
	toggle: (group) =>
		set((state) => {
			const key = JSON.stringify(group);
			const collapsed = new Set(state.collapsed);
			if (collapsed.has(key)) collapsed.delete(key);
			else collapsed.add(key);
			while (collapsed.size > MAX_COLLAPSED_GROUPS) {
				const oldest = collapsed.values().next().value;
				if (oldest !== undefined) collapsed.delete(oldest);
			}
			return { collapsed };
		}),
}));

export function useSidebarAgentExpansion(group: AgentGroup) {
	const expanded = useSidebarAgentExpansionStore(
		(state) => !state.collapsed.has(JSON.stringify(group)),
	);
	const toggle = useSidebarAgentExpansionStore((state) => state.toggle);
	return { expanded, toggle: () => toggle(group) };
}
