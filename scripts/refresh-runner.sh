#!/usr/bin/env bash
# TennisArc data-refresh runner: keeps a DEDICATED clone in sync with origin/main and runs the
# publish pipeline from there, so the cron never depends on — or interferes with — a dev checkout
# (no clobbered uncommitted work, no stale script after a merge, no manual `git pull`).
#
# Install (Mac launchd or Pi systemd): copy this file OUTSIDE the clone (it must survive resets,
# e.g. ~/Library/Application Support/TennisArc/run-refresh.sh) and point the agent at it. The copy
# is a snapshot — re-copy if this file changes. launchd/systemd never overlap runs of one job, so
# no locking is needed. First run bootstraps the clone by itself.
set -euo pipefail

CLONE="${TENNISARC_RUNNER_CLONE:-$HOME/Library/Application Support/TennisArc/refresh}"
REPO_URL="${TENNISARC_REPO_URL:-https://github.com/tsenoner/TennisArc.git}"

if [ ! -d "$CLONE/.git" ]; then
  mkdir -p "$(dirname "$CLONE")"
  git clone "$REPO_URL" "$CLONE"
fi
cd "$CLONE"

# Run exactly what's on origin/main: discard local drift and leftovers from a killed run
# (clean skips gitignored files, so node_modules stays put).
git fetch origin main
git reset --hard origin/main
git clean -fdq

# Idempotent and fast when nothing changed; a real failure aborts the cycle and the next tick
# retries — better than scraping with a half-installed toolchain.
pnpm install --frozen-lockfile
pnpm exec playwright install chromium

exec scripts/publish-data.sh
