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

# Run publish-data.sh under a hard timeout so a hung headless browser can't wedge the schedule.
# launchd/systemd never overlap runs of one job, so a single stuck run blocks EVERY later tick
# until it's killed by hand — which is exactly what bit us: a Playwright navigation hung for days
# and silently swallowed every 30-min cycle. A timeout makes each cycle self-clearing. We walk the
# PID tree rather than signal a process group, because the headless-Chromium child opens its own
# session (ps state "Ss"), so a group-kill — what GNU `timeout`/`gtimeout` do — would miss it.
TENNISARC_TIMEOUT="${TENNISARC_TIMEOUT:-1200}"   # seconds; override via env if a real run needs longer

descendants() {                 # print a PID and all its descendants — snapshot the whole tree
  local pid=$1 child            # BEFORE killing, so reparenting after the first kill can't strand a
  echo "$pid"                   # grandchild (the orphaned chrome-headless-shell processes we saw).
  for child in $(pgrep -P "$pid" 2>/dev/null); do descendants "$child"; done
}

scripts/publish-data.sh &
JOB=$!
( sleep "$TENNISARC_TIMEOUT"
  if kill -0 "$JOB" 2>/dev/null; then
    echo "refresh-runner: publish-data.sh exceeded ${TENNISARC_TIMEOUT}s — killing the run" >&2
    PIDS="$(descendants "$JOB")"
    kill -TERM $PIDS 2>/dev/null || true   # SIGTERM first so publish-data.sh's EXIT trap can clean up
    sleep 20
    kill -KILL $PIDS 2>/dev/null || true
  fi
) &
WATCHDOG=$!

STATUS=0
wait "$JOB" || STATUS=$?         # `|| ...` stops `set -e` bailing before we reap the watchdog
kill -TERM $(descendants "$WATCHDOG") 2>/dev/null || true   # finished on its own → cancel the timer
exit "$STATUS"
