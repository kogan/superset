import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "jsonc-parser";
import {
	getIdeTheme,
	initializeIdeSettings,
	setIdeTheme,
} from "./default-settings";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function fixture(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "ide-settings-test-"));
	directories.push(directory);
	return directory;
}

test("new IDE profiles use Dark Modern and disable hot exit", async () => {
	const directory = await fixture();
	await initializeIdeSettings(directory);
	expect(
		JSON.parse(
			await readFile(join(directory, "User", "settings.json"), "utf8"),
		),
	).toEqual({ "workbench.colorTheme": "Dark Modern", "files.hotExit": "off" });
});

test("existing preferences and JSONC comments survive adding hot exit", async () => {
	const directory = await fixture();
	await mkdir(join(directory, "User"));
	const preferences =
		'{\n // My preferred theme\n "workbench.colorTheme": "Light Modern",\n "editor.fontSize": 17,\n}\n';
	const path = join(directory, "User", "settings.json");
	await writeFile(path, preferences);
	await initializeIdeSettings(directory);
	const updated = await readFile(path, "utf8");
	expect(updated).toContain("// My preferred theme");
	expect(parse(updated)).toEqual({
		"workbench.colorTheme": "Light Modern",
		"editor.fontSize": 17,
		"files.hotExit": "off",
	});
	await initializeIdeSettings(directory);
	expect(await readFile(path, "utf8")).toBe(updated);
});

test("unsafe hot exit values change without reformatting existing JSONC", async () => {
	const directory = await fixture();
	await mkdir(join(directory, "User"));
	const preferences =
		'{\r\n\t// Preserve this comment\r\n\t"files.hotExit": "onExit",\r\n\t"workbench.colorTheme": "Light Modern",\r\n}\r\n';
	const path = join(directory, "User", "settings.json");
	await writeFile(path, preferences);
	await initializeIdeSettings(directory);
	expect(await readFile(path, "utf8")).toBe(
		preferences.replace('"onExit"', '"off"'),
	);
});

test("duplicate hot exit keys cannot retain an unsafe value", async () => {
	const directory = await fixture();
	await mkdir(join(directory, "User"));
	const path = join(directory, "User", "settings.json");
	await writeFile(
		path,
		'{"files.hotExit":"onExit", "files.hotExit":"onExitAndWindowClose"}',
	);
	await initializeIdeSettings(directory);
	expect(await readFile(path, "utf8")).toBe(
		'{"files.hotExit":"off", "files.hotExit":"off"}',
	);
});

test("invalid settings block initialization without changing the file", async () => {
	const directory = await fixture();
	await mkdir(join(directory, "User"));
	const path = join(directory, "User", "settings.json");
	for (const preferences of ['{"editor.fontSize":', "[]"]) {
		await writeFile(path, preferences);
		await expect(initializeIdeSettings(directory)).rejects.toThrow(
			"fix invalid JSON",
		);
		expect(await readFile(path, "utf8")).toBe(preferences);
	}
});

test("concurrent initialization converges without replacing settings", async () => {
	const directory = await fixture();
	await Promise.all([
		initializeIdeSettings(directory),
		initializeIdeSettings(directory),
	]);
	const path = join(directory, "User", "settings.json");
	expect(JSON.parse(await readFile(path, "utf8"))["workbench.colorTheme"]).toBe(
		"Dark Modern",
	);
	await writeFile(path, '{"editor.fontSize":20}\n');
	await initializeIdeSettings(directory);
	expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
		"editor.fontSize": 20,
		"files.hotExit": "off",
	});
});

test("theme selection preserves JSONC and safety settings until explicitly changed", async () => {
	const directory = await fixture();
	expect(await getIdeTheme(directory)).toBe("dark");
	await mkdir(join(directory, "User"));
	const path = join(directory, "User", "settings.json");
	const custom =
		'{\n\t// My favorite colors\n\t"workbench.colorTheme": "Nord",\n\t"files.hotExit": "off",\n\t"editor.fontSize": 17,\n}\n';
	await writeFile(path, custom);
	expect(await getIdeTheme(directory)).toBeNull();
	await initializeIdeSettings(directory);
	expect(await readFile(path, "utf8")).toBe(custom);
	await setIdeTheme(directory, "light");
	expect(await getIdeTheme(directory)).toBe("light");
	expect(await readFile(path, "utf8")).toBe(
		custom.replace('"Nord"', '"Light Modern"'),
	);
	await setIdeTheme(directory, "dark");
	expect(await getIdeTheme(directory)).toBe("dark");
	expect(await readFile(path, "utf8")).toBe(
		custom.replace('"Nord"', '"Dark Modern"'),
	);
});

test("theme writes serialize with initialization and keep hot exit off", async () => {
	const directory = await fixture();
	await Promise.all([
		initializeIdeSettings(directory),
		setIdeTheme(directory, "dark"),
		setIdeTheme(directory, "light"),
		initializeIdeSettings(directory),
	]);
	expect(await getIdeTheme(directory)).toBe("light");
	expect(
		JSON.parse(
			await readFile(join(directory, "User", "settings.json"), "utf8"),
		),
	).toEqual({
		"workbench.colorTheme": "Light Modern",
		"files.hotExit": "off",
	});
});
