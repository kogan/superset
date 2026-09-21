import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const SUPERSET_HOME_DIR_NAME = ".superestset";

export function defaultSupersetHomeDir(
	env: NodeJS.ProcessEnv = process.env,
): string {
	return (
		env.SUPERSET_HOME_DIR?.trim() || join(homedir(), SUPERSET_HOME_DIR_NAME)
	);
}

export function isDefaultSupersetHomeDir(home: string): boolean {
	return resolve(home) === resolve(join(homedir(), SUPERSET_HOME_DIR_NAME));
}

export function defaultWorkspaceFilesHomeDir(): string {
	const runtimeHome = defaultSupersetHomeDir();
	return isDefaultSupersetHomeDir(runtimeHome)
		? join(homedir(), ".superset")
		: runtimeHome;
}
