import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { msg } from "@lingui/core/macro";
import { i18n } from "@superset/i18n";
import { TRPCError } from "@trpc/server";
import type { safeStorage as electronSafeStorage } from "electron";
import {
	SUPERSET_HOME_DIR_MODE,
	SUPERSET_SENSITIVE_FILE_MODE,
} from "main/lib/app-environment";
import {
	type StoredJiraConnection,
	storedJiraConnectionSchema,
} from "./jira-schema";

type JiraEncryption = Pick<
	typeof electronSafeStorage,
	| "isEncryptionAvailable"
	| "getSelectedStorageBackend"
	| "encryptString"
	| "decryptString"
>;

export function createJiraStorage({
	directory,
	encryption,
	platform = process.platform,
}: {
	directory: string;
	encryption: JiraEncryption;
	platform?: NodeJS.Platform;
}) {
	const filename = join(directory, "jira-connection.enc");

	function requireEncryption() {
		if (
			!encryption.isEncryptionAvailable() ||
			(platform === "linux" &&
				encryption.getSelectedStorageBackend() === "basic_text")
		) {
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: i18n._(
					msg({
						message:
							"Secure storage is unavailable. Unlock your system keychain and try again.",
					}),
				),
			});
		}
	}

	return {
		async read(): Promise<StoredJiraConnection | null> {
			try {
				const bytes = await readFile(filename);
				requireEncryption();
				const data: unknown = JSON.parse(encryption.decryptString(bytes));
				return storedJiraConnectionSchema.parse(data);
			} catch (error) {
				if (
					error instanceof Error &&
					"code" in error &&
					error.code === "ENOENT"
				) {
					return null;
				}
				if (error instanceof TRPCError) throw error;
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: i18n._(
						msg({
							message:
								"Could not read the saved Jira connection. Disconnect and connect again.",
						}),
					),
				});
			}
		},

		async write(connection: StoredJiraConnection) {
			const temporaryFile = `${filename}.${randomUUID()}.tmp`;
			let handle: Awaited<ReturnType<typeof open>> | undefined;
			try {
				requireEncryption();
				const bytes = encryption.encryptString(JSON.stringify(connection));
				await mkdir(directory, {
					recursive: true,
					mode: SUPERSET_HOME_DIR_MODE,
				});
				handle = await open(temporaryFile, "wx", SUPERSET_SENSITIVE_FILE_MODE);
				await handle.writeFile(bytes);
				await handle.chmod(SUPERSET_SENSITIVE_FILE_MODE);
				await handle.sync();
				await handle.close();
				handle = undefined;
				await rename(temporaryFile, filename);
			} catch (error) {
				if (error instanceof TRPCError) throw error;
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: i18n._(
						msg({
							message:
								"Could not save the Jira connection. Check local storage permissions and try again.",
						}),
					),
				});
			} finally {
				await handle?.close().catch(() => {});
				await rm(temporaryFile, { force: true }).catch(() => {});
			}
		},

		async remove() {
			try {
				await rm(filename, { force: true });
			} catch {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: i18n._(
						msg({
							message:
								"Could not remove the Jira connection. Check local storage permissions and try again.",
						}),
					),
				});
			}
		},
	};
}
