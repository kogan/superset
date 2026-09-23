export function isNativeClipboardShortcut(
	input: Pick<Electron.Input, "key" | "meta" | "control" | "alt" | "shift">,
	platform: NodeJS.Platform = process.platform,
): boolean {
	if (input.alt || input.shift) return false;
	const command =
		platform === "darwin"
			? input.meta && !input.control
			: input.control && !input.meta;
	return command && ["c", "x", "v"].includes(input.key.toLowerCase());
}
