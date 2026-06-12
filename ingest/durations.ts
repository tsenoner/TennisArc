import type { Match, Player, Tour } from "../src/model";

// Historical durations come from Jeff Sackmann's tennis_atp / tennis_wta CSVs (CC BY-NC-SA 4.0):
// SofaScore's time.periodN is absent pre-mid-2014, has whole-event holes, and counts rain/curfew
// suspensions as play time. Sackmann's `minutes` is official on-court time (Isner–Mahut = 665).
const MATCHES_URL = (tour: Tour, year: number): string => {
  const t = tour.toLowerCase();
  return `https://raw.githubusercontent.com/JeffSackmann/tennis_${t}/master/${t}_matches_${year}.csv`;
};

// Longest genuine slam match in the covered era is well under 6h; SofaScore's suspension
// wall-clock values start just above it (observed floor 21675s). Local values past the bound
// are garbage, not marathons.
const MAX_SANE_SEC = 21_600;

// Sackmann tourney_name variants per slam key (compared lowercased; 2024 files say "Us Open").
const TOURNEY: Record<string, string[]> = {
  "australian-open": ["australian open"],
  "roland-garros": ["roland garros", "french open"],
  wimbledon: ["wimbledon"],
  "us-open": ["us open"],
};
const ROUND: Record<string, number> = { R128: 0, R64: 1, R32: 2, R16: 3, QF: 4, SF: 5, F: 6 };

export interface SlamDurationRow {
  roundIndex: number;
  winnerName: string;
  loserName: string;
  durationSec: number | null;
}

/** Lowercased letter-only name tokens. Hyphens split tokens (Auger-Aliassime ↔ "Auger Aliassime");
 *  apostrophes don't (O'Connell ↔ "Oconnell"). Ł/ł need an explicit map — NFD can't decompose them. */
function nameTokens(name: string): string[] {
  return name
    .replace(/[Łł]/g, "l")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[\s-]+/)
    .map((t) => t.replace(/[^a-z]/g, ""))
    .filter(Boolean);
}

const fullKey = (name: string): string => nameTokens(name).join("");
/** Abbreviation-tolerant signature: surname + first initial ("A. van Uytvanck" ↔ "Alison Van Uytvanck"). */
const sigKey = (name: string): string => {
  const t = nameTokens(name);
  return t.length ? `${t[t.length - 1]}:${t[0][0]}` : "";
};
const pairKey = (roundIndex: number, a: string, b: string): string => `${roundIndex}|${[a, b].sort().join("~")}`;

/** Parse a Sackmann yearly matches CSV down to one slam's main-draw duration rows. */
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
 * Mutate matches: per finished/retired match, prefer the Sackmann duration (exact name join,
 * then surname+initial fallback); else keep a plausible local value; else null. Ambiguous
 * fallback keys (two CSV rows sharing one signature) join nothing rather than risk a wrong row.
 */
export function applyDurations(
  matches: Record<string, Match>, players: Record<string, Player>, rows: SlamDurationRow[],
): DurationStats {
  const exact = new Map<string, SlamDurationRow>();
  const fuzzy = new Map<string, SlamDurationRow | null>(); // null = ambiguous
  for (const r of rows) {
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
    if (row?.durationSec != null) {
      m.durationSec = row.durationSec;
      m.durationProvisional = false;
      stats.fromCsv++;
    } else if (m.durationSec != null && m.durationSec <= MAX_SANE_SEC) {
      stats.keptLocal++;
    } else if (m.durationSec != null) {
      m.durationSec = null;
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
