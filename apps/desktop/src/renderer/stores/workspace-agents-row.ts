import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

interface WorkspaceAgentsRowState {
	// When true, running agents render inline under each workspace item.
	enabled: boolean;
	setEnabled: (enabled: boolean) => void;
}

export const useWorkspaceAgentsRowStore = create<WorkspaceAgentsRowState>()(
	devtools(
		persist(
			(set) => ({
				enabled: true,
				setEnabled: (enabled) => set({ enabled }),
			}),
			{ name: "workspace-agents-row" },
		),
		{ name: "WorkspaceAgentsRowStore" },
	),
);

export function useWorkspaceAgentsRowEnabled(): boolean {
	return useWorkspaceAgentsRowStore((state) => state.enabled);
}
