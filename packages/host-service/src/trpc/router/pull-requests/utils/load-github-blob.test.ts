import { describe, expect, test } from "bun:test";
import { loadGithubBlob } from "./load-github-blob";

const oid = "a".repeat(40);
describe("GitHub diff context", () => {
	test("resolves an abbreviated patch hash and preserves whitespace through the REST blob response", async () => {
		const contents = "\n  unchanged line\nlast line  \n\n";
		const calls: string[][] = [];
		const result = await loadGithubBlob({
			owner: "owner",
			repo: "repo",
			objectId: "aaaaaaa",
			runGh: async (args) => {
				calls.push(args);
				return args[1] === "graphql"
					? {
							data: {
								repository: {
									object: {
										__typename: "Blob",
										oid,
										byteSize: contents.length,
										isBinary: false,
									},
								},
							},
						}
					: {
							encoding: "base64",
							content: Buffer.from(contents).toString("base64"),
						};
			},
		});
		expect(result).toBe(contents);
		expect(calls[0]).toContain("expression=aaaaaaa");
		expect(calls[1]).toEqual(["api", `repos/owner/repo/git/blobs/${oid}`]);
	});
	test("represents the absent side of an added or deleted file without a request", async () => {
		expect(
			await loadGithubBlob({
				owner: "owner",
				repo: "repo",
				objectId: "0000000",
				runGh: async () => {
					throw new Error("Unexpected request");
				},
			}),
		).toBe("");
	});
	test("rejects oversized files before downloading their contents", async () => {
		let requests = 0;
		await expect(
			loadGithubBlob({
				owner: "owner",
				repo: "repo",
				objectId: "aaaaaaa",
				runGh: async () => {
					requests++;
					return {
						data: {
							repository: {
								object: {
									__typename: "Blob",
									oid,
									byteSize: 3 * 1024 * 1024,
									isBinary: false,
								},
							},
						},
					};
				},
			}),
		).rejects.toThrow("too large");
		expect(requests).toBe(1);
	});
});
