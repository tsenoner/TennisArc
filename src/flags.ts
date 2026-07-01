import { FLAG_URLS } from "./flag-assets.gen";

// ISO 3166-1 alpha-3 → alpha-2 for nations that appear in Grand Slam draws.
// A few IOC aliases (SUI, GER, NED, DEN, CRO, BUL, SLO, RSA) are included because
// some feeds use IOC rather than ISO codes. Unknown codes fall back to a white flag.
// Exported so flags.test.ts derives its coverage check from this live map — adding a
// code here without rerunning scripts/gen-flag-assets.mjs then fails CI.
export const ISO3_TO_2: Record<string, string> = {
  ESP: "ES", FRA: "FR", ITA: "IT", DEU: "DE", GER: "DE", GBR: "GB", USA: "US",
  SRB: "RS", RUS: "RU", CHE: "CH", SUI: "CH", AUT: "AT", AUS: "AU", ARG: "AR",
  BRA: "BR", CAN: "CA", CHN: "CN", JPN: "JP", KAZ: "KZ", GRC: "GR", NOR: "NO",
  DNK: "DK", DEN: "DK", SWE: "SE", NLD: "NL", NED: "NL", BEL: "BE", POL: "PL",
  CZE: "CZ", SVK: "SK", HRV: "HR", CRO: "HR", BGR: "BG", BUL: "BG", HUN: "HU",
  ROU: "RO", PRT: "PT", POR: "PT", FIN: "FI", UKR: "UA", BLR: "BY", GEO: "GE",
  CHL: "CL", COL: "CO", PER: "PE", URY: "UY", PRY: "PY", ECU: "EC", BOL: "BO",
  VEN: "VE", MEX: "MX", IND: "IN", KOR: "KR", TWN: "TW", TPE: "TW", THA: "TH",
  HKG: "HK", ISR: "IL", TUR: "TR", EGY: "EG", TUN: "TN", MAR: "MA", ZAF: "ZA",
  RSA: "ZA", NZL: "NZ", MDA: "MD", BIH: "BA", SVN: "SI", SLO: "SI", EST: "EE",
  LVA: "LV", LTU: "LT", CYP: "CY", LUX: "LU", MCO: "MC", SMR: "SM", SAU: "SA",
  UZB: "UZ", LBN: "LB", JOR: "JO", AND: "AD", ARM: "AM", BRB: "BB", DOM: "DO",
  IDN: "ID", IRL: "IE", JAM: "JM", LIE: "LI", MKD: "MK", MNE: "ME", PHL: "PH",
  PRI: "PR",
};

/** ISO-3 (or common IOC) → ISO-2, or null if unknown. */
export function iso3to2(code: string): string | null {
  return ISO3_TO_2[code.toUpperCase()] ?? null;
}

/** A country's flag emoji (regional-indicator pair), or 🏳 when the code is unknown.
 *  Fallback only: emoji letter-box on Windows (#6) and WebKit won't paint them on SVG
 *  textPath at all, so anything user-facing should prefer the bundled SVGs below. */
export function flagEmoji(iso3: string): string {
  const a2 = iso3to2(iso3);
  if (!a2) return "🏳";
  return String.fromCodePoint(...[...a2].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** URL of the bundled flag-icons SVG for a country, or null for unmapped codes.
 *  Renders identically on every platform (unlike emoji). */
export function flagAssetUrl(iso3: string): string | null {
  const a2 = iso3to2(iso3);
  return a2 ? FLAG_URLS[a2] ?? null : null;
}
