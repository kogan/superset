import { z } from "zod";
import type { ExecGh } from "../../workspace-creation/utils/exec-gh";

const blobResponseSchema = z.object({
	data: z.object({
		repository: z.object({
			object: z.object({
				__typename: z.literal("Blob"),
				oid: z.string().regex(/^[0-9a-f]{40}$/),
				byteSize: z.number().nonnegative(),
				isBinary: z.boolean(),
			}),
		}),
	}),
});

export async function loadGithubBlob({
	owner,
	repo,
	objectId,
	runGh,
}: {
	owner: string;
	repo: string;
	objectId: string;
	runGh: ExecGh;
}): Promise<string> {
	if (/^0+$/.test(objectId)) return "";
	const response = await runGh(
		[
			"api",
			"graphql",
			"-f",
			"query=query($owner:String!,$repo:String!,$expression:String!){repository(owner:$owner,name:$repo){object(expression:$expression){__typename oid ... on Blob{byteSize isBinary}}}}",
			"-f",
			`owner=${owner}`,
			"-f",
			`repo=${repo}`,
			"-f",
			`expression=${objectId}`,
		],
		{ timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
	);
	const blob = blobResponseSchema.parse(response).data.repository.object;
	if (blob.byteSize > 2 * 1024 * 1024)
		throw new Error("File is too large to expand");
	if (blob.isBinary) {
		throw new Error("Full text is unavailable for this file");
	}
	const contents = z
		.object({ encoding: z.literal("base64"), content: z.string() })
		.parse(
			await runGh(["api", `repos/${owner}/${repo}/git/blobs/${blob.oid}`], {
				timeout: 30_000,
				maxBuffer: 4 * 1024 * 1024,
			}),
		);
	return Buffer.from(contents.content, "base64").toString("utf8");
}
