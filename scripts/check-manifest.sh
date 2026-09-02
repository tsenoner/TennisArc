#!/usr/bin/env bash
# Assert that a data dir's manifest (index.json) lists exactly the per-slam snapshots on disk.
#
# publish-data.sh runs this right after `pnpm reindex`. The manifest is what the app's slam tabs
# read, so a snapshot that is on disk but absent from index.json is invisible to users even though
# nothing was lost. That happened silently for weeks: `pnpm reindex` exited 0 having done nothing
# (its CLI main-guard failed on a checkout path containing a space — see ingest/cli.ts), the
# carry-forward kept every file, and Wimbledon 2026 simply vanished from the tabs. A count mismatch
# here is a bug in the pipeline, so refuse to publish rather than ship a manifest that hides data.
#
# Usage: check-manifest.sh <data-dir>      (e.g. public/data)   exit 0 = consistent, 1 = mismatch
set -euo pipefail
dir="${1:?usage: check-manifest.sh <data-dir>}"

# Snapshots live at slams/{year}/{atp|wta}-{slam}.json. nullglob array, not `ls`: an unmatched
# glob would otherwise become a literal and the count would be wrong (same idiom as publish-data.sh).
shopt -s nullglob
files=( "$dir"/slams/[0-9]*/atp-*.json "$dir"/slams/[0-9]*/wta-*.json )
shopt -u nullglob
disk="${#files[@]}"

if [ ! -f "$dir/index.json" ]; then
  echo "manifest missing: $dir/index.json does not exist ($disk snapshots on disk) — did reindex run?" >&2
  exit 1
fi
listed="$(node -e '
  const i = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  process.stdout.write(String(Array.isArray(i.slams) ? i.slams.length : -1));
' "$dir/index.json")"

if [ "$listed" != "$disk" ]; then
  echo "manifest mismatch: $dir/index.json lists $listed slams but $disk snapshots are on disk — did reindex run?" >&2
  exit 1
fi
echo "manifest ok: $listed slams"
