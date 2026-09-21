import { expect, test } from "bun:test";
import { applyColumnLayout, mergeColumnLayout } from "./columnLayout";

test("restores saved order and visibility, adding newly discovered columns at the end", () => {
	const columns = [{ key: "todo" }, { key: "dev" }, { key: "review" }];
	expect(
		applyColumnLayout(columns, [
			{ key: "dev", visible: true },
			{ key: "todo", visible: false },
			{ key: "absent", visible: false },
		]),
	).toEqual([
		{ key: "dev", visible: true },
		{ key: "todo", visible: false },
		{ key: "review", visible: true },
	]);
	expect(applyColumnLayout(columns)).toEqual(
		columns.map((column) => ({ ...column, visible: true })),
	);
});

test("editing filtered columns preserves hidden preferences for statuses not currently loaded", () => {
	expect(
		mergeColumnLayout(
			[{ key: "dev", visible: false }],
			[
				{ key: "todo", visible: false },
				{ key: "dev", visible: true },
			],
		),
	).toEqual([
		{ key: "dev", visible: false },
		{ key: "todo", visible: false },
	]);
});
