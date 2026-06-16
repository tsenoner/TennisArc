import { RET_ELO_ERA_START, type EloConfig, type LayoffDock } from "./historical-elo";

// Per-tour entrant seeding for the TA-calibrated engine. A player's seed depends on their DEBUT level:
// Challenger (level "C") or a qualifying round (round "Q*") seeds at `seedSub` (TA's "low 1200s"),
// everyone else at `seedTour`. Tennis Abstract's true seed values are unpublished and level/gender-
// dependent, so these are EMPIRICALLY FITTED by ingest/calibrate-elo.ts: run our engine to "today" over
// the full match set and grid-search the seeds to minimize median |overall error| vs the live TA board.
//
// INJURY/ABSENCE DOCK (re-instated 2026-06-15 after verification — see docs/elo-investigation-findings.md
// §5). TA's published board ALREADY docks a currently-absent player: ~100 Elo at 8 active-season weeks
// out, rising to ~150 at ~1 year, but ONLY for players who were rated >= 1900 (Sackmann tuned the curve
// on that cohort). Verbatim proof it is a DISPLAY-time, normally-on component: the penalties "bring down
// the current Elo ratings of the players who are in the middle of long breaks ... giving us ranking
// tables that come closer to what we expect"; during COVID he had to explicitly *suspend* "that penalty"
// board-wide. The dock is IDENTICAL for ATP and WTA (one curve carried to both — NO per-gender scale; an
// earlier per-gender knob was the unprincipled mistake that got the dock wrongly removed). The >=1900
// gate is the piece the earlier removed build lacked — without it the dock wrongly hit sub-1900 players
// TA leaves un-docked, which is what made docking "hurt WTA" by mean. We evaluate by per-player residual
// / median, NEVER by the absent-tail-dominated mean.
//
// Fitted 2026-06-15 vs the live TA board (full 1968+ history, dominant-id join, dock ON, top-50 TA):
//   ATP seedTour=1450 seedSub=1130 -> overall meanAbs 15.4 (median -3), hard 17, clay 20, grass 96
//   WTA seedTour=1350 seedSub=1050 -> overall meanAbs 11.1 (median +2), hard 11, clay 15, grass 60
// The dock cut ATP meanAbs ~21->15 and removed the absent-player outliers (Alcaraz/Korda now ~+-10).
// Most players match within ~5-7 Elo. After the dock the largest residuals are currently-ACTIVE injury
// returnees (Djokovic +114, Fritz +100, Anisimova +112, Zheng +95) depressed by TA's SEPARATE on-return
// K-multiplier (x1.5->x1 over 20 matches) — a path-dependent schedule an extraction-time dock cannot
// reproduce (a bounded, documented limitation, NOT a dock-parameter problem; see findings §9/§11). The
// one >=1900 WTA absentee the curve touches (Vondrousova) is over-docked ~65 — accepted as the N=1 cost
// of carrying TA's single curve to the WTA board (a per-gender knob would be overfitting). Byte-exact is
// impossible (TA's code/seed unpublished).
export const TA_LAYOFF_DOCK: LayoffDock = {
  triggerDays: 56, // ~8 active-season weeks
  minPenalty: 100, // Elo dock at the trigger (Sackmann: "eight-week break ... drop of 100 Elo points")
  maxPenalty: 150, // Elo dock at >= maxDays (Sackmann: "not-quite-one-year break ... drop of 150 points")
  maxDays: 365, // active-season days at which the dock plateaus
  ratingFloor: 1900, // dock only players rated >= this pre-layoff (Sackmann's tuning cohort)
  recoveryMatches: 20, // boosted-K window after a return (Sackmann: "back to 1x over the next 20 matches")
  recoveryMult: 1.5, // peak K-multiplier on the first match back (Sackmann: "increase ... by a factor of 1.5")
  comebackResetYears: 2, // serial layoffs within 2yr of the last comeback combine (Sackmann's verbatim rule)
  suspendFrom: 20200301, // COVID shutdown — Sackmann suspended the absence penalty board-wide (2021-03-08)
  suspendTo: 20211231, // "until things are a bit more normal" — the disrupted 2020-2021 seasons
};

export const seedConfig = (seedTour: number, seedSub: number): EloConfig => ({
  seedFor: (level, round) => (level === "C" || /^Q/.test(round) ? seedSub : seedTour),
  dock: TA_LAYOFF_DOCK,
  retEraStart: RET_ELO_ERA_START, // era-gate retirements (transferred from the yElo reverse-engineering)
});

// Re-fitted 2026-06-15 after transferring the yElo learnings — PLAY-ORDER replay (round-within-event sort),
// the full reverse-engineered SCOPE (drop walkovers + sub-$50K ITF + WTA-125 feed de-dup), and era-gated
// retirements. Re-fit vs TA's published board (boards.json 20260504, top-50, dock ON): ATP 1400/1200 ->
// overall meanAbs 5.6 (median 3.4, hard 10 clay 9), a ~3x improvement over the pre-transfer 15.4; WTA
// 1350/1130 -> meanAbs 13.5 (hard 8 clay 11). The tour/sub SPLIT survives the re-fit (single-seed is far
// worse — 141 ATP), but play order shifts the optimum lower (1400 vs the old 1550). See docs/elo-investigation-findings.md.
export const ATP_ELO_CONFIG: EloConfig = seedConfig(1400, 1200);
export const WTA_ELO_CONFIG: EloConfig = seedConfig(1350, 1130);
