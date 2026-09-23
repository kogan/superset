import { msg } from "@lingui/core/macro";
import { i18n } from "@superset/i18n";
import { type BrowserWindow, dialog } from "electron";
import { ideManager } from "./ide-manager";

export async function allowIdeClose(window?: BrowserWindow): Promise<boolean> {
	try {
		const allowed = await (window
			? ideManager.canCloseWindow(window)
			: ideManager.canCloseApp());
		if (allowed) return true;
	} catch (error) {
		console.error("[ide] Could not check editors before closing", error);
	}
	const options: Electron.MessageBoxOptions = {
		type: "warning",
		message: i18n._(
			msg({ message: "Save your files before closing the IDE." }),
		),
	};
	if (window && !window.isDestroyed())
		await dialog.showMessageBox(window, options);
	else await dialog.showMessageBox(options);
	return false;
}
