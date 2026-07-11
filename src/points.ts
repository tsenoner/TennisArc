import type { SetScore, Tour } from "./model";

/** ATP slams are best-of-5, WTA best-of-3 — the single home of the tour→format rule. */
export const bestOfForTour = (tour: Tour): 3 | 5 => (tour === "ATP" ? 5 : 3);
export const setsToWin = (bestOf: 3 | 5): 2 | 3 => (bestOf === 5 ? 3 : 2);

/** Live current-game rules for the match strip: tiebreak detection and the single BP/SP/MP
 *  chip. Inputs are the RAW feed point strings ("0"|"15"|"30"|"40"|"A", digits in tiebreaks);
 *  anything unrecognized suppresses the chip rather than guessing (fail quiet, never wrong-loud). */
export interface PointStateInput {
  pts: { p1: string; p2: string };
  serving?: "p1" | "p2";
  games: { p1: number; p2: number };   // games in the current set
  sets: { p1: number; p2: number };    // completed sets won
  bestOf: 3 | 5;
}
export interface PointState { tb: boolean; chip: "BP" | "SP" | "MP" | null; chipFor: "p1" | "p2" | null; }

/** Spelled-out meaning for the .ms-chip abbreviation, for its aria-label (the visible text is the
 *  terse "BP"/"SP"/"MP" — screen-reader users get the full phrase instead). */
export const CHIP_LABEL: Record<NonNullable<PointState["chip"]>, string> =
  { BP: "break point", SP: "set point", MP: "match point" };

/** A set sits in a tiebreak when both sides hold the same games count ≥6 (6-6; also 12-12-era data). */
export const isTiebreak = (a: number, b: number): boolean => a === b && a >= 6;

const RANK: Record<string, number> = { "0": 0, "15": 1, "30": 2, "40": 3, "A": 4 };
// Prototype-safe key check, es2020-safe at runtime (Object.hasOwn is ES2022 — the build
// targets es2020, so it would throw on Safari ≤15.3 / Chrome ≤92 despite the tsconfig lib).
const isGamePts = (s: string): boolean => Object.prototype.hasOwnProperty.call(RANK, s);
const other = (s: "p1" | "p2"): "p1" | "p2" => (s === "p1" ? "p2" : "p1");

/** A set score that already ended the set by the standard rule: ≥6 with a 2-game margin, or 7-6. */
const decided = (g: { p1: number; p2: number }): boolean => {
  const hi = Math.max(g.p1, g.p2), lo = Math.min(g.p1, g.p2);
  return (hi >= 6 && hi - lo >= 2) || (hi === 7 && lo === 6);
};

export function pointState(i: PointStateInput): PointState {
  const toWin = setsToWin(i.bestOf);
  const finalSet = i.sets.p1 + i.sets.p2 === i.bestOf - 1;
  const tb = isTiebreak(i.games.p1, i.games.p2);
  // Stale-context guard: the games context rides the 30s list poll while the points ride the
  // 8s pbp poll — a DECIDED last set means the new set hasn't been appended yet, so any chip
  // computed from it is stale-loud. Suppress them all until the context catches up.
  if (decided(i.games)) return { tb, chip: null, chipFor: null };
  // Winning the current SET: MP if it completes the match for that side, else SP.
  const setChip = (side: "p1" | "p2"): "SP" | "MP" => (i.sets[side] + 1 >= toWin ? "MP" : "SP");

  if (tb) {
    // No serve attribution in a tiebreak (the server rotates every two points, faster than the
    // 30s CX cadence) — so never BP; the tiebreak decides the set, so a lead at target−1+ is SP/MP.
    // Stale-context guard: BOTH values reading as tennis-format points means the 6-6 games
    // context is stale and a NORMAL game is in progress (the set moved on to 7-6 or a new set) —
    // no reachable legit TB chip state has both sides in that set (a lead ≥1 with both in-set
    // would have ended the TB points earlier; 15-14 passes since "14" is out-of-set).
    if (isGamePts(i.pts.p1) && isGamePts(i.pts.p2)) return { tb: true, chip: null, chipFor: null };
    const target = finalSet ? 10 : 7; // 10-point final-set TB at every slam since 2022
    const a = Number(i.pts.p1), b = Number(i.pts.p2);
    if (!Number.isFinite(a) || !Number.isFinite(b) || i.pts.p1.trim() === "" || i.pts.p2.trim() === "")
      return { tb: true, chip: null, chipFor: null };
    for (const side of ["p1", "p2"] as const) {
      const mine = side === "p1" ? a : b, theirs = side === "p1" ? b : a;
      if (mine >= target - 1 && mine - theirs >= 1) return { tb: true, chip: setChip(side), chipFor: side };
    }
    return { tb: true, chip: null, chipFor: null };
  }

  const r1 = isGamePts(i.pts.p1) ? RANK[i.pts.p1] : undefined;
  const r2 = isGamePts(i.pts.p2) ? RANK[i.pts.p2] : undefined;
  if (r1 == null || r2 == null) return { tb: false, chip: null, chipFor: null };
  if (r1 === 4 && r2 === 4) return { tb: false, chip: null, chipFor: null };
  for (const side of ["p1", "p2"] as const) {
    const mine = side === "p1" ? r1 : r2, theirs = side === "p1" ? r2 : r1;
    const gamePoint = (mine === 3 && theirs < 3) || mine === 4;
    if (!gamePoint) continue;                       // at most one side can hold game point
    const gWin = i.games[side] + 1;
    if (gWin >= 6 && gWin - i.games[other(side)] >= 2) return { tb: false, chip: setChip(side), chipFor: side };
    // `serving` rides the 30s overlay: a game-boundary flip can mislabel a BP for ≤30s —
    // accepted transient (no reliable client-side signal exists), self-corrects on the next live poll.
    if (i.serving && i.serving !== side) return { tb: false, chip: "BP", chipFor: side };
    return { tb: false, chip: null, chipFor: null }; // the server's plain game point
  }
  return { tb: false, chip: null, chipFor: null };
}

/** Current-set games and completed-set counts from a live overlay score. The LAST entry is the
 *  set in progress (Flashscore appends sets as they start); earlier entries count when decided
 *  by the standard rule (≥6 with a 2-game margin, or 7-6). */
export function deriveContext(score: SetScore[] | null): { games: { p1: number; p2: number }; sets: { p1: number; p2: number } } {
  const games = { p1: 0, p2: 0 }, sets = { p1: 0, p2: 0 };
  if (!score || score.length === 0) return { games, sets };
  const last = score[score.length - 1];
  games.p1 = last.p1; games.p2 = last.p2;
  for (const set of score.slice(0, -1)) {
    if (decided(set)) sets[set.p1 > set.p2 ? "p1" : "p2"]++;
  }
  return { games, sets };
}
