import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { z } from "zod";

export const jiraWorkspaceLinkSchema = z.object({
	issueKey: z.string().regex(/^[A-Z][A-Z0-9_]*-\d+$/),
	workspaceId: z.string().uuid(),
	hostId: z.string().min(1).max(200),
	linked: z.boolean(),
});
export type JiraWorkspaceLink = z.infer<typeof jiraWorkspaceLinkSchema>;

export function createJiraWorkspaceStorage(directory: string) {
	let database: Database.Database | undefined;
	function open() {
		if (database) return database;
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		const filename = join(directory, "jira-workspaces.db");
		database = new Database(filename);
		chmodSync(filename, 0o600);
		database.exec(`CREATE TABLE IF NOT EXISTS workspace_links (
			base_url TEXT NOT NULL,
			issue_key TEXT NOT NULL,
			workspace_id TEXT NOT NULL,
			host_id TEXT NOT NULL,
			linked INTEGER NOT NULL CHECK (linked IN (0, 1)),
			PRIMARY KEY (base_url, issue_key, workspace_id, host_id)
		)`);
		return database;
	}
	return {
		list(baseUrl: string): JiraWorkspaceLink[] {
			return z.array(jiraWorkspaceLinkSchema).parse(
				open()
					.prepare(`SELECT issue_key AS issueKey, workspace_id AS workspaceId,
					host_id AS hostId, linked FROM workspace_links WHERE base_url = ?`)
					.all(baseUrl)
					.map((row) => {
						const parsed = jiraWorkspaceLinkSchema
							.extend({ linked: z.number() })
							.parse(row);
						return { ...parsed, linked: parsed.linked === 1 };
					}),
			);
		},
		set(baseUrl: string, link: JiraWorkspaceLink) {
			open()
				.prepare(`INSERT INTO workspace_links (base_url, issue_key, workspace_id, host_id, linked)
				VALUES (?, ?, ?, ?, ?) ON CONFLICT (base_url, issue_key, workspace_id, host_id)
				DO UPDATE SET linked = excluded.linked`)
				.run(
					baseUrl,
					link.issueKey,
					link.workspaceId,
					link.hostId,
					Number(link.linked),
				);
		},
	};
}
