// Shared building blocks for reverse-engineering TA's Elo from the boards themselves.
// Loads the parsed boards (parse-boards.ts) + the FULL Sackmann match history (richer than the
// engine's EloMatchRow: keeps tourney_id, draw_size, best_of for window/inclusion experiments),
// and provides name<->id joins so a board player can be tied to their Sackmann matches.
//
// Re-exports winProbability / kFactor from the production engine so every analysis uses one source.
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fullKey } from "../names";
import { winProbability, kFactor, dayNumber, roundRank, keepForEloScope } from "../historical-elo";
import type { Board, BoardPlayer } from "./parse-boards";

export { winProbability, kFactor, fullKey, roundRank };
// Re-export the engine's day-number helper under lib's public name (consumers import `dayNum` unchanged).
export { dayNumber as dayNum };
export type { Board, BoardPlayer };

const CACHE = resolve(process.cwd(), "ingest/.cache/elo");

export interface Match {
  tourneyId: string;
  tourneyName: string;
  date: number; // tourney_date (START of event), YYYYMMDD
  endDate: number; // estimated FINAL date (see estEnd) — for season/whole-event attribution
  playDate: number; // estimated date THIS match was played (see playDate) — for board-cutoff gating
  drawSize: number;
  level: string; // G grand slam, M masters, A atp/wta, F finals, D davis/team, C challenger, etc.
  surface: "Hard" | "Clay" | "Grass" | null;
  round: string; // R128..F, plus Q* for qualifying, RR round-robin
  bestOf: number;
  score: string; // raw score; "RET"/"W/O"/"DEF" markers => not counted by TA (see keepForElo)
  winnerId: string;
  winnerName: string;
  loserId: string;
  loserName: string;
  idx: number; // stable input order, for deterministic intra-date sort
}

/** TA's verified inclusion scope (reverse-engineered from the boards, see FINDINGS.md §7–§8):
 *  count every CONTESTED result EXCEPT pure walkovers, and (WTA) ITF below $50K. WTA tags ITF events by
 *  numeric prize tier (15/25/35/40/50/60/75/80/100); only >=50 counts. ATP levels are all real.
 *
 *  This keeps everything CONTESTED: a pure WALKOVER ("W/O"/"Walkover"/empty — zero games played) is always
 *  dropped; a retirement ("6-3 4-6 2-1 RET") or default/abandonment ("… DEF"/"… ABD") was contested and HAS a
 *  winner, so it stays in the corpus. Whether retirements actually COUNT toward a rating is ERA-dependent (see
 *  RET_ERA_START) — that gate lives in the consumers (yelo-fit / replay), keyed by board/window date, because
 *  TA's spring-2025 recompute was retroactive. The discriminator here is just "were any games played?". */
export function keepForElo(m: Match): boolean {
  // Shared scope primitive (with historical-elo.ts `keepForEloRow`); a Match always has a string score, so
  // "games played?" is just /\d/ — no undefined case (unlike the row form, where a missing score = played).
  return keepForEloScope(m.level, /\d/.test(m.score));
}

/** TA began counting RETIREMENTS in season yElo (and full Elo) at a one-time RECOMPUTE in spring 2025: every
 *  board captured from ~April 2025 on counts RET for the WHOLE season, while boards captured before — all
 *  2021-2024 boards AND the Jan–Mar 2025 boards — exclude it. Proven by the razor-sharp, both-tours-identical
 *  flip in W/L-exact: RET-off wins every board through 2025-03-17, RET-on wins every board from 2025-05-26
 *  (e.g. ATP 20241104 494/507 RET-off vs 201 on; ATP 20260223 265/265 RET-on vs 188 off). So RET inclusion is
 *  decided per board by CAPTURE date, NOT match date (the recompute was retroactive). Exact cutover unknown —
 *  no Wayback capture exists between 2025-03-17 and 2025-05-26 — so we gate at a midpoint in that window. */
export { RET_ELO_ERA_START as RET_ERA_START } from "../historical-elo";
export const isRetirement = (m: Match): boolean => /\d/.test(m.score) && /\b(RET|DEF|ABD)\b/i.test(m.score);

