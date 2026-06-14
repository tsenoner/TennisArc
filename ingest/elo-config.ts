import type { EloConfig } from "./historical-elo";

// Per-tour entrant seeding for the TA-calibrated engine. A player's seed depends on their DEBUT level:
// Challenger (level "C") or a qualifying round (round "Q*") seeds at `seedSub` (TA's "low 1200s"),
// everyone else at `seedTour`. Tennis Abstract's true seed values are unpublished and level/gender-
// dependent, so these are EMPIRICALLY FITTED by ingest/calibrate-elo.ts: run our engine to "today" over
// the full match set and grid-search the seeds to minimize median |overall error| vs the live TA board.
//
// `layoffScale` toggles the injury/absence dock (see historical-elo.ts). The dock METHOD is identical
// for both tours, but it needs reliable recent-activity data. ATP 2026 data is complete, so the dock
// correctly corrects genuine absentees (Alcaraz/Draper, who skipped Roland Garros) — overall meanAbs
// 20.1 -> 14.5. But Sackmann's 2026 WTA file is materially INCOMPLETE (several top-40 players missing
// months — verified: Kudermetova has 0 matches, Kartal/Vondrousova missing the clay season), so the dock
// false-fires on WTA players who are actually active and makes WTA WORSE (10.0 -> 16.5). So we dock ATP
// (1.0) and NOT WTA (0). This is a DATA-completeness difference, NOT a methodology/magnitude one — there
// is no research basis for a per-gender dock magnitude.
//
// Fitted 2026-06-14 vs TA as-of 2026-06-08, dominant-id join, top-50 TA players:
//   ATP seedTour=1500 seedSub=1170 dock=on  -> overall 14.5 (median -1.7), hard 19, clay 18, grass 75
//   WTA seedTour=1400 seedSub=1090 dock=off -> overall 10.0 (median +1.8), hard 19, clay 19, grass 37
// Most players match within ~5-7 Elo. The largest residuals are players with injury-interrupted careers
// (TA docks each past injury; we can't distinguish injury from a sparse schedule without TA's injury
// list) and ATP thin-grass samples. Byte-exact is impossible (TA's code/ratings/seed/penalty unpublished);
// see docs/elo-methodology.md.
export const seedConfig = (seedTour: number, seedSub: number, layoffScale = 1): EloConfig => ({
  seedFor: (level, round) => (level === "C" || /^Q/.test(round) ? seedSub : seedTour),
  layoffScale,
});

export const ATP_ELO_CONFIG: EloConfig = seedConfig(1500, 1170, 1.0);
export const WTA_ELO_CONFIG: EloConfig = seedConfig(1400, 1090, 0);
