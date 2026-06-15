import type { Player, PlayerElo } from "../src/model";
import { fullKey, sigKey } from "./names";

// Surface-aware Elo computed from Jeff Sackmann's FULL match history (every event per tour, not just
// slams). Ratings are frozen at each slam's start date, then joined into the snapshot players' `elo`
// (overall + per-surface). A Python prototype confirmed acceptance: frozen at Roland-Garros 2016
// start, Djokovic is #1 overall and #1 clay, Nadal #2 clay.
//
// Why not reuse ingest/elo.ts: that module scrapes Tennis Abstract's *current* ratings, which can't
// be rewound to a historical event. This recomputes ratings deterministically from raw results so a
// 2016 snapshot shows 2016 Elo, not today's.

/**
 * Tunable entrant seeding. `seedFor(level, round)` returns the starting rating for a player's first-ever
 * appearance, given the level (tourney_level) and round of that debut match. Tennis Abstract seeds new
 * entrants below 1500 (a "low 1200s" value that depends on debut level) — and rates qualifying-round
 * debutants lower than main-draw debutants, so BOTH level and round are exposed to match that
 * granularity. The default keeps 1500 for every debut, so nothing changes until a config is passed.
 */
export interface EloConfig {
  seedFor: (level: string, round: string) => number;
  /** Injury/absence dock applied at rating-extraction time (see {@link LayoffDock}). Omit for no dock. */
  dock?: LayoffDock;
  /** Era-gate retirements (see {@link RET_ELO_ERA_START}): when set, a replay whose cutoff is BEFORE this
   *  date skips retirement results (TA only began counting RET at the spring-2025 recompute). Omit to count
   *  retirements always (legacy behaviour). */
  retEraStart?: number;
}

export const DEFAULT_ELO_CONFIG: EloConfig = { seedFor: () => 1500 };

/**
 * Tennis Abstract's injury/absence penalty ("Handling Injuries and Absences with Tennis Elo", 2018-05-15).
 * A player inactive for >= ~8 competitive-season weeks is docked ON THE PUBLISHED BOARD — ~100 Elo at 8
 * weeks rising toward ~150 at ~1 year — but ONLY if their pre-layoff rating was >= `ratingFloor` (Sackmann
 * tuned the curve on layoffs by players rated >= 1900; below it he does not dock). We apply this at rating-
 * EXTRACTION time, because TA's published number for a CURRENTLY-absent player already reflects it. Verbatim:
 * the penalties "end up bringing down the current Elo ratings of the players who are in the middle of long
 * breaks ... giving us ranking tables that come closer to what we expect" — and during COVID he had to
 * explicitly *suspend* "that penalty" board-wide (2021-03-08), which proves it is normally ON the board.
 * IMPLEMENTED FAITHFULLY (verified against Sackmann's text + a month-by-month reconstruction):
 *  • ON RETURN, in the replay, we DOCK THE STATE and open a boosted-K recovery window (K ×`recoveryMult`
 *    decaying linearly to ×1 over `recoveryMatches` matches). Recovery is therefore via RESULTS (winning),
 *    not an automatic time-decay — a returnee who keeps losing stays docked, exactly as TA's board shows
 *    (Zheng/Hurkacz sat docked all season; an auto-decay overlay wrongly let them drift back up).
 *  • COMBINE-AND-DIFFERENTIAL for serial layoffs (verbatim: "if the second layoff is within two years of
 *    the previous comeback, combine the length of the two layoffs, find the penalty for that combined
 *    length, and apply the difference"). We track the cluster's combined active-layoff days + the dock
 *    already charged, and at each return charge only `curve(combinedDays) − alreadyCharged`. This BOUNDS a
 *    multi-gap veteran near the −150 ceiling instead of stacking a fresh −100 per gap (the bug that dragged
 *    Djokovic ~100 too low). Clusters reset after `comebackResetYears` clean years.
 *  • A still-open trailing gap (a player absent right now, not yet returned) extends the cluster at
 *    EXTRACTION: it docks `curve(combinedDays + openGap) − alreadyCharged` on the output.
 * Gated on the pre-dock rating >=`ratingFloor` so only the elite cohort TA docks is touched (an ungated
 * dock deflates the pool ~−820). IDENTICAL for ATP and WTA. The 100/150 endpoints, the ≥1900 gate, the
 * 20-match recovery and the 2-year combine window are Sackmann's; the linear curve shape between the
 * endpoints is our only assumption. NOTE active-season counting means a true ~1-calendar-year layoff
 * (~242 active days) reaches ~130, not 150 — a deliberate consequence of excluding the offseason.
 */
