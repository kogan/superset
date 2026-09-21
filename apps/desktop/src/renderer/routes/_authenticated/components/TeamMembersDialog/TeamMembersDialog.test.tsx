import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { TeamMember } from "renderer/routes/_authenticated/_dashboard/pull-requests/utils/pullRequestTeam";

const alreadyRegistered = GlobalRegistrator.isRegistered;
if (!alreadyRegistered) GlobalRegistrator.register();
(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const { act, cleanup, fireEvent, render, within } = await import(
	"@testing-library/react"
);
const { QueryClient, QueryClientProvider } = await import(
	"@tanstack/react-query"
);
const { TeamMembersDialog } = await import("./TeamMembersDialog");
afterEach(cleanup);
afterAll(async () => {
	if (!alreadyRegistered) await GlobalRegistrator.unregister();
});

test("saves additions and removals only after Save, and rejects invalid username syntax", async () => {
	const client = new QueryClient();
	const saves: TeamMember[][] = [];
	render(
		<QueryClientProvider client={client}>
			<TeamMembersDialog
				members={[{ login: "alice" }]}
				projectTargets={[]}
				onSave={(members) => saves.push(members)}
				onClose={() => {}}
			/>
		</QueryClientProvider>,
	);
	const page = within(document.body);
	await act(async () => {
		fireEvent.click(page.getByRole("button", { name: "Remove @alice" }));
	});
	await act(async () => {
		fireEvent.change(page.getByRole("combobox"), {
			target: { value: "alice is:open" },
		});
	});
	expect(page.getByText("Enter a valid GitHub username.")).toBeTruthy();
	expect(saves).toEqual([]);
	await act(async () => {
		fireEvent.change(page.getByRole("combobox"), { target: { value: "@BOB" } });
	});
	await act(async () => {
		fireEvent.click(page.getByRole("option", { name: "Add @bob" }));
	});
	expect(page.getByRole("button", { name: "Remove @bob" })).toBeTruthy();
	expect(saves).toEqual([]);
	await act(async () => {
		fireEvent.click(page.getByRole("button", { name: "Save" }));
	});
	expect(saves).toEqual([[{ login: "bob" }]]);
	client.clear();
});

test("Cancel discards edits without saving membership", async () => {
	const client = new QueryClient();
	let closed = false;
	let saved = false;
	render(
		<QueryClientProvider client={client}>
			<TeamMembersDialog
				members={[{ login: "alice" }]}
				projectTargets={[]}
				onSave={() => {
					saved = true;
				}}
				onClose={() => {
					closed = true;
				}}
			/>
		</QueryClientProvider>,
	);
	const page = within(document.body);
	await act(async () => {
		fireEvent.click(page.getByRole("button", { name: "Remove @alice" }));
	});
	await act(async () => {
		fireEvent.click(page.getByRole("button", { name: "Cancel" }));
	});
	expect(closed).toBe(true);
	expect(saved).toBe(false);
	client.clear();
});
