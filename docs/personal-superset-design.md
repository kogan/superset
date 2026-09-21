# superestset

This is a locally modified copy of Superset at upstream revision `02c4d5c087db8e3ead76e97e836482affc2381b3`. The changes add a personal Jira connection and expose worktree file and diff controls. Upstream licensing and copyright notices remain in place.

## User flow

Open Jira in the sidebar. The local connection supports Jira Cloud email/API tokens, scoped Cloud tokens, and Server/Data Center bearer PATs. The Team view uses a selected board’s saved filter, without an assignee restriction. Saved column preferences restrict Jira search before pagination. Users choose the Jira URL, board and GitHub PR source in Settings > Integrations. There are no company defaults. Epics are excluded; column visibility and order are user-configurable. Member and status filters run in Jira before pagination. The personal view includes the current user as either assignee or reviewer.

Kanban uses a paginated issue query. Kanban uses the configured columns and preserves empty columns when a member filter has no matching cards. Without a column configuration it groups Jira status names by workflow category. PR links are siblings of the ticket link, so opening a PR never also opens the Jira issue. Links come from Jira descriptions and remote issue links, with a GitHub repository/organization search fallback for complete Jira keys in PR titles and bodies. PR failures leave tickets and available links visible.

Open a worktree and click Files to browse and edit its files. In Changes, use the inline diff gap controls for nearby context or Show all lines for the whole file.

## Local Jira boundary

Electron tRPC owns credentials, requests, response validation, and local preferences. Cloud authentication uses Basic email/token and `/rest/api/3/search/jql` with opaque continuation tokens. Scoped Cloud credentials discover the site ID without authorization, then use the fixed Atlassian gateway origin. Server/Data Center retains `/rest/api/2/search` and numeric offsets. Both stop on empty pages and reject inconsistent pagination.

One encrypted file stores credentials. Connection metadata never returns the token. Reconnecting or disconnecting cancels and clears Jira data queries. Redirects are rejected, certificate checks stay enabled, and HTTPS is required except for loopback fixture servers. A separate fixed-size preferences file stores the Jira URL, selected board, and GitHub search scope; it contains no credentials.

The board API supplies its saved filter ID. JQL quotes member identifiers and makes assignee/state restrictions explicit. Assignees from loaded tickets populate the member picker; name searches use Jira’s user search API and report permission errors separately. PR lookup has bounded Jira request concurrency and reports incomplete GitHub results. It invokes the existing GitHub CLI without a shell and never sends Jira credentials to GitHub. Only HTTPS `github.com` pull-request URLs become PR links.

Moving a card calls Jira’s workflow transition API. Inline PR comments are posted to GitHub only when submitted. Connection, board, repository and team preferences are saved on the device.

## Design decision

Two designs were compared: a third source in the existing Tasks page and a dedicated local Jira page. The independent review scored them 9/10 and 10/10. The dedicated page is the base because it keeps company Jira independent of cloud task filters, persisted task-source state, and selection behavior.

The combined design takes the workspace-owned diff-context control from the Tasks candidate. It uses the existing toolbar child slot, leaving pull-request views unchanged. Both candidates agreed on the local Jira boundary and on reusing the existing file tree, editor, and diff hydration.

The changes need no cloud database migration, hosted Jira integration, or replacement editor. The local Superset runtime still uses its own local services and development sign-in.

## Verification

Exercise the Jira client against an actual local HTTP fixture server, including authentication, context paths, pagination, invalid responses, and redirects. Check encrypted storage independently. In the running desktop app, connect the fixture, browse and refresh issues, disconnect, open a worktree's Files view, save an edit, and expand actual unchanged lines in an inline diff.

Use synthetic accounts, board names, tickets and repository identifiers in committed tests and documentation. Keep verification involving private services outside tracked source.
