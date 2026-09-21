import { join } from "node:path";
import { FORK } from "@superset/shared/standalone";
import { app } from "electron";

/** Keep background Node processes out of the main app's macOS identity. */
export function nodeExecutable() {
	return app.isPackaged && process.platform === "darwin"
		? join(
				process.resourcesPath,
				`../Frameworks/${FORK.name} Helper.app/Contents/MacOS/${FORK.name} Helper`,
			)
		: process.execPath;
}
