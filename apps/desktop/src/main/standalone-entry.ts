import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { msg } from "@lingui/core/macro";
import { i18n, initI18n, initI18nAsync, resolveLocale } from "@superset/i18n";
import { FORK } from "@superset/shared/standalone";
import { app, dialog, ipcMain, protocol } from "electron";
import { startLocalServices, stopLocalServices } from "./lib/local-runtime";

// Establish identity before any module opens SQLite, reads auth, or owns a host.
// Electron selects the macOS Keychain service before ready. Keep existing keys.
app.setName(FORK.storageName);
initI18n();
// Closing the import progress window must not quit before the main window exists.
const holdStartupOpen = () => {};
app.on("window-all-closed", holdStartupOpen);
const dataDir =
	process.env.SUPERESTSET_DATA_DIR || join(homedir(), ".superestset");
if (!isAbsolute(dataDir))
	throw new Error("SUPERESTSET_DATA_DIR must be absolute");
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const profile = join(dataDir, "electron");
mkdirSync(profile, { recursive: true, mode: 0o700 });
app.setPath("userData", profile);
app.setPath("sessionData", profile);
process.env.SUPERSET_HOME_DIR = dataDir;
process.env.SUPERESTSET_LOCAL = "1";
delete process.env.SUPERSET_WORKSPACE_ID;
delete process.env.SUPERSET_WORKSPACE_NAME;

protocol.registerSchemesAsPrivileged([
	{
		scheme: "superset-icon",
		privileges: {
			standard: true,
			secure: true,
			bypassCSP: true,
			supportFetchAPI: true,
		},
	},
	{
		scheme: "superset-font",
		privileges: {
			standard: true,
			secure: true,
			bypassCSP: true,
			supportFetchAPI: true,
		},
	},
]);

if (!app.requestSingleInstanceLock()) app.exit(0);
else {
	void (async () => {
		const runtime = await startLocalServices(dataDir);
		Object.assign(process.env, runtime.publicEnvironment);
		process.env.SUPERESTSET_API_ORIGIN = runtime.session.apiOrigin;
		process.env.SUPERESTSET_CONTENT_ORIGIN =
			runtime.publicEnvironment.USERCONTENT_URL;
		ipcMain.on("superestset:environment", (event) => {
			event.returnValue = runtime.publicEnvironment;
		});
		// A graceful shutdown message flushes PGlite before its process exits.
		app.on("will-quit", (event) => {
			event.preventDefault();
			void stopLocalServices().finally(() => app.exit(0));
		});
		await app.whenReady();
		app.setName(FORK.name);
		const [{ localDb }, { settings }] = await Promise.all([
			import("./lib/local-db"),
			import("@superset/local-db"),
		]);
		const language = localDb.select().from(settings).get()?.language;
		await initI18nAsync(
			resolveLocale([
				...(language ? [language] : []),
				...app.getPreferredSystemLanguages(),
			]),
		);
		const { saveToken, saveOrganizationIds } = await import(
			"../lib/trpc/routers/auth/utils/auth-functions"
		);
		await saveToken(runtime.session);
		await saveOrganizationIds({ ...runtime.session, expectedRevision: 0 });
		const { connectExistingWorkspaces } = await import(
			"./lib/workspace-connections/startup"
		);
		try {
			await connectExistingWorkspaces(dataDir, runtime.session);
		} catch (error) {
			dialog.showErrorBox(
				i18n._(
					msg({ message: "Some Superset workspaces could not be connected." }),
				),
				error instanceof Error ? error.message : String(error),
			);
		}
		await import("./index");
		app.removeListener("window-all-closed", holdStartupOpen);
	})().catch(async (error) => {
		console.error(`[${FORK.name}] Startup failed`, error);
		await app.whenReady();
		dialog.showErrorBox(
			`${FORK.name} could not start`,
			error instanceof Error ? error.message : String(error),
		);
		await stopLocalServices();
		app.exit(1);
	});
}
