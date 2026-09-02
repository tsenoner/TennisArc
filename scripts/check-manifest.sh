#!/usr/bin/env bash
# Assert that a data dir's manifest (index.json) lists exactly the per-slam snapshots on disk.
#
# publish-data.sh runs this after `pnpm reindex` and again on the tree it is about to push. The
# manifest is what the app's slam tabs read, so a snapshot that is on disk but absent from
# index.json is invisible to users even though nothing was lost. That happened silently for weeks:
# `pnpm reindex` exited 0 having done nothing (its main-guard failed on a checkout path containing
# a space — see ingest/main-guard.ts), the carry-forward kept every file, and Wimbledon 2026 simply
# vanished from the tabs. A mismatch here is a bug in the pipeline, so refuse to publish rather
# than ship a manifest that hides data.
#
# Compares IDENTITIES (tour/year/slam), not just counts: the snapshot filename encodes the same
# identity the manifest entry carries, so a stale manifest that happens to be the right length, or
# a snapshot whose contents disagree with its filename, would both slip past a count check while
# still dropping or duplicating a tab. It also makes the failure name the slam, which is the
# sentence an operator needs in an unattended log.
#
# Usage: check-manifest.sh <data-dir>      (e.g. public/data)   exit 0 = consistent, 1 = mismatch
set -euo pipefail
dir="${1:?usage: check-manifest.sh <data-dir>}"

# Snapshots live at slams/{year}/{atp|wta}-{slam}.json. nullglob array, not `ls`: an unmatched
# glob would otherwise become a literal and the comparison would be wrong (same idiom as
# publish-data.sh's count_snaps). `${files[@]+...}` keeps an empty array legal under `set -u` in
# bash 3.2, the macOS /usr/bin/env bash.
shopt -s nullglob
files=( "$dir"/slams/[0-9]*/atp-*.json "$dir"/slams/[0-9]*/wta-*.json )
shopt -u nullglob

if [ ! -f "$dir/index.json" ]; then
  echo "manifest missing: $dir/index.json does not exist (${#files[@]} snapshots on disk) — did reindex run?" >&2
  exit 1
fi

node -e '
  const fs = require("node:fs");
  const [manifest, ...files] = process.argv.slice(1);
  const id = (p) => {
    const m = /slams\/(\d{4})\/(atp|wta)-([a-z0-9-]+)\.json$/.exec(p);
    return m && `${m[2].toUpperCase()}/${m[1]}/${m[3]}`;
  };
  const disk = new Set(files.map(id).filter(Boolean));
  const idx = JSON.parse(fs.readFileSync(manifest, "utf8"));
  const listed = new Set((Array.isArray(idx.slams) ? idx.slams : []).map((s) => `${s.tour}/${s.year}/${s.slam}`));
  const only = (a, b) => [...a].filter((x) => !b.has(x)).sort();
  const missing = only(disk, listed), extra = only(listed, disk);
  if (missing.length || extra.length) {
    const parts = [];
    if (missing.length) parts.push(`on disk but not in the manifest: ${missing.join(", ")}`);
    if (extra.length) parts.push(`in the manifest but not on disk: ${extra.join(", ")}`);
    console.error(`manifest mismatch: ${parts.join("; ")} — did reindex run?`);
    process.exit(1);
  }
  console.log(`manifest ok: ${disk.size} slams`);
' "$dir/index.json" ${files[@]+"${files[@]}"}
