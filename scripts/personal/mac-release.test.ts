import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import builder from "../../apps/desktop/electron-builder";
import {
	RELEASES_URL,
	updateFeedUrl,
} from "../../apps/desktop/src/shared/auto-update";
import { FORK } from "../../packages/shared/src/standalone";
import { MAC_RELEASE_CERTIFICATE, macSigning } from "./mac-signing";
import { verifyMacArtifacts } from "./verify-mac-release";

const temporary: string[] = [];
afterEach(async () => {
	await Promise.all(
		temporary
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

async function fixture() {
	const releaseDirectory = await mkdtemp(join(tmpdir(), "mac-release-test-"));
	temporary.push(releaseDirectory);
	const version = "1.32.1";
	const files = await Promise.all(
		["dmg", "zip"].map(async (extension) => {
			const url = `superset-plus-plus-${version}-arm64.${extension}`;
			const contents = Buffer.from(`fixture ${extension}`);
			await writeFile(join(releaseDirectory, url), contents);
			return {
				url,
				size: contents.length,
				sha512: createHash("sha512").update(contents).digest("base64"),
			};
		}),
	);
	const zip = files.find((file) => file.url.endsWith(".zip"));
	if (!zip) throw new Error("Missing fixture ZIP");
	const manifest = { version, files, path: zip.url, sha512: zip.sha512 };
	const save = () =>
		writeFile(
			join(releaseDirectory, "latest-mac.yml"),
			Bun.YAML.stringify(manifest),
		);
	await save();
	return { releaseDirectory, version, manifest, save };
}

test("release builds default to the established certificate and reject identity changes", () => {
	expect(macSigning([])).toEqual({
		mode: "self-signed",
		identity: MAC_RELEASE_CERTIFICATE,
	});
	expect(
		macSigning(["--self-signed"], MAC_RELEASE_CERTIFICATE.toLowerCase())
			.identity,
	).toBe(MAC_RELEASE_CERTIFICATE);
	expect(() => macSigning([], "Another certificate")).toThrow(
		"manual reinstall",
	);
	expect(() => macSigning(["--self-signed", "--ad-hoc"])).toThrow(
		"one signing mode",
	);
	expect(macSigning(["--ad-hoc"])).toEqual({ mode: "ad-hoc" });
});

test("packaging and runtime keep the fork identity and release feeds after upstream merges", () => {
	expect(FORK.bundleId).toBe("com.deexi333.superestset");
	expect(builder.appId).toBe(FORK.bundleId);
	expect(builder.publish).toEqual({
		provider: "github",
		owner: "kogan",
		repo: "superset",
	});
	expect(builder.mac?.artifactName).toBe(
		`superset-plus-plus-\${version}-\${arch}.\${ext}`,
	);
	expect(RELEASES_URL).toBe("https://github.com/kogan/superset/releases");
	expect(updateFeedUrl(false)).toBe(`${RELEASES_URL}/latest/download`);
	expect(updateFeedUrl(true)).toBe(`${RELEASES_URL}/download/desktop-canary`);
});

test("accepts complete artifacts for a newer version", async () => {
	const f = await fixture();
	await expect(
		verifyMacArtifacts({ ...f, previousVersion: "1.32.0" }),
	).resolves.toEqual(f.manifest);
});

test("rejects the already published internal version even if a release title was renamed", async () => {
	const f = await fixture();
	await expect(
		verifyMacArtifacts({ ...f, previousVersion: f.version }),
	).rejects.toThrow("must be newer");
	await expect(
		verifyMacArtifacts({ ...f, previousVersion: "1.33.0" }),
	).rejects.toThrow("must be newer");
});

test("rejects mismatched app versions and renamed assets", async () => {
	const f = await fixture();
	await expect(verifyMacArtifacts({ ...f, version: "1.2.0" })).rejects.toThrow(
		"Manifest version",
	);
	f.manifest.files[0].url = "superset-plus-plus-1.2.0-arm64.dmg";
	await f.save();
	await expect(verifyMacArtifacts(f)).rejects.toThrow("Artifact names");
});

test("rejects missing ZIP and inconsistent update hashes", async () => {
	const f = await fixture();
	f.manifest.sha512 = "wrong";
	await f.save();
	await expect(verifyMacArtifacts(f)).rejects.toThrow("Primary update hashes");
	f.manifest.files.pop();
	await f.save();
	await expect(verifyMacArtifacts(f)).rejects.toThrow();
});

test("rejects corrupted artifacts even when their size is unchanged", async () => {
	const f = await fixture();
	await writeFile(join(f.releaseDirectory, f.manifest.path), "fixture BAD");
	await expect(verifyMacArtifacts(f)).rejects.toThrow("Hash mismatch");
});
