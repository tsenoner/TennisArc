#!/usr/bin/env bash
# Refresh tennis data from a residential IP and publish to the `data` branch.
# GitHub-hosted runners are Cloudflare-blocked, so run this locally (or via launchd/cron).
#
# Approach: uses a throwaway git worktree to build the clean data-only branch, so the
# main working tree is never touched by the branch-switching logic and cannot be corrupted.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO_ROOT="$(pwd)"
# HTTPS remote so the gh credential helper authenticates the push even under launchd,
# which has no SSH agent. Run `gh auth setup-git` once so git uses the gh token for HTTPS.
REMOTE="https://github.com/tsenoner/TennisArc.git"
WORKTREE_DIR="$(mktemp -d /tmp/tapub-XXXXXX)"
trap 'git worktree remove --force "$WORKTREE_DIR" 2>/dev/null || rm -rf "$WORKTREE_DIR"' EXIT

# 1. Run the ingest (writes public/data/*.json in the main tree).
pnpm ingest

# 2. Bail out early if nothing changed in public/data.
if [ -z "$(git status --porcelain -- public/data)" ]; then
  echo "no fresh data; data branch unchanged"
  exit 0
fi

# 3. Snapshot the freshly ingested JSON before touching any branches.
STAGING="$(mktemp -d /tmp/tapub-staging-XXXXXX)"
trap 'git worktree remove --force "$WORKTREE_DIR" 2>/dev/null || rm -rf "$WORKTREE_DIR"; rm -rf "$STAGING"' EXIT
cp "$REPO_ROOT"/public/data/*.json "$STAGING/"

# 4. Set up git identity if not already configured (needed for the commit).
git config --get user.name  >/dev/null 2>&1 || git config user.name  "tennisarc-bot"
git config --get user.email >/dev/null 2>&1 || git config user.email "bot@users.noreply.github.com"

# 5. Create or reset a local data-pub ref we can check out into the worktree.
#    We try to base it on origin/data so the push is incremental; if that doesn't
#    exist yet we start an orphan commit instead.
if git fetch "$REMOTE" data 2>/dev/null; then
  git branch -f data-pub FETCH_HEAD
else
  # No remote data branch yet — create an empty orphan ref via a temp worktree trick:
  # write a stub commit that we'll immediately overwrite below.
  git worktree add --orphan -b data-pub "$WORKTREE_DIR"
  (
    cd "$WORKTREE_DIR"
    git commit --allow-empty -m "init data branch" >/dev/null
  )
  git worktree remove --force "$WORKTREE_DIR"
fi

# 6. Check out data-pub into the throwaway worktree.
git worktree add "$WORKTREE_DIR" data-pub

# 7. Wipe whatever was there and drop in the fresh JSON (files at root, no subdirs).
(
  cd "$WORKTREE_DIR"
  git rm -rf . >/dev/null 2>&1 || true
  cp "$STAGING"/*.json .
  git add -A
  if git diff --cached --quiet; then
    echo "no changes vs last data branch commit; nothing to publish"
    exit 0
  fi
  git commit -q -m "data: refresh $(date -u +%FT%TZ)"
  git push -f "$REMOTE" data-pub:data
  echo "published data branch"
)

# Keep the main working tree clean: the fresh ingest in public/data was only needed to
# build the data branch (which now carries it), so restore the committed seed.
git checkout -- public/data 2>/dev/null || true
