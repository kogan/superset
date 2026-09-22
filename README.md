# superset++

A standalone Mac app for coding agents, Git worktrees, Jira, and GitHub pull requests. Each teammate installs the app on their own Mac and connects their own accounts.

## Download and install

**For Apple Silicon Macs.** The installer includes the app, its database, and local services. You do not need the original Superset app, Docker, Bun, or a checkout of this repository to run it.

1. Open [superset++ releases](https://github.com/kogan/superset/releases).
2. Expand **Assets** on the latest superset++ release and download the file ending in **`-arm64.dmg`**.
3. Open the DMG and drag **superset++.app** into **Applications**.
4. Open **superset++** from Applications.

**If there is no `.dmg` under Assets, an installer has not been published yet.** Ask the maintainer for the DMG. **Code > Download ZIP** and **Source code** downloads contain the source, not an installable app.

Current builds are ad-hoc signed and are not Apple-notarized. If macOS blocks the app because the developer cannot be verified, follow [Apple's instructions for opening an app from an unknown developer](https://support.apple.com/guide/mac-help/mh40616/mac). After attempting to open it, the exception is under **System Settings > Privacy & Security > Open Anyway**.

Intel Mac, Windows, and Linux installers are not provided by this fork.

## Set up your workspace

1. Choose **Add project > Open project** and select a local repository. Clone your team's repository first if you do not have a local copy.
2. Create a workspace, then open a terminal, coding agent, or the Files tab.
3. To use Jira, open **Settings > Integrations > Jira** and enter your own connection details. Choose your team's board in the Jira view.
4. For GitHub pull requests, install the GitHub CLI and sign in with `gh auth login`. Select your organization or repository in **PR source**.
5. Use **My team > Edit team** to choose whose pull requests you want to follow.

Install and sign in to the coding agents you want to use. Git and your project's development tools are separate from the app. Each person needs their own repository, Jira, and agent access; installing superset++ does not grant access to them.

Existing Superset worktrees are discovered on startup and opened in their original folders. New worktrees default to `~/.superset/worktrees`. Your app settings and local data live in `~/.superestset`.

You do not need to fork this repository to use the app. Everyone can install the same DMG. Settings, team selections, terminals, and local Pages stay on each person's Mac.

## Update the app

After installing a current release once, superset++ checks for updates at launch and downloads them in the background. When an update is ready, restart the app to install it. You can use **Check for updates** to check immediately. Your data, workspaces, and settings stay in place.

Finish active terminal and agent sessions before replacing an older build, then quit the app. Keep one installed copy at a stable path. Do not delete `~/.superestset` or your worktree folders when updating. Older SuperestSet builds use the same data folder.

## What you can do

- **Jira:** use the board's actual column names and status mappings, including empty columns. Choose which columns appear and their order, move tickets, view reviewers, and open linked PRs or Freshdesk tickets.
- **Ticket workspaces:** choose **Workspaces > New workspace** on a ticket, or link an existing workspace.
- **Pull requests:** filter by your team, review diffs, and comment directly on GitHub. **Send to agent** is a separate option.
- **Coding agents:** see agents and subagents beneath their workspaces, collapse their rows, and rename subagents.
- **Files:** search filenames and file contents, open matching lines, edit files, and review diffs.
- **Attention:** find agents waiting for input, failed checks on your PRs, and requested reviews.
- **Local Pages:** publish and read HTML pages stored on your Mac.

Choose which features appear under **Settings > General > Features**. See [the usage guide](PERSONAL_BUILD.md) for details, shortcuts, worktree behavior, and backups.

## Build or publish an installer

Maintainers: see [DEVELOPMENT.md](DEVELOPMENT.md) to build and verify the DMG, then [attach it to a GitHub Release](DEVELOPMENT.md#publish-a-download-for-the-team). Teammates only need the installer.

## Upstream and license

superset++ is a separately maintained fork of [Superset](https://github.com/superset-sh/superset). The original Superset installation is not a runtime dependency. The upstream [Elastic License 2.0](LICENSE.md) and copyright notices are retained.
