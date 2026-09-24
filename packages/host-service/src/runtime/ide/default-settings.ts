import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	applyEdits,
	modify,
	type Node,
	type ParseError,
	parseTree,
} from "jsonc-parser";

export type IdeTheme = "dark" | "light";

const themes = { dark: "Dark Modern", light: "Light Modern" } satisfies Record<
	IdeTheme,
	string
>;
const settingsWrites = new Map<string, Promise<void>>();

export function initializeIdeSettings(
	userDataDirectory: string,
): Promise<void> {
	return updateSettings(userDataDirectory);
}

export function setIdeTheme(
	userDataDirectory: string,
	theme: IdeTheme,
): Promise<void> {
	return updateSettings(userDataDirectory, theme);
}

export async function getIdeTheme(
	userDataDirectory: string,
): Promise<IdeTheme | null> {
	await settingsWrites.get(userDataDirectory);
	const path = join(userDataDirectory, "User", "settings.json");
	let content: string;
	try {
		content = await readFile(path, "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT")
			return "dark";
		throw error;
	}
	const values = settingValues(
		parseSettings(content, path),
		"workbench.colorTheme",
	);
	const value = values.at(-1)?.value;
	if (value === themes.dark) return "dark";
	if (value === themes.light) return "light";
	return null;
}

function updateSettings(
	userDataDirectory: string,
	theme?: IdeTheme,
): Promise<void> {
	const previous = settingsWrites.get(userDataDirectory) ?? Promise.resolve();
	const write = previous
		.catch(() => {})
		.then(() => initialize(userDataDirectory, theme))
		.finally(() => {
			if (settingsWrites.get(userDataDirectory) === write)
				settingsWrites.delete(userDataDirectory);
		});
	settingsWrites.set(userDataDirectory, write);
	return write;
}

async function initialize(
	userDataDirectory: string,
	theme?: IdeTheme,
): Promise<void> {
	const directory = join(userDataDirectory, "User");
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const path = join(directory, "settings.json");
	try {
		await writeFile(
			path,
			`${JSON.stringify({ "workbench.colorTheme": themes[theme ?? "dark"], "files.hotExit": "off" }, null, 2)}\n`,
			{ flag: "wx", mode: 0o600 },
		);
		return;
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "EEXIST"))
			throw error;
	}
	const content = await readFile(path, "utf8");
	// Embedded browser backups cannot restore across the next session's origin.
	// Disabling hot exit makes VS Code veto shutdown while a working copy is dirty.
	let updated = updateSetting(content, path, "files.hotExit", "off");
	if (theme)
		updated = updateSetting(
			updated,
			path,
			"workbench.colorTheme",
			themes[theme],
		);
	if (updated === content) return;
	const temporary = join(directory, `.settings-${randomUUID()}.tmp`);
	try {
		await writeFile(temporary, updated, { flag: "wx", mode: 0o600 });
		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true });
	}
}

function parseSettings(content: string, path: string): Node | undefined {
	const errors: ParseError[] = [];
	const root = parseTree(content, errors, {
		allowTrailingComma: true,
		allowEmptyContent: true,
	});
	if (errors.length || (root && root.type !== "object")) {
		throw new Error(`Cannot update IDE settings: fix invalid JSON in ${path}`);
	}
	return root;
}

function settingValues(root: Node | undefined, setting: string): Node[] {
	return (root?.children ?? []).flatMap((property) => {
		const [key, value] = property.children ?? [];
		return key?.value === setting && value ? [value] : [];
	});
}

function updateSetting(
	content: string,
	path: string,
	setting: string,
	value: string,
): string {
	const values = settingValues(parseSettings(content, path), setting);
	const edits = values.length
		? values
				.filter((node) => node.value !== value)
				.map((node) => ({
					offset: node.offset,
					length: node.length,
					content: JSON.stringify(value),
				}))
		: modify(content, [setting], value, {
				formattingOptions: { insertSpaces: true, tabSize: 2 },
			});
	return applyEdits(content, edits);
}
