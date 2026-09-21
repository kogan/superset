import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { MovementState } from "../../hooks/useJiraMovement/movement";

const registered = GlobalRegistrator.isRegistered;
if (!registered) GlobalRegistrator.register();
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { cleanup, fireEvent, render, within } = await import(
	"@testing-library/react"
);
const { JiraTransitionDialog } = await import("./JiraTransitionDialog");
afterEach(cleanup);
afterAll(async () => {
	if (!registered) await GlobalRegistrator.unregister();
});
const target = {
	issue: {
		id: "1",
		key: "TEST-1",
		summary: "Example",
		status: "Backlog",
		statusCategory: "new",
		assignee: null,
		pullRequests: [],
		freshdeskLinks: [],
		priority: null,
		project: "Team",
		updated: "2026-09-18T00:00:00Z",
		url: "https://jira.example/browse/TEST-1",
	},
};
test("exposes actionable choices and disables required Jira forms", () => {
	const choose = mock(() => {});
	const cancel = mock(() => {});
	render(
		<JiraTransitionDialog
			state={{
				kind: "choosing",
				connectionRevision: "fixture",
				target,
				transitions: [
					{
						id: "start",
						name: "Start",
						status: "Development",
						requiredFields: [],
					},
					{
						id: "resolve",
						name: "Resolve",
						status: "Done",
						requiredFields: ["Resolution"],
					},
				],
			}}
			onCancel={cancel}
			onChoose={choose}
		/>,
	);
	const page = within(document.body);
	expect(page.getByRole("dialog")).toBeTruthy();
	const start = page.getByRole("button", { name: "Start → Development" });
	start.focus();
	expect(document.activeElement).toBe(start);
	fireEvent.click(start);
	expect(choose).toHaveBeenCalledWith("start");
	expect(
		page
			.getByRole("button", { name: "Resolve → Done" })
			.hasAttribute("disabled"),
	).toBe(true);
	expect(page.getByText("This move requires fields in Jira.")).toBeTruthy();
	expect(
		page.getByRole("button", { name: "Open in Jira" }).hasAttribute("disabled"),
	).toBe(false);
	fireEvent.click(page.getByRole("button", { name: "Cancel" }));
	expect(cancel).toHaveBeenCalledTimes(1);
});
test("renders loading, errors and empty results; prevents closing during mutation", () => {
	const props = { onCancel: mock(() => {}), onChoose: mock(() => {}) };
	const view = render(
		<JiraTransitionDialog {...props} state={{ kind: "loading", target }} />,
	);
	const page = within(document.body);
	expect(page.getByText("Loading available moves…")).toBeTruthy();
	view.rerender(
		<JiraTransitionDialog
			{...props}
			state={{
				kind: "choosing",
				connectionRevision: "fixture",
				target,
				transitions: [],
			}}
		/>,
	);
	expect(
		page.getByText(
			"No available moves. Open the issue in Jira to check its workflow.",
		),
	).toBeTruthy();
	view.rerender(
		<JiraTransitionDialog
			{...props}
			state={{ kind: "error", target, error: new Error("Denied") }}
		/>,
	);
	expect(page.getByRole("alert").textContent).toBe("Denied");
	const state: MovementState = { kind: "moving", target };
	view.rerender(<JiraTransitionDialog {...props} state={state} />);
	expect(page.getByText("Moving issue…")).toBeTruthy();
	expect(
		page.getByRole("button", { name: "Cancel" }).hasAttribute("disabled"),
	).toBe(true);
	expect(page.queryByRole("button", { name: "Close" })).toBeNull();
});
