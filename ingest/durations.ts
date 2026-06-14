import type { Match, Player, Tour } from "../src/model";
import { ROUND, TOURNEY, fullKey, pairKey, sigKey } from "./names";

// Historical durations come from Jeff Sackmann's tennis_atp / tennis_wta CSVs (CC BY-NC-SA 4.0):
// SofaScore's time.periodN is absent pre-mid-2014, has whole-event holes, and counts rain/curfew
// suspensions as play time. Sackmann's `minutes` is official on-court time (Isner–Mahut = 665).
const MATCHES_URL = (tour: Tour, year: number): string => {
  const t = tour.toLowerCase();
  return `https://raw.githubusercontent.com/JeffSackmann/tennis_${t}/master/${t}_matches_${year}.csv`;
};

/** Qualifying + Challenger (ATP) / qualifying + ITF (WTA) file. ATP: challengers from 2008, quallies
 *  from 2011; early years 404 (handled by fetchQualChallCsv). TA's published Elo includes these. */
export const qualChallUrl = (tour: Tour, year: number): string => {
  const t = tour.toLowerCase();
  const stem = tour === "ATP" ? "qual_chall" : "qual_itf";
  return `https://raw.githubusercontent.com/JeffSackmann/tennis_${t}/master/${t}_matches_${stem}_${year}.csv`;
};

