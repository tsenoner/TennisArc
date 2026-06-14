import type { EloConfig } from "./historical-elo";

// Per-tour entrant seeding for the TA-calibrated engine. A player's seed depends on their DEBUT level:
// Challenger (level "C") or a qualifying round (round "Q*") seeds at `seedSub` (TA's "low 1200s"),
// everyone else at `seedTour`. Tennis Abstract's true seed values are unpublished and level/gender-
// dependent, so these are EMPIRICALLY FITTED by ingest/calibrate-elo.ts: run our engine to "today" over
// the full match set and grid-search the seeds to minimize median |overall error| vs the live TA board.
//
// NO injury/absence dock: research (TA's 2018 + 2025 posts) confirmed TA publishes a currently-absent
// player's FROZEN, UN-DOCKED last value — it docks only ON RETURN (to forecast comeback matches), which a
// gap-based model can't replicate without deflating the whole pool. So docking absent players (which we
// briefly tried) is wrong for matching TA's published board; we show the frozen value, like TA.
//
// Fitted 2026-06-14 vs TA as-of 2026-06-08, dominant-id join, top-50 TA players:
//   ATP seedTour=1500 seedSub=1170 -> overall meanAbs ~20 (median ~-2), hard ~22, clay ~21, grass ~75
//   WTA seedTour=1400 seedSub=1090 -> overall meanAbs ~10 (median ~+2), hard ~19, clay ~19, grass ~37
// Most players match within ~5-7 Elo. The largest residuals are players with injury-interrupted careers
// (TA bakes per-injury docks applied on each return into its history; we can't — a bounded, documented
// limitation) and ATP thin-grass samples. Our historical freezes also run ~130 low in 2016-2017 (history
// starts 2000, less burn-in than TA's 1968) converging by ~2019. Byte-exact is impossible (TA's
// code/ratings/seed/penalty unpublished); see docs/elo-methodology.md.
export const seedConfig = (seedTour: number, seedSub: number): EloConfig => ({
  seedFor: (level, round) => (level === "C" || /^Q/.test(round) ? seedSub : seedTour),
});

export const ATP_ELO_CONFIG: EloConfig = seedConfig(1500, 1170);
export const WTA_ELO_CONFIG: EloConfig = seedConfig(1400, 1090);
