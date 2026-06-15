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
  endDate: number; // estimated FINAL date (see estEnd) — for board-inclusion windows
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
 *  count every real competitive result EXCEPT walkovers/retirements, and (WTA) ITF below $50K. WTA tags ITF
 *  events by numeric prize tier (15/25/35/40/50/60/75/80/100); only >=50 counts. ATP levels are all real. */
export function keepForElo(m: Match): boolean {
  if (/RET|W\/O|WO\b|DEF|Walkover|Def\./i.test(m.score)) return false; // walkover/retirement: no rating change
  const n = /^(\d+)/.exec(m.level)?.[1];
  if (n && Number(n) < 50) return false; // sub-$50K ITF (WTA) — not counted
  return true;
}

const SURF: Record<string, "Hard" | "Clay" | "Grass"> = { Hard: "Hard", Clay: "Clay", Grass: "Grass" };

/** Estimate a tournament's final-match date from its start + draw size. Sackmann dates every match in an
 *  event with the START date, but a board only "sees" the event once it has FINISHED, so to decide which
 *  board a result belongs to we need an end date. Slams/big draws run ~2 weeks, smaller ~1 week. */
export function estEnd(date: number, drawSize: number, level: string): number {
  const span = level === "G" ? 13 : drawSize >= 56 ? 9 : drawSize >= 32 ? 7 : 6;
  const y = Math.floor(date / 10000), m = (Math.floor(date / 100) % 100) - 1, d = date % 100;
  const j = Date.UTC(y, m, d) + span * 86_400_000;
  const dt = new Date(j);
  return dt.getUTCFullYear() * 10000 + (dt.getUTCMonth() + 1) * 100 + dt.getUTCDate();
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
        endDate: estEnd(date, drawSize, level), drawSize, level,
        surface: SURF[f2[iSurf] ?? ""] ?? null, round: f2[iRound] ?? "", bestOf: Number(f2[iBo]) || 3, score: f2[iSc] ?? "",
        winnerId: wId, winnerName: f2[iWn] ?? "", loserId: lId, loserName: f2[iLn] ?? "", idx: idx++,
      });
    }
  }
  out.sort((a, b) => a.date - b.date || a.idx - b.idx);
  return out;
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
