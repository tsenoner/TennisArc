import type { EloConfig } from "./historical-elo";

// Per-tour entrant seeding for the TA-calibrated engine. A player's seed depends on their DEBUT level:
// Challenger (level "C") or a qualifying round (round "Q*") seeds at `seedSub` (TA's "low 1200s"),
// everyone else at `seedTour`. Tennis Abstract's true seed values are unpublished and level/gender-
// dependent, so these are EMPIRICALLY FITTED by ingest/calibrate-elo.ts: run our engine to "today" over
// the full match set and grid-search the seeds to minimize median |overall error| vs the live TA board.
//
// Fitted 2026-06-14 vs TA as-of 2026-06-08, Sackmann tour + qual/challenger (ATP) / ITF>=$50K (WTA),
// 2000+, top-50 TA players. Achieved (overall / hard / clay / grass meanAbs Elo):
//   ATP seedTour=1500 seedSub=1170 -> overall 32 (median -1.2), hard 37, clay 35, grass 77
//   WTA seedTour=1450 seedSub=1090 -> overall 11 (median +2.5), hard 21, clay 19, grass 34
// ATP's seedTour lands exactly on TA's documented tour-level tradition (1500); WTA seeds lower, matching
// TA's "depends a bit on tournament level and gender" note. Grass (ATP) is the weakest surface — thin
// samples + an unmodeled injury/absence penalty + our 2000 (not 1968) history start. Byte-exact is
// impossible (TA's code/ratings/seed/penalty are unpublished); see docs/superpowers/plans + RESEARCH.md.
export const seedConfig = (seedTour: number, seedSub: number): EloConfig => ({
  seedFor: (level, round) => (level === "C" || /^Q/.test(round) ? seedSub : seedTour),
});

export const ATP_ELO_CONFIG: EloConfig = seedConfig(1500, 1170);
export const WTA_ELO_CONFIG: EloConfig = seedConfig(1450, 1090);
