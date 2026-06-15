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
pnpm elo:scatter                                   # parse → reproduce → interactive Elo+yElo scatter (toggle)
npx tsx ingest/elo-reverse/fetch-wayback.ts        # (re)download every distinct Wayback capture (network)
npx tsx ingest/elo-reverse/replay.ts ATP --clean   # full-board update rule (per-transition residuals)
npx tsx ingest/elo-reverse/yelo-fit.ts ATP         # season-yElo reproduction (per board)
npx tsx ingest/elo-reverse/yelo-fit.ts ATP --board 20260112   # one yElo board, detailed W/L + Δ
```

The **scatter** (`elo-scatter.html`, generated) plots computed vs retrieved per player, with an **Elo / yElo
toggle**; hover shows name + both values + discrepancy + W/L. Points on the diagonal reproduce TA exactly.

## Files

| File | Role |
|---|---|
| `lib.ts` | loaders, name↔id join, window/inclusion helpers. `keepForElo` (drops only pure walkovers + sub-$50K ITF; **retirements/defaults COUNT**); `loadMatches` de-dups the WTA-125 feed; `roundRank` (process matches in PLAY order — Sackmann lists finals first); `playDate`/`estEnd` (draw-size-aware tournament timing). |
| `fetch-wayback.ts` | download every distinct-content Wayback capture of all 4 reports → `data/wayback/raw-full/`. |
| `parse-boards.ts` | parse full-Elo boards (monthly tarball + dense `raw-full`) → `boards.json`, deduped by `lastUpdate`. |
| `parse-yelo.ts` | parse season-yElo boards (`Rank\|Player\|Wins\|Losses\|yElo`) → `yelo-boards.json`. |
| `replay.ts` | full-board seeded mini-replay; validation of the update rule. |
| `yelo-fit.ts` | season-yElo reproduction (`--board`, `--pgrid`, `--cutfit`, `--scatter`, `--trace`). |
| `scatter.ts` | build the interactive Elo+yElo computed-vs-retrieved HTML. |

Generated (gitignored): `boards.json`, `yelo-boards.json`, `yelo-scatter-{ATP,WTA}.json`, `elo-scatter.html`.

## Data dependencies

- **Dense captures:** `data/wayback/raw-full/` (gitignored, `fetch-wayback.ts`) — 412 ATP + 271 WTA full-Elo
  + 34 ATP + 36 WTA yElo distinct-content captures.
- **Monthly tarball:** `data/wayback/ta-elo-boards-2016-2026.tar.gz` (committed) → `data/wayback/raw/`.
- **Sackmann match CSVs:** `ingest/.cache/elo/` (gitignored; `pnpm backfill-elo` if empty).

## Note

This tooling characterises TA's method; the **shipped** engine (`../historical-elo.ts` + `../elo-config.ts`)
is the older from-scratch reconstruction and has not been migrated to these findings — see
`docs/elo-investigation-findings.md` §0 for the pending corrections.
