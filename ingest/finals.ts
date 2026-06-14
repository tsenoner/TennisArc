import type { Match, Player, SetScore } from "../src/model";
import { ROUND, TOURNEY, fullKey, sigKey } from "./names";
import { MAX_SANE_SEC } from "./durations";

// A handful of historical slam finals shipped as status:"scheduled" with both finalists present
// but no result (winner:null, score:null) — the live SofaScore ingest never captured the final's
// outcome. Backfill the real winner + per-set score + on-court minutes from Jeff Sackmann's
// tennis_atp / tennis_wta F rows, joined to the snapshot finalists by NAME (the two sources use
// different player ids). Idempotent: a final that already has a result is left untouched.

export interface FinalRow {
  winnerName: string;
  loserName: string;
  score: string;
  durationSec: number | null;
}

export interface SackmannScore {
  sets: SetScore[];
  status: "finished" | "retired" | "walkover";
}

/**
 * Parse a Sackmann winner-perspective score string into FIXED-slot SetScores.
 *
 * Sackmann encodes each set as "A-B" (winnerGames-loserGames) with an optional "(C)" giving the
 * loser-of-the-tiebreak's points. We orient to the snapshot's fixed p1/p2 slots: when the row's
 * winner sits in slot p1, a set is {p1:A,p2:B}; when the winner is p2, the games swap to {p1:B,p2:A}.
 * The tiebreak number C is the same regardless of orientation (only the games swap) and is attached
 * only when "(C)" is present.
 *
 * A trailing "RET"/"Def."/"DEF" token marks a retirement (status "retired"; the sets completed so
 * far are kept). "W/O"/"walkover" marks a walkover (status "walkover", no sets).
 */
export function parseSackmannScore(score: string, winnerIsP1: boolean): SackmannScore {
  const trimmed = score.trim();
  if (/\b(w\/o|walkover)\b/i.test(trimmed)) return { sets: [], status: "walkover" };

  let status: SackmannScore["status"] = "finished";
  const sets: SetScore[] = [];
  for (const token of trimmed.split(/\s+/)) {
    if (!token) continue;
    if (/^(ret\.?|def\.?)$/i.test(token)) {
      status = "retired";
      break;
    }
    const m = token.match(/^(\d+)-(\d+)(?:\((\d+)\))?$/);
    if (!m) continue; // skip any stray non-score token defensively
    const a = Number(m[1]);
    const b = Number(m[2]);
    // Games are winner-perspective (A=winner, B=loser); orient to fixed slots. The tiebreak
    // minor-score C is slot-independent — only the games swap when the winner is p2.
    const set: SetScore = winnerIsP1 ? { p1: a, p2: b } : { p1: b, p2: a };
    if (m[3] !== undefined) set.tb = Number(m[3]);
    sets.push(set);
  }
  return { sets, status };
}

/**
 * Extract the single final (round "F") row for a slam from a Sackmann yearly CSV. Returns null when
 * no F row for that slam is present. durationSec -> on-court seconds (Math.round(minutes*60)) or null.
 * Bare-`,` split is safe for Sackmann's quote-free schema (header.indexOf for column positions).
 */
export function parseFinalRow(csv: string, slam: string): FinalRow | null {
  const names = new Set(TOURNEY[slam] ?? []);
  const lines = csv.split(/\r?\n/);
  const header = lines[0]?.split(",") ?? [];
  const col = (n: string): number => header.indexOf(n);
  const iName = col("tourney_name");
  const iRound = col("round");
  const iScore = col("score");
  const iMin = col("minutes");
  const iWin = col("winner_name");
  const iLose = col("loser_name");
  if ([iName, iRound, iScore, iMin, iWin, iLose].includes(-1)) return null;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (!names.has(cols[iName]?.toLowerCase() ?? "")) continue;
    if (ROUND[cols[iRound] ?? ""] !== ROUND.F) continue;
    const min = Number(cols[iMin]);
    return {
      winnerName: cols[iWin] ?? "",
      loserName: cols[iLose] ?? "",
      score: cols[iScore] ?? "",
      durationSec: cols[iMin] && Number.isFinite(min) && min > 0 ? Math.round(min * 60) : null,
    };
  }
  return null;
}

/**
 * Determine which fixed slot (p1/p2) a name occupies, joining by name: exact full-name key first,
 * then surname+initial signature. Returns "p1"/"p2" or null when neither slot matches unambiguously
 * (a signature that matches both slots, or matches neither). Never guesses.
 */
function resolveSlot(match: Match, players: Record<string, Player>, name: string): "p1" | "p2" | null {
  const n1 = match.p1 ? players[match.p1]?.name ?? "" : "";
  const n2 = match.p2 ? players[match.p2]?.name ?? "" : "";
  const full = fullKey(name);
  if (full && fullKey(n1) === full) return "p1";
  if (full && fullKey(n2) === full) return "p2";
  const sig = sigKey(name);
  if (!sig) return null;
  const s1 = sigKey(n1) === sig;
  const s2 = sigKey(n2) === sig;
  if (s1 && !s2) return "p1";
  if (s2 && !s1) return "p2";
  return null; // ambiguous (both) or no match (neither)
}

/**
 * Apply a parsed final row to a scheduled final. Returns false (leaving the match untouched) when
 * the final already has a result (idempotent) or the name-join is ambiguous; otherwise mutates
 * winner / score / status / durationSec (capped MAX_SANE_SEC) / durationProvisional and returns true.
 */
export function applyFinal(match: Match, players: Record<string, Player>, row: FinalRow): boolean {
  if (match.status === "finished" || match.status === "retired" || match.status === "walkover") {
    return false; // already resolved — idempotent no-op
  }
  const wSlot = resolveSlot(match, players, row.winnerName);
  if (wSlot === null) return false; // ambiguous / no join — never guess
  // Sanity-check the loser too: if it resolves to the SAME slot as the winner the row is corrupt
  // (winner and loser are the same finalist) — reject. An unresolvable loser (abbreviated/ambiguous)
  // is conservative-OK: the 5 real finals' losers all map to the opposite slot.
  const lSlot = resolveSlot(match, players, row.loserName);
  if (lSlot !== null && lSlot === wSlot) return false;

  const parsed = parseSackmannScore(row.score, wSlot === "p1");
  // An empty/garbled score string parses to "finished" with zero sets. Don't write a finished final
  // that has a declared winner but no score — leave it scheduled (mirrors the ambiguous-join no-op).
  // A genuine walkover (status "walkover", also zero sets) is a real result and is kept.
  if (parsed.status === "finished" && parsed.sets.length === 0) return false;

  match.winner = wSlot;
  match.status = parsed.status;
  match.score = parsed.status === "walkover" ? null : parsed.sets;
  match.durationSec =
    row.durationSec != null && row.durationSec <= MAX_SANE_SEC ? row.durationSec : null;
  match.durationProvisional = false;
  return true;
}
