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

export interface Player {
  id: string;
  name: string;
  country: string;            // IOC 3-letter
  seed: number | null;
  entry: EntryType;
  ranking: number | null;
  ageYears: number | null;
  sofaSlug: string | null;
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
