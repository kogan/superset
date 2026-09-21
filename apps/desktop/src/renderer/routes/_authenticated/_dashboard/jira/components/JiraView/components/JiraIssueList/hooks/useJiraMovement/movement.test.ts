import { describe, expect, it, mock } from "bun:test";
import type { JiraIssue } from "../../components/JiraKanban/utils/groupIssuesByStatus";
import { createMovement, type JiraTransition } from "./movement";

const issue: JiraIssue = {
	id: "1",
	key: "TEAM-1",
	summary: "Issue",
	status: "Backlog",
	statusCategory: "new",
	assignee: null,
	pullRequests: [],
	freshdeskLinks: [],
	priority: null,
	project: "Team",
	updated: "2026-09-18T00:00:00Z",
	url: "https://jira.example/browse/TEAM-1",
};
const qa: JiraTransition = {
	id: "qa",
	name: "Submit",
	status: "Needs QA",
	requiredFields: [],
};
const connectionRevision = "00000000-0000-0000-0000-000000000000:1";
const lookup = (transitions: JiraTransition[]) => ({
	connectionRevision,
	transitions,
});
const dev: JiraTransition = {
	id: "dev",
	name: "Start",
	status: "In Development",
	requiredFields: [],
};
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((yes) => {
		resolve = yes;
	});
	return { promise, resolve };
}
function setup(
	transitions: JiraTransition[] = [qa],
	overrides: Partial<Parameters<typeof createMovement>[0]> = {},
) {
	const dependencies = {
		list: mock(async () => lookup(transitions)),
		move: mock(async () => {}),
		refresh: mock(async () => {}),
		success: mock(() => {}),
		refreshFailed: mock(() => {}),
		...overrides,
	};
	return { controller: createMovement(dependencies), dependencies };
}
describe("Jira movement", () => {
	it("matches destination status, waits for confirmation, and never changes issues optimistically", async () => {
		const pending = deferred<void>();
		const { controller, dependencies } = setup(
			[{ ...qa, name: "Backlog" }, dev],
			{ move: mock(() => pending.promise) },
		);
		const moving = controller.start(issue, ["Needs QA"]);
		await Promise.resolve();
		expect(dependencies.move).toHaveBeenCalledWith(
			"TEAM-1",
			"qa",
			connectionRevision,
		);
		expect(controller.getSnapshot().kind).toBe("moving");
		expect(dependencies.refresh).not.toHaveBeenCalled();
		expect(issue.status).toBe("Backlog");
		pending.resolve();
		await moving;
		expect(dependencies.refresh).toHaveBeenCalledTimes(1);
		expect(dependencies.success).toHaveBeenCalledTimes(1);
		expect(controller.getSnapshot().kind).toBe("idle");
	});
	it("asks which transition to use for grouped columns", async () => {
		const { controller, dependencies } = setup([qa, dev]);
		await controller.start(issue, ["Needs QA", "In Development"]);
		expect(controller.getSnapshot()).toMatchObject({
			kind: "choosing",
			transitions: [qa, dev],
		});
		expect(dependencies.move).not.toHaveBeenCalled();
		await controller.choose("dev");
		expect(dependencies.move).toHaveBeenCalledWith(
			"TEAM-1",
			"dev",
			connectionRevision,
		);
	});
	it("card Move to requires explicit choice even for one transition", async () => {
		const { controller, dependencies } = setup();
		await controller.start(issue);
		expect(controller.getSnapshot().kind).toBe("choosing");
		expect(dependencies.move).not.toHaveBeenCalled();
		await controller.choose("unknown");
		expect(dependencies.move).not.toHaveBeenCalled();
		await controller.choose("qa");
		expect(dependencies.move).toHaveBeenCalledTimes(1);
	});
	it("same-column drops do not even query", async () => {
		const { controller, dependencies } = setup();
		await controller.start(issue, ["Backlog", "Needs QA"]);
		expect(dependencies.list).not.toHaveBeenCalled();
		expect(dependencies.move).not.toHaveBeenCalled();
	});
	it("required fields cannot be bypassed and empty choices remain visible", async () => {
		const required = { ...qa, requiredFields: ["Resolution"] };
		const { controller, dependencies } = setup([required]);
		await controller.start(issue, ["Needs QA"]);
		expect(controller.getSnapshot()).toMatchObject({
			kind: "choosing",
			transitions: [required],
		});
		await controller.choose("qa");
		expect(dependencies.move).not.toHaveBeenCalled();
		controller.cancel();
		await controller.start(issue, ["Done"]);
		expect(controller.getSnapshot()).toMatchObject({
			kind: "choosing",
			transitions: [],
		});
	});
	it("blocks duplicate gestures during lookup and mutation", async () => {
		const listing = deferred<JiraTransition[]>();
		const mutation = deferred<void>();
		const { controller, dependencies } = setup([], {
			list: mock(() => listing.promise.then(lookup)),
			move: mock(() => mutation.promise),
		});
		const first = controller.start(issue, ["Needs QA"]);
		await controller.start(issue);
		expect(dependencies.list).toHaveBeenCalledTimes(1);
		listing.resolve([qa]);
		await Promise.resolve();
		await controller.choose("qa");
		await controller.start(issue);
		controller.cancel();
		expect(controller.getSnapshot().kind).toBe("moving");
		expect(dependencies.move).toHaveBeenCalledTimes(1);
		mutation.resolve();
		await first;
	});
	it("cancel and connection unmount prevent late lookups from posting", async () => {
		for (const stop of ["cancel", "dispose"] as const) {
			const listing = deferred<JiraTransition[]>();
			let signal: AbortSignal | undefined;
			const { controller, dependencies } = setup([], {
				list: mock((_key, nextSignal) => {
					signal = nextSignal;
					return listing.promise.then(lookup);
				}),
			});
			const first = controller.start(issue, ["Needs QA"]);
			controller[stop]();
			listing.resolve([qa]);
			await first;
			expect(signal?.aborted).toBe(true);
			expect(dependencies.move).not.toHaveBeenCalled();
			expect(dependencies.refresh).not.toHaveBeenCalled();
		}
	});
	it("ignores old lookup after a new selection", async () => {
		const listing = deferred<JiraTransition[]>();
		let calls = 0;
		const { controller, dependencies } = setup([], {
			list: mock(async () =>
				lookup(++calls === 1 ? await listing.promise : [dev]),
			),
		});
		const old = controller.start(issue, ["Needs QA"]);
		controller.cancel();
		await controller.start(issue);
		listing.resolve([qa]);
		await old;
		expect(controller.getSnapshot()).toMatchObject({
			kind: "choosing",
			transitions: [dev],
		});
		expect(dependencies.move).not.toHaveBeenCalled();
	});
	it("denied moves remain errors without refetch, retries or optimistic updates", async () => {
		const failure = new Error("Transition no longer available");
		const { controller, dependencies } = setup([qa], {
			move: mock(async () => {
				throw failure;
			}),
		});
		await controller.start(issue, ["Needs QA"]);
		expect(controller.getSnapshot()).toMatchObject({
			kind: "error",
			error: failure,
		});
		expect(dependencies.refresh).not.toHaveBeenCalled();
		expect(dependencies.success).not.toHaveBeenCalled();
		expect(dependencies.move).toHaveBeenCalledTimes(1);
		expect(issue.status).toBe("Backlog");
	});
	it("distinguishes successful writes from refresh errors", async () => {
		const failure = new Error("offline");
		const { controller, dependencies } = setup([qa], {
			refresh: mock(async () => {
				throw failure;
			}),
		});
		await controller.start(issue, ["Needs QA"]);
		expect(dependencies.success).toHaveBeenCalledTimes(1);
		expect(dependencies.refreshFailed).toHaveBeenCalledWith(failure);
		expect(controller.getSnapshot().kind).toBe("idle");
	});
	it("does not notify a new connection about the old mutation", async () => {
		const mutation = deferred<void>();
		const { controller, dependencies } = setup([qa], {
			move: mock(() => mutation.promise),
		});
		const moving = controller.start(issue, ["Needs QA"]);
		await Promise.resolve();
		controller.dispose();
		mutation.resolve();
		await moving;
		expect(dependencies.success).not.toHaveBeenCalled();
		expect(dependencies.refresh).not.toHaveBeenCalled();
	});
});
