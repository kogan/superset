import { describe, expect, test } from "bun:test";
import {
	migratePullRequestsFilterState,
	pullRequestsSearchFromFilters,
	usePullRequestsFilterStore,
} from "./pullRequestsFilterStore";

describe("usePullRequestsFilterStore.setProjectFilters", () => {
	test("does not notify subscribers when filters are unchanged", () => {
		// Views sync filters back through an effect keyed on this array, so an
		// always-fresh reference here regresses into an infinite update loop.
		const { setProjectFilters } = usePullRequestsFilterStore.getState();
		setProjectFilters(["project-1", "project-2"]);
		const before = usePullRequestsFilterStore.getState().projectFilters;
		let notifications = 0;
		const unsubscribe = usePullRequestsFilterStore.subscribe(() => {
			notifications += 1;
		});
		setProjectFilters(["project-1", "project-2"]);
		unsubscribe();
		expect(usePullRequestsFilterStore.getState().projectFilters).toBe(before);
		expect(notifications).toBe(0);
		usePullRequestsFilterStore.getState().setProjectFilters([]);
	});
});

describe("pullRequestsSearchFromFilters", () => {
	test("omits default filters", () => {
		expect(
			pullRequestsSearchFromFilters({
				search: "",
				projectFilters: [],
				authorFilter: null,
				reviewFilter: null,
				includeClosed: false,
				mergedOnly: false,
			}),
		).toEqual({});
	});

	test("serializes independent pull request filters", () => {
		expect(
			pullRequestsSearchFromFilters({
				search: "remote host",
				projectFilters: ["project-1", "project-2"],
				authorFilter: "octocat,teammate",
				reviewFilter: "changes-requested",
				includeClosed: true,
				mergedOnly: false,
			}),
		).toEqual({
			search: "remote host",
			projects: "project-1,project-2",
			author: "octocat,teammate",
			review: "changes-requested",
			state: "all",
		});
	});

	test("mergedOnly wins over includeClosed in the serialized state", () => {
		expect(
			pullRequestsSearchFromFilters({
				search: "",
				projectFilters: [],
				authorFilter: null,
				reviewFilter: null,
				includeClosed: true,
				mergedOnly: true,
			}),
		).toEqual({ state: "merged" });
	});
});

describe("migratePullRequestsFilterState", () => {
	test("moves the legacy single repository into the multi-select state", () => {
		expect(
			migratePullRequestsFilterState({
				projectFilter: "project-1",
				authorFilter: " @octocat ",
				reviewFilter: "approved",
			}),
		).toMatchObject({
			projectFilters: ["project-1"],
			authorFilter: "octocat",
			reviewFilter: "approved",
		});
	});

	test("defaults corrupt persisted values safely", () => {
		expect(
			migratePullRequestsFilterState({
				projectFilters: ["project-1", 42, "project-1"],
				authorFilter: "octocat author:someone-else",
				reviewFilter: "review:approved",
				includeClosed: "true",
				mergedOnly: "true",
			}),
		).toMatchObject({
			projectFilters: ["project-1"],
			authorFilter: null,
			reviewFilter: null,
			includeClosed: false,
			mergedOnly: false,
		});
		expect(migratePullRequestsFilterState(null)).toMatchObject({
			projectFilters: [],
			authorFilter: null,
			reviewFilter: null,
			includeClosed: false,
			mergedOnly: false,
		});
	});
});

test("restores saved multiple authors", () => {
	expect(
		migratePullRequestsFilterState({ authorFilter: "alice, @bob, ALICE" })
			.authorFilter,
	).toBe("alice,bob");
	usePullRequestsFilterStore.getState().setAuthorFilter("alice, @bob, ALICE");
	expect(usePullRequestsFilterStore.getState().authorFilter).toBe("alice,bob");
	usePullRequestsFilterStore.getState().setAuthorFilter(null);
	expect(usePullRequestsFilterStore.getState().authorFilter).toBeNull();
});

describe("editable team persistence", () => {
	test("never seeds a team when upgrading an installation without saved members", () => {
		const upgraded = migratePullRequestsFilterState({ authorFilter: "alice" });
		expect(upgraded.teamMembers).toEqual([]);
		expect(upgraded.authorFilter).toBe("alice");
		expect(migratePullRequestsFilterState(undefined).teamMembers).toEqual([]);
		expect(migratePullRequestsFilterState({}).teamMembers).toEqual([]);
	});
	test("empty and edited teams survive migration and rehydration normalization", () => {
		expect(
			migratePullRequestsFilterState({ teamMembers: [] }).teamMembers,
		).toEqual([]);
		const saved = migratePullRequestsFilterState({
			teamMembers: [{ login: "@Alice" }],
		});
		expect(migratePullRequestsFilterState(saved).teamMembers).toEqual([
			{ login: "alice" },
		]);
		const { setTeamMembers } = usePullRequestsFilterStore.getState();
		setTeamMembers([{ login: "Alice" }, { login: "ALICE" }, { login: "bob" }]);
		expect(usePullRequestsFilterStore.getState().teamMembers).toEqual([
			{ login: "alice" },
			{ login: "bob" },
		]);
		setTeamMembers([]);
		expect(usePullRequestsFilterStore.getState().teamMembers).toEqual([]);
	});
});

test("editing the team updates an active team filter but preserves other author filters", () => {
	const store = usePullRequestsFilterStore.getState();
	store.setTeamMembers([{ login: "alice" }, { login: "bob" }]);
	store.setAuthorFilter("alice,bob");
	store.setTeamMembers([{ login: "charlie" }]);
	expect(usePullRequestsFilterStore.getState().authorFilter).toBe("charlie");
	store.setTeamMembers([]);
	expect(usePullRequestsFilterStore.getState().authorFilter).toBeNull();
	store.setAuthorFilter("someone-else");
	store.setTeamMembers([{ login: "alice" }]);
	expect(usePullRequestsFilterStore.getState().authorFilter).toBe(
		"someone-else",
	);
	store.setTeamMembers([]);
	store.setAuthorFilter(null);
});
