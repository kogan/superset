import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const registered = GlobalRegistrator.isRegistered;
if (!registered) GlobalRegistrator.register();
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
mock.module("renderer/hooks/host-service/useTerminalAgentBindings", () => ({
	useTerminalAgentBindings: () => new Map(),
}));
mock.module("renderer/hooks/useV2AgentConfigs", () => ({
	useV2AgentConfigs: () => ({ data: [] }),
}));
const { cleanup, fireEvent, render, within, waitFor } = await import(
	"@testing-library/react"
);
const { PullRequestCommentComposer } = await import(
	"./PullRequestCommentComposer"
);
afterEach(cleanup);
afterAll(async () => {
	mock.restore();
	if (!registered) await GlobalRegistrator.unregister();
});
test("defaults to posting on GitHub without an agent or workspace", async () => {
	const post = mock(async (_body: string) => {});
	const send = mock(async () => {});
	render(
		<PullRequestCommentComposer
			contextLabel="Line 4"
			hostUrl="http://localhost:1"
			linkedWorkspaceId={null}
			onCancel={() => {}}
			onPostComment={post}
			onSubmit={send}
		/>,
	);
	const page = within(document.body);
	expect(
		page
			.getByRole("button", { name: "Comment on PR" })
			.getAttribute("aria-pressed"),
	).toBe("true");
	fireEvent.change(page.getByRole("textbox", { name: "Comment" }), {
		target: { value: "Please check this." },
	});
	fireEvent.click(page.getByRole("button", { name: "Post comment" }));
	await waitFor(() => expect(post).toHaveBeenCalledWith("Please check this."));
	expect(send).not.toHaveBeenCalled();
});
test("failed direct posting retains the draft and never sends to an agent", async () => {
	const send = mock(async () => {});
	render(
		<PullRequestCommentComposer
			contextLabel="Line 4"
			hostUrl="http://localhost:1"
			linkedWorkspaceId={null}
			onCancel={() => {}}
			onPostComment={async () => {
				throw new Error("Rejected");
			}}
			onSubmit={send}
		/>,
	);
	const page = within(document.body);
	fireEvent.change(page.getByRole("textbox"), {
		target: { value: "Keep my draft" },
	});
	fireEvent.click(page.getByRole("button", { name: "Post comment" }));
	await waitFor(() =>
		expect(
			page
				.getByRole("button", { name: "Post comment" })
				.hasAttribute("disabled"),
		).toBe(false),
	);
	expect(page.getByDisplayValue("Keep my draft")).toBeDefined();
	expect(send).not.toHaveBeenCalled();
});

test("keyboard submission posts once while a request is pending", async () => {
	let finish = () => {};
	const pending = new Promise<void>((resolve) => {
		finish = resolve;
	});
	const post = mock(async () => pending);
	const send = mock(async () => {});
	render(
		<PullRequestCommentComposer
			contextLabel="Line 4"
			hostUrl="http://localhost:1"
			linkedWorkspaceId={null}
			onCancel={() => {}}
			onPostComment={post}
			onSubmit={send}
		/>,
	);
	const page = within(document.body);
	const textbox = page.getByRole("textbox");
	fireEvent.change(textbox, { target: { value: "One comment" } });
	fireEvent.keyDown(textbox, { key: "Enter", metaKey: true });
	fireEvent.keyDown(textbox, { key: "Enter", metaKey: true });
	expect(post).toHaveBeenCalledTimes(1);
	expect(send).not.toHaveBeenCalled();
	finish();
	await waitFor(() =>
		expect(page.getByRole("button", { name: "Post comment" })).toBeDefined(),
	);
});