/** Fetch the qual/challenger file; returns null on 404 (some early years are absent) rather than throw. */
export async function fetchQualChallCsv(tour: Tour, year: number): Promise<string | null> {
  const res = await fetch(qualChallUrl(tour, year), { headers: { "User-Agent": "Mozilla/5.0 TennisArc/1.0" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`qual_chall CSV HTTP ${res.status} for ${tour} ${year}`);
  return res.text();
}

/** WTA ITF tiers we count (>= $50K). ATP qual_chall needs no prize filter (all challengers count). */
export const WTA_ITF_MIN_TIERS = new Set(["50", "75", "80", "100", "125"]);

/** Keep a WTA qual_itf row only if its tourney_level is a >= $50K ITF tier, OR a non-ITF level
 *  (letters like W/P/PM/I/G/M — i.e. not a bare dollar-tier number). Sub-$50K numeric tiers drop. */
export const keepWtaQualItf = (level: string): boolean =>
  WTA_ITF_MIN_TIERS.has(level) || !/^\d+$/.test(level);

// Plausibility ceiling for trustworthy on-court time (Jeff Sackmann's `minutes`). The longest match in
// tennis history is Isner–Mahut 2010 (665 min ≈ 11h05), so nothing genuine exceeds 12h; this caps the
// CSV merge so a poisoned upstream `minutes` can't ship an absurd duration. Isner–Mahut's 39 900s and
// Anderson–Isner's 23 760s stay.
export const MAX_SANE_SEC = 43_200;

// Tighter bound for SofaScore-derived values (live periodN + carried-forward local values). periodN
// counts rain/curfew suspensions as play time, and a suspended match's wall-clock starts just above 6h
// (observed floor ~21675s), overlapping genuine epics — so the two can't be told apart by magnitude.
// Cap at 6h: conservative against suspension garbage, at the cost of clipping the rare genuine >6h match
// live; Sackmann's official `minutes` backfills that within a day (see applyDurations). The sources
// differ in trust, so they get different ceilings — never widen this one to MAX_SANE_SEC.
export const MAX_LOCAL_SEC = 21_600;

export interface SlamDurationRow {
  roundIndex: number;
  winnerName: string;
  loserName: string;
  durationSec: number | null;
}

/** Parse a Sackmann yearly matches CSV down to one slam's main-draw duration rows. The bare-`,`
 *  split is safe for Sackmann's quote-free schema (none of the columns used carry a comma); it
 *  would need a real CSV parser only if that upstream format ever changes. */
export function parseMatchesCsv(csv: string, slam: string): SlamDurationRow[] {
  const names = new Set(TOURNEY[slam] ?? []);
  const lines = csv.split(/\r?\n/);
  const header = lines[0]?.split(",") ?? [];
  const col = (n: string): number => header.indexOf(n);
  const [iName, iRound, iMin, iWin, iLose] =
    [col("tourney_name"), col("round"), col("minutes"), col("winner_name"), col("loser_name")];
  if ([iName, iRound, iMin, iWin, iLose].includes(-1)) return [];

  const out: SlamDurationRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (!names.has(cols[iName]?.toLowerCase() ?? "")) continue;
    const roundIndex = ROUND[cols[iRound] ?? ""];
    if (roundIndex === undefined) continue;
    const min = Number(cols[iMin]);
    out.push({
      roundIndex,
      winnerName: cols[iWin] ?? "",
      loserName: cols[iLose] ?? "",
      durationSec: cols[iMin] && Number.isFinite(min) && min > 0 ? Math.round(min * 60) : null,
    });
  }
  return out;
}

export interface DurationStats { fromCsv: number; keptLocal: number; dropped: number; unmatched: number }

/**
 * Mutate matches: per finished/retired match, prefer the Sackmann duration (exact name join, then
 * surname+initial fallback, capped at MAX_SANE_SEC); else keep a local value within the tighter
 * MAX_LOCAL_SEC SofaScore bound; else null. Ambiguous fallback keys (two CSV rows sharing one
 * signature) join nothing rather than risk a wrong row.
 */
export function applyDurations(
  matches: Record<string, Match>, players: Record<string, Player>, rows: SlamDurationRow[],
): DurationStats {
  const exact = new Map<string, SlamDurationRow>();
  const fuzzy = new Map<string, SlamDurationRow | null>(); // null = ambiguous
  for (const r of rows) {
    // exact keys are (round, sorted full-name pair): a single-elimination draw can't stage the same
    // pair twice in one round, so an unguarded set can't mis-join (unlike the fuzzy signature below).
    exact.set(pairKey(r.roundIndex, fullKey(r.winnerName), fullKey(r.loserName)), r);
    const k = pairKey(r.roundIndex, sigKey(r.winnerName), sigKey(r.loserName));
    fuzzy.set(k, fuzzy.has(k) ? null : r);
  }

  const stats: DurationStats = { fromCsv: 0, keptLocal: 0, dropped: 0, unmatched: 0 };
  for (const m of Object.values(matches)) {
    if ((m.status !== "finished" && m.status !== "retired") || !m.p1 || !m.p2) continue;
    const n1 = players[m.p1]?.name ?? "";
    const n2 = players[m.p2]?.name ?? "";
    const row =
      exact.get(pairKey(m.roundIndex, fullKey(n1), fullKey(n2))) ??
      fuzzy.get(pairKey(m.roundIndex, sigKey(n1), sigKey(n2)));
    if (row?.durationSec != null && row.durationSec <= MAX_SANE_SEC) {
      m.durationSec = row.durationSec;
      m.durationProvisional = false;
      stats.fromCsv++;
    } else if (m.durationSec != null && m.durationSec <= MAX_LOCAL_SEC) {
      stats.keptLocal++;
    } else if (m.durationSec != null) {
      m.durationSec = null;
      m.durationProvisional = false; // a dropped (unknown) duration is no longer "provisional"
      stats.dropped++;
    } else {
      stats.unmatched++;
    }
  }
  return stats;
}

/** Fetch + parse one tour-year Sackmann matches file (plain HTTPS GitHub raw). */
export async function fetchMatchesCsv(tour: Tour, year: number): Promise<string> {
  const res = await fetch(MATCHES_URL(tour, year), { headers: { "User-Agent": "Mozilla/5.0 TennisArc/1.0" } });
  if (!res.ok) throw new Error(`matches CSV HTTP ${res.status} for ${tour} ${year}`);
  return res.text();
}
