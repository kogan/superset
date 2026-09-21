import { z } from "zod";
import { protectedProcedure } from "../../../index";
import { resolveGithubRepo } from "../../workspace-creation/shared/project-helpers";
import { execGh } from "../../workspace-creation/utils/exec-gh";
import { loadGithubBlob } from "../utils/load-github-blob";

export const getFileContents = protectedProcedure
	.input(
		z.object({
			projectId: z.string(),
			objectId: z.string().regex(/^[0-9a-f]{7,40}$/i),
		}),
	)
	.query(async ({ ctx, input }) => {
		const repo = await resolveGithubRepo(ctx, input.projectId);
		return loadGithubBlob({
			owner: repo.owner,
			repo: repo.name,
			objectId: input.objectId,
			runGh: execGh,
		});
	});
