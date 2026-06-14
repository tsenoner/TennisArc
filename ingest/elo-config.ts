import type { EloConfig } from "./historical-elo";

// Per-tour entrant seeding for the TA-calibrated engine. A player's seed depends on their DEBUT level:
// Challenger (level "C") or a qualifying round (round "Q*") seeds at `seedSub` (TA's "low 1200s"),
// everyone else at `seedTour`. The exact values are FITTED by ingest/calibrate-elo.ts against the live
// Tennis Abstract board and frozen here. The values below are PLACEHOLDERS pending that fit run.
export const seedConfig = (seedTour: number, seedSub: number): EloConfig => ({
  seedFor: (level, round) => (level === "C" || /^Q/.test(round) ? seedSub : seedTour),
});

export const ATP_ELO_CONFIG: EloConfig = seedConfig(1500, 1230); // PLACEHOLDER — fit pending
export const WTA_ELO_CONFIG: EloConfig = seedConfig(1500, 1230); // PLACEHOLDER — fit pending