export interface LayoffDock {
  triggerDays: number; // active-season days before a gap counts as a layoff (~8 weeks = 56)
  minPenalty: number; // dock at the trigger (100)
  maxPenalty: number; // dock at >= maxDays (150)
  maxDays: number; // active-season days at which the dock plateaus (365)
  ratingFloor: number; // only dock players whose pre-dock rating >= this (1900)
  recoveryMatches: number; // boosted-K window after a return (Sackmann: 20)
  recoveryMult: number; // peak K-multiplier on the first match back (Sackmann: 1.5), decays linearly to 1
  comebackResetYears: number; // a layoff within this many years of the last comeback combines with it (2)
  // COVID-19 suspension: Sackmann SUSPENDED the absence penalty board-wide during the pandemic
  // (2021-03-08: "Because the pandemic caused all sorts of absences for all sorts of reasons, I've
  // suspended that penalty until things are a bit more normal."). Within [suspendFrom, suspendTo] we apply
  // no dock — a comeback in the window charges nothing, and a board in the window shows un-docked values.
  suspendFrom?: number; // YYYYMMDD inclusive (omit to never suspend)
  suspendTo?: number; // YYYYMMDD inclusive
}

/** True if `date` falls inside the dock's COVID suspension window. */
function dockSuspended(dock: LayoffDock, date: number): boolean {
  return dock.suspendFrom !== undefined && date >= dock.suspendFrom && date <= (dock.suspendTo ?? dock.suspendFrom);
}

/** Logistic Elo expectation for A beating B. winProbability(r,r) === 0.5, monotonic in (rA - rB). */
export function winProbability(rA: number, rB: number): number {
  return 1 / (1 + 10 ** ((rB - rA) / 400));
}

/** Dynamic K-factor: 250/(priorMatches+5)^0.4 — large when a player is new, shrinking as they settle. */
export function kFactor(priorMatches: number): number {
  return 250 / (priorMatches + 5) ** 0.4;
}

/** YYYYMMDD -> integer UTC day number, for layoff gap arithmetic. */
const dayNumber = (yyyymmdd: number): number =>
  Math.round(Date.UTC(Math.floor(yyyymmdd / 10000), (Math.floor(yyyymmdd / 100) % 100) - 1, yyyymmdd % 100) / 86_400_000);

/**
 * Competitive-season days a player has been inactive between `lastDate` and `asOf`, counting only the part
 * of each year's ~Feb 1 – Oct 1 window. Sackmann: "the eight-week threshold doesn't count the offseason,
 * so an eight-week layoff might really mean ~16 weeks between events." This treats the winter off-season
 * (and a player's own early end / late start to a season) as normal, so only genuine mid-season or
 * multi-month absences accrue toward the trigger. Returns 0 for an absurd `asOf` (all-rows sentinel) so
 * callers can stay date-agnostic.
 */
export function activeLayoffDays(lastDate: number, asOf: number): number {
  if (lastDate === 0 || asOf > 30_000_000 || asOf <= lastDate) return 0;
  const last = dayNumber(lastDate);
  const cur = dayNumber(asOf);
  let active = 0;
  for (let y = Math.floor(lastDate / 10000); y <= Math.floor(asOf / 10000); y++) {
    const seasonStart = Math.round(Date.UTC(y, 1, 1) / 86_400_000); // Feb 1
    const seasonEnd = Math.round(Date.UTC(y, 9, 1) / 86_400_000); // Oct 1
    active += Math.max(0, Math.min(cur, seasonEnd) - Math.max(last, seasonStart));
  }
  return active;
}

