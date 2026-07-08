// Shared name-join primitives. Moved here from ingest/names.ts so both the ingest pipeline and the
// client (Flashscore live join) share ONE implementation — keep behaviour byte-identical
// (ingest/durations.test.ts + ingest/names.test.ts pin the first four).

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

/** Order-independent key for a name pair: sorted so (a,b) and (b,a) collide. */
export const sortedPairKey = (a: string, b: string): string => [a, b].sort().join("~");

export const pairKey = (roundIndex: number, a: string, b: string): string =>
  `${roundIndex}|${sortedPairKey(a, b)}`;

/** Flashscore lists names surname-first with a trailing initial ("Fritz T.", "Van Uytvanck A.").
 *  Normalize to the SAME "surname:initial" space as sigKey(fullName): the trailing single-letter
 *  token is the first-name initial; the token before it is the (last) surname token — matching
 *  sigKey's last-token surname convention. "" when it can't be keyed. */
export const flashSigKey = (name: string): string => {
  const t = nameTokens(name);
  if (t.length < 2) return "";
  const initial = t[t.length - 1];
  const surname = t[t.length - 2];
  return surname && initial ? `${surname}:${initial[0]}` : "";
};
