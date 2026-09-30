import { expect, test } from "bun:test";
import {
	applyColumnLayout,
	getVisibleBoardStatuses,
	mergeColumnLayout,
} from "./columnLayout";

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

test("carries status-based visibility and order into actual board columns", () => {
	const columns = [
		{
			key: "dev",
			layoutKeys: [
				'["indeterminate","In Development"]',
				'["indeterminate","Needs QA"]',
			],
		},
		{ key: "qa", layoutKeys: ['["indeterminate","Being QA\'d"]'] },
		{ key: "done", layoutKeys: ['["done","Closed"]', '["done","Live"]'] },
		{ key: "new" },
	];
	const saved = [
		{ key: '["indeterminate","Being QA\'d"]', visible: true },
		{ key: '["indeterminate","Needs QA"]', visible: false },
		{ key: '["indeterminate","In Development"]', visible: true },
		{ key: '["done","Closed"]', visible: false },
		{ key: '["done","Live"]', visible: false },
	];
	expect(
		applyColumnLayout(columns, saved).map(({ key, visible }) => ({
			key,
			visible,
		})),
	).toEqual([
		{ key: "qa", visible: true },
		{ key: "dev", visible: true },
		{ key: "done", visible: false },
		{ key: "new", visible: true },
	]);
	const updated = [
		{ key: "dev", visible: false },
		{ key: "qa", visible: true },
		...saved,
	];
	expect(
		applyColumnLayout(columns, updated)
			.slice(0, 2)
			.map(({ key, visible }) => ({ key, visible })),
	).toEqual([
		{ key: "dev", visible: false },
		{ key: "qa", visible: true },
	]);
});

test("only queries visible board statuses, so hidden backlog and done issues cannot fill the first page", () => {
	const columns = [
		{ key: "backlog", name: "Backlog", statuses: ["To Do"] },
		{ key: "dev", name: "In Dev", statuses: ["In Development", "Review"] },
		{ key: "qa", name: "QA", statuses: ["Review", "Testing"] },
		{ key: "done", name: "Done", statuses: ["Closed", "Live"] },
	];
	const layout = [
		{ key: "backlog", visible: false },
		{ key: "done", visible: false },
	];
	expect(getVisibleBoardStatuses(columns, layout)).toEqual([
		"In Development",
		"Review",
		"Testing",
	]);
	expect(getVisibleBoardStatuses([...columns].reverse(), layout)).toEqual(
		getVisibleBoardStatuses(columns, layout),
	);
	expect(
		getVisibleBoardStatuses(
			columns,
			columns.map(({ key }) => ({ key, visible: false })),
		),
	).toEqual([]);
	expect(getVisibleBoardStatuses(undefined)).toEqual([]);
});

test("uses the same legacy visibility mappings for the Jira query and rendered board", () => {
	const columns = [
		{ key: "dev", name: "In Dev", statuses: ["In Development"] },
		{ key: "done", name: "Done", statuses: ["Closed", "Live"] },
	];
	expect(
		getVisibleBoardStatuses(columns, [
			{ key: '["done","Closed"]', visible: false },
			{ key: '["done","Live"]', visible: false },
		]),
	).toEqual(["In Development"]);
});
