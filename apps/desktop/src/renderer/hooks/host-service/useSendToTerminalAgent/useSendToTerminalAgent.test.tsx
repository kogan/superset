import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const registered = GlobalRegistrator.isRegistered;
if (!registered) GlobalRegistrator.register();
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const submit = mock(async (_input: unknown) => {});
const rawWrite = mock(async (_input: unknown) => {});
const invalidateQueries = mock(async (_input: unknown) => {});
mock.module("@superset/workspace-client", () => ({
	workspaceTrpc: {
		terminal: {
			send: { useMutation: () => ({ mutateAsync: submit, isPending: false }) },
			writeInput: {
				useMutation: () => ({ mutateAsync: rawWrite, isPending: false }),
			},
		},
	},
}));
mock.module("@tanstack/react-query", () => ({
	useQueryClient: () => ({ invalidateQueries }),
}));
mock.module("../useTerminalAgentBindings/useTerminalAgentBindings", () => ({
	getTerminalAgentBindingsQueryKey: (workspaceId: string) => [
		"bindings",
		workspaceId,
	],
}));
const { cleanup, renderHook } = await import("@testing-library/react");
const { useSendToTerminalAgent } = await import("./useSendToTerminalAgent");
afterEach(() => {
	cleanup();
	submit.mockClear();
	rawWrite.mockClear();
});
afterAll(async () => {
	mock.restore();
	if (!registered) await GlobalRegistrator.unregister();
});

test("submits multiline prompts to the selected existing agent through the framed send path", async () => {
	const { result } = renderHook(useSendToTerminalAgent);
	await result.current.send({
		workspaceId: "workspace",
		terminalId: "selected-agent",
		text: "Review the change.\nKeep this second line.\x1b[201~",
	});
	expect(submit).toHaveBeenCalledWith({
		workspaceId: "workspace",
		terminalId: "selected-agent",
		text: "Review the change.\nKeep this second line.",
		submit: true,
	});
	expect(rawWrite).not.toHaveBeenCalled();
});
