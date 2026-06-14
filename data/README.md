# `data/` — durable inputs for the Elo engine

This directory holds the **reproducible reference data** behind the historical Elo work (issue #25). Two
classes of input feed the engine; this records where each lives and how to regenerate it.

## 1. Tennis Abstract archived boards (Wayback) — **committed here**

`wayback/ta-elo-boards-2016-2026.tar.gz` — every distinct **monthly** capture of TA's published Elo board
pages (`tennisabstract.com/reports/{atp,wta}_elo_ratings.html`) from the Internet Archive, ~120 per tour
back to **Feb 2016** (none predate it). 175 captures, ~3.7 MB. Committed because the Wayback Machine is not
a guaranteed-permanent source and these underpin the historical validation.

Derived, committed artifact: **`ingest/fixtures/ta-elo-historical.json`** — the top-40 `(name, overall)`
per board "Last update" date, extracted from those captures (factual rating data).

Regenerate / refresh:
```bash
tar -xzf data/wayback/ta-elo-boards-2016-2026.tar.gz -C data/wayback/raw  # unpack (raw/ is gitignored)
npx tsx ingest/elo-wayback.ts            # rebuild ingest/fixtures/ta-elo-historical.json from raw/
npx tsx ingest/elo-wayback.ts --fetch    # re-download every monthly capture from Wayback first (network)
npx tsx ingest/elo-burnin.ts             # validate the production engine against the fixture (per-year offset)
npx tsx ingest/elo-reconstruct.ts ATP "Novak Djokovic"   # month-by-month per-player reconstruction
```

## 2. Jeff Sackmann match CSVs — **not vendored (re-fetched from the canonical source)**

The engine is built from `JeffSackmann/tennis_atp` + `tennis_wta` yearly match CSVs (main draw 1968+,
`*_qual_chall_*` / `*_qual_itf_*` 2008+/2011+). These are **~217 MB** and already live, versioned, at their
canonical GitHub home, so we do **not** duplicate them in this repo. They are fetched automatically by the
committed ingest code (`ingest/durations.ts` → `fetchMatchesCsv` / `fetchQualChallCsv`, used by
`ingest/backfill-elo.ts` and `ingest/calibrate-elo.ts`) and cached under `ingest/.cache/elo/` (gitignored).
To warm the cache for 1968–present:
```bash
npx tsx ingest/calibrate-elo.ts   # fetches + caches all years, then fits the entrant seeds
```

License: Sackmann's data is CC BY-NC-SA 4.0; TA board content is © Tennis Abstract. Both are third-party —
we keep only the small factual fixture in-tree and re-fetch the bulk inputs from their owners' sources.