/** The raw dock curve for a (combined) layoff of `days` active-season days: minPenalty at the trigger,
 *  rising linearly to maxPenalty at maxDays, clamped both ends. No rating/trigger gate — callers gate. */
export function layoffCurve(dock: LayoffDock, days: number): number {
  const t = Math.min(1, Math.max(0, (days - dock.triggerDays) / (dock.maxDays - dock.triggerDays)));
  return dock.minPenalty + (dock.maxPenalty - dock.minPenalty) * t;
}

/** Elo dock for `activeDays` of competitive-season inactivity given a player's pre-dock `rating`. Zero
 *  below the ~8-week trigger OR below the rating floor (TA docks only players who were rated ~1900+).
 *  This is the SINGLE-layoff form; serial layoffs use the combine-and-differential logic in the engine. */
export function layoffPenalty(dock: LayoffDock, activeDays: number, rating: number): number {
  if (rating < dock.ratingFloor || activeDays < dock.triggerDays) return 0;
  return layoffCurve(dock, activeDays);
}

/**
 * Tennis Abstract's surface Elo is a flat 50/50 blend of overall and a pure single-surface rating
 * (TA report page + Heavy Topspin 2017/2019: "50/50 worked for each surface"), applied at ALL sample
 * sizes. `surfaceCount === 0` means the player has never played the surface -> no signal -> null.
 */
export function resolveSurfaceElo(
  surfaceRating: number,
  surfaceCount: number,
  overall: number,
): number | null {
  if (surfaceCount === 0) return null;
  return 0.5 * overall + 0.5 * surfaceRating;
}

export type EloSurface = "Hard" | "Clay" | "Grass";

export interface EloMatchRow {
  tourneyName: string;
  tourneyDate: number; // YYYYMMDD as a number, e.g. 20160523
  surface: EloSurface | null;
  winnerId: string;
  loserId: string;
  winnerName: string;
  loserName: string;
  round: string;
  level: string; // tourney_level (G grand slam, D Davis/team, F finals, M/A/etc.)
  score?: string; // raw score; used for walkover/retirement scope (omit-safe: treated as "games played")
}

const SURFACES: Record<string, EloSurface> = { Hard: "Hard", Clay: "Clay", Grass: "Grass" };

// TA's verified full-board inclusion scope, reverse-engineered from TA's own boards (docs/yelo-reproduction.md,
// docs/elo-investigation-findings.md). These mirror ingest/elo-reverse/lib.ts so the production engine and the
// reverse-engineering tooling share one definition.

/** TA began counting RETIREMENTS in the full board at a one-time spring-2025 recompute (retroactive): a board
 *  frozen on/after this date counts RET for the WHOLE history; an earlier board excludes it. Walkovers are never
 *  counted. So RET inclusion is decided by the SNAPSHOT (cutoff) date, not the match date. */
export const RET_ELO_ERA_START = 20250418;
const isRetirementRow = (r: EloMatchRow): boolean => !!r.score && /\d/.test(r.score) && /\b(RET|DEF|ABD)\b/i.test(r.score);

/** Keep a row in the rating replay: drop pure WALKOVERS (no games played — "W/O"/"Walkover"/empty score) and
 *  sub-$50K ITF (numeric tourney_level < 50). Everything contested at tour / Challenger / ITF-$50K+ stays.
 *  A row with no score (hand-built/test) is treated as played. Retirements are kept HERE (era-gated at replay). */
export function keepForEloRow(r: EloMatchRow): boolean {
  if (r.score !== undefined && !/\d/.test(r.score)) return false; // walkover / no games played
  const n = /^(\d+)/.exec(r.level)?.[1];
  if (n && Number(n) < 50) return false; // sub-$50K ITF
  return true;
}

/** Drop exact-duplicate feed rows (Sackmann's WTA qualifying/Challenger feed re-lists every WTA-125 match
 *  twice). Keyed on date|round|winner|loser|score — a pair never legitimately collides on that key. */
