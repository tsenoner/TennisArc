// Shared building blocks for reverse-engineering TA's Elo from the boards themselves.
// Loads the parsed boards (parse-boards.ts) + the FULL Sackmann match history (richer than the
// engine's EloMatchRow: keeps tourney_id, draw_size, best_of for window/inclusion experiments),
// and provides name<->id joins so a board player can be tied to their Sackmann matches.
//
// Re-exports winProbability / kFactor from the production engine so every analysis uses one source.
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fullKey } from "../names";
import { winProbability, kFactor } from "../historical-elo";
import type { Board, BoardPlayer } from "./parse-boards";

export { winProbability, kFactor, fullKey };
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
  if (!/\d/.test(m.score)) return false; // walkover / no games played (W/O, Walkover, empty): not counted
  const n = /^(\d+)/.exec(m.level)?.[1];
  if (n && Number(n) < 50) return false; // sub-$50K ITF (WTA) — not counted
  return true;
}

/** TA began counting RETIREMENTS in season yElo (and full Elo) at a one-time RECOMPUTE in spring 2025: every
 *  board captured from ~April 2025 on counts RET for the WHOLE season, while boards captured before — all
 *  2021-2024 boards AND the Jan–Mar 2025 boards — exclude it. Proven by the razor-sharp, both-tours-identical
 *  flip in W/L-exact: RET-off wins every board through 2025-03-17, RET-on wins every board from 2025-05-26
 *  (e.g. ATP 20241104 494/507 RET-off vs 201 on; ATP 20260223 265/265 RET-on vs 188 off). So RET inclusion is
 *  decided per board by CAPTURE date, NOT match date (the recompute was retroactive). Exact cutover unknown —
 *  no Wayback capture exists between 2025-03-17 and 2025-05-26 — so we gate at a midpoint in that window. */
export const RET_ERA_START = 20250418;
export const isRetirement = (m: Match): boolean => /\d/.test(m.score) && /\b(RET|DEF|ABD)\b/i.test(m.score);

const SURF: Record<string, "Hard" | "Clay" | "Grass"> = { Hard: "Hard", Clay: "Clay", Grass: "Grass" };

/** Chronological rank of a round WITHIN a tournament. Sackmann lists matches FINAL-FIRST (match_num F is
 *  the highest, R32 the lowest), so naive CSV order processes the final before its early rounds — which,
 *  in a from-scratch replay, lets a champion "beat" opponents still at the seed. We must process in PLAY
 *  order: qualifying → round-robin → R128 → … → F. Used as the primary intra-date sort key. */
const ROUND_RANK: Record<string, number> = {
  Q1: 1, Q2: 2, Q3: 3, Q4: 4, // qualifying (played before the main draw)
  RR: 5, // round-robin group stage (Finals/United Cup) — before the knockout
  R128: 10, R64: 11, R32: 12, R16: 13, QF: 14, SF: 15, BR: 16, F: 17,
};
export const roundRank = (round: string): number => ROUND_RANK[round] ?? 13;

/** YYYYMMDD + n days → YYYYMMDD (UTC). */
function addDays(date: number, n: number): number {
  const y = Math.floor(date / 10000), m = (Math.floor(date / 100) % 100) - 1, d = date % 100;
  const dt = new Date(Date.UTC(y, m, d) + n * 86_400_000);
  return dt.getUTCFullYear() * 10000 + (dt.getUTCMonth() + 1) * 100 + dt.getUTCDate();
}

// Sackmann dates EVERY match in an event with the event's START (tourney_date), but TA's weekly board only
// counts a match once it has been PLAYED. To attribute matches to the right board we estimate each match's
// actual play date = tourney_date + a round-offset that depends on the event's calendar span. Slams run 13
// days; the 96-draw "1.5-week" Masters ~11; everything else is a 1-week (Mon→Sun) event.
const players2 = (round: string): number =>
  ({ R128: 128, R64: 64, R32: 32, R16: 16, QF: 8, SF: 4, F: 2, BR: 2 } as Record<string, number>)[round] ?? 0;

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
  const p = players2(round);
  if (!p) return addDays(date, span);
  // round number from the first main-draw round (depends on draw size); spread evenly start→final.
  const total = Math.max(1, Math.round(Math.log2(Math.max(2, drawSize)))); // # main-draw rounds
  const rn = total - Math.round(Math.log2(p)) + 1; // 1 = first round … total = final
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

/** YYYYMMDD -> integer day number (for gap/age arithmetic). */
export const dayNum = (d: number): number =>
  Math.round(Date.UTC(Math.floor(d / 10000), (Math.floor(d / 100) % 100) - 1, d % 100) / 86_400_000);
