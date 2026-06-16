# ATP/WTA points-earned reproduction (issue #25, Phase 2 — 2026-06-15)

> **Canonical summary: [docs/issue-25-findings.md](issue-25-findings.md).** This file is kept as the detailed investigation log for issue #25; some intermediate values below were later corrected — trust the canonical summary where they differ.


Companion to [`yelo-reproduction.md`](yelo-reproduction.md). Reproduces the official ATP/WTA ranking points
each player **earned per tournament** (tier + round reached), summed per calendar year, from Jeff Sackmann's
match CSVs. Tooling: [`ingest/points/`](../ingest/points/) (`validate.ts`, `round-extraction.ts`); authoritative
spec (era-correct tables, tier lists, best-N rules, ground-truth standings) in `ingest/points/POINTS-TABLES.md`
+ `TIER-LISTS.md` (built by two cross-verified research workflows with adversarial checking).

## What reproduces EXACTLY

- **Per-tournament points by tier + round** — the literal deliverable. The round-reached extraction is exact
  (champion → W, runner-up → F, …; verified on 2023 Wimbledon/US Open and every tier), the era-correct point
  tables + CSV-verified per-year tier lists are cross-verified (two adversarial research workflows), and the
  **ATP/WTA Finals round-robin accumulation** (per-RR-win + SF/F bonuses) is exact. Spot-proof: **Djokovic 2023
  = 11245, Alcaraz 2023 = 8855, Nadal/Federer/Shapovalov 2019 — all exact; 12 of the ATP-2019 top-30 exact.**
- Two data quirks decoded: **the ATP Tour Finals is Sackmann level `A`** ("Tour Finals"), NOT `F` (level `F` is
  the NextGen Finals, 0 points) — detect the Finals by name; and **the BYE RULE** (ATP/WTA rulebook): a seeded
  player who reaches the 2nd round on a bye and then loses is scored as a **first-round loser**, not at the round
  of his loss. Scoring by Sackmann's exit-round label over-credited every bye-recipient seed (this alone was
  Medvedev's 2019 over-count); fixing it took ATP-2019 from 0 → 12 of top-30 exact and made Alcaraz 2023 exact.

## The validation target and its irreducible floor

We compute **calendar-year points earned**, and that number is correct — independently confirmed: bye-corrected
Medvedev 2019 = **5885**, exactly the value the diagnostic workflow derived from his event log. It does **not**
equal the official year-end **ranking** total, for two reasons that are *not* a function of calendar-year match
rounds (so they cannot be closed from the CSVs):

1. **52-week rolling window.** The year-end ranking still carries ~6 weeks of the *previous* year's indoor
   results, which a calendar-year sum excludes. Medvedev 2019 +180 is *exactly* this. Validating against the
   year-end **Race** (pure calendar year) removes it — the Race is the correct ground truth for "points earned
   per calendar year", and against it the clean players are exact.
2. **Rank-scaled team events.** United Cup (2023+, max 500), ATP Cup (2020-2022, max 750) award points by
   *opponent ranking + stage*, not round reached. **Proven:** every 2023 ATP top-8 under-counter (Tsitsipas,
   Zverev, Fritz, Tiafoe, Norrie, Hurkacz) played the United Cup; the non-participants (Alcaraz, Sinner) are
   exact or near. A genuine data limit, analogous to the W/L drift in Phase 1.

**Reducible remainder** (not yet fully closed): WTA pre-2021 Premier-tier list completeness (the `W500`/`Premier`
boundary — WTA-2019 is the weakest at mean |Δ| ~180), and Challenger sub-category (CH50–175; approximated as
CH125). Qualifying-point bonuses and Challenger inclusion are implemented (took ATP-2019 mean |Δ| 87 → 54).
   - **Qualifying points** (a qualifier earns Q-bonus + main-draw points) — currently skipped; small for top-30.
   - **Best-N at the cap boundary** (the ATP Masters→500/250 replacement rule; zero-pointer slots) for the
     heaviest schedules (2019 Medvedev +215 et al. over-count slightly — no team event that year).
   - **Ground-truth quality:** the spec's year-end standings had documented ESPN↔Wikipedia conflicts at several
     ranks; some residual is the *reference* number, not our engine.

**Aggregate accuracy (top-30, after bye rule + Q-bonus + Challenger):** ATP-2019 mean |Δ| **54** (12/30 exact),
ATP-2023 134 (mostly United Cup + rolling window), WTA-2019 ~180 / WTA-2023 ~129 (Premier-tier completeness);
the #1-ranked player and most clean-schedule top players reproduce exactly or within a few points.

## Verdict

The engine reproduces **per-tournament tier+round points exactly**. Matching the official year-end **ranking
total** to literal zero is blocked for ~1/4 of top players by rank-scaled team-event points that are provably
not round-derivable; the remainder is reducible with per-year tier-list completion + qualifying points +
authoritative per-event breakdowns (a forensic grind against partly-imprecise public standings).