const SURF: Record<string, "Hard" | "Clay" | "Grass"> = { Hard: "Hard", Clay: "Clay", Grass: "Grass" };

// `roundRank` (chronological rank of a round WITHIN a tournament — the primary intra-date PLAY-order sort
// key) is re-exported above from historical-elo.ts, the single source shared with the production engine.

/** YYYYMMDD + n days → YYYYMMDD (UTC). */
export function addDays(date: number, n: number): number {
  const y = Math.floor(date / 10000), m = (Math.floor(date / 100) % 100) - 1, d = date % 100;
  const dt = new Date(Date.UTC(y, m, d) + n * 86_400_000);
  return dt.getUTCFullYear() * 10000 + (dt.getUTCMonth() + 1) * 100 + dt.getUTCDate();
}

/** Round to one decimal — TA publishes board ratings to 0.1, so reproduction stats match at that precision. */
export const round1 = (x: number): number => Math.round(x * 10) / 10;

// Two median variants used across the Elo tooling (they DIVERGE on even-length input, so both exist):
//  • `median`      — even length averages the two middle elements (calibrate-elo / elo-burnin / fixture).
//  • `medianUpper` — even length takes the UPPER-middle element, arr[len>>1] (replay / yelo-fit own copies).
// Both NaN on empty. (replay.ts/yelo-fit.ts keep their own inline `med` — they're owned by other agents.)
/** Median; even length = average of the two middle elements. NaN on empty. */
export const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y);
  if (!s.length) return NaN;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
/** Median; even length = the UPPER-middle element (arr[len>>1] after sort). NaN on empty. */
export const medianUpper = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : NaN;
};

// Sackmann dates EVERY match in an event with the event's START (tourney_date), but TA's weekly board only
// counts a match once it has been PLAYED. To attribute matches to the right board we estimate each match's
// actual play date = tourney_date + a round-offset that depends on the event's calendar span. Slams run 13
// days; the 96-draw "1.5-week" Masters ~11; everything else is a 1-week (Mon→Sun) event.
// `roundsFromFinal` = how many rounds back from the final a round sits (F=1 … R128=7; BR=1 like F). An
// unknown round (not a main-draw knockout) returns undefined so playDate falls back to the full span. (This
// is the round depth playDate needs directly — formerly recovered as Math.round(log2(player-count)).)
const roundsFromFinal = (round: string): number | undefined =>
  ({ F: 1, BR: 1, SF: 2, QF: 3, R16: 4, R32: 5, R64: 6, R128: 7 } as Record<string, number>)[round];

/** Day-span from the event start (day 0) to the FINAL, by event type. */
function eventSpan(level: string, draw: number): number {
  if (level === "G") return 13; // Grand Slam: Mon → 2nd Sunday
  if (level === "M" && draw >= 96) return 11; // 96-draw Masters (IW/Miami/Madrid/Rome/Canada/Cincy/Shanghai)
  if (level === "F") return 7; // Tour/NextGen Finals (RR Sun → F next Sun)
  if (level === "D") return 3; // Davis/team tie (a weekend)
  return 6; // 1-week event: Mon → Sun (incl. 56-draw Masters Paris/Monte-Carlo, 500s, 250s, challengers)
}

/** Estimated PLAY date of one match (the day that round concluded). Qualifying is the weekend BEFORE the
 *  main draw; main-draw rounds are spread linearly from day 0 (first round) to the final. */
export function playDate(date: number, drawSize: number, level: string, round: string): number {
  const qual: Record<string, number> = { Q1: -3, Q2: -2, Q3: -1, Q4: -1 };
  if (round in qual) return addDays(date, qual[round]);
  const span = eventSpan(level, drawSize);
  if (level === "F") return addDays(date, ({ RR: 4, SF: 6, F: 7, BR: 7 } as Record<string, number>)[round] ?? span);
  if (level === "D" || round === "RR") return addDays(date, Math.max(0, span - 1));
  const depth = roundsFromFinal(round);
  if (depth === undefined) return addDays(date, span);
  // round number from the first main-draw round (depends on draw size); spread evenly start→final.
  const total = Math.max(1, Math.round(Math.log2(Math.max(2, drawSize)))); // # main-draw rounds
  const rn = total - depth + 1; // 1 = first round … total = final
  const off = total <= 1 ? span : Math.round(((rn - 1) / (total - 1)) * span);
  return addDays(date, Math.min(off, span));
}

