import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { msg } from "@lingui/core/macro";
import { i18n } from "@superset/i18n";
import { app, dialog } from "electron";
import { z } from "zod";
import { connectWorkspaceSources, discoverWorkspaceSources } from "./connect";

export async function requestWorkspaceRefresh() {
	const { response } = await dialog.showMessageBox({
		type: "question",
		message: i18n._(msg({ message: "Refresh Superset Workspaces…" })),
		detail: i18n._(
			msg({
				message:
					"Restart to find existing Superset workspaces. Their folders will be opened in place.",
			}),
		),
		buttons: [
			i18n._(msg({ message: "Restart" })),
			i18n._(msg({ message: "Cancel" })),
		],
		defaultId: 0,
		cancelId: 1,
	});
	if (response !== 0) return;
	const { quitApp } = await import("../../index");
	app.relaunch();
	quitApp();
}

export async function connectExistingWorkspaces(
	dataDir: string,
	session: { apiOrigin: string; token: string; organizationIds: string[] },
) {
	const sources = await discoverWorkspaceSources(dataDir);
	if (sources.length === 0) return;
	const response = await fetch(`${session.apiOrigin}/api/auth/get-session`, {
		headers: { authorization: `Bearer ${session.token}` },
	});
	if (!response.ok) throw new Error("Could not identify the local account.");
	const identity = z
		.object({ user: z.object({ id: z.uuid() }) })
		.parse(await response.json());
	const organizationId = session.organizationIds[0];
	if (!organizationId)
		throw new Error("The local account has no organization.");
	const result = await connectWorkspaceSources(sources, {
		dataDir,
		organizationId,
		userId: identity.user.id,
		migrationsFolder: app.isPackaged
			? join(process.resourcesPath, "resources/host-migrations")
			: join(app.getAppPath(), "../../packages/host-service/drizzle"),
	});
	await writeFile(
		join(dataDir, "superset-connections-report.json"),
		JSON.stringify(
			{
				...result,
				sources: sources.map((source) => source.home),
				at: new Date().toISOString(),
			},
			null,
			2,
		),
		{ mode: 0o600 },
	);
	if (result.failures.length)
		await dialog.showMessageBox({
			type: "warning",
			message: i18n._(
				msg({ message: "Some Superset workspaces could not be connected." }),
			),
			detail: result.failures.join("\n"),
			buttons: [i18n._(msg({ message: "Continue" }))],
		});
}
