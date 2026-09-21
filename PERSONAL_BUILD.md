# Using superset++

Follow the [download and installation instructions](README.md#download-and-install) for the standalone app. The app includes its local services; it does not need the original Superset app, Docker, or Bun. See [README.md](README.md) for installation and [DEVELOPMENT.md](DEVELOPMENT.md) for building.

## Jira and team PRs

Open **Settings > Integrations** to enter your Jira server URL and credentials. Once connected, use **Choose team board** and **PR source** to select your board and GitHub organization or repository. These settings stay on your device; new installations have no company defaults.

1. Open **Settings > Integrations** and the Jira card.
2. Choose **API token**, enter the email address of the Atlassian account that created it, and enter the token in the app. Choose **API token with scopes** if that is how you created the token at id.atlassian.com.
3. Open **Jira** in the sidebar. **Team** shows issues from your selected board. The board selector remembers your choice and can also be changed in Settings. Team columns use Jira's board names and status mappings, including empty columns.
4. Use **All assignees** to choose a member, yourself, or unassigned issues. Search finds people beyond the currently loaded tickets. **All statuses**, **Unfinished**, and **In progress** narrow the status.
5. Use **Columns** to show or hide columns and move them left or right. **Save** remembers the layout on this Mac; **Cancel** discards edits and **Restore defaults** resets visibility and order. Reselecting the same board preserves its layout; choosing a different board starts with its default layout. **Load more** retrieves the next page using the same filters; the footer shows how many tickets have loaded.

Epics are excluded from every status in both Team and My work, on the board.

**My work** includes tickets assigned to you and tickets where you are the Code Reviewer. It groups the loaded issues by status. Every card shows its assignee and reviewers, with **Unassigned** for an empty reviewer field. In Kanban, a **Needs QA** card with an empty reviewer field has an amber background, a thick amber border, and a **Reviewer needed** badge. An unavailable reviewer field is not treated as empty.

Cards show matching workspaces when the Jira key appears in the workspace name or branch. Use **Workspaces > New workspace** to start workspace creation with the ticket key and context, or link or unlink an existing workspace manually. Successful creation links the new workspace; cancellation leaves the ticket unlinked. Click a linked workspace name to open it. These associations are saved locally in SQLite.

PR links appear at the bottom of Kanban cards. The app reads GitHub links in Jira descriptions and remote links. For tickets without remote PR links, it also searches your configured GitHub organization or repository for the complete Jira key in PR titles and descriptions using your existing GitHub CLI login. Click the repository name to change the GitHub search scope. Jira’s separate Development panel is not a public issue-link API; GitHub lookup supplies matching PRs when those links are not returned as Jira remote links. Branch-only references without a ticket link or a Jira key in the PR title or description are not matched.

Jira requests run on this Mac. Credentials are encrypted through Electron safeStorage and macOS Keychain. Tickets and PR results stay in memory. Board and repository preferences live in `~/.superestset/jira-preferences.json`. Reading tickets and PRs does not change them. Dragging a card or selecting **Move to** performs the selected Jira workflow transition.

The connector also supports Server/Data Center personal access tokens. Standard Cloud tokens use email-based Basic authentication; scoped tokens use Atlassian’s gateway after discovering the site’s Cloud ID.

## Your GitHub pull requests

Open your repository as a project in the app. Existing worktrees are opened in place. In **Pull requests**, use **Filters** to choose repositories, authors and PR state. The GitHub section uses connected projects; the Jira card links use the separate Jira/GitHub lookup described above.

Open **Settings > Integrations > My team > Edit team**, or click **Edit team** beside **My team** in Pull requests, to choose whose PRs you want to follow. Select a repository for contributor suggestions, search by username, or enter a GitHub username directly. Add or remove members and click **Save**; **Cancel** discards your edits. You can save up to 20 people. This list stays on your Mac and does not invite anyone or change GitHub access.

Click **My team** to filter PRs to your saved members. **Filters > Author > My team** selects the same group. Saving changes while that filter is active refreshes it to the new members. Removing every member clears the active team filter. New installations and older profiles without a saved team start with no members. The first click on **My team** opens the editor. Upgrades preserve members already saved in your local profile; no names are supplied by the application.

The Tasks and Workspaces navigation items are removed from the expanded and collapsed sidebar.

## Agents in the sidebar

Each tracked agent appears as an indented row below its workspace with its current status. Click a row to focus that agent’s terminal. Named sessions use their names, and identical names get numbers so separate agents remain distinguishable. Live subagents reported by the agent’s hooks appear one level deeper; clicking one opens its transcript. The list updates as agents start and end. When several agents use the same provider, its group can be collapsed; each parent agent also has a separate control to collapse its subagents.

Subagents use task descriptions or readable task names from their session metadata. If neither is available, the app uses a useful role or a distinct task label. Click the pencil beside a subagent to rename it. Custom names appear in the sidebar, subagent menu, and transcript view and survive host restarts when the child is reported again. **Use automatic name** clears your override. A new parent session starts with fresh names.

The stop control interrupts the parent agent in its terminal. A stop control beside a subagent is labelled **Stop agent and subagents** because it interrupts the parent and its children together.

## Choose your features

Open **Settings > General > Features** to switch Jira, Pull requests, Pages, Workspace agents, and Search file contents on or off. Changes apply immediately and stay saved after restarting. Turning a feature off hides its controls; it does not delete your data or stop running agents. Filename search remains available when file-content search is off.

## Browse files and review changes

Select a worktree and choose **+ > Files**, click **Files** in the tab bar or beside the agent buttons, or **Browse files** in an empty workspace. This opens a dedicated Files tab with the folder tree on the left and an editor on the right. Click **Files** again to return to that tab. Open a file from the tree to edit it and use **Command-S** to save. The tree shows the selected worktree's files; select the main repository workspace to edit that checkout.

Press **Command-P** or click **Search files** above the folder tree. Choose **Filenames** to find a file by name or path, or **File contents** to search text across the current workspace. Content results show a matching snippet and line number; selecting one opens that position in the editor, including when the file is already open. Use **Show filters** to include or exclude paths with patterns such as `src/**` or `**/*.test.ts`. Search shows up to 100 results and tells you when to narrow the query. **Command-F** searches within the currently focused text editor.

In the inline diff, use the gap controls to reveal nearby unchanged lines. **Show all lines** reveals the rest of the file. **Hide unchanged regions** returns to the previous context view, including any gaps you expanded manually.

The GitHub PR **Code** view reveals unchanged code in increments of 20 lines above or below a change. It loads the exact Git objects referenced by the patch; binary files and text files larger than 2 MiB cannot expand.

## Move Jira cards

Drag a card using its handle and drop it into another status column. When a column contains several possible workflow destinations, choose the transition in the dialog. Use **Move to** for a click or keyboard alternative. Dropping into the current column or canceling does not change Jira. If Jira requires additional fields, open the issue in Jira to complete the move. The board refreshes after Jira confirms success.

## Pages

Open **Pages** in the sidebar to read local HTML pages and their versions. Metadata and content are stored below `~/.superestset`; signed tickets and the page content security policy remain in use. These pages are local to this Mac unless you deploy your own public services.

## Data, migration, and updates

The independent installation uses `~/.superestset` and its own Electron profile. The old source launcher’s `.personal-data`, `superset-dev-data`, and Docker volumes remain separate. Existing Superset worktrees are opened in place and retained when their superset++ entries are removed. New worktrees default to `~/.superset/worktrees`. Earlier copied workspaces remain in Previous copies groups. Credentials and live process ownership stay separate.

Use **Check for updates** or visit [superset++ releases](https://github.com/kogan/superset/releases) to download a newer fork build. Quit the app before replacing it or backing up its data. The original Superset updater is not used.

The upstream [license](LICENSE.md) applies. The original implementation notes remain in [the personal design document](docs/personal-superset-design.md).

## Attention inbox

Open **Attention** in the sidebar to see current agent input requests, failed checks on your authored PRs, and PRs directly requesting your GitHub review. Use **All**, **Agents**, **Failed checks**, or **Review requests** to filter the list. Clicking an agent opens its exact terminal; clicking a PR opens its preview.

Agent requests update through lifecycle events. GitHub results refresh every minute while the page is open and when you press **Refresh**. **Load more** fetches additional results. Partial results and unavailable sources are shown explicitly. Sleeping sandbox hosts are not woken for this inbox. Only connected projects are searched.

Turn the inbox off in **Settings > General > Features > Attention inbox**. Turning off **Pull requests** leaves only agent input in the inbox. The **Workspace agents** switch controls sidebar rows independently.
