# elo-reverse — board-to-board reverse-engineering of TA's Elo

Reverse-engineers Tennis Abstract's (TA) singles Elo **update rule** by replaying TA's own published monthly
boards forward: seed an engine from board(T), apply that window's Sackmann matches, and compare to board(T+1).
No burn-in, no from-scratch reconstruction — board(T) is the ground truth — so each mechanism (K, seed, dock,
inclusion) is isolated directly. This is the method behind `docs/elo-investigation-findings.md` §0; it
reproduces TA month-to-month to median ~3 (ATP) / ~1.4 (WTA) Elo, **byte-exact in clean windows**.

## Run

```bash
pnpm elo:scatter                              # parse boards → build the interactive scatter → open it
npx tsx ingest/elo-reverse/replay.ts ATP --clean   # validate the update rule (per-transition residuals)
npx tsx ingest/elo-reverse/replay.ts ATP --grid    # grid over K numerator / seed
```

The **scatter** (`ingest/elo-reverse/elo-scatter.html`, generated) plots computed (board-replay) vs retrieved
(TA board) per player; hover shows name + both values + discrepancy. Tour / transition / ±debut selectors.

## Files

| File | Role |
|---|---|
| `lib.ts` | loaders (`loadBoards`, `loadMatches`), name↔id join, window/inclusion helpers, re-exports `winProbability`/`kFactor` from `../historical-elo`. `keepForElo` = TA's verified inclusion scope (drops walkovers/RET + sub-$50K ITF). |
| `parse-boards.ts` | parse every archived board → `boards.json` (full depth). Auto-extracts the committed board tarball on first run. |
| `replay.ts` | seeded mini-replay; the decisive validation of the update rule. |
| `scatter.ts` | build the interactive computed-vs-retrieved HTML. |

Generated (gitignored): `boards.json` (~8 MB), `elo-scatter.html`.

## Data dependencies

- **Raw boards:** `data/wayback/raw/` (gitignored), auto-extracted by `parse-boards.ts` from the committed
  tarball `data/wayback/ta-elo-boards-2016-2026.tar.gz`.
- **Sackmann match CSVs:** `ingest/.cache/elo/` (gitignored, re-fetched by the rest of the Elo pipeline — run
  `pnpm backfill-elo` once if the cache is empty).

## Note

This tooling characterises TA's method; the **shipped** engine (`../historical-elo.ts` + `../elo-config.ts`)
is the older from-scratch reconstruction and has not yet been migrated to these findings (seed, walkover/RET
exclusion, discrete-display dock) — see `docs/elo-investigation-findings.md` §0 for the pending corrections.
