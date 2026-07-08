import type { Match, Player, Tour } from "../src/model";
import { ROUND, TOURNEY, fullKey, pairKey, sigKey } from "./names";
import { matchesUrl, qualChallUrl } from "./sources";

// Historical durations come from Jeff Sackmann's schema (`minutes` = official on-court time,
// Isner–Mahut = 665): SofaScore's time.periodN is absent pre-mid-2014, has whole-event holes, and
// counts rain/curfew suspensions as play time. Sackmann's ATP repo is 404 (#41), so ATP now reads
// the TML mirror (same columns + an extra `indoor` col, tolerated by the header-based parse); WTA
// stays on Sackmann. Both source URLs are resolved per-tour in sources.ts.

/** Fetch the qual/challenger file; returns null on 404 (some early years are absent) rather than throw. */
export async function fetchQualChallCsv(tour: Tour, year: number): Promise<string | null> {
  const res = await fetch(qualChallUrl(tour, year), { headers: { "User-Agent": "Mozilla/5.0 TennisArc/1.0" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`qual_chall CSV HTTP ${res.status} for ${tour} ${year}`);
  return res.text();
}

/** WTA ITF prize tiers we count (TA's rule is ">= $50K"): 50, 60, 75, 80, 100, 125. Including the $60K
 *  tier slightly improves our match to TA's board once the injury dock is tour-scaled. ATP qual_chall
 *  needs no prize filter (all challengers count). ($60K was previously omitted, dropping ~6.7k rows.) */
export const WTA_ITF_MIN_TIERS = new Set(["50", "60", "75", "80", "100", "125"]);

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

// Plausibility ceiling for a SINGLE set's on-court seconds. In the tiebreak era (all four slams use a
// final-set tiebreak since 2022) no set runs close to 3h — the longest realistic set is a marathon
// 7-6 tiebreak set around ~90min. A rain/curfew suspension instead bloats the ONE set that spanned the
// stoppage to many hours (observed 59 818s and 65 336s ≈ 16–18h overnight at Wimbledon 2026) while the
// other sets stay normal. 3h is far above any genuine set yet far below that suspension wall-clock, so
// it cleanly isolates the corrupted period without ever clipping a real one (see recoverLocalDurationSec).
export const MAX_SET_SEC = 10_800;

/** The per-set on-court seconds from a SofaScore `time` object (its `periodN` keys, missing coerced to
 *  0), so the periodN filter lives in one place for both suspension helpers below. */
function periodSeconds(time: Record<string, number | undefined>): number[] {
  return Object.entries(time)
    .filter(([k]) => /^period\d+$/.test(k))
    .map(([, v]) => v ?? 0);
}

/** True when any per-set time.periodN exceeds the plausible single-set ceiling — the signature of a
 *  rain/curfew suspension folded into one set (see recoverLocalDurationSec). Used to mark a finished
 *  match as having been suspended even after SofaScore drops back to a plain "finished" status. */
export function hasSuspendedPeriod(time: Record<string, number | undefined>): boolean {
  return periodSeconds(time).some((s) => s > MAX_SET_SEC);
}

/**
 * Best-estimate on-court seconds for a FINISHED/RETIRED match from SofaScore's per-set `time.periodN`,
 * healing the rain/curfew-suspension corruption. When play is suspended (e.g. the 11pm Wimbledon
 * curfew) and resumes the next day, the single set that spanned the stoppage absorbs the entire
 * overnight wall-clock gap (~16–18h) while every other set stays a normal ~40–60min. The previous
 * logic summed all periods and, finding the total over the 6h bound, nulled the whole match — so a
 * completed first-rounder rendered as an unplayed grey scaffold for days until Sackmann's official
 * minutes arrived. Instead: sum the plausible sets (≤ MAX_SET_SEC) and estimate each inflated set as
 * the mean of the plausible ones, giving a realistic duration immediately that Sackmann later refines.
 *
 * Returns null when there's no usable signal — no period entries; EVERY set implausibly long (can't
 * distinguish a genuine >6h epic from uniform garbage); FEWER THAN TWO clean sets to anchor an estimate
 * when a set is inflated (a lone short retirement set is no template for a suspended full set, so
 * extrapolating from it would mint an absurd duration); or a recovered total past the 6h local bound.
 * A null finished duration is later restored from Sackmann's CSV.
 */
export function recoverLocalDurationSec(time: Record<string, number | undefined>): number | null {
  const periods = periodSeconds(time).filter((s) => s > 0);
  const clean = periods.filter((s) => s <= MAX_SET_SEC);
  const inflatedCount = periods.length - clean.length;
  // Healing an inflated set means estimating its on-court time as the mean of the un-suspended sets —
  // only trustworthy with ≥2 representative anchors. With fewer (e.g. a lone short/retirement set beside
  // a suspended full set) the mean badly under/over-shoots, so defer to Sackmann rather than ship a
  // wrong, authoritative-looking value. (No inflated sets → no estimation → a single clean set is fine.)
  if (inflatedCount > 0 && clean.length < 2) return null;
  if (!clean.length) return null; // no period entries at all
  const cleanSum = clean.reduce((a, b) => a + b, 0);
  const total = inflatedCount === 0 ? cleanSum : cleanSum + inflatedCount * (cleanSum / clean.length);
  return total > 0 && total <= MAX_LOCAL_SEC ? Math.round(total) : null;
}

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

/** Fetch + parse one tour-year matches file (plain HTTPS GET; provider resolved in sources.ts). */
export async function fetchMatchesCsv(tour: Tour, year: number): Promise<string> {
  const res = await fetch(matchesUrl(tour, year), { headers: { "User-Agent": "Mozilla/5.0 TennisArc/1.0" } });
  if (!res.ok) throw new Error(`matches CSV HTTP ${res.status} for ${tour} ${year}`);
  return res.text();
}
