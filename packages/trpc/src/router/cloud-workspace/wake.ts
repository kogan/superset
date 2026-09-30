import { db } from "@superset/db/client";
import { cloudWorkspaces } from "@superset/db/schema";
import { eq } from "drizzle-orm";
import { nudge } from "../../lib/realtime";
import { buildSandboxClaim, wakeSandbox } from "../../lib/sandbox";
import { transitionCloudWorkspace } from "./transition";

type CloudWorkspaceRow = typeof cloudWorkspaces.$inferSelect;

/** Resumes or extends the sandbox and records its current address. */
export async function wakeCloudWorkspace(
	row: CloudWorkspaceRow,
): Promise<string> {
	const { claim } = await buildSandboxClaim({ row });
	const { hostTarget } = await wakeSandbox({
		providerSandboxId: row.providerSandboxId,
		claim,
	});
	if (hostTarget !== row.sandboxUrl) {
		await db
			.update(cloudWorkspaces)
			.set({ sandboxUrl: hostTarget })
			.where(eq(cloudWorkspaces.id, row.id));
	}
	return hostTarget;
}

/**
 * For a sandbox that is gone or can never resume. A `ready` row nothing can
 * open would sit in the sidebar forever; failed is the state the client
 * already renders with a way out.
 */
export async function markSandboxUnavailable(
	row: CloudWorkspaceRow,
	error: unknown,
): Promise<void> {
	await transitionCloudWorkspace({
		id: row.id,
		from: ["ready"],
		to: "failed",
		set: { sandboxUrl: null },
	});
	nudge(row.organizationId, "cloud_workspaces");
	console.error(`[cloud-workspace] ${row.id} sandbox unavailable`, error);
}
