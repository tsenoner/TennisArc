export type Tour = "ATP" | "WTA";
export type EntryType = "Q" | "WC" | "LL" | "PR" | null;
export type MatchStatus =
  | "notstarted" | "scheduled" | "live" | "suspended" | "finished" | "retired" | "walkover";

/** The in-progress statuses: a match being played, or one paused mid-play (rain/bad light/curfew).
 *  Both accrue provisional time and read as "in progress" to the time leaderboard and the slam-status
 *  classifier — the single source of truth so a future in-progress status lands in one place. (The arc
 *  layer keeps `live` and `suspended` separate on purpose: they get distinct visual tiers.) */
export const isInProgress = (status: MatchStatus): boolean =>
  status === "live" || status === "suspended";

/** The not-yet-played statuses: a match with a known slot ("scheduled") or one still fed by
 *  placeholders ("notstarted"). The single source of truth for the order-of-play surfaces —
 *  scheduledInfo's display allowlist and normalize's coarse-stamp gate must never drift apart. */
export const isUpcoming = (status: MatchStatus): boolean =>
  status === "scheduled" || status === "notstarted";

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
  /** Sticky: set once a stoppage is observed (live, via the currentPeriodStartTimestamp signal) or
   *  inferred (a finished match whose per-set time.periodN carries a suspension-inflated set). Persists
   *  across refreshes (carryForwardSuspended) so a finished-but-once-suspended match stays flagged even
   *  after SofaScore drops back to a plain code-100 "finished" with no stoppage marker. Absent = false. */
  wasSuspended?: boolean;
  /** Order-of-play display fields, re-derived every refresh. `scheduledStart` (Unix seconds) is
   *  stamped by normalizeCuptrees for EVERY not-yet-played match, all rounds to the Final, from the
   *  cuptrees block's seriesStartDateTimestamp — a shared nominal round-day time on future rounds.
   *  For the scheduled matches whose per-event detail is fetched, enrichMatch overrides it with
   *  the published per-event startTimestamp and sets `scheduledPrecise`. Display is uniform —
   *  every tier shows a date + provisional time; the flag governs HIDE RULES only (a precise slot
   *  hides >6h past, a nominal one survives until its VENUE day ends — see `scheduledInfo`).
   *  `scheduledCourt` is per-event too, so it exists only where detail was fetched. */
  scheduledStart?: number;
  scheduledPrecise?: boolean;
  scheduledCourt?: string;
  sofaEventId: number | null;
  sofaCustomId: string | null;
  stats: MatchStats | null;
}

/** A live/finished/scheduled match extracted from the Flashscore livescore feed (server-parsed by
 *  ingest/flashscore.ts, joined onto the snapshot client-side by src/live.ts). Names are
 *  Flashscore's surname-first short form ("Fritz T."). */
export interface LiveRecord {
  id: string;
  stage: 1 | 2 | 3;              // 1 scheduled, 2 live, 3 finished
  home: string;
  away: string;
  setsWon: [number, number];     // [home, away]
  sets: Array<[number, number]>; // per-set games [home, away], in order
  srv?: 1 | 2;                   // current server (CX), live records only — 1 home, 2 away
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
