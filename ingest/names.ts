// Shared name-join primitives for joining Jeff Sackmann CSV rows onto SofaScore-sourced
// snapshots (the two sources use different player ids, so every join is by name). Extracted
// verbatim from durations.ts so durations / finals / seeds / historical-elo all share one
// implementation — keep behaviour byte-identical (durations.test.ts pins it).

// Sackmann tourney_name variants per slam key (compared lowercased; 2024 files say "Us Open").
export const TOURNEY: Record<string, string[]> = {
  "australian-open": ["australian open"],
  "roland-garros": ["roland garros", "french open"],
  wimbledon: ["wimbledon"],
  "us-open": ["us open"],
};
export const ROUND: Record<string, number> = { R128: 0, R64: 1, R32: 2, R16: 3, QF: 4, SF: 5, F: 6 };

/** Lowercased letter-only name tokens. Hyphens split tokens (Auger-Aliassime ↔ "Auger Aliassime");
 *  apostrophes don't (O'Connell ↔ "Oconnell"). Ł/ł need an explicit map — NFD can't decompose them. */
export function nameTokens(name: string): string[] {
  return name
    .replace(/[Łł]/g, "l")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[\s-]+/)
    .map((t) => t.replace(/[^a-z]/g, ""))
    .filter(Boolean);
}

export const fullKey = (name: string): string => nameTokens(name).join("");
/** Abbreviation-tolerant signature: surname + first initial ("A. van Uytvanck" ↔ "Alison Van Uytvanck"). */
export const sigKey = (name: string): string => {
  const t = nameTokens(name);
  return t.length ? `${t[t.length - 1]}:${t[0][0]}` : "";
};
export const pairKey = (roundIndex: number, a: string, b: string): string => `${roundIndex}|${[a, b].sort().join("~")}`;
