import type { Player, Tour } from "../src/model";
import { normalizeName } from "./elo";
import { PROVIDER, type Provider, playersUrl } from "./sources";

const dobToIso = (dob: string): string | null =>
  /^\d{8}$/.test(dob) ? `${dob.slice(0, 4)}-${dob.slice(4, 6)}-${dob.slice(6, 8)}` : null;

const unquote = (s: string): string => {
  const t = s.trim();
  return t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
};

/** Sackmann players CSV: bare comma-delimited, fixed columns name_first[1], name_last[2], dob[4]. */
function parseSackmannPlayers(csv: string): Map<string, string> {
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

/** TML ATP_Database.csv: quoted CSV; full name in `player`, dob (YYYYMMDD) in `birthdate`, read by
 *  header name. Comma-split + unquote is safe — the columns up to and including birthdate
 *  (id / player / atpname) carry no embedded commas for ATP names. */
function parseTmlPlayers(csv: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = csv.split(/\r?\n/);
  const header = (lines[0]?.split(",") ?? []).map(unquote);
  const iName = header.indexOf("player");
  const iDob = header.indexOf("birthdate");
  if (iName === -1 || iDob === -1) return out;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const iso = dobToIso(unquote(cols[iDob] ?? ""));
    if (!iso) continue;
    const key = normalizeName(unquote(cols[iName] ?? ""));
    if (key && !out.has(key)) out.set(key, iso); // keep first (CSV is roughly chronological)
  }
  return out;
}

/** Parse a players CSV into a normalized-full-name → ISO-birthdate map, per the provider's schema. */
export function parsePlayersCsv(csv: string, schema: Provider = "sackmann"): Map<string, string> {
  return schema === "tml" ? parseTmlPlayers(csv) : parseSackmannPlayers(csv);
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

/** Fetch + parse the player file for a tour (plain HTTPS GET; provider/schema resolved in sources.ts). */
export async function fetchPlayers(tour: Tour): Promise<Map<string, string>> {
  const res = await fetch(playersUrl(tour), { headers: { "User-Agent": "Mozilla/5.0 TennisArc/1.0" } });
  if (!res.ok) throw new Error(`players HTTP ${res.status} for ${tour}`);
  return parsePlayersCsv(await res.text(), PROVIDER[tour]);
}
