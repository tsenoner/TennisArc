#!/usr/bin/env bash
# Refresh tennis data from a residential IP and publish to the `data` branch.
# GitHub-hosted runners are Cloudflare-blocked, so run this locally (or via launchd/cron).
#
# Data layout (public/data/, all copied to the orphan `data` branch each run):
#   index.json                          — manifest of available slams (rebuilt by `pnpm reindex`)
#   {tour}-{year}-{slam}.json           — one snapshot per slam (e.g. atp-2026-roland-garros.json)
#   {atp,wta}.json                      — alias of the *active* slam (legacy; current app fallback)
#
# Auto-persist: completed slams stay live with NO manual freeze. Each run carries forward the
# already-published `data` branch (step 2) and rebuilds the manifest from every snapshot on disk
# (step 3), so a major that finished in a past window survives later windows publishing other
# slams. The committed seed (public/data) and the published branch are both inputs; the branch is
# the superset. (You can still freeze a slam into the seed by committing its JSON to main, but you
# no longer have to.) Backfill past majors with: BACKFILL_YEARS=2024,2025 pnpm ingest
#
# Approach: a throwaway git worktree builds the clean data-only branch, so the main working tree is
# never corrupted by branch switching, and is restored to the committed seed on exit.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO_ROOT="$(pwd)"
# HTTPS remote so the gh credential helper authenticates the push even under launchd, which has no
# SSH agent (run `gh auth setup-git` once). Override with TENNISARC_REMOTE for local testing.
REMOTE="${TENNISARC_REMOTE:-https://github.com/tsenoner/TennisArc.git}"

WORKTREE_DIR="$(mktemp -d /tmp/tapub-XXXXXX)"
PUB_DIR="$(mktemp -d /tmp/tapub-pub-XXXXXX)"
STAGING="$(mktemp -d /tmp/tapub-staging-XXXXXX)"
cleanup() {
  git worktree remove --force "$WORKTREE_DIR" 2>/dev/null || rm -rf "$WORKTREE_DIR"
  rm -rf "$PUB_DIR" "$STAGING"
  # The carry-forward overlay (step 2) drops untracked snapshots into public/data; remove them and
  # restore the committed seed so the main working tree is left exactly as we found it.
  git checkout -- public/data 2>/dev/null || true
  git clean -fdq -- public/data 2>/dev/null || true
}
trap cleanup EXIT

# 1. Refresh the active slam (a fast no-op between tournaments — no browser launched).
pnpm ingest

# 2. Carry forward previously-published slams so completed majors persist with no manual freeze.
#    FIRST learn whether a published `data` branch exists, independently of the fetch: this is the
#    difference between "first publish ever" (safe to create the branch from the seed) and "the
#    branch is live but we failed to read it" (must NOT force-push a seed-only tree over it and lose
#    branch-only slams). ls-remote --exit-code: rc 0 = ref exists, 2 = absent, other = unreachable.
REMOTE_HAS_DATA=0
rc=0; git ls-remote --exit-code --heads "$REMOTE" data >/dev/null 2>&1 || rc=$?
if   [ "$rc" = 0 ]; then REMOTE_HAS_DATA=1
elif [ "$rc" = 2 ]; then REMOTE_HAS_DATA=0
else echo "cannot reach the remote to check the data branch — aborting (no publish)" >&2; exit 1
fi

#    Then pull the branch and copy any per-slam snapshot it holds that we don't already have locally.
#    The existence check means the freshly-ingested active slam and the committed seed always win;
#    only genuinely-absent past slams are restored. FETCH_HEAD is reused in step 8.
#    (Avoid `cp -n`: BSD/macOS cp exits non-zero when it skips, which would trip `set -e`.)
HAVE_PUBLISHED=0
if [ "$REMOTE_HAS_DATA" = 1 ] && git fetch "$REMOTE" data 2>/dev/null; then
  HAVE_PUBLISHED=1
  git archive FETCH_HEAD 2>/dev/null | tar -x -C "$PUB_DIR" 2>/dev/null || true
  shopt -s nullglob
  for f in "$PUB_DIR"/atp-[0-9]*-*.json "$PUB_DIR"/wta-[0-9]*-*.json; do
    dest="public/data/$(basename "$f")"
    [ -e "$dest" ] || cp "$f" "$dest"
  done
  shopt -u nullglob
