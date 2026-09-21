#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
upstream_url="${UPSTREAM_URL:-https://github.com/superset-sh/superset.git}"
sync_branch="sync/upstream"
: "${SYNC_BUNDLE:?Set SYNC_BUNDLE to a path outside the checkout}"

output() {
  printf '%s=%s\n' "$1" "$2"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf '%s=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"
  fi
}

merge_ref() {
  if git merge --no-edit "$1"; then
    return
  fi
  if [[ -z "$(git ls-files --unmerged)" ]]; then
    return 1
  fi
  if ! node "$script_dir/resolve-conflicts.mjs"; then
    git merge --abort
    return 1
  fi
  git commit --no-edit
}

case "${1:-}" in
  prepare)
    if [[ -n "$(git status --porcelain)" ]]; then
      echo "Run the sync in a clean, disposable checkout." >&2
      exit 1
    fi
    git config user.name "upstream-sync[bot]"
    git config user.email "upstream-sync[bot]@users.noreply.github.com"
    git fetch --no-tags origin refs/heads/main:refs/remotes/origin/main
    git fetch --no-tags "$upstream_url" refs/heads/main:refs/remotes/upstream/main
    base_sha="$(git rev-parse refs/remotes/origin/main)"
    upstream_sha="$(git rev-parse refs/remotes/upstream/main)"
    git checkout --detach "$base_sha"
    if git ls-remote --exit-code --heads origin "refs/heads/$sync_branch" > /dev/null; then
      git fetch --no-tags origin "refs/heads/$sync_branch:refs/remotes/origin/$sync_branch"
      if ! git merge-base --is-ancestor "refs/remotes/origin/$sync_branch" HEAD; then
        git checkout --detach "refs/remotes/origin/$sync_branch"
        merge_ref "$base_sha"
      fi
    else
      status=$?
      if [[ "$status" != 2 ]]; then
        exit "$status"
      fi
    fi
    merge_ref "$upstream_sha"
    candidate_sha="$(git rev-parse HEAD)"
    if [[ "$candidate_sha" == "$base_sha" ]]; then
      output changed false
      exit 0
    fi
    git merge-base --is-ancestor "$base_sha" "$candidate_sha"
    git merge-base --is-ancestor "$upstream_sha" "$candidate_sha"
    git bundle create "$SYNC_BUNDLE" HEAD "^$base_sha"
    output base_sha "$base_sha"
    output upstream_sha "$upstream_sha"
    output candidate_sha "$candidate_sha"
    output changed true
    ;;
  publish)
    for sha in "${BASE_SHA:-}" "${UPSTREAM_SHA:-}" "${CANDIDATE_SHA:-}"; do
      if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
        echo "Invalid candidate metadata." >&2
        exit 1
      fi
    done
    git fetch --no-tags origin refs/heads/main:refs/remotes/origin/main
    if [[ "$(git rev-parse refs/remotes/origin/main)" != "$BASE_SHA" ]]; then
      echo "main changed during validation; rerun to validate a fresh merge." >&2
      exit 1
    fi
    git bundle verify "$SYNC_BUNDLE"
    git fetch --no-tags "$SYNC_BUNDLE" HEAD
    if [[ "$(git rev-parse FETCH_HEAD)" != "$CANDIDATE_SHA" ]]; then
      echo "The artifact does not contain the validated candidate." >&2
      exit 1
    fi
    git merge-base --is-ancestor "$BASE_SHA" "$CANDIDATE_SHA"
    git merge-base --is-ancestor "$UPSTREAM_SHA" "$CANDIDATE_SHA"
    git push origin "$CANDIDATE_SHA:refs/heads/main"
    ;;
  *)
    echo "Usage: sync.sh prepare|publish" >&2
    exit 1
    ;;
esac
