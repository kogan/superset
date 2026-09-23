import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { z } from "zod";
import desktop from "../../apps/desktop/package.json";

const releaseDirectory = resolve(process.argv[2] ?? "apps/desktop/release");
const manifest = z
	.object({
		version: z.string(),
		files: z.array(
			z.object({
				url: z.string(),
				sha512: z.string(),
				size: z.number().int().positive(),
			}),
		),
		path: z.string(),
		sha512: z.string(),
	})
	.parse(
		Bun.YAML.parse(
			await readFile(join(releaseDirectory, "latest-mac.yml"), "utf8"),
		),
	);

assert.equal(
	manifest.version,
	desktop.version,
	"Manifest version must match the app",
);
for (const extension of [".dmg", ".zip"]) {
	assert(
		manifest.files.some((file) => file.url.endsWith(extension)),
		`Manifest must include a ${extension} artifact`,
	);
}
const update = manifest.files.find((file) => file.url === manifest.path);
assert(update?.url.endsWith(".zip"), "The primary update must be a listed ZIP");
assert.equal(
	manifest.sha512,
	update.sha512,
	"Primary update hashes must match",
);

for (const file of manifest.files) {
	assert.equal(
		basename(file.url),
		file.url,
		`Invalid artifact filename: ${file.url}`,
	);
	const artifact = join(releaseDirectory, file.url);
	assert.equal(
		(await stat(artifact)).size,
		file.size,
		`Size mismatch: ${file.url}`,
	);
	const hash = createHash("sha512");
	for await (const chunk of createReadStream(artifact)) hash.update(chunk);
	assert.equal(
		hash.digest("base64"),
		file.sha512,
		`Hash mismatch: ${file.url}`,
	);
	console.log(`Verified release artifact: ${file.url}`);
}
