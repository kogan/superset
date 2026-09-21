import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
	useSidebarAgentExpansion,
	useSidebarAgentExpansionStore,
} from "./sidebar-agent-expansion";

beforeEach(() =>
	useSidebarAgentExpansionStore.setState({ collapsed: new Set() }),
);

const alreadyRegistered = GlobalRegistrator.isRegistered;
if (!alreadyRegistered) GlobalRegistrator.register();
const { act, cleanup, renderHook } = await import("@testing-library/react");
afterEach(cleanup);
afterAll(async () => {
	if (!alreadyRegistered) await GlobalRegistrator.unregister();
});

test("keeps a collapsed workspace collapsed after selection and remount", () => {
	const row = renderHook(() =>
		useSidebarAgentExpansion(["workspace", "workspace"]),
	);
	expect(row.result.current.expanded).toBe(true);
	act(() => row.result.current.toggle());
	row.rerender();
	expect(row.result.current.expanded).toBe(false);
	row.unmount();
	const remounted = renderHook(() =>
		useSidebarAgentExpansion(["workspace", "workspace"]),
	);
	expect(remounted.result.current.expanded).toBe(false);
	act(() => remounted.result.current.toggle());
	expect(remounted.result.current.expanded).toBe(true);
});

test("model and subagent choices survive remounts independently of the workspace", () => {
	const { toggle } = useSidebarAgentExpansionStore.getState();
	toggle(["workspace", "model", "codex"]);
	toggle(["workspace", "subagents", "terminal"]);
	toggle(["workspace", "workspace"]);
	toggle(["workspace", "workspace"]);
	const model = renderHook(() =>
		useSidebarAgentExpansion(["workspace", "model", "codex"]),
	);
	const subagents = renderHook(() =>
		useSidebarAgentExpansion(["workspace", "subagents", "terminal"]),
	);
	const other = renderHook(() =>
		useSidebarAgentExpansion(["another-workspace", "model", "codex"]),
	);
	expect(model.result.current.expanded).toBe(false);
	expect(subagents.result.current.expanded).toBe(false);
	expect(other.result.current.expanded).toBe(true);
});

test("bounds retained groups", () => {
	const { toggle } = useSidebarAgentExpansionStore.getState();
	for (let i = 0; i < 2100; i++) toggle([String(i), "workspace"]);
	expect(useSidebarAgentExpansionStore.getState().collapsed.size).toBe(2000);
});
