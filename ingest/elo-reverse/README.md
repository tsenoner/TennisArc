# elo-reverse — reverse-engineering & reproducing TA's Elo + season-yElo

Two reproductions of Tennis Abstract's (TA) singles ratings, both validated against TA's **own published
boards** (the ground truth), so no from-scratch burn-in is needed:

1. **Full board** — replay board(T) + that window's Sackmann matches → board(T+1). With the **dense weekly**
   captures (below) this now reproduces TA to per-transition **median-of-medians 0.10 (ATP) / 0.04 (WTA)** —
   **271/332 (ATP) & 181/230 (WTA) transitions ≤1 Elo** (was 3.0/1.4 on monthly boards). `replay.ts`.
2. **Season yElo** — for each player, reset to 1500/n=0 and replay their current-year matches against
   opponents' **REAL** full-Elo at match time (only the target updates). yElo ratings reproduce to
   **median |Δ| ~5–8**, ~100% W/L-exact early-season. Full write-up: [`docs/yelo-reproduction.md`](../../docs/yelo-reproduction.md).
   `yelo-fit.ts`.

Method + findings: `docs/elo-investigation-findings.md` §0 (full board) and `docs/yelo-reproduction.md` (yElo).

## Run

```bash
pnpm elo:scatter                                   # parse → reproduce → serve the full DASHBOARD (localhost:5188)
pnpm elo:scatter-legacy                            # the older single Elo/yElo scatter file (elo-scatter.html)
pnpm elo:check-points                              # known-answer gate for the points engine (ATP 2019/2023)
npx tsx ingest/elo-reverse/fetch-wayback.ts        # (re)download every distinct Wayback capture (network)
npx tsx ingest/elo-reverse/replay.ts ATP --clean   # full-board update rule (per-transition residuals)
npx tsx ingest/elo-reverse/yelo-fit.ts ATP         # season-yElo reproduction (per board)
npx tsx ingest/elo-reverse/yelo-fit.ts ATP --board 20260112   # one yElo board, detailed W/L + Δ
```

The **dashboard** (`dashboard.html`, served by `serve.ts` because the dataset is a ~5 MB JSON sidecar, not
inlined) has three views, toggled top-left, with an ATP/WTA switch:

- **Elo / yElo** — a **stacked-bar accuracy timeline** over EVERY snapshot we have (all 333 ATP / 231 WTA
  full-board transitions; all 30/35 yElo boards). Each bar = that snapshot's |Δ|-bucket composition
  (green ≤2 / yellow ≤10 / orange ≤30 / red >30), with a median-|Δ| overlay line and recompute boundaries
  drawn muted. **Click a bar → the linked computed-vs-retrieved scatter** + the full stats line for that
  snapshot. (`dashboard-data.ts` → `dashboard-data.json`.)
- **Points** — computed best-N earned-points vs official year-end ranking, per season, top-30, as paired
  bars with colour-coded Δ. ATP 2009-2025 + WTA 2015-2025. (`../points/engine.ts --emit` → `points-data.json`.)

The legacy **scatter** (`elo-scatter.html`, `scatter.ts`) is the old last-8-transitions single plot, kept for
reference.

## Files

| File | Role |
|---|---|
| `lib.ts` | loaders, name↔id join, window/inclusion helpers. `keepForElo` (drops only pure walkovers + sub-$50K ITF; **retirements/defaults COUNT**); `loadMatches` de-dups the WTA-125 feed; `roundRank` (process matches in PLAY order — Sackmann lists finals first); `playDate`/`estEnd` (draw-size-aware tournament timing). |
| `fetch-wayback.ts` | download every distinct-content Wayback capture of all 4 reports → `data/wayback/raw-full/`. |
| `parse-boards.ts` | parse full-Elo boards (monthly tarball + dense `raw-full`) → `boards.json`, deduped by `lastUpdate`. |
| `parse-yelo.ts` | parse season-yElo boards (`Rank\|Player\|Wins\|Losses\|yElo`) → `yelo-boards.json`. |
| `replay.ts` | full-board seeded mini-replay; validation of the update rule. |
| `yelo-fit.ts` | season-yElo reproduction (`--board`, `--pgrid`, `--cutfit`, `--scatter`, `--trace`). |
| `scatter.ts` | (legacy) build the interactive last-8 Elo+yElo computed-vs-retrieved HTML. |
| `dashboard-data.ts` | emit `dashboard-data.json` — EVERY Elo/yElo snapshot with |Δ|-bucket counts + full pts (name-interned). |
| `dashboard.html` | the 3-view dashboard (stacked-bar timeline + linked scatter + points); fetches the JSON sidecars. |
| `serve.ts` | tiny static server for `dashboard.html` + the sidecars (5 MB → HTTP not file://); opens the browser. |

Generated (gitignored): `boards.json`, `yelo-boards.json`, `yelo-scatter-{ATP,WTA}.json`, `elo-scatter.html`.

## Data dependencies

- **Dense captures:** `data/wayback/raw-full/` (gitignored, `fetch-wayback.ts`) — 412 ATP + 271 WTA full-Elo
  + 34 ATP + 36 WTA yElo distinct-content captures.
- **Monthly tarball:** `data/wayback/ta-elo-boards-2016-2026.tar.gz` (committed) → `data/wayback/raw/`.
- **Sackmann match CSVs:** `ingest/.cache/elo/` (gitignored; populated by `npx tsx ingest/calibrate-elo.ts`. Note `pnpm backfill-elo` fetches straight into the snapshots and does **not** write this cache).

## Note

This tooling characterises TA's method; the **shipped** engine (`../historical-elo.ts` + `../elo-config.ts`)
is the from-scratch reconstruction. As of 2026-06-15 the key findings have been **transferred** to it:
**play-order replay** (`sortEloRows` now sorts by round-within-event), the full **scope** (`keepForEloRow` +
`dedupeEloRows` drop walkovers + sub-$50K ITF + the WTA-125 double-feed), and **era-gated retirements**
(`retEraStart` in the config, cutoff-keyed). Seeds re-fit accordingly (ATP 1400/1200, WTA 1350/1130). Measured
vs TA's board (boards.json 20260504, top-50): **ATP overall meanAbs 15.4 → 5.6** (~3×); WTA ~13. The
injury/absence dock + 50/50 surface blend are unchanged.
