import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure } from "../../../index";
import { actionRejectionError } from "../../github/github";
import { resolveGithubRepo } from "../../workspace-creation/shared/project-helpers";

const createCommentInputSchema = z
	.object({
		projectId: z.string(),
		prNumber: z.number().int().positive(),
		body: z.string().trim().min(1).max(65_536),
		commitId: z.string().regex(/^[a-f0-9]{40}$/i),
		path: z.string().min(1),
		startLine: z.number().int().positive(),
		endLine: z.number().int().positive(),
		startSide: z.enum(["LEFT", "RIGHT"]),
		endSide: z.enum(["LEFT", "RIGHT"]),
	})
	.refine(
		(input) =>
			input.startSide !== input.endSide || input.startLine <= input.endLine,
		{
			message: "The comment range must be in diff order.",
		},
	);

export const createComment = protectedProcedure
	.input(createCommentInputSchema)
	.mutation(async ({ ctx, input }) => {
		const repo = await resolveGithubRepo(ctx, input.projectId);
		const octokit = await ctx.github();
		try {
			const { data: pr } = await octokit.pulls.get({
				owner: repo.owner,
				repo: repo.name,
				pull_number: input.prNumber,
			});
			if (pr.head.sha !== input.commitId) {
				throw new TRPCError({
					code: "CONFLICT",
					message:
						"The pull request changed. Refresh the diff before posting your comment.",
				});
			}
			const multiline =
				input.startLine !== input.endLine || input.startSide !== input.endSide;
			const { data } = await octokit.pulls.createReviewComment({
				owner: repo.owner,
				repo: repo.name,
				pull_number: input.prNumber,
				body: input.body,
				commit_id: input.commitId,
				path: input.path,
				line: input.endLine,
				side: input.endSide,
				...(multiline
					? { start_line: input.startLine, start_side: input.startSide }
					: {}),
			});
			return { id: data.id, url: data.html_url };
		} catch (error) {
			if (error instanceof TRPCError) throw error;
			throw actionRejectionError(error, "GitHub refused the comment.");
		}
	});
