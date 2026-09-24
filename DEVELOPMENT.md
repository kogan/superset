# Developing superset++

To use the app, follow the [download and installation instructions](README.md#download-and-install). This guide builds that installer from this repository without an original Superset installation or Docker services.

## Requirements

- Apple Silicon Mac and Xcode Command Line Tools (`xcode-select --install`).
- Git and Bun 1.3.14, pinned in `.bun-version`.
- GitHub access to clone this repository.

## Build the Mac app

```sh
git clone https://github.com/kogan/superset.git
cd superset
bun install --frozen-lockfile --ignore-scripts
node apps/desktop/node_modules/electron/install.js
bun run --cwd apps/desktop install:deps
bun run build:mac
```

The app and disk image are written below `apps/desktop/release`. Use `bun run build:mac --dir` to build the app without making a disk image.

After a full build, `bun run build:mac --dir --skip-api --main-only` rebuilds main-process changes using the existing API, renderer, and preload output. Use the full build when any of those components change.

The build uses checked-in placeholders, not your `.env`. The installed app generates its own authentication, encryption, and content-signing secrets. Never commit an installation's data or secrets.

The build packages the API's standalone output, PGlite and its migrations, the local content server, Electron, native terminal modules, and the bundled CLI. Relative dependency links in Next's standalone output must remain relative: flattening Bun's dependency links breaks Node resolution in the packaged app.

## Verify

```sh
bun run check:plugins
bun run check:i18n
bun run check:versions
bun run scripts/personal/verify-worktree-connections.ts
bun test packages/db/src/runtime.test.ts packages/auth/src/local-bootstrap.test.ts
bun test packages/trpc/src/lib/local-runtime/cache.test.ts packages/trpc/src/lib/local-objects/local-objects.test.ts apps/usercontent/scripts/standalone.test.ts
bun run scripts/personal/verify-packaged-api.ts
```

The packaged API check uses the app's Electron executable with a system-only PATH and a temporary data folder. It checks local authentication, protected requests, Pages upload/publish/read, and persistence across restart. It never calls a real Jira site.

The worktree connection check uses real Git repositories, SQLite, and Electron's native-module ABI. It verifies original paths, unchanged staged and unstaged files, dependencies and ignored files, preserved copy and terminal identities, repeat discovery, removal receipts, and symlink containment.

For UI verification, launch the built app with a separate absolute `SUPERESTSET_DATA_DIR` and `SUPERESTSET_TEST_NO_PROVISION=1` to leave global agent configuration alone. The latter is a verification switch, not the normal installation mode. Check the real renderer and native terminal workflows as well as unit tests.

## Runtime layout

The display name is `superset++`. Keep the existing bundle ID, URL scheme, CLI command, and data directory stable across renames. Electron starts under `FORK.storageName` until its macOS Keychain service is configured, then switches to `FORK.name` after `ready`. This preserves the [Keychain service name used by Electron 41](https://github.com/electron/electron/blob/v41.10.3/shell/browser/electron_browser_main_parts.cc#L476-L518).

`~/.superestset` belongs to this fork. `metadata` contains PGlite; `objects` holds private/public page assets; `host` holds organization-local workspace databases. `electron` contains the Chromium profile. The launcher owns the API/content origins and passes public origins through preload before renderer clients initialize. Session tokens stay out of the public runtime configuration.

Only the API process opens PGlite. It initializes the unmodified upstream SQL migrations before loading authentication and routes. Startup creates or resumes an ordinary local session; there is no shared development password. Quitting flushes the database and stops the app's local services.

Before starting the workspace host, the app connects existing Superset workspace folders in place. Source host databases are read-only. The local host's `external_workspace_paths` table records canonical paths independently of workspace and project lifetimes. It prevents deleted entries from reappearing and protects original folders during cleanup, project removal, and archived reconciliation. If an older migration made an internal workspace copy, the existing record is moved to the original path so terminal and agent links survive; the old folder remains untouched as a recovery copy. `superset-connections-report.json` records the latest discovery result. File > Refresh Superset Workspaces… restarts before rescanning. Default Git folders live under `~/.superset`, while runtime data remains under `~/.superestset`. An explicit custom `SUPERSET_HOME_DIR` keeps isolated development and test folders under that custom home.

## Publish a download for the team

Build an Apple Silicon release from the release branch with `bun run build:mac`, then run the verification commands above. It writes `superset-plus-plus-<version>-arm64.dmg`, a matching `.zip`, and `latest-mac.yml` under `apps/desktop/release`. The build verifies that the manifest names the generated files and that their sizes and hashes match. Rerun that check with `bun run scripts/personal/verify-mac-release.ts`. The DMG is for first installs; the ZIP and manifest let installed apps update themselves. A `--dir` build produces an app bundle, not release artifacts.

To publish the verified installer:

1. Open [the repository's Releases page](https://github.com/kogan/superset/releases) and choose **Draft a new release**.
2. Create a tag such as `superset-plus-plus-v1.30.0` at the exact commit used for the build. Use the app's version in the tag and release title.
3. Describe the changes and state that this installer is for Apple Silicon Macs. Identify whether the build is ad-hoc signed or Developer ID signed and notarized.
4. Attach the `.dmg`, matching `.zip`, and `latest-mac.yml` under **Attach binaries**. Attach its SHA-256 checksum file if one was generated. The updater cannot work from a DMG alone.
5. Publish the release and mark it as the latest release when it is ready for general use.
6. Download the attached DMG to confirm the file is available. Share the release page with the team.

GitHub's automatic **Source code** archives are not installers. Pushing commits or creating a release without all three Mac artifacts does not provide a usable update. Do not upload a configured app data folder, credentials, or worktrees.

For an immediate handoff before publishing, share the verified DMG itself. The recipient follows the same drag-to-Applications installation steps in the README.

## Release builds and signing

The fork's manual Mac workflow uses `macos-14`, an Apple Silicon label in [GitHub's runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). It uploads build artifacts for review. Publishing a GitHub release is a separate maintainer action.

Personal builds are ad-hoc signed. Apple notarization requires the maintainer's Apple signing identity and credentials; none are stored in this repository.

For releases that retain the same signing identity across updates, install your **Developer ID Application** certificate and its private key in your macOS keychain, then run:

```sh
security find-identity -v -p codesigning
bun run build:mac --signed
```

The signed build checks for a valid Developer ID Application identity before compiling, enables certificate discovery, and requires signing during packaging. It cannot silently fall back to an ad-hoc signature. If you have multiple identities, select the same one for every release with electron-builder's `CSC_NAME` setting. Signing and notarization are separate: this option does not configure notarization credentials. The first switch from an ad-hoc build can still require permission approval again.

Do not run old SuperestSet and new superset++ helpers together. They share `com.deexi333.superestset`, but different ad-hoc builds have different code requirements. macOS can alternate its Documents permission between those identities and prompt repeatedly. Quitting the window may leave terminal daemons alive. Finish or explicitly stop the old terminal sessions before retiring the old app; never kill a daemon without checking which sessions it owns. Keep the current app at one stable installation path. A separate test data directory does not give a test build a separate macOS permission identity.

To continue with an agent inside superset++, open a checkout of `kogan/superset`, then ask it to implement, test, commit, push, and rebuild your change. Cut each release on a dedicated release branch and keep desktop, host-service, and CLI versions equal. Build and run the verification commands above before uploading the DMG, ZIP, and `latest-mac.yml` to a release in **kogan/superset**. The first installation uses the DMG; later releases update the installed app. Use this fork's build workflow; the inherited release scripts describe upstream infrastructure.

Inherited deployment workflows are preserved under `.github/upstream-workflows` as reference. Fork checks and Mac packaging live under `.github/workflows`, alongside reusable CI workflows called by the upstream-sync automation.

## Historical source launcher

`scripts/personal/launch.py` and the old command files document the previous Bun/Docker development setup. They are not the installed app's launcher. Do not use their teardown command to stop the new app or to remove old data during migration.

## Updating upstream code

Create an integration branch before merging an upstream release. Preserve this fork's startup, identity, local storage/authentication, Jira, PR, and Files behavior. Build and verify the actual app before publishing a replacement installer. Back up the fork's data before testing schema changes.
