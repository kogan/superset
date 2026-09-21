# superset++

superset++ is a standalone Mac development workspace built from Superset. It brings Jira tickets, GitHub pull requests, Git worktrees, terminals, files, diffs, and local Pages into one app. Configure your Jira connection, board, PR source and teammates in **Settings > Integrations**.

The Mac app includes its own runtime, database, and page storage. You do **not** need the original Superset app, Docker, or Bun to run it. Git, your coding agents, and their account connections are still needed for the development work you choose to do.

The **Attention** inbox collects agents waiting for input, failed checks on your own PRs, and PRs requesting your review across connected projects. Open a row to jump to its terminal or PR; resolved items clear when their source refreshes.

Agents appear beneath their workspaces in collapsible sidebar groups with status and direct session navigation. Use the chevron beside a workspace to hide or show all of its agents, including different agent types, without stopping them. Subagents use task names when available; click the pencil beside one to give it a custom name. In the Pull requests Code tab, select a diff line or range to post a comment directly to GitHub. Choose **Send to agent** only when you want AI help. The Files search supports filenames and file contents, path filters, and opening matching lines. Choose which features to show in **Settings > General > Features**. See [the usage guide](PERSONAL_BUILD.md) and [saved feature ideas](docs/feature-backlog.md).

## Download and install

1. Open [superset++ releases](https://github.com/kogan/superset/releases).
2. Download the **Apple Silicon / arm64 `.dmg`** from the release.
3. Open the disk image and drag **superset++.app** into **Applications**.
4. Open **superset++**. It creates a personal local account and opens your existing Superset workspaces in place.

If no superset++ installer has been published in this fork yet, build it with [DEVELOPMENT.md](DEVELOPMENT.md). Forking the source does not copy installers from another repository.

If you are upgrading from SuperestSet, quit it before opening **superset++**. Both app names use the same data folder.

Finish or stop the old app's terminal sessions before upgrading, since its terminal helpers can survive quitting the window. Running helpers from both versions can cause repeated Documents access prompts. Keep one installed copy of the fork; retain your worktrees and `~/.superestset` data when retiring an old app.

These personal builds use an ad-hoc signature and are not Apple-notarized. If macOS blocks the downloaded app, use **System Settings > Privacy & Security > Open Anyway** after attempting to open it.

Downloads and updates come from this repository. **Check for updates** opens its Releases page; the app does not install upstream Superset updates. Intel Mac, Windows, and Linux installers are not provided by this fork's Mac release workflow.

## What this fork adds

- **Jira workboard:** Team and My work views, remembered boards and filters, a Kanban board with saved column visibility and order, assignees, code reviewers, linked PRs, and clickable Freshdesk links found in ticket descriptions or Jira remote links. Choose your board and configure column visibility and order for your workflow.
- **Move Jira issues:** drag a card's handle into another column, or use **Move to**. Available Jira workflow transitions determine the choices. Moves requiring extra fields open in Jira.
- **Start from a ticket:** choose **Workspaces > New workspace** to open workspace creation with the ticket context. Choose the project and review the branch and name. A successful creation links the workspace back to the ticket. You can also link existing workspaces.
- **Team pull requests:** choose **Edit team** beside **My team** to select repository contributors or enter GitHub usernames. Each person keeps their own saved team list.
- **Files and review:** a dedicated Files tab, quick file search, editing and saving, and controls to expand unchanged diff context.
- **Local Pages:** publish and read HTML pages, retain versions and assets, and use the existing signed access checks.
- **Separate installation:** its own app identity, deep links, data directory, local services, and fork release channel.

## First use

On startup, superset++ finds existing Superset workspaces and opens their original folders. It reads the existing workspace list from `~/.superset`, `~/.superset-dev`, and the custom fork's detected `superset-dev-data` folders. There is no copy or import step. Your branches, edits, ignored files, dependencies, and build output stay exactly where they are.

New worktrees use `~/.superset/worktrees`; new projectless sessions use `~/.superset/sessions`. An explicit project or host worktree location still takes priority. The original Superset app does not need to be installed or running once the folders are connected.

If an earlier release made copies, those remain available in **Previous copies** groups. Their paths and terminal associations are preserved. Use the original project entries for shared work going forward.

Removing a connected original workspace from superset++ closes its entry and its superset++ terminals, while leaving its folder and branch on disk. Removed entries stay removed on restart. Workspaces created by superset++ retain normal cleanup behavior.

Discovery runs on startup. Use **File > Refresh Superset Workspaces…** to restart and find newly added original workspaces. Superset++ has its own terminal sessions, Pages, settings, and service connections. Editing a shared file in either app changes that same file.

Open a repository through **Add project > Open project**. Create a workspace, then open a terminal, an agent, or the Files tab.

Connect Jira under **Settings > Integrations > Jira**. The connector supports standard Atlassian API tokens, scoped Cloud tokens, and Server/Data Center personal access tokens. GitHub PR lookup uses your GitHub CLI connection. Model and coding-agent accounts remain your own connections.

Jira moves change the real ticket's status. Creating a workspace creates local development files; it does not change the ticket's status.

See [the personal feature guide](PERSONAL_BUILD.md) for board behavior, PR matching, shortcuts, and data locations.

## Data and backups

The renamed app uses the same `~/.superestset` data folder as SuperestSet, so your existing workspaces, settings, and saved connections carry over.

App data lives in `~/.superestset`, including the embedded database, local Pages objects, settings, and workspace records. Quit superset++ before copying this directory as a backup. Repositories outside this directory need their own backups.

Keep backups of the original repositories and `~/.superset` worktree folders as well as the superset++ data folder. Previous copies are retained for recovery; no files are automatically merged between copies and originals. Connect Jira separately in superset++ Settings.

The app's local services listen on loopback addresses. Public internet hosting, inbound cloud webhooks, and access from another device require separately deployed services; this Mac build does not use Superset's hosted infrastructure for them.

## Build from source

See [DEVELOPMENT.md](DEVELOPMENT.md). Development tools are required to build an installer, but are not required by someone installing the Mac app.

You can ask a coding agent here or inside superset++ to make further changes. Open **this repository's source checkout** as the agent's workspace. After changes are tested and pushed, build and install a new Mac app; a GitHub push alone does not update an installed copy.

## Upstream and license

This fork began from Superset revision `02c4d5c087db8e3ead76e97e836482affc2381b3`. Its Git history retains the upstream history and the fork's changes. The original Superset installation is not a runtime dependency.

The upstream [Elastic License 2.0](LICENSE.md) and copyright notices are retained. superset++ is a separately maintained personal fork.