/** Estimated final-match (event END) date — used to attribute a whole tournament to a season/board. */
export function estEnd(date: number, drawSize: number, level: string): number {
  return addDays(date, eventSpan(level, drawSize));
}

/** Load + parse every Sackmann yearly CSV for a tour, sorted by (date, input index). Keeps extra columns
 *  the engine's parser drops. `fromYear` lets callers skip deep history they don't need (faster). */
export function loadMatches(tour: "ATP" | "WTA", fromYear = 2014): Match[] {
  const files = readdirSync(CACHE)
    .filter((f) => f.startsWith(`${tour}_`) && f.endsWith(".csv"))
    .filter((f) => Number(f.match(/_(\d{4})\.csv$/)?.[1] ?? 0) >= fromYear)
    .sort();
  const out: Match[] = [];
  let idx = 0;
  for (const f of files) {
    const lines = readFileSync(resolve(CACHE, f), "utf8").split(/\r?\n/);
    const h = lines[0].split(",");
    const c = (n: string) => h.indexOf(n);
    const iId = c("tourney_id"), iName = c("tourney_name"), iDate = c("tourney_date"),
      iDraw = c("draw_size"), iLvl = c("tourney_level"), iSurf = c("surface"), iRound = c("round"),
      iBo = c("best_of"), iSc = c("score"), iWid = c("winner_id"), iWn = c("winner_name"), iLid = c("loser_id"), iLn = c("loser_name");
    for (let i = 1; i < lines.length; i++) {
      const r = lines[i];
      if (!r) continue;
      const f2 = r.split(",");
      const date = Number(f2[iDate]);
      const wId = f2[iWid], lId = f2[iLid];
      if (!wId || !lId || !Number.isFinite(date) || !f2[iDate]) continue;
      const drawSize = Number(f2[iDraw]) || 0;
      const level = f2[iLvl] ?? "";
      out.push({
        tourneyId: f2[iId] ?? "", tourneyName: f2[iName] ?? "", date,
        endDate: estEnd(date, drawSize, level), playDate: playDate(date, drawSize, level, f2[iRound] ?? ""),
        drawSize, level,
        surface: SURF[f2[iSurf] ?? ""] ?? null, round: f2[iRound] ?? "", bestOf: Number(f2[iBo]) || 3, score: f2[iSc] ?? "",
        winnerId: wId, winnerName: f2[iWn] ?? "", loserId: lId, loserName: f2[iLn] ?? "", idx: idx++,
      });
    }
  }
  // Dedup exact-duplicate feed rows. Sackmann's WTA qualifying/challenger feed re-lists every level-C (WTA-125)
  // match TWICE (1343 identical rows in 2026 alone; ATP has ~14). They're byte-identical on
  // tourneyId|round|winnerId|loserId|score, so the same pair never legitimately collides on that key (a draw
  // pairs two players at most once per round). Left in, they DOUBLE-count once 125 qualifying is in scope.
  const seen = new Set<string>();
  const deduped = out.filter((m) => {
    const k = `${m.tourneyId}|${m.round}|${m.winnerId}|${m.loserId}|${m.score}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // Play order: by event start date, then ROUND within the event (R128→F), then stable input order.
  deduped.sort((a, b) => a.date - b.date || roundRank(a.round) - roundRank(b.round) || a.idx - b.idx);
  return deduped;
}

export function loadBoards(): { ATP: Board[]; WTA: Board[] } {
  return JSON.parse(readFileSync(resolve(process.cwd(), "ingest/elo-reverse/boards.json"), "utf8"));
}

/** id -> canonical display name (most frequent), and fullKey(name) -> dominant id (>=4x runner-up,
 *  matching the engine's AMBIGUITY_DOMINANCE). Lets a board player (name only) be tied to a Sackmann id. */
export function nameIndex(matches: Match[]): { idName: Map<string, string>; keyToId: Map<string, string>; idCount: Map<string, number> } {
  const idCount = new Map<string, number>();
  const idNames = new Map<string, Map<string, number>>();
  const bump = (id: string, name: string) => {
    idCount.set(id, (idCount.get(id) ?? 0) + 1);
    const m = idNames.get(id) ?? new Map<string, number>();
    m.set(name, (m.get(name) ?? 0) + 1);
    idNames.set(id, m);
  };
  for (const m of matches) { bump(m.winnerId, m.winnerName); bump(m.loserId, m.loserName); }
  const idName = new Map<string, string>();
  for (const [id, names] of idNames) {
    idName.set(id, [...names].sort((a, b) => b[1] - a[1])[0][0]);
  }
  // fullKey -> candidate ids with counts
  const keyIds = new Map<string, Map<string, number>>();
  for (const [id, n] of idCount) {
    const k = fullKey(idName.get(id) ?? "");
    if (!k) continue;
    const m = keyIds.get(k) ?? new Map<string, number>();
    m.set(id, n);
    keyIds.set(k, m);
  }
  const keyToId = new Map<string, string>();
  for (const [k, ids] of keyIds) {
    const sorted = [...ids].sort((a, b) => b[1] - a[1]);
    const [topId, topN] = sorted[0];
    const runner = sorted[1]?.[1] ?? 0;
    if (runner === 0 || topN >= runner * 4) keyToId.set(k, topId);
  }
  return { idName, keyToId, idCount };
}

/** Resolve each board player to a Sackmann id via fullKey. Returns name->id and the unmatched names. */
export function resolveBoard(board: Board, keyToId: Map<string, string>): { id: Map<string, string>; unmatched: string[] } {
  const id = new Map<string, string>();
  const unmatched: string[] = [];
  for (const p of board.players) {
    const hit = keyToId.get(fullKey(p.name));
    if (hit) id.set(p.name, hit);
    else unmatched.push(p.name);
  }
  return { id, unmatched };
}

/** Matches that BELONG to the window between two board as-of dates, by estimated tournament END date:
 *  prev.lastUpdate < endDate <= cur.lastUpdate. (A tournament shows up on the first board after it ends.) */
export function windowMatches(matches: Match[], prevDate: number, curDate: number): Match[] {
  return matches.filter((m) => m.endDate > prevDate && m.endDate <= curDate);
}

/** Convenience: index a board's players by name for O(1) lookup of elo/age/rank. */
export function byName(board: Board): Map<string, BoardPlayer> {
  return new Map(board.players.map((p) => [p.name, p]));
}

// ---- shared board-replay window machinery (scatter.ts / dashboard-data.ts / replay.ts) ----
// The same per-board-pair replay was copy-pasted in three callers: build a per-id sorted career-date index,
// binary-search the prior-match count, lazily carry-forward each player's state, run the window's Elo update,
// and (for the timeline) flag "recompute boundary" transitions. The mechanics below are byte-identical across
// callers; only the OUTPUT shape (scatter pts / dashboard pts / replay residuals) diverges, so each caller
// keeps its own post-window loop and consumes these primitives.

/** Per-id career match-date index + a binary-search prior-count closure. `prior(id, before)` = how many of
 *  that id's matches started strictly BEFORE `before` (the K-factor's experience count `n`). Built from the
 *  SAME `keepForElo`-filtered match set every caller passes, so the closure is identical across them. */
export function priorMatchCounter(matches: Match[]): (id: string, before: number) => number {
  const cd = new Map<string, number[]>();
  for (const m of matches) for (const id of [m.winnerId, m.loserId]) { const a = cd.get(id) ?? []; a.push(m.date); cd.set(id, a); }
  return (id: string, before: number) => {
    const a = cd.get(id);
    if (!a) return 0;
    let lo = 0, hi = a.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < before) lo = mid + 1; else hi = mid; }
    return lo;
  };
}

/** "Recompute boundary" heuristic, shared by all three callers: a board-wide rescale shows up as the IDLE
 *  players (those with a prior rating but NO window match) shifting EN MASSE — flagged when there are >=5 of
 *  them and their UPPER-median delta exceeds 25. `idleDeltas` = (predicted/carried − published) per idle player. */
export const isRecomputeBoundary = (idleDeltas: number[]): boolean =>
  idleDeltas.length >= 5 && Math.abs(idleDeltas.slice().sort((a, b) => a - b)[idleDeltas.length >> 1]) > 25;

/** Running per-id rating state during a window replay: `ov` overall Elo, `n` matches-so-far (drives K). */
export interface ReplayState { ov: number; n: number }
/** One yielded window: the board pair, the day-gap, the per-id state AFTER the window's matches were applied
 *  (idle players are absent — their carry-forward value lives in `latest`), and a per-id window match count. */
export interface ReplayWindowYield {
  i: number; prev: Board; cur: Board; gap: number;
  st: Map<string, ReplayState>; mcount: Map<string, number>; latest: Map<string, number>;
}
export interface ReplayWindowOpts {
  seed: number; // entrant seed for a never-seen player
  maxGap: number; // skip a board pair whose day-gap exceeds this (stale/missing intermediate captures)
  winProb: (a: number, b: number) => number; // P(A beats B) given the two overall Elos
  kFactor: (n: number) => number; // K-factor from a player's prior match count
  eraGate?: (m: Match, curDate: number) => boolean; // optional per-window inclusion gate (replay's RET era)
}

/** Sweep consecutive board pairs, replaying each window's matches forward from TA's own carried-forward board
 *  values, and YIELD the post-window state for every pair within `maxGap`. The caller's loop body runs between
 *  yields, BEFORE this advances `latest` to the current board — preserving the original "score, then carry
 *  forward" ordering. `boardIds[i]` is board i's players keyed by Sackmann id (built once by the caller). */
export function* replayWindow(
  boards: Board[],
  boardIds: Map<string, BoardPlayer>[],
  matches: Match[],
  prior: (id: string, before: number) => number,
  opts: ReplayWindowOpts,
): Generator<ReplayWindowYield> {
  const { seed, maxGap, winProb, kFactor: kF, eraGate } = opts;
  const latest = new Map<string, number>(); // latest-known published overall per id (carry-forward)
  for (let i = 0; i < boards.length; i++) {
    const prev = i > 0 ? boards[i - 1] : null, cur = boards[i];
    if (prev) {
      const gap = dayNumber(cur.lastUpdate) - dayNumber(prev.lastUpdate);
      if (gap <= maxGap) {
        let win = windowMatches(matches, prev.lastUpdate, cur.lastUpdate);
        if (eraGate) win = win.filter((m) => eraGate(m, cur.lastUpdate));
        const st = new Map<string, ReplayState>();
        const mcount = new Map<string, number>();
        const get = (id: string): ReplayState => {
          let s = st.get(id);
          if (!s) { s = { ov: latest.get(id) ?? seed, n: prior(id, prev.lastUpdate) }; st.set(id, s); }
          return s;
        };
        for (const m of win) {
          const w = get(m.winnerId), l = get(m.loserId);
          const e = winProb(w.ov, l.ov);
          w.ov += kF(w.n) * (1 - e); l.ov += kF(l.n) * (0 - (1 - e)); w.n++; l.n++;
          mcount.set(m.winnerId, (mcount.get(m.winnerId) ?? 0) + 1); mcount.set(m.loserId, (mcount.get(m.loserId) ?? 0) + 1);
        }
        yield { i, prev, cur, gap, st, mcount, latest };
      }
    }
    for (const [id, p] of boardIds[i]) latest.set(id, p.overall);
  }
}

// `dayNum` (YYYYMMDD -> integer UTC day number, for gap/age arithmetic) is re-exported above as the engine's
// `dayNumber` — one shared definition with the production engine.
