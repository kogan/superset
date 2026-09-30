import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gt, valid } from "semver";
import { z } from "zod";
import desktop from "../../apps/desktop/package.json";
import { FORK } from "../../packages/shared/src/standalone";
import { MAC_RELEASE_CERTIFICATE } from "./mac-signing";

const manifestSchema = z.object({
	version: z.string().refine((value) => valid(value) === value),
	files: z
		.array(
			z.object({
				url: z.string(),
				sha512: z.string(),
				size: z.number().int().positive(),
			}),
		)
		.length(2),
	path: z.string(),
	sha512: z.string(),
});

export async function verifyMacArtifacts({
	releaseDirectory,
	version,
	previousVersion,
}: {
	releaseDirectory: string;
	version: string;
	previousVersion?: string;
}) {
	const manifest = manifestSchema.parse(
		Bun.YAML.parse(
			await readFile(join(releaseDirectory, "latest-mac.yml"), "utf8"),
		),
	);
	assert.equal(
		manifest.version,
		version,
		"Manifest version must match the app",
	);
	if (previousVersion !== undefined)
		assert(
			gt(version, previousVersion),
			`Release ${version} must be newer than published app ${previousVersion}; use the manifest version, not the release title.`,
		);
	const prefix = `superset-plus-plus-${version}-arm64`;
	assert.deepEqual(
		manifest.files.map((file) => file.url).sort(),
		[`${prefix}.dmg`, `${prefix}.zip`],
		"Artifact names must match the app version and architecture",
	);
	const update = manifest.files.find((file) => file.url === manifest.path);
	assert(update, "The primary update must be listed in the manifest");
	assert(
		update.url.endsWith(".zip"),
		"The primary update must be a listed ZIP",
	);
	assert.equal(
		manifest.sha512,
		update.sha512,
		"Primary update hashes must match",
	);
	for (const file of manifest.files) {
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
	}
	return manifest;
}

async function command(args: string[]): Promise<string> {
	const result = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, code] = await Promise.all([
		new Response(result.stdout).text(),
		new Response(result.stderr).text(),
		result.exited,
	]);
	assert.equal(code, 0, `${args[0]} failed: ${stderr}`);
	return stdout.trim();
}

export async function verifyMacApp(app: string, version: string) {
	assert.equal(
		process.platform,
		"darwin",
		"Signature verification requires macOS",
	);
	const plist = join(app, "Contents/Info.plist");
	for (const [key, expected] of Object.entries({
		CFBundleIdentifier: FORK.bundleId,
		CFBundleShortVersionString: version,
		CFBundleVersion: version,
	})) {
		assert.equal(
			await command(["/usr/libexec/PlistBuddy", "-c", `Print :${key}`, plist]),
			expected,
			key,
		);
	}
	await command([
		"codesign",
		"--verify",
		"--deep",
		"--strict",
		"--all-architectures",
		"-R",
		`=identifier "${FORK.bundleId}" and certificate leaf = H"${MAC_RELEASE_CERTIFICATE}"`,
		app,
	]);
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const development = args.includes("--ad-hoc");
	const publishing = args.includes("--for-publish");
	assert(
		!(development && publishing),
		"Ad-hoc builds cannot be published to the update feed",
	);
	const releaseDirectory = resolve(
		args.find((arg) => !arg.startsWith("--")) ?? "apps/desktop/release",
	);
	const temporary = await mkdtemp(join(tmpdir(), "superset-release-check-"));
	try {
		let previousVersion: string | undefined;
		if (publishing) {
			const repository = new URL(FORK.repository).pathname.slice(1);
			await command([
				"gh",
				"release",
				"download",
				"--repo",
				repository,
				"--pattern",
				"latest-mac.yml",
				"--dir",
				temporary,
			]);
			previousVersion = z
				.object({ version: manifestSchema.shape.version })
				.parse(
					Bun.YAML.parse(
						await readFile(join(temporary, "latest-mac.yml"), "utf8"),
					),
				).version;
		}
		const manifest = await verifyMacArtifacts({
			releaseDirectory,
			version: desktop.version,
			previousVersion,
		});
		if (!development) {
			await verifyMacApp(
				join(releaseDirectory, "mac-arm64", `${desktop.productName}.app`),
				manifest.version,
			);
			const extracted = join(temporary, "update");
			await command([
				"ditto",
				"-x",
				"-k",
				join(releaseDirectory, manifest.path),
				extracted,
			]);
			await verifyMacApp(
				join(extracted, `${desktop.productName}.app`),
				manifest.version,
			);
			const dmg = join(
				releaseDirectory,
				`superset-plus-plus-${manifest.version}-arm64.dmg`,
			);
			await command(["hdiutil", "verify", dmg]);
			const mount = join(temporary, "dmg");
			await mkdir(mount);
			await command([
				"hdiutil",
				"attach",
				"-readonly",
				"-nobrowse",
				"-mountpoint",
				mount,
				dmg,
			]);
			try {
				await verifyMacApp(
					join(mount, `${desktop.productName}.app`),
					manifest.version,
				);
			} finally {
				await command(["hdiutil", "detach", mount]);
			}
		}
		console.log(
			development
				? "Verified development artifact hashes only. These files must not be published as updates."
				: `Verified ${manifest.version}: artifact names, hashes, app/DMG/updater ZIP versions, bundle ID, and release signing certificate.`,
		);
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}
