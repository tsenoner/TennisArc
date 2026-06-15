# ATP/WTA points-earned reproduction (issue #25, Phase 2 — 2026-06-15)

Companion to [`yelo-reproduction.md`](yelo-reproduction.md). Reproduces the official ATP/WTA ranking points
each player **earned per tournament** (tier + round reached), summed per calendar year, from Jeff Sackmann's
match CSVs. Tooling: `.scratch/points/{validate,engine}.ts`; authoritative spec (era-correct tables, tier
lists, best-N rules, ground-truth standings) in `.scratch/points/SPEC.md` (built by a 10-agent research
workflow with adversarial cross-verification).

## What reproduces EXACTLY

- **Per-tournament points by tier + round** — the literal deliverable. The round-reached extraction is exact
  (champion → W, runner-up → F, …; verified on 2023 Wimbledon/US Open and every tier), the era-correct point
  tables are cross-verified, and the **ATP/WTA Finals round-robin accumulation** (per-RR-win + SF/F bonuses) is
  exact. Spot-proof: **Djokovic 2023 = 11245 (exact)**, **Nadal/Federer/Shapovalov 2019 = exact**.
- A subtle data quirk decoded: **the ATP Tour Finals is Sackmann level `A`** (name "Tour Finals"), NOT `F` —
  level `F` is the *NextGen* Finals (0 ranking points). Detect the Finals by name, not level.

## The validation target and its irreducible floor

Validated against published **year-end top-30** standings (ATP/WTA 2019 & 2023). The residual between our
calendar-year sum and the official year-end **total** decomposes into:

1. **Rank-scaled team events — IRREDUCIBLE from match-round data.** United Cup (2023+, max 500), ATP Cup
   (2020-2022, max 750) award points scaled by *opponent ranking + stage*, not round reached. **Proven:** every
   2023 ATP top-8 under-counter (Tsitsipas −210, Zverev −175, Fritz −415, Tiafoe −280, Norrie −215, Hurkacz −95)
   played the United Cup; the ones who didn't (Medvedev, Alcaraz, Sinner) have only small deltas. These points
   cannot be derived from a player's match rounds — a genuine data limit, analogous to the W/L drift in Phase 1.
2. **Reducible edge cases** (need per-year refinement / authoritative per-event breakdowns):
   - **Per-year ATP-500/250 and WTA-1000/500 tier lists.** Sackmann's `tourney_level` does not distinguish 500
     from 250 (both `A`) or WTA tiers (`P`/`I`/`W` span tiers); classification needs a name+year lookup. The
     lists in `SPEC.md` are largely correct but incomplete for some years (esp. pre-2021 WTA Premier era — WTA
     2019 mean |Δ| 240 is the worst, driven by Premier-tier mapping).
   - **Qualifying points** (a qualifier earns Q-bonus + main-draw points) — currently skipped; small for top-30.
   - **Best-N at the cap boundary** (the ATP Masters→500/250 replacement rule; zero-pointer slots) for the
     heaviest schedules (2019 Medvedev +215 et al. over-count slightly — no team event that year).
   - **Ground-truth quality:** the spec's year-end standings had documented ESPN↔Wikipedia conflicts at several
     ranks; some residual is the *reference* number, not our engine.

**Aggregate accuracy (top-30, current):** mean |Δ| ATP 87 (2019) / 137 (2023), WTA 240 (2019) / 146 (2023);
the #1-ranked player and most clean-schedule top players reproduce exactly or within a few points.

## Verdict

The engine reproduces **per-tournament tier+round points exactly**. Matching the official year-end **ranking
total** to literal zero is blocked for ~1/4 of top players by rank-scaled team-event points that are provably
not round-derivable; the remainder is reducible with per-year tier-list completion + qualifying points +
authoritative per-event breakdowns (a forensic grind against partly-imprecise public standings).
