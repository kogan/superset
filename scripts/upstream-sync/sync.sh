#!/usr/bin/env bash
set -euo pipefail

: "${GH_REPO:?Set GH_REPO to the destination repository}"
upstream_url="${UPSTREAM_URL:-https://github.com/superset-sh/superset.git}"
sync_branch="sync/upstream"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Run the sync in a clean, disposable checkout." >&2
  exit 1
fi

git config user.name "upstream-sync[bot]"
git config user.email "upstream-sync[bot]@users.noreply.github.com"
git fetch --no-tags origin refs/heads/main:refs/remotes/origin/main
git fetch --no-tags "$upstream_url" refs/heads/main:refs/remotes/upstream/main

if git merge-base --is-ancestor refs/remotes/upstream/main refs/remotes/origin/main; then
  echo "main already includes the latest upstream commits."
  exit 0
fi

find_open_pr() {
  pr_number="$(gh pr list --repo "$GH_REPO" --base main --head "$sync_branch" \
    --state open --json number,headRepositoryOwner \
    --jq ".[] | select(.headRepositoryOwner.login == \"${GH_REPO%%/*}\") | .number")"
  if [[ "$pr_number" == *$'\n'* ]]; then
    echo "Multiple open sync PRs exist; reconcile them before retrying." >&2
    exit 1
  fi
}

find_open_pr

if git ls-remote --exit-code --heads origin "refs/heads/$sync_branch" > /dev/null; then
  git fetch --no-tags origin "refs/heads/$sync_branch:refs/remotes/origin/$sync_branch"
  git checkout --detach "refs/remotes/origin/$sync_branch"
else
  status=$?
  if [[ "$status" != 2 ]]; then
    exit "$status"
  fi
  if [[ -n "$pr_number" ]]; then
    echo "The open sync PR has lost its branch; restore it before retrying." >&2
    exit 1
  fi
  git checkout --detach refs/remotes/upstream/main
fi

body_file="$(mktemp)"
trap 'rm -f "$body_file"' EXIT
upstream_sha="$(git rev-parse refs/remotes/upstream/main)"
cat > "$body_file" <<EOF
Bring changes from superset-sh/superset into the Kogan fork.

- Upstream commit: https://github.com/superset-sh/superset/commit/$upstream_sha
- Review the diff and wait for required CI checks before merging.
- Use **Create a merge commit** to preserve upstream ancestry. Do not squash or rebase this PR.
- Resolve conflicts on \`$sync_branch\`; daily updates preserve commits on this branch.
- See [the sync runbook](https://github.com/$GH_REPO/blob/main/docs/upstream-sync.md).
EOF

if ! git merge --no-edit refs/remotes/upstream/main; then
  git merge --abort
  if [[ -n "$pr_number" ]]; then
    cat >> "$body_file" <<EOF

**Update blocked:** the latest upstream changes conflict with commits on the sync branch.
Merge upstream main into \`$sync_branch\`, resolve the conflicts, and mark this PR ready after CI passes.
EOF
    if [[ "$(gh pr view "$pr_number" --repo "$GH_REPO" --json isDraft --jq .isDraft)" == false ]]; then
      gh pr ready "$pr_number" --repo "$GH_REPO" --undo
    fi
    gh pr edit "$pr_number" --repo "$GH_REPO" --body-file "$body_file"
  fi
  echo "::error::Upstream conflicts with $sync_branch. Resolve on that branch and retry; no remote branch was changed."
  exit 1
fi

if ! git merge --no-edit refs/remotes/origin/main; then
  git merge --abort
  cat >> "$body_file" <<EOF

**Conflicts with main:** merge \`origin/main\` into \`$sync_branch\` and resolve the conflicts before merging this PR.
EOF
fi

git push origin "HEAD:refs/heads/$sync_branch"

git fetch --no-tags origin refs/heads/main:refs/remotes/origin/main
if git merge-base --is-ancestor HEAD refs/remotes/origin/main; then
  echo "The pushed sync commits are already merged into main."
  exit 0
fi

find_open_pr
if [[ -n "$pr_number" ]]; then
  gh pr edit "$pr_number" --repo "$GH_REPO" --body-file "$body_file"
else
  if ! gh pr create --repo "$GH_REPO" --base main --head "$sync_branch" \
    --title "chore: sync upstream Superset" --body-file "$body_file"; then
    find_open_pr
    if [[ -z "$pr_number" ]]; then
      exit 1
    fi
    gh pr edit "$pr_number" --repo "$GH_REPO" --body-file "$body_file"
  fi
fi
