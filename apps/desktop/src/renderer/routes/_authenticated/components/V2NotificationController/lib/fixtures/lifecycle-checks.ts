import { afterAll, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { WorkspaceState } from "@superset/panes";
import type { AgentLifecyclePayload } from "@superset/workspace-client";
import type { PlayRingtoneOptions } from "renderer/lib/ringtones/play";
import type { PaneViewerData } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types";

const registered = GlobalRegistrator.isRegistered;
if (!registered) GlobalRegistrator.register();
const showNative = mock(async (_input: unknown) => {});
const play = mock(async (_input: PlayRingtoneOptions) => {});
mock.module("renderer/lib/trpc-client", () => ({
	electronTrpcClient: {
		notifications: { showNative: { mutate: showNative } },
		settings: {
			getSelectedRingtoneId: { query: async () => "shamisen" },
			setSelectedRingtoneId: { mutate: async () => {} },
		},
	},
}));
mock.module("renderer/lib/ringtones/play", () => ({ playRingtone: play }));

const { handleV2AgentLifecycleEvent } = await import("../lifecycleEvents");
const { useV2NotificationStore } = await import(
	"renderer/stores/v2-notifications"
);
const { clearRememberedV2PaneSelectionsForTest } = await import(
	"renderer/stores/v2-pane-selection"
);
const focus = spyOn(document, "hasFocus").mockReturnValue(true);
Object.defineProperty(document, "hidden", {
	configurable: true,
	get: () => false,
});

const layout: WorkspaceState<PaneViewerData> = {
	version: 1,
	activeTabId: "active-tab",
	tabs: [
		{
			id: "active-tab",
			createdAt: 1,
			activePaneId: "parent-pane",
			layout: { type: "pane", paneId: "parent-pane" },
			panes: {
				"parent-pane": {
					id: "parent-pane",
					kind: "terminal",
					data: { terminalId: "parent-terminal" },
				},
			},
		},
	],
};
function event(
	overrides: Partial<AgentLifecyclePayload> = {},
): AgentLifecyclePayload {
	return {
		eventType: "PermissionRequest",
		terminalId: "parent-terminal",
		occurredAt: 123,
		agent: { agentId: "codex", sessionId: "parent-session" },
		preview: "**Which branch** should I compare?",
		...overrides,
	};
}
function handle(payload: AgentLifecyclePayload) {
	handleV2AgentLifecycleEvent({
		workspaceId: "workspace",
		workspaceName: "Checkout",
		projectName: "Example project",
		payload,
		paneLayout: layout,
		volume: 35,
		muted: false,
	});
}

beforeEach(() => {
	window.location.hash = "#/v2-workspace/workspace";
	focus.mockReturnValue(true);
	showNative.mockClear();
	play.mockClear();
	clearRememberedV2PaneSelectionsForTest();
	useV2NotificationStore.setState({ terminalSeenAt: {}, manualUnread: {} });
});
afterAll(async () => {
	focus.mockRestore();
	if (!registered) await GlobalRegistrator.unregister();
});

test("notifies for a question even while the parent terminal is visible and focused", () => {
	handle(event());
	expect(document.hasFocus()).toBe(true);
	expect(document.hidden).toBe(false);
	expect(showNative).toHaveBeenCalledTimes(1);
	expect(showNative).toHaveBeenCalledWith({
		title: "Example project › Checkout",
		subtitle: "Codex · Needs input",
		body: "Which branch should I compare?",
		silent: true,
		clickTarget: {
			workspaceId: "workspace",
			source: { type: "terminal", id: "parent-terminal" },
		},
	});
	expect(play).toHaveBeenCalledWith(
		expect.objectContaining({ volume: 35, muted: false }),
	);
});

test("a child's question shows its task name and links to the terminal where the answer is entered", () => {
	handle(event({ subagent: { id: "child", name: "Review checkout" } }));
	expect(showNative).toHaveBeenCalledWith(
		expect.objectContaining({
			subtitle: "Review checkout · Needs input",
			body: "Which branch should I compare?",
			clickTarget: {
				workspaceId: "workspace",
				source: { type: "terminal", id: "parent-terminal" },
			},
		}),
	);
	expect(play).toHaveBeenCalledTimes(1);
});

test("completion stays quiet for a visible focused terminal", () => {
	handle(event({ eventType: "Stop", preview: "Review completed." }));
	expect(showNative).not.toHaveBeenCalled();
	expect(play).not.toHaveBeenCalled();
	expect(
		useV2NotificationStore.getState().terminalSeenAt["parent-terminal"],
	).toBe(123);
});

test("completion still alerts when another workspace is visible", () => {
	window.location.hash = "#/v2-workspace/another-workspace";
	handle(event({ eventType: "Stop", preview: "Review completed." }));
	expect(showNative).toHaveBeenCalledWith(
		expect.objectContaining({
			subtitle: "Codex · Finished",
			body: "Review completed.",
		}),
	);
	expect(play).toHaveBeenCalledTimes(1);
});
