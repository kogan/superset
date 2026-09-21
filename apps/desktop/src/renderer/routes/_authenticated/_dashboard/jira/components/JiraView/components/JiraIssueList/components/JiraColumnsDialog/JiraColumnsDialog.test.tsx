import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { StatusColumn } from "../JiraKanban/utils/groupIssuesByStatus";

const registered = GlobalRegistrator.isRegistered;
if (!registered) GlobalRegistrator.register();
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { cleanup, fireEvent, render, within } = await import(
	"@testing-library/react"
);
const { JiraColumnsDialog } = await import("./JiraColumnsDialog");
afterEach(cleanup);
afterAll(async () => {
	if (!registered) await GlobalRegistrator.unregister();
});

const columns: StatusColumn[] = ["To do", "In dev", "QA"].map((status) => ({
	key: status,
	status,
	statuses: [status],
	category: "new",
	issues: [],
}));

test("hides and reorders columns in a draft, then saves the chosen layout", () => {
	const save = mock(() => {});
	render(
		<JiraColumnsDialog
			columns={columns}
			layout={[]}
			isSaving={false}
			onSave={save}
			onClose={() => {}}
		/>,
	);
	const page = within(document.body);
	fireEvent.click(page.getByRole("checkbox", { name: "To do" }));
	fireEvent.click(page.getByRole("button", { name: "Move QA left" }));
	fireEvent.click(page.getByRole("button", { name: "Move QA left" }));
	expect(page.getAllByRole("listitem").map((row) => row.textContent)).toEqual([
		"QA",
		"To do",
		"In dev",
	]);
	expect(
		page.getByRole("button", { name: "Move QA left" }).hasAttribute("disabled"),
	).toBe(true);
	expect(save).not.toHaveBeenCalled();
	fireEvent.click(page.getByRole("button", { name: "Save" }));
	expect(save).toHaveBeenCalledWith([
		{ key: "QA", visible: true },
		{ key: "To do", visible: false },
		{ key: "In dev", visible: true },
	]);
});

test("cancel discards edits and restore defaults resets order and visibility", () => {
	const save = mock(() => {});
	const close = mock(() => {});
	const layout = [
		{ key: "QA", visible: false },
		{ key: "To do", visible: true },
	];
	render(
		<JiraColumnsDialog
			columns={columns}
			layout={layout}
			isSaving={false}
			onSave={save}
			onClose={close}
		/>,
	);
	const page = within(document.body);
	fireEvent.click(page.getByRole("button", { name: "Restore defaults" }));
	expect(page.getAllByRole("listitem").map((row) => row.textContent)).toEqual([
		"To do",
		"In dev",
		"QA",
	]);
	expect(
		page
			.getAllByRole("checkbox")
			.every((box) => box.getAttribute("aria-checked") === "true"),
	).toBe(true);
	fireEvent.click(page.getByRole("button", { name: "Cancel" }));
	expect(close).toHaveBeenCalledTimes(1);
	expect(save).not.toHaveBeenCalled();
	expect(layout[0]).toEqual({ key: "QA", visible: false });
	fireEvent.click(page.getByRole("button", { name: "Save" }));
	expect(save).toHaveBeenCalledWith([]);
});
