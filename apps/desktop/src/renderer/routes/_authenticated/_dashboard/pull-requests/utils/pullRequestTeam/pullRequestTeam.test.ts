import { expect, test } from "bun:test";
import {
	getTeamAuthors,
	isTeamAuthorFilter,
	MAX_TEAM_MEMBERS,
	normalizeTeamMembers,
} from "./pullRequestTeam";

test("normalizes saved members and removes duplicates, invalid logins and unbounded names", () => {
	expect(
		normalizeTeamMembers([
			{ login: " @Alice ", name: " Alice " },
			{ login: "ALICE" },
			{ login: "bob" },
			{ login: "bad login author:attacker" },
			{ login: "charlie", name: "x".repeat(101) },
			null,
		]),
	).toEqual([{ login: "alice", name: "Alice" }, { login: "bob" }]);
	expect(normalizeTeamMembers(null)).toEqual([]);
	expect(
		normalizeTeamMembers(
			Array.from({ length: 30 }, (_, i) => ({ login: `user-${i}` })),
		),
	).toHaveLength(MAX_TEAM_MEMBERS);
});

test("an empty roster cannot activate an all-authors team filter", () => {
	expect(getTeamAuthors([])).toBeNull();
	expect(isTeamAuthorFilter(null, [])).toBe(false);
	expect(isTeamAuthorFilter("alice", [])).toBe(false);
});

test("recognizes exactly the configured team regardless of order and case", () => {
	const members = [{ login: "alice" }, { login: "bob" }];
	expect(getTeamAuthors(members)).toBe("alice,bob");
	expect(isTeamAuthorFilter("BOB,ALICE", members)).toBe(true);
	expect(isTeamAuthorFilter("alice", members)).toBe(false);
	expect(isTeamAuthorFilter("alice,bob,charlie", members)).toBe(false);
	expect(isTeamAuthorFilter("alice,bob", [{ login: "charlie" }])).toBe(false);
});
