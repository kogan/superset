import { describe, expect, test } from "bun:test";
import { buildStack, type StackPullRequest } from "./buildStack";

function pr(
	headRef: string,
	baseRef: string,
	number: number,
	extra: Partial<StackPullRequest> = {},
): StackPullRequest {
	return {
		number,
		title: `PR ${number}`,
		headRef,
		baseRef,
		url: `https://github.com/o/r/pull/${number}`,
		isDraft: false,
		state: "open",
		...extra,
	};
}

describe("buildStack", () => {
	test("walks a 3-PR chain tip-first with the current branch flagged", () => {
		const prs = [pr("a", "develop", 1), pr("b", "a", 2), pr("c", "b", 3)];
		const stack = buildStack(prs, "c");
		expect(stack.map((n) => n.headRef)).toEqual(["c", "b", "a"]);
		expect(stack.map((n) => n.number)).toEqual([3, 2, 1]);
		expect(stack.filter((n) => n.isCurrent).map((n) => n.headRef)).toEqual([
			"c",
		]);
	});

	test("shows the full chain from a mid-stack branch, marking it current", () => {
		const prs = [pr("a", "develop", 1), pr("b", "a", 2), pr("c", "b", 3)];
		const stack = buildStack(prs, "b");
		// Full tip→trunk, not just "b" and below.
		expect(stack.map((n) => n.headRef)).toEqual(["c", "b", "a"]);
		expect(stack.filter((n) => n.isCurrent).map((n) => n.headRef)).toEqual([
			"b",
		]);
	});

	test("shows the full chain from the base branch too", () => {
		const prs = [pr("a", "develop", 1), pr("b", "a", 2), pr("c", "b", 3)];
		const stack = buildStack(prs, "a");
		expect(stack.map((n) => n.headRef)).toEqual(["c", "b", "a"]);
		expect(stack.find((n) => n.isCurrent)?.headRef).toBe("a");
	});

	test("a lone PR targeting trunk is length 1 (the view treats it as no stack)", () => {
		expect(
			buildStack([pr("a", "develop", 1)], "a").map((n) => n.headRef),
		).toEqual(["a"]);
	});

	test("returns empty when the current branch has no PR", () => {
		expect(buildStack([pr("a", "develop", 1)], "feature-no-pr")).toEqual([]);
	});

	test("stops at trunk even when trunk is not a known PR head", () => {
		const stack = buildStack([pr("b", "a", 2), pr("a", "main", 1)], "b");
		expect(stack.map((n) => n.headRef)).toEqual(["b", "a"]);
	});

	test("does not loop forever on a cyclic base chain", () => {
		const prs = [pr("a", "b", 1), pr("b", "a", 2)];
		const stack = buildStack(prs, "a");
		// Each head is visited at most once.
		expect(new Set(stack.map((n) => n.headRef)).size).toBe(stack.length);
		expect(stack.length).toBeLessThanOrEqual(2);
	});
});
