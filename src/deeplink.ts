import type { Match, Player } from "./model";

/** Lowercase, accent-stripped, hyphenated slug (cosmetic — SofaScore resolves by customId). */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // combining diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return s || "match";
}

/**
 * Deep link to a match on SofaScore. The trailing customId is the real key; the
 * slug is cosmetic (a wrong slug still resolves). Opens the native app via
 * Universal/App Links when installed, else the web page. Null if we have no id.
 */
export function sofascoreMatchUrl(match: Match, p1: Player | null, p2: Player | null): string | null {
  if (!match.sofaCustomId) return null;
  const slug = p1 && p2 ? `${slugify(p1.name)}-${slugify(p2.name)}` : "match";
  return `https://www.sofascore.com/tennis/match/${slug}/${match.sofaCustomId}`;
}
