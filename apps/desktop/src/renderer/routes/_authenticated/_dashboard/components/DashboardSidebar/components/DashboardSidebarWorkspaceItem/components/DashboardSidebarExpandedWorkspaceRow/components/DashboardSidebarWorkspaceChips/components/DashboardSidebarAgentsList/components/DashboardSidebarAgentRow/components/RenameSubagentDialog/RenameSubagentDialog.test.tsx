import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const registered = GlobalRegistrator.isRegistered;
if (!registered) GlobalRegistrator.register();
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { cleanup, fireEvent, render, within, waitFor } = await import(
	"@testing-library/react"
);
const { RenameSubagentDialog } = await import("./RenameSubagentDialog");
afterEach(cleanup);
afterAll(async () => {
	if (!registered) await GlobalRegistrator.unregister();
});

test("saves an edited name and closes only after it is saved", async () => {
	const save = mock(async (_name: string) => {});
	const close = mock(() => {});
	render(
		<RenameSubagentDialog
			name="Review payments"
			automaticName="Audit checkout"
			onSave={save}
			onClose={close}
		/>,
	);
	const page = within(document.body);
	fireEvent.change(page.getByRole("textbox", { name: "Subagent name" }), {
		target: { value: "Payment tests" },
	});
	fireEvent.click(page.getByRole("button", { name: "Save" }));
	expect(close).not.toHaveBeenCalled();
	await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
	expect(save).toHaveBeenCalledWith("Payment tests");
});

test("cancel discards edits and automatic name explicitly clears the override", async () => {
	const save = mock(async (_name: string) => {});
	const close = mock(() => {});
	const view = render(
		<RenameSubagentDialog
			name="Review payments"
			automaticName="Audit checkout"
			onSave={save}
			onClose={close}
		/>,
	);
	const page = within(document.body);
	fireEvent.change(page.getByRole("textbox"), {
		target: { value: "Discard me" },
	});
	fireEvent.click(page.getByRole("button", { name: "Cancel" }));
	expect(save).not.toHaveBeenCalled();
	expect(close).toHaveBeenCalledTimes(1);
	view.unmount();
	render(
		<RenameSubagentDialog
			name="Review payments"
			automaticName="Audit checkout"
			onSave={save}
			onClose={close}
		/>,
	);
	fireEvent.click(page.getByRole("button", { name: "Use automatic name" }));
	await waitFor(() => expect(close).toHaveBeenCalledTimes(2));
	expect(save).toHaveBeenCalledWith("");
});

test("a failed save retains the edited name for retry", async () => {
	const save = mock(async (_name: string) => {
		throw new Error("Host offline");
	});
	const close = mock(() => {});
	render(
		<RenameSubagentDialog
			name="Review payments"
			automaticName="Audit checkout"
			onSave={save}
			onClose={close}
		/>,
	);
	const page = within(document.body);
	fireEvent.change(page.getByRole("textbox"), {
		target: { value: "Payment tests" },
	});
	fireEvent.click(page.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(page.getByRole("alert").textContent).toContain("Could not rename"),
	);
	expect(close).not.toHaveBeenCalled();
	expect(page.getByDisplayValue("Payment tests")).toBeDefined();
	expect(
		page.getByRole("button", { name: "Save" }).hasAttribute("disabled"),
	).toBe(false);
});
