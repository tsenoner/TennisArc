# points — reproduce ATP/WTA ranking points EARNED per tournament (issue #25, Phase 2)

Reproduces the official ATP/WTA ranking points each player **earned per tournament** (tier + round reached),
summed per calendar year, from Jeff Sackmann's match CSVs. Full write-up: [`docs/points-reproduction.md`](../../docs/points-reproduction.md).

## What's exact

**Per-tournament tier+round points reproduce EXACTLY.** Round-reached extraction is exact (champion→W,
runner-up→F, …; the **bye rule** — a seeded bye-recipient who loses his opener gets first-round points — was
the final fix), the **Finals round-robin accumulation** is exact, and the era-correct tables + CSV-verified
per-year tier lists are cross-verified (two adversarial research workflows). Proof points: **Djokovic 2023 =
11245, Alcaraz 2023 = 8855, Nadal/Federer 2019 — all exact; 12 of the ATP-2019 top-30 exact.**

## The irreducible floor (vs official year-end RANKING)

Our calendar-year sum is correct (Medvedev 2019 = 5885, independently confirmed). It does **not** equal the
official year-end *ranking* total for two provable reasons, neither a function of calendar-year match rounds:
1. **52-week rolling window** — the year-end ranking still carries ~6 weeks of the *prior* year's indoor
   results (Medvedev 2019: +180 = exactly this). Validating against the year-end **Race** (pure calendar year)
   removes it.
2. **Rank-scaled team events** — United Cup (2023+, ≤500) and ATP Cup (2020-2022, ≤750) award points by
   opponent rank + stage. Every 2023 ATP top-8 under-counter played the United Cup.

Reducible remainder (not yet fully closed): WTA pre-2021 Premier-tier list completeness (the `W500`/`Premier`
boundary), and Challenger sub-category (CH50–175; we approximate as CH125).

## Run

```bash
npx tsx ingest/points/validate.ts ATP 2023            # top-30 computed vs official year-end
npx tsx ingest/points/validate.ts ATP 2019 30 --p="Daniil Medvedev"   # one player's event breakdown
npx tsx ingest/points/round-extraction.ts ATP 2023 "Wimbledon"        # verify round-reached mechanics
```

## Files

| File | Role |
|---|---|
| `validate.ts` | tier classification + era tables + bye rule + qualifying bonus + best-N; validates vs `ground-truth.json` |
| `round-extraction.ts` | the table-independent round-reached core (mechanics check) |
| `ground-truth.json` | published year-end top-30 (ATP/WTA 2019 & 2023) |
| `POINTS-TABLES.md` | era-correct per-round point tables (both tours), counting rules, ground truth |
| `TIER-LISTS.md` | CSV-verified per-year ATP-500 / WTA-tier name lists, qualifying tables, diagnosed residuals |
