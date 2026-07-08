import type { Tour } from "../src/model";

/** Which upstream provides a tour's player + match CSVs. */
export type Provider = "sackmann" | "tml";

/**
 * Player/match data provider per tour. Jeff Sackmann's tennis_atp / tennis_wta repos went 404
 * ~2026-07-02 (#41), silently killing birthdate enrichment (every live ingest) plus the duration /
 * seed / finals / Elo-calibration backfills. TML (stats.tennismylife.org) is a near-live ATP mirror
 * that reuses Sackmann's column names, so ATP is repointed there. WTA has no equivalent mirror, so
 * it stays on Sackmann and degrades gracefully — fetchPlayers' 404 is caught and birthdates stay
 * null — until tennis_wta returns. When the Sackmann repos come back, flip a tour to "sackmann" here.
 */
export const PROVIDER: Record<Tour, Provider> = {
  ATP: "tml",
  WTA: "sackmann",
};

const sackmannBase = (tour: Tour): string =>
  `https://raw.githubusercontent.com/JeffSackmann/tennis_${tour.toLowerCase()}/master`;
const TML_BASE = "https://stats.tennismylife.org/data";

/** Player metadata CSV (carries birthdate) for a tour. */
export function playersUrl(tour: Tour): string {
  return PROVIDER[tour] === "tml"
    ? `${TML_BASE}/ATP_Database.csv`
    : `${sackmannBase(tour)}/${tour.toLowerCase()}_players.csv`;
}

/** The layout of a tour's players CSV, selecting how parsePlayersCsv extracts name + dob. */
export function playersSchema(tour: Tour): Provider {
  return PROVIDER[tour];
}

/** Yearly main-draw matches CSV (carries official `minutes` on-court durations). */
export function matchesUrl(tour: Tour, year: number): string {
  return PROVIDER[tour] === "tml"
    ? `${TML_BASE}/${year}.csv`
    : `${sackmannBase(tour)}/${tour.toLowerCase()}_matches_${year}.csv`;
}

/**
 * Qualifying + challenger matches CSV — used only by the offline Elo-calibration backfills, which
 * already fail soft (404 → null / caught). Sackmann bundles quali + challenger into one file
 * (`qual_chall` for ATP, `qual_itf` for WTA); TML publishes challengers as `<year>_challenger.csv`
 * (qualifying rows are not separately mirrored, so TML-sourced ATP calibration omits quallies).
 */
export function qualChallUrl(tour: Tour, year: number): string {
  if (PROVIDER[tour] === "tml") return `${TML_BASE}/${year}_challenger.csv`;
  const stem = tour === "ATP" ? "qual_chall" : "qual_itf";
  return `${sackmannBase(tour)}/${tour.toLowerCase()}_matches_${stem}_${year}.csv`;
}
