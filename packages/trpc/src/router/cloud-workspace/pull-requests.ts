import { db } from "@superset/db/client";
import {
	cloudWorkspacePullRequests,
	cloudWorkspaceRepositories,
	githubRepositories,
} from "@superset/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { nudge } from "../../lib/realtime";

export const reportedPullRequestsSchema = z
	.array(
		z.object({
			repository: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
			number: z.number().int().positive().max(2_147_483_647),
			linkedAt: z.number().int().positive().optional(),
		}),
	)
	.max(200);

export async function recordPullRequests(
	workspace: { id: string; organizationId: string },
	pullRequests: z.infer<typeof reportedPullRequestsSchema>,
): Promise<{ ignored: string[] }> {
	const repositories = await db
		.select({
			id: githubRepositories.id,
			fullName: githubRepositories.fullName,
		})
		.from(cloudWorkspaceRepositories)
		.innerJoin(
			githubRepositories,
			eq(cloudWorkspaceRepositories.repositoryId, githubRepositories.id),
		)
		.where(eq(cloudWorkspaceRepositories.cloudWorkspaceId, workspace.id));
	const repositoryIdByName = new Map(
		repositories.map((row) => [row.fullName.toLowerCase(), row.id]),
	);
	const ignored = new Set<string>();
	const rows = pullRequests.flatMap((pullRequest) => {
		const repositoryId = repositoryIdByName.get(
			pullRequest.repository.toLowerCase(),
		);
		if (!repositoryId) {
			ignored.add(pullRequest.repository);
			return [];
		}
		return [
			{
				cloudWorkspaceId: workspace.id,
				repositoryId,
				prNumber: pullRequest.number,
				...(pullRequest.linkedAt && {
					linkedAt: new Date(Math.min(pullRequest.linkedAt, Date.now())),
				}),
			},
		];
	});
	if (rows.length === 0) return { ignored: [...ignored] };

	const inserted = await db
		.insert(cloudWorkspacePullRequests)
		.values(rows)
		.onConflictDoNothing()
		.returning({ prNumber: cloudWorkspacePullRequests.prNumber });
	if (inserted.length > 0) nudge(workspace.organizationId, "cloud_workspaces");
	return { ignored: [...ignored] };
}
