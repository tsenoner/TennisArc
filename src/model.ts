export type Tour = "ATP" | "WTA";
export type EntryType = "Q" | "WC" | "LL" | "PR" | null;
export type MatchStatus =
  | "notstarted" | "scheduled" | "live" | "finished" | "retired" | "walkover";

export interface SetScore { p1: number; p2: number; tb?: number; }

export interface MatchStats {
  aces?: [number, number];
  doubleFaults?: [number, number];
  firstServePct?: [number, number];
  servicePointsWonPct?: [number, number];
  breakPointsConverted?: [string, string];
}

export interface PlayerElo {
  overall: number | null;
  hard: number | null;
  clay: number | null;
  grass: number | null;
}

export interface Player {
  id: string;
  name: string;
  country: string;            // IOC 3-letter
  seed: number | null;
  entry: EntryType;
  ranking: number | null;
  ageYears: number | null;
  sofaSlug: string | null;
  elo: PlayerElo | null;
  birthdate: string | null;   // ISO "YYYY-MM-DD" (from Jeff Sackmann player files)
}

/** SofaScore seeds the draw with synthetic "teams" for not-yet-decided future slots — their
 *  `name` is a bracket-slot code (R64P3, R16P1, Qf1, …) rather than a real person. Used by the
 *  ingest (to keep them out of snapshots) and by read-time consumers (to ignore any that slipped
 *  into already-committed snapshots). Matching by the slot-code shape alone is enough at ingest;
 *  `isPlaceholderPlayer` additionally requires empty identity so a real player can never be dropped. */
export const PLACEHOLDER_TEAM_NAME = /^(?:R\d+P\d+|(?:Q|S)F\d+|F\d+)$/i;

/** True when a Player is one of those synthetic future-slot placeholders, not a real draw entrant.
 *  Requires BOTH a slot-code name AND no identity (no country/seed/ranking/elo), so it never
 *  misclassifies a real player. */
export function isPlaceholderPlayer(p: Player): boolean {
  return PLACEHOLDER_TEAM_NAME.test(p.name)
    && p.country === "" && p.seed == null && p.ranking == null && p.elo == null;
}

export interface Match {
  id: string;                 // `${roundIndex}-${slot}`
  roundIndex: number;         // 0 = first round (outer) … last = Final (inner)
  slot: number;               // position within the round
  nextMatchId: string | null; // null only for the Final
  p1: string | null;          // playerId; null = TBD
  p2: string | null;
  status: MatchStatus;
  winner: "p1" | "p2" | null;
  score: SetScore[] | null;
  live: { set: number; game: string; server: "p1" | "p2" } | null;
  durationSec: number | null; // Σ per-set seconds (provisional while live)
  durationProvisional: boolean;
  sofaEventId: number | null;
  sofaCustomId: string | null;
  stats: MatchStats | null;
}

export interface Round {
  index: number;
  name: string;               // "Round of 128" … "Final"
  size: number;               // entrants this round
  matchIds: string[];
}

export interface Snapshot {
  schemaVersion: number;
  generatedAt: string;        // ISO
  tour: Tour;
  tournament: {
    slam: string; name: string; year: number; surface: string;
    sofaUniqueTournamentId: number; sofaSeasonId: number; drawSize: number;
  };
  players: Record<string, Player>;
  matches: Record<string, Match>;
  rounds: Round[];
}

export type SlamStatus = "upcoming" | "live" | "complete";

export interface AvailableSlam {
  tour: Tour;
  year: number;
  slam: string;
  name: string;
  surface: string;
  status: SlamStatus;
  generatedAt: string;
  drawSize: number;
}

export interface SlamIndex {
  schemaVersion: number;
  generatedAt: string;
  slams: AvailableSlam[];
}

/** Canonical per-slam snapshot path under the data root, shared by ingest (writer) and app (reader). */
export function snapshotPath(tour: Tour, year: number, slam: string): string {
  return `slams/${year}/${tour.toLowerCase()}-${slam}.json`;
}
