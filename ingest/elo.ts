import type { Player, PlayerElo } from "../src/model";

/** Lowercase, strip accents and any non-letter, for matching names across data sources. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

export interface EloEntry {
  name: string;
  ageYears: number | null;
  elo: PlayerElo;
}

const stripTags = (s: string): string => s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
const numOrNull = (s: string): number | null => {
  const v = Number.parseFloat(stripTags(s));
  return Number.isFinite(v) ? v : null;
};

/** Parse a Tennis Abstract Elo ratings HTML table into a name→ratings map. */
export function parseEloTable(html: string): Map<string, EloEntry> {
  const out = new Map<string, EloEntry>();
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (cells.length < 11) continue; // header / malformed rows have no <td>s
    const name = stripTags(cells[1]);
    if (!name) continue;
    out.set(normalizeName(name), {
      name,
      ageYears: numOrNull(cells[2]),
      elo: {
        overall: numOrNull(cells[3]),
        hard: numOrNull(cells[6]),
        clay: numOrNull(cells[8]),
        grass: numOrNull(cells[10]),
      },
    });
  }
  return out;
}

/**
 * Mutate `players`: attach ELO and back-fill age from `elo` by normalized name.
 * `aliases` maps a normalized player name → the normalized ELO-table key for known mismatches.
 * Unmatched players get `elo: null`. Returns match stats for logging/curation.
 */
export function applyElo(
  players: Record<string, Player>,
  elo: Map<string, EloEntry>,
  aliases: Record<string, string> = {},
): { matched: number; unmatched: string[] } {
  let matched = 0;
  const unmatched: string[] = [];
  for (const p of Object.values(players)) {
    const norm = normalizeName(p.name);
    const entry = elo.get(aliases[norm] ?? norm);
    if (entry) {
      p.elo = entry.elo;
      if (p.ageYears == null && entry.ageYears != null) p.ageYears = entry.ageYears;
      matched++;
    } else {
      p.elo = null;
      unmatched.push(p.name);
    }
  }
  return { matched, unmatched };
}
