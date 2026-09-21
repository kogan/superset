# Daily upstream updates

The **Upstream Sync** workflow checks `superset-sh/superset:main` daily at
19:23 UTC (05:23 Melbourne standard time, 06:23 during daylight saving), or on
manual dispatch. It publishes successful merges directly to `kogan/superset:main`.

## Merge and validation

The workflow starts with the current fork main and preserves any unmerged work
on the previous `sync/upstream` branch. Normal Git merges preserve both upstream
history and Kogan commits. Only textual conflicts call OpenAI through AIMC.
The resolver receives the base, ours, and theirs versions of each conflicted file
and can change only those paths. Refusals, incomplete responses, binary files,
symlinks, unresolved markers, and oversized inputs stop the run.

Fork PRs and upstream merge candidates both run `fork-checks.yml`, the fork's
active CI suite. The inherited `ci.yml` and `build-cli.yml` remain available as
callable workflows without automatic push or pull-request triggers.

The candidate is saved as an immutable Git bundle. The reusable fork CI workflow
runs its plugin, version, translation, and regression checks against that exact
commit, together with the upstream sync fixture tests. No App private key or AIMC
key is passed to these validation jobs. The CI definition comes from the trusted main commit that
started the run, rather than the candidate being tested.

After all checks pass, a fresh job imports the bundle without checking out or
executing candidate code. It verifies the candidate SHA and upstream/base
ancestry, then makes a normal fast-forward push to main. If main changed while
checks were running, the run stops and must be rerun against the new main. It
never force-pushes. No new sync PR is created; an existing PR becomes merged when
its commits reach main.

## Credentials

The GitHub App is installed on **only `kogan/superset`**, with Contents, Pull
requests and Workflows read/write access. Publishing requests only the Contents
and Workflows permissions. Its client ID is the repository Actions variable
`UPSTREAM_SYNC_APP_CLIENT_ID`.

Two separate environments must allow only the selected branch `main`, with no
allowed tags:

| Environment | Secret | Purpose |
| --- | --- | --- |
| `upstream-sync` | `UPSTREAM_SYNC_APP_PRIVATE_KEY` | Publish the validated commit |
| `upstream-sync-ai` | `AIMC_API_KEY` | Resolve textual conflicts |

Do not create repository-secret copies: imported PR workflows must not access
these credentials. These are workflow credentials, not application runtime
variables, so they are not added to application schemas or deployment templates.

Create an OpenAI connection in [AIMC API Keys](https://aimc-admin.ai.kgn.io/keys)
for an approved governance role, and store the returned
**AIMC client token**, not the upstream OpenAI key, in `upstream-sync-ai`.
Prefer a dedicated `superset-upstream-sync` role with a hard $25 monthly budget,
a `balanced` tier with the full budget share, and global models allowed. An existing
approved role can also be used. Provisioning must be confirmed in AIMC before
relying on conflict resolution.

The gateway is `https://aimc-stream.ai.kgn.io/v2/openai`; the default model is
`openai/gpt-5.4`, which AIMC classifies for direct OpenAI routing. The optional
repository variable `UPSTREAM_SYNC_MODEL` can select another AIMC-supported
OpenAI model. The resolver uses Chat Completions with structured output, at most
500 KB of input and 24,000 completion tokens per merge. It does not run model
commands or give the model GitHub publishing credentials.

```sh
gh secret set AIMC_API_KEY --repo kogan/superset --env upstream-sync-ai
gh workflow run sync-upstream.yml --repo kogan/superset --ref main -f verify_ai=true
```

The secret command prompts without echoing the key. `verify_ai=true` checks a
synthetic conflict through AIMC and requires both sides' changes to survive before
preparing the real merge. Clean merges do not need an
AI call; a conflict without a configured key fails without publishing.

Inherited preview, production, sandbox, cleanup and canary jobs are restricted
to the upstream repository and disabled in this fork. Keep merge commits enabled
and linear-history enforcement off. If main gains branch protection, its rules
must allow this App to publish the already-validated merge; the workflow does
not bypass protection automatically.

## Local verification

```sh
node --test scripts/upstream-sync/sync.test.mjs
actionlint -shellcheck= .github/workflows/sync-upstream.yml .github/workflows/fork-checks.yml
shellcheck scripts/upstream-sync/sync.sh
```
