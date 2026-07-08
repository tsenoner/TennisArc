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
npx tsx ingest/points/engine.ts ATP 2016             # any season top-30 computed vs official (generalized)
npx tsx ingest/points/engine.ts WTA 2019 --p="Ashleigh Barty"   # one player's event breakdown
npx tsx ingest/points/engine.ts --emit               # write points-data.json for the dashboard (all seasons)
npx tsx ingest/points/engine.ts --check              # known-answer gate (ATP 2019 ≥12/30, Djokovic 2023 exact)
npx tsx ingest/points/validate.ts ATP 2023           # (original) hardcoded-2019/2023 validator
```

`engine.ts` generalizes `validate.ts` to EVERY repo-scope season (ATP 2009-2025, WTA 2015-2025): it loads the
per-era point tables, the ordered tier ruleset, the per-year tier lists and the best-N rules straight from the
spec docs' `json` blocks (single source of truth) and resolves them by season. Ground truth covers all 28
seasons (curated 2019/2023 + 24 sourced & adversarially verified via a research workflow). ATP clean years hit
13-20/30 exact; COVID years (ATP 2020-22 / WTA 2020-21, frozen multi-season rankings) and team-event years
(2023+) carry the documented floor; WTA's best-others cap reproduces only approximately. Each season's diagnostic
note ships in `points-data.json`.

## Files

| File | Role |
|---|---|
| `engine.ts` | **generalized** points engine — all seasons, spec-driven tables/tiers, `--emit`/`--check`/per-player |
| `validate.ts` | original hardcoded-2019/2023 validator (kept; the known-answer baseline) |
| `ground-truth.json` | published year-end top-30 — ATP 2009-2025 + WTA 2015-2025 (28 seasons); `_meta.provenance` flags source |
| `POINTS-TABLES.md` | era-correct per-round point tables (both tours), counting rules, ground truth |
| `TIER-LISTS.md` | CSV-verified per-year ATP-500 / WTA-tier name lists, qualifying tables, diagnosed residuals |