export function dedupeEloRows(rows: EloMatchRow[]): EloMatchRow[] {
  const seen = new Set<string>();
  return rows.filter((m) => {
    const k = `${m.tourneyDate}|${m.round}|${m.winnerId}|${m.loserId}|${m.score ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Parse a Sackmann yearly matches CSV into Elo rows. Header-index lookup; the bare-`,` split is safe
 * for Sackmann's quote-free schema. Rows with an empty winner/loser id or a non-numeric tourney_date
 * are skipped (can't be played into the engine). Unknown/empty surface maps to null (overall-only).
 */
export function parseEloMatchesCsv(
  csv: string,
  keepLevel: (level: string) => boolean = () => true,
): EloMatchRow[] {
  const lines = csv.split(/\r?\n/);
  const header = lines[0]?.split(",") ?? [];
  const col = (n: string): number => header.indexOf(n);
  const iName = col("tourney_name");
  const iSurf = col("surface");
  const iDate = col("tourney_date");
  const iWid = col("winner_id");
  const iLid = col("loser_id");
  const iWname = col("winner_name");
  const iLname = col("loser_name");
  const iRound = col("round");
  const iLevel = col("tourney_level");
  const iScore = col("score");
  if ([iName, iDate, iWid, iLid, iWname, iLname, iRound, iLevel].includes(-1)) return [];

  const out: EloMatchRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = line.split(",");
    const winnerId = cols[iWid] ?? "";
    const loserId = cols[iLid] ?? "";
    if (!winnerId || !loserId) continue;
    const date = Number(cols[iDate]);
    if (!Number.isFinite(date) || !cols[iDate]) continue;
    const level = cols[iLevel] ?? "";
    if (!keepLevel(level)) continue;
    out.push({
      tourneyName: cols[iName] ?? "",
      tourneyDate: date,
      surface: SURFACES[cols[iSurf] ?? ""] ?? null,
      winnerId,
      loserId,
      winnerName: cols[iWname] ?? "",
      loserName: cols[iLname] ?? "",
      round: cols[iRound] ?? "",
      level,
      score: iScore === -1 ? "" : cols[iScore] ?? "",
    });
  }
  return out;
}

interface RatingState {
  overall: number;
  overallN: number;
  hard: number;
  hardN: number;
  clay: number;
  clayN: number;
  grass: number;
  grassN: number;
  name: string;
  lastDate: number; // YYYYMMDD of the player's most recent match (0 until first) — for the layoff dock
  recoveryLeft: number; // matches remaining in the boosted-K post-return window (0 = normal)
  clusterDays: number; // combined active-layoff days in the current cluster (combine-and-differential)
  clusterDock: number; // total Elo already docked in this cluster
  lastComeback: number; // YYYYMMDD of the last qualifying return (for the comeback-reset window)
}

const freshState = (name: string, seed: number): RatingState => ({
  overall: seed,
  overallN: 0,
  hard: seed,
  hardN: 0,
  clay: seed,
  clayN: 0,
  grass: seed,
  grassN: 0,
  name,
  lastDate: 0,
  recoveryLeft: 0,
  clusterDays: 0,
  clusterDock: 0,
  lastComeback: 0,
});

/**
 * Incremental surface-aware Elo. Each `update(row)` applies an overall update to both players (each
 * side using its OWN dynamic K from its own prior count) and, if the surface is known, a separate
 * same-surface update with separate per-surface counts. Walkovers/retirements are real results —
 * Sackmann lists a winner, so they move ratings like any other win. The optional `config` controls how
 * a new entrant's seed is assigned on first appearance (default: 1500 for every debut).
 */
export class EloEngine {
  readonly players = new Map<string, RatingState>();

  constructor(private readonly config: EloConfig = DEFAULT_ELO_CONFIG) {}

  private state(id: string, name: string, level: string, round: string): RatingState {
    let s = this.players.get(id);
    if (!s) {
      s = freshState(name, this.config.seedFor(level, round));
      this.players.set(id, s);
    } else if (name && !s.name) {
      s.name = name;
    }
    return s;
  }

  update(row: EloMatchRow): void {
    const w = this.state(row.winnerId, row.winnerName, row.level, row.round);
    const l = this.state(row.loserId, row.loserName, row.level, row.round);

    // On-return injury dock (combine-and-differential): dock the STATE and open a boosted-K window.
    this.detectReturn(w, row.tourneyDate);
    this.detectReturn(l, row.tourneyDate);
    const mW = this.recoveryMult(w);
    const mL = this.recoveryMult(l);

    // Overall: symmetric update, each side with its own K from its own prior count (× recovery boost).
    const eW = winProbability(w.overall, l.overall);
    const kW = kFactor(w.overallN) * mW;
    const kL = kFactor(l.overallN) * mL;
    w.overall += kW * (1 - eW);
    l.overall += kL * (0 - (1 - eW)); // expectation for the loser is (1 - eW)
    w.overallN += 1;
    l.overallN += 1;

    const surf = row.surface;
    if (surf === "Hard") this.surfaceUpdate(w, l, "hard", "hardN", mW, mL);
    else if (surf === "Clay") this.surfaceUpdate(w, l, "clay", "clayN", mW, mL);
    else if (surf === "Grass") this.surfaceUpdate(w, l, "grass", "grassN", mW, mL);
    // Unknown/empty surface: overall-only (already applied above).

    // Count this match toward each side's recovery window, then record activity for the extraction dock.
    if (w.recoveryLeft > 0) w.recoveryLeft -= 1;
    if (l.recoveryLeft > 0) l.recoveryLeft -= 1;
    w.lastDate = row.tourneyDate;
    l.lastDate = row.tourneyDate;
  }

  /** On a return from a >= trigger active-season gap by a player whose pre-dock rating is >= ratingFloor,
   *  dock the STATE by the COMBINE-AND-DIFFERENTIAL amount and open a boosted-K recovery window. Serial
   *  layoffs within `comebackResetYears` of the last comeback combine: we charge only
   *  `curve(combinedDays) − alreadyCharged`, bounding the cluster near the −maxPenalty ceiling instead of
   *  stacking a fresh penalty per gap. No-op without a dock config, on a debut, or below trigger/floor. */
  private detectReturn(s: RatingState, date: number): void {
    const dock = this.config.dock;
    if (!dock || s.lastDate === 0) return;
    if (dockSuspended(dock, date)) return; // COVID: no penalty for pandemic-era comebacks
    const gap = activeLayoffDays(s.lastDate, date);
    if (gap < dock.triggerDays) return; // routine play, not a layoff
    // Gate: dock only a player who was ~elite (>=ratingFloor) pre-layoff. We use `overall + clusterDock`
    // (the rating with this cluster's docks added back). KNOWN LATENT IMPRECISION (verified): once results-
    // recovery has won points back, clusterDock is frozen while overall climbs, so this slightly OVER-states
    // the true level — but empirically that errs in the SAFE direction (it keeps borderline ~1900 players,
    // e.g. Kartal, on the right side of the gate to match TA). Gating on raw s.overall instead wrongly docks
    // declined ex-elites and destabilises the fit; an exact fix needs a separate undocked track (not worth
    // it — the failure modes are off-board). See docs/elo-investigation-findings.md §9.
    const preDockRating = s.overall + s.clusterDock;
    if (preDockRating < dock.ratingFloor) return;
    // A layoff long after the last comeback starts a fresh cluster (clean-recovery reset).
    if (s.lastComeback !== 0 && yearsBetween(s.lastComeback, date) > dock.comebackResetYears) {
      s.clusterDays = 0;
      s.clusterDock = 0;
    }
    s.clusterDays += gap;
    s.lastComeback = date;
    const differential = layoffCurve(dock, s.clusterDays) - s.clusterDock;
    if (differential <= 0) return; // combined penalty already fully charged
    s.overall -= differential;
    s.hard -= differential;
    s.clay -= differential;
    s.grass -= differential;
    s.clusterDock += differential;
    s.recoveryLeft = dock.recoveryMatches;
  }

  /** K multiplier for a player inside the post-return window: decays linearly from `recoveryMult` (first
   *  match back) to 1 over `recoveryMatches` matches; 1 outside the window. */
  private recoveryMult(s: RatingState): number {
    const dock = this.config.dock;
    if (!dock || s.recoveryLeft <= 0) return 1;
    return 1 + (dock.recoveryMult - 1) * (s.recoveryLeft / dock.recoveryMatches);
  }

  private surfaceUpdate(
    w: RatingState,
    l: RatingState,
    rk: "hard" | "clay" | "grass",
    nk: "hardN" | "clayN" | "grassN",
    mW = 1,
    mL = 1,
  ): void {
    const eW = winProbability(w[rk], l[rk]);
    const kW = kFactor(w[nk]) * mW;
    const kL = kFactor(l[nk]) * mL;
    w[rk] += kW * (1 - eW);
    l[rk] += kL * (0 - (1 - eW));
    w[nk] += 1;
    l[nk] += 1;
  }
}

/** Whole-and-fractional years between two YYYYMMDD dates (for the comeback-combine window). */
function yearsBetween(from: number, to: number): number {
  return (dayNumber(to) - dayNumber(from)) / 365.25;
}

/** The OUTPUT dock for a player who is absent RIGHT NOW (open trailing gap, not yet returned): the open
 *  gap extends the current cluster, so we charge `curve(clusterDays + openGap) − clusterDock` on top of
 *  what state already carries. Zero below trigger/floor. Used at extraction. */
export function openGapDock(
  dock: LayoffDock,
  openGapDays: number,
  clusterDays: number,
  clusterDock: number,
  preDockRating: number,
): number {
  if (openGapDays < dock.triggerDays || preDockRating < dock.ratingFloor) return 0;
  return Math.max(0, layoffCurve(dock, clusterDays + openGapDays) - clusterDock);
}

export interface ComputedElo extends PlayerElo {
  overall: number;
  hard: number | null;
  clay: number | null;
  grass: number | null;
  /** A representative source name for this rating, used to build the sigKey fallback in apply. */
  name: string;
}

export interface ComputedRatings {
  byId: Map<string, ComputedElo>;
  byName: Map<string, ComputedElo>; // keyed by fullKey(name); ambiguous fullKeys are dropped
}

/** Chronological rank of a round WITHIN a tournament. Sackmann lists a tournament's matches FINAL-FIRST
 *  (the final has the highest match_num, R128 the lowest), so naive input order processes the final
 *  before its early rounds — letting a champion "beat" opponents still sitting at the entrant seed and
 *  collapsing every unbeaten run to one value. We must replay in PLAY order: qualifying → round-robin →
 *  R128 → … → F. Verified against TA's own boards (reverse-engineering, docs/yelo-reproduction.md): play
 *  order tightened the board-replay residual measurably. Unknown rounds sort at R16 (mid-draw). */
const ROUND_RANK: Record<string, number> = {
  Q1: 1, Q2: 2, Q3: 3, Q4: 4, RR: 5, // qualifying then round-robin group stage (before the knockout)
  R128: 10, R64: 11, R32: 12, R16: 13, QF: 14, SF: 15, BR: 16, F: 17,
};
const roundRank = (round: string): number => ROUND_RANK[round] ?? 13;

/**
 * Sort rows into the deterministic replay PLAY order: (tourneyDate, round-within-event, original input
 * index). Returns a NEW array (input untouched). Sackmann shares one date across a whole tournament and
 * lists its matches final-first, so we order by round (qualifying→F) before falling back to input index;
 * a shuffled input must still yield byte-identical output.
 */
export function sortEloRows(rows: EloMatchRow[]): EloMatchRow[] {
  return rows
    .map((row, idx) => ({ row, idx }))
    .sort((a, b) => a.row.tourneyDate - b.row.tourneyDate || roundRank(a.row.round) - roundRank(b.row.round) || a.idx - b.idx)
    .map(({ row }) => row);
}

/** A same-name id must hold >= this multiple of the runner-up id's match count to be trusted as the
 *  real player. Sackmann's qual/challenger files sometimes record a player under a second, low-match
 *  duplicate id (e.g. Mensik: 212 matches under one id, 11 under another); without this, the shared
 *  fullKey is ambiguous and BOTH get dropped, leaving a current top player with no Elo in the snapshot. */
const AMBIGUITY_DOMINANCE = 4;

/**
 * Compute frozen ratings as of `cutoffDate` from rows ALREADY in `sortEloRows` order: feed every row
 * with `tourneyDate < cutoffDate` (strict) into a fresh engine, then resolve per-surface values.
 * The backfill pre-sorts each tour's rows once and reuses this across ~113 snapshots.
 */
export function computeRatingsAsOfSorted(
  sortedRows: EloMatchRow[],
  cutoffDate: number,
  config: EloConfig = DEFAULT_ELO_CONFIG,
): ComputedRatings {
  const engine = new EloEngine(config);
  // Era-gate retirements by the SNAPSHOT date: a board frozen before the spring-2025 recompute excludes RET
  // (TA's recompute was retroactive). When retEraStart is unset, retirements count always (legacy).
  const countRet = config.retEraStart === undefined || cutoffDate >= config.retEraStart;
  for (const row of sortedRows) {
    if (row.tourneyDate >= cutoffDate) continue;
    if (!countRet && isRetirementRow(row)) continue;
    engine.update(row);
  }

  const byId = new Map<string, ComputedElo>();
  // Per fullKey, keep the dominant id's rating + its match count + the runner-up's count. A name shared
  // by two ids resolves to the dominant record when it clearly outweighs the other (a phantom/duplicate);
  // ids with comparable counts stay ambiguous and are dropped (we can't tell which is which).
  const best = new Map<string, { elo: ComputedElo; n: number; runnerUp: number }>();
  for (const [id, s] of engine.players) {
    // Injury/absence dock at EXTRACTION. For a board DURING the COVID suspension we un-dock everyone
    // (add back the in-state clusterDock), since TA suspended the penalty board-wide then. (Approximate:
    // adding back the dock reverses the rating subtraction but not the boosted-K path the comeback already
    // took, so an ex-docked player can read slightly high — a small, historical-only residual.) Otherwise dock a
    // player absent RIGHT NOW (open trailing gap, not yet returned): the open gap extends their cluster,
    // docking the marginal curve amount on the output. A player who has already returned carries their dock
    // IN STATE (applied during replay); active, settled players get 0 — the field is never deflated.
    const dock = !config.dock
      ? 0
      : dockSuspended(config.dock, cutoffDate)
        ? -s.clusterDock
        : openGapDock(
            config.dock,
            activeLayoffDays(s.lastDate, cutoffDate),
            s.clusterDays,
            s.clusterDock,
            s.overall + s.clusterDock, // pre-layoff level for the gate (see detectReturn)
          );
    const surf = (raw: number, n: number): number | null => {
      const r = resolveSurfaceElo(raw, n, s.overall);
      return r === null ? null : r - dock;
    };
    const computed: ComputedElo = {
      name: s.name,
      overall: s.overall - dock,
      hard: surf(s.hard, s.hardN),
      clay: surf(s.clay, s.clayN),
      grass: surf(s.grass, s.grassN),
    };
    byId.set(id, computed);
    const k = fullKey(s.name);
    if (!k) continue;
    const cur = best.get(k);
    if (!cur) best.set(k, { elo: computed, n: s.overallN, runnerUp: 0 });
    else if (s.overallN > cur.n) best.set(k, { elo: computed, n: s.overallN, runnerUp: cur.n });
    else if (s.overallN > cur.runnerUp) best.set(k, { elo: cur.elo, n: cur.n, runnerUp: s.overallN });
  }
  const byName = new Map<string, ComputedElo>();
  for (const [k, v] of best) {
    if (v.runnerUp === 0 || v.n >= v.runnerUp * AMBIGUITY_DOMINANCE) byName.set(k, v.elo);
  }
  return { byId, byName };
}

/**
 * Compute frozen ratings as of `cutoffDate`: sort rows into deterministic order, then replay. Thin
 * wrapper so a shuffled input yields byte-identical output via `sortEloRows`; equal to
 * `computeRatingsAsOfSorted(sortEloRows(rows), cutoffDate, config)`.
 */
export function computeRatingsAsOf(
  rows: EloMatchRow[],
  cutoffDate: number,
  config: EloConfig = DEFAULT_ELO_CONFIG,
): ComputedRatings {
  return computeRatingsAsOfSorted(sortEloRows(rows), cutoffDate, config);
}

/**
 * Mutate `players`: attach each matched player's frozen ComputedElo by `fullKey(name)`, falling back
 * to `sigKey(name)` (surname+initial). The sigKey fallback joins only when the signature is
 * unambiguous on BOTH sides — within `byName` (two distinct CSV fullKeys sharing one signature map to
 * null) AND within the snapshot (two still-unmatched players sharing one signature: we can't tell
 * which is which, so neither joins). Unmatched players keep their existing `elo` (the caller decides
 * whether to null it).
 */
export function applyHistoricalElo(
  players: Record<string, Player>,
  byName: Map<string, ComputedElo>,
): { matched: number; unmatched: string[] } {
  // sigKey can't be recovered from a fullKey (token boundaries are gone), so build the fallback index
  // from each ComputedElo's source name. A signature shared by two distinct fullKeys is ambiguous and
  // maps to null — those players join nothing rather than risk a wrong rating.
  const bySig = new Map<string, ComputedElo | null>();
  const sigOwner = new Map<string, string>(); // sigKey -> the fullKey that first claimed it
  for (const [fk, elo] of byName) {
    const sk = sigKey(elo.name);
    if (!sk) continue;
    if (!bySig.has(sk)) {
      bySig.set(sk, elo);
      sigOwner.set(sk, fk);
    } else if (sigOwner.get(sk) !== fk) {
      bySig.set(sk, null); // distinct fullKeys collide on one signature -> ambiguous
    }
  }

  let matched = 0;
  const unmatched: string[] = [];

  // Pass 1 — exact fullKey join. Players with no direct hit become sig-fallback candidates.
  const sigCandidates: Player[] = [];
  for (const p of Object.values(players)) {
    const fk = fullKey(p.name);
    const direct = fk ? byName.get(fk) : undefined;
    if (direct) {
      p.elo = eloOf(direct);
      matched++;
    } else {
      sigCandidates.push(p);
    }
  }

  // How many candidates share each signature: when two collide we can't tell which one the CSV's sig
  // owner is, so neither may inherit it (the snapshot-side guard, mirroring seeds.ts applySeeds).
  const sigCandCount = new Map<string, number>();
  for (const p of sigCandidates) {
    const sk = sigKey(p.name);
    if (sk) sigCandCount.set(sk, (sigCandCount.get(sk) ?? 0) + 1);
  }

  // Pass 2 — surname+initial fallback for everything still unmatched after pass 1. A candidate joins
  // only when its sig is unambiguous on the CSV side (bySig non-null) AND on the snapshot side (count 1).
  for (const p of sigCandidates) {
    const sk = sigKey(p.name);
    const hit = sk ? bySig.get(sk) : undefined;
    if (hit && (sigCandCount.get(sk) ?? 0) === 1) {
      p.elo = eloOf(hit);
      matched++;
    } else {
      unmatched.push(p.name);
    }
  }
  return { matched, unmatched };
}

/** Project a ComputedElo down to the PlayerElo stored on the snapshot (drops the source name). */
const eloOf = (c: ComputedElo): PlayerElo => ({
  overall: c.overall,
  hard: c.hard,
  clay: c.clay,
  grass: c.grass,
});
