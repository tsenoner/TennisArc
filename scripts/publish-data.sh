#!/usr/bin/env bash
# Refresh tennis data from a residential IP and publish to the `data` branch.
# GitHub-hosted runners are Cloudflare-blocked, so run this locally (or via launchd/cron).
#
# Data layout (public/data/, all copied to the orphan `data` branch each run):
#   index.json                          — manifest of available slams (merged each ingest)
#   {tour}-{year}-{slam}.json           — one snapshot per slam (e.g. atp-2026-roland-garros.json)
#   {atp,wta}.json                      — alias of the *active* slam (legacy; current app fallback)
# Only the active slam is rewritten each run; completed slams persist because their JSON is
# committed to the repo seed (public/data/). To FREEZE a finished slam, commit its final
# {tour}-{year}-{slam}.json + the updated index.json to main once the final is played.
# Backfill past years with: BACKFILL_YEARS=2024,2025 pnpm ingest
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

# 5. Build the data branch as a SINGLE orphan commit (no parent) so it never
#    accumulates stale JSON snapshots: `git log data` stays one commit deep and the
#    force-push below replaces the published tip outright. The branch is just a file
#    server for Vercel — nothing reads its history, so there's nothing to preserve.
git branch -D data-pub >/dev/null 2>&1 || true
git worktree add --orphan -b data-pub "$WORKTREE_DIR" >/dev/null

# 6. Drop in the fresh JSON (files at root, no subdirs) and commit.
(
  cd "$WORKTREE_DIR"
  cp "$STAGING"/*.json .
  # Tell Vercel never to build the data branch (it has no app) — prevents failing preview deploys.
  printf '%s\n' '{"git":{"deploymentEnabled":false}}' > vercel.json
  git add -A
  git commit -q -m "data: refresh $(date -u +%FT%TZ)"
)

# 7. Skip the push when the new tree is byte-identical to what's already published
#    (a tree SHA ignores commit date/message), else force-push the single commit.
if git fetch "$REMOTE" data 2>/dev/null && \
   [ "$(git -C "$WORKTREE_DIR" rev-parse 'HEAD^{tree}')" = "$(git rev-parse 'FETCH_HEAD^{tree}')" ]; then
  echo "data unchanged vs published branch; nothing to publish"
  exit 0
fi
git -C "$WORKTREE_DIR" push -f "$REMOTE" data-pub:data
echo "published data branch (single orphan commit)"

# Keep the main working tree clean: the fresh ingest in public/data was only needed to
# build the data branch (which now carries it), so restore the committed seed.
git checkout -- public/data 2>/dev/null || true
