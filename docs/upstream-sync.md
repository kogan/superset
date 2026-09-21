# Daily upstream updates

Kogan changes land through feature PRs into `kogan/superset:main`. The **Upstream Sync**
workflow checks `superset-sh/superset:main` daily at 19:23 UTC (05:23 Melbourne standard
time, 06:23 during daylight saving), or on manual dispatch.

The workflow maintains `sync/upstream` and opens or updates one PR into `main`.
It never pushes to `main`, force-pushes, or merges the PR. GitHub runs PR CI against
the proposed merge with Kogan's changes. When upstream is already included in `main`,
the run makes no changes.

## GitHub setup

Install a GitHub App on **only `kogan/superset`**, granting these repository permissions:

- Contents: read and write
- Pull requests: read and write
- Workflows: read and write (upstream updates can change workflow files)

Set the repository Actions variable `UPSTREAM_SYNC_APP_CLIENT_ID` to its client ID,
and store `UPSTREAM_SYNC_APP_PRIVATE_KEY` in the `upstream-sync` environment.
Restrict that environment to the selected branch `main`, with no allowed tags.
Do not keep a repository-secret copy: imported PR workflows must not access the key.
The workflow generates a short-lived token scoped to this repository. It does not
use a personal access token or the built-in token to publish updates.

```sh
gh variable set UPSTREAM_SYNC_APP_CLIENT_ID --repo kogan/superset --body YOUR_APP_CLIENT_ID
gh secret set UPSTREAM_SYNC_APP_PRIVATE_KEY --repo kogan/superset --env upstream-sync < /path/to/app-private-key.pem
gh workflow run sync-upstream.yml --repo kogan/superset
```

The workflow must be merged into `main` for schedules and manual dispatch. If GitHub
Actions is disabled for the fork, enable it first. Check the first manual run and the
resulting PR's CI before relying on the schedule.

Protect `main` with required PRs and the `Upstream sync tests`, `Lint`, `Test`, and
`Typecheck` checks. Keep merge commits enabled and linear-history enforcement off.
Auto-merge should remain disabled until the fork's deployment and release configuration
has been reviewed: inherited workflows include production migrations and deployments.
The inherited preview, production, sandbox, and canary jobs only run in
`superset-sh/superset`; deployment credentials are not copied from upstream.

## Reviewing updates

Always select **Create a merge commit** for upstream sync PRs. Squashing or rebasing
discards the shared ancestry needed to recognise upstream commits on the next run.
Ordinary Kogan feature PRs can still be squash-merged.

If the PR conflicts with `main`, merge `origin/main` into `sync/upstream` in a separate
checkout, resolve the conflicts, and push the branch normally. The next daily run
preserves those resolution commits. Review behavioural changes even when Git can
merge the files automatically.

If a later upstream update conflicts with those resolutions, the workflow fails
without pushing and changes any existing PR to draft. Merge upstream main into
`sync/upstream`, resolve the conflicts, and push. Mark the PR ready once checks pass.
If the preceding PR was already merged, resolve the branch and rerun the workflow
to open the next PR. The workflow never marks a draft PR ready automatically.

Run the isolated Git regression tests with:

```sh
node --test scripts/upstream-sync/sync.test.mjs
```
