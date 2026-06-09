import type { Player, Tour } from "../src/model";
import { normalizeName } from "./elo";

const PLAYERS_URL: Record<Tour, string> = {
  ATP: "https://raw.githubusercontent.com/JeffSackmann/tennis_atp/master/atp_players.csv",
  WTA: "https://raw.githubusercontent.com/JeffSackmann/tennis_wta/master/wta_players.csv",
};

const dobToIso = (dob: string): string | null =>
  /^\d{8}$/.test(dob) ? `${dob.slice(0, 4)}-${dob.slice(4, 6)}-${dob.slice(6, 8)}` : null;

/** Parse a Sackmann players CSV into a normalized-full-name → ISO-birthdate map. */
export function parsePlayersCsv(csv: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = csv.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 5) continue;
    const iso = dobToIso(cols[4]?.trim() ?? "");
    if (!iso) continue;
    const key = normalizeName(`${cols[1]} ${cols[2]}`);
    if (key && !out.has(key)) out.set(key, iso); // keep first (CSV is roughly chronological)
  }
  return out;
}

/** Mutate players: set birthdate from the DOB map by normalized full name. */
export function applyBirthdates(players: Record<string, Player>, dob: Map<string, string>): { matched: number; unmatched: number } {
  let matched = 0, unmatched = 0;
  for (const p of Object.values(players)) {
    const iso = dob.get(normalizeName(p.name));
    if (iso) { p.birthdate = iso; matched++; } else { unmatched++; }
  }
  return { matched, unmatched };
}

/** Fetch + parse the Sackmann player file for a tour (plain HTTPS GitHub raw). */
export async function fetchPlayers(tour: Tour): Promise<Map<string, string>> {
  const res = await fetch(PLAYERS_URL[tour], { headers: { "User-Agent": "Mozilla/5.0 TennisArc/1.0" } });
  if (!res.ok) throw new Error(`players HTTP ${res.status} for ${tour}`);
  return parsePlayersCsv(await res.text());
}
