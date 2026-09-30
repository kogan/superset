import {
	afterAll,
	afterEach,
	beforeEach,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const registered = GlobalRegistrator.isRegistered;
if (!registered) GlobalRegistrator.register();
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const selection = {
	workspaceId: "workspace",
	terminalId: "parent-terminal",
	subagentId: "child-one",
};
let supported = true;
let hostUrl: string | null = "http://host.invalid";
const capability = mock(async (_input: typeof selection) => ({ supported }));
const stop = mock(async (_input: typeof selection) => {});
const parentWrite = mock(async (_input: unknown) => {});
const clearStatuses = mock(async (_input: unknown) => {});
mock.module("renderer/hooks/host-service/useWorkspaceHostUrl", () => ({
	useWorkspaceHostUrl: () => hostUrl,
}));
mock.module("renderer/lib/host-service-client", () => ({
	getHostServiceClientByUrl: () => ({
		terminalAgents: {
			subagentStopCapability: { query: capability },
			stopSubagent: { mutate: stop },
			clearWorkspaceStatuses: { mutate: clearStatuses },
		},
		terminal: { writeInput: { mutate: parentWrite } },
	}),
}));

const { cleanup, fireEvent, render, waitFor } = await import(
	"@testing-library/react"
);
const { SubagentStopButton } = await import("../SubagentStopButton");
const clients: QueryClient[] = [];
const parentListeners: Array<() => void> = [];
function renderStop(subagentIds = [selection.subagentId]) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	clients.push(client);
	const parentClick = mock(() => {});
	const view = render(
		<QueryClientProvider client={client}>
			{subagentIds.map((subagentId) => (
				<SubagentStopButton
					key={subagentId}
					{...selection}
					subagentId={subagentId}
				/>
			))}
		</QueryClientProvider>,
	);
	document.body.addEventListener("click", parentClick);
	parentListeners.push(parentClick);
	return { ...view, parentClick };
}

beforeEach(() => {
	supported = true;
	hostUrl = "http://host.invalid";
	capability.mockClear();
	stop.mockReset();
	stop.mockImplementation(async () => {});
	parentWrite.mockClear();
	clearStatuses.mockClear();
});
afterEach(() => {
	for (const listener of parentListeners.splice(0)) {
		document.body.removeEventListener("click", listener);
	}
	cleanup();
	for (const client of clients.splice(0)) client.clear();
	expect(parentWrite).not.toHaveBeenCalled();
	expect(clearStatuses).not.toHaveBeenCalled();
});
afterAll(async () => {
	if (!registered) await GlobalRegistrator.unregister();
});

test("stops only the selected child and does not bubble into the parent row", async () => {
	const view = renderStop();
	const button = view.getByRole("button", { name: "Stop subagent" });
	await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
	fireEvent.click(button);
	await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
	expect(capability).toHaveBeenCalledWith(selection);
	expect(stop).toHaveBeenCalledWith(selection);
	expect(view.parentClick).not.toHaveBeenCalled();
});

test("unsupported capabilities and unresolved hosts cannot stop a child", async () => {
	supported = false;
	const view = renderStop();
	await waitFor(() => expect(capability).toHaveBeenCalledTimes(1));
	const button = view.getByRole("button", { name: "Stop subagent" });
	expect(button.hasAttribute("disabled")).toBe(true);
	fireEvent.click(button);
	expect(stop).not.toHaveBeenCalled();
	view.unmount();
	hostUrl = null;
	const offline = renderStop();
	const offlineButton = offline.getByRole("button", { name: "Stop subagent" });
	expect(offlineButton.hasAttribute("disabled")).toBe(true);
	fireEvent.click(offlineButton);
	expect(stop).not.toHaveBeenCalled();
	expect(capability).toHaveBeenCalledTimes(1);
});

test("a rejected child stop reports the failure without interrupting the parent", async () => {
	stop.mockImplementation(async () => {
		throw new Error("Child already ended");
	});
	const error = spyOn(console, "error").mockImplementation(() => {});
	try {
		const view = renderStop();
		const button = view.getByRole("button", { name: "Stop subagent" });
		await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
		fireEvent.click(button);
		await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
		expect(stop).toHaveBeenCalledTimes(1);
		expect(stop).toHaveBeenCalledWith(selection);
	} finally {
		error.mockRestore();
	}
});

test("consecutive stop clicks target their own children independently", async () => {
	const view = renderStop(["child-one", "child-two"]);
	const buttons = view.getAllByRole("button", { name: "Stop subagent" });
	await waitFor(() =>
		expect(buttons.every((button) => !button.hasAttribute("disabled"))).toBe(
			true,
		),
	);
	for (const button of buttons) fireEvent.click(button);
	await waitFor(() => expect(stop).toHaveBeenCalledTimes(2));
	expect(stop.mock.calls.map(([input]) => input)).toEqual([
		selection,
		{ ...selection, subagentId: "child-two" },
	]);
	expect(view.parentClick).not.toHaveBeenCalled();
});