fi

#    Guard the data-loss path: the branch exists but we couldn't fetch it → refuse to publish, since
#    a force-push now would overwrite slams we were unable to carry forward.
if [ "$REMOTE_HAS_DATA" = 1 ] && [ "$HAVE_PUBLISHED" = 0 ]; then
  echo "data branch exists but could not be fetched — refusing to publish (would risk data loss)" >&2
  exit 1
fi

# 3. Rebuild the manifest from every per-slam snapshot now on disk (seed + active + carried).
pnpm reindex

# 4. Snapshot the full data set before touching branches.
cp "$REPO_ROOT"/public/data/*.json "$STAGING/"

# 5. Set up a git identity if none is configured (needed for the commit under launchd/cron).
git config --get user.name  >/dev/null 2>&1 || git config user.name  "tennisarc-bot"
git config --get user.email >/dev/null 2>&1 || git config user.email "bot@users.noreply.github.com"

# 6. Build the data branch as a SINGLE orphan commit (the branch is just a file server for Vercel —
#    no history to preserve), then force-push only if its tree actually changed.
git branch -D data-pub >/dev/null 2>&1 || true
git worktree add --orphan -b data-pub "$WORKTREE_DIR" >/dev/null
(
  cd "$WORKTREE_DIR"
  cp "$STAGING"/*.json .
  # Tell Vercel never to build the data branch (it has no app) — prevents failing preview deploys.
  printf '%s\n' '{"git":{"deploymentEnabled":false}}' > vercel.json
  git add -A
  git commit -q -m "data: refresh $(date -u +%FT%TZ)"
)

# Count per-slam snapshots in a dir. Uses a nullglob array, NOT `ls`: under bash 3.2 (the macOS
# /usr/bin/env bash) an unmatched glob makes `ls` exit 1, which `pipefail` + `set -e` would turn
# into a whole-script abort on any single-tour / empty dir. `${#files[@]}` is safe under `set -u`.
count_snaps() {
  local d="$1"; local -a files
  shopt -s nullglob
  files=( "$d"/atp-[0-9]*-*.json "$d"/wta-[0-9]*-*.json )
  shopt -u nullglob
  echo "${#files[@]}"
}

# 7. Safety guard: never publish FEWER snapshots than are already live. With carry-forward the new
#    tree is always a superset; if it somehow shrank, a bug is afoot — abort rather than wipe data.
NEW_N="$(count_snaps "$WORKTREE_DIR")"
if [ "$HAVE_PUBLISHED" = 1 ]; then
  PUB_N="$(count_snaps "$PUB_DIR")"
  if [ "$NEW_N" -lt "$PUB_N" ]; then
    echo "refusing to publish: new tree has $NEW_N snapshots vs $PUB_N already live — aborting to avoid data loss" >&2
    exit 1
  fi
fi

# 8. Skip the push when the new tree is byte-identical to what's already published (a tree SHA
#    ignores commit date/message), else force-push the single commit.
if [ "$HAVE_PUBLISHED" = 1 ] && \
   [ "$(git -C "$WORKTREE_DIR" rev-parse 'HEAD^{tree}')" = "$(git rev-parse 'FETCH_HEAD^{tree}')" ]; then
  echo "data unchanged vs published branch; nothing to publish"
  exit 0
fi
git -C "$WORKTREE_DIR" push -f "$REMOTE" data-pub:data
echo "published data branch ($NEW_N snapshots)"
