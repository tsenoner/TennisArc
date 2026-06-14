import type { Player, PlayerElo } from "../src/model";
import { fullKey, sigKey } from "./names";

// Surface-aware Elo computed from Jeff Sackmann's FULL match history (every event per tour, not just
// slams). Ratings are frozen at each slam's start date, then joined into the snapshot players' `elo`
// (overall + per-surface). A Python prototype confirmed acceptance: frozen at Roland-Garros 2016
// start, Djokovic is #1 overall and #1 clay, Nadal #2 clay.
//
// Why not reuse ingest/elo.ts: that module scrapes Tennis Abstract's *current* ratings, which can't
// be rewound to a historical event. This recomputes ratings deterministically from raw results so a
// 2016 snapshot shows 2016 Elo, not today's.

/**
 * Tunable entrant seeding. `seedFor(level, round)` returns the starting rating for a player's first-ever
 * appearance, given the level (tourney_level) and round of that debut match. Tennis Abstract seeds new
 * entrants below 1500 (a "low 1200s" value that depends on debut level); the default keeps 1500 so
 * nothing changes until a config is passed.
 */
export interface EloConfig {
  seedFor: (level: string, round: string) => number;
}

export const DEFAULT_ELO_CONFIG: EloConfig = { seedFor: () => 1500 };

/** Logistic Elo expectation for A beating B. winProbability(r,r) === 0.5, monotonic in (rA - rB). */
export function winProbability(rA: number, rB: number): number {
  return 1 / (1 + 10 ** ((rB - rA) / 400));
}

/** Dynamic K-factor: 250/(priorMatches+5)^0.4 — large when a player is new, shrinking as they settle. */
export function kFactor(priorMatches: number): number {
  return 250 / (priorMatches + 5) ** 0.4;
}

/**
 * Tennis Abstract's surface Elo is a flat 50/50 blend of overall and a pure single-surface rating
 * (TA report page + Heavy Topspin 2017/2019: "50/50 worked for each surface"), applied at ALL sample
 * sizes. `surfaceCount === 0` means the player has never played the surface -> no signal -> null.
 */
export function resolveSurfaceElo(
  surfaceRating: number,
  surfaceCount: number,
  overall: number,
): number | null {
  if (surfaceCount === 0) return null;
  return 0.5 * overall + 0.5 * surfaceRating;
}

export type EloSurface = "Hard" | "Clay" | "Grass";

export interface EloMatchRow {
  tourneyName: string;
  tourneyDate: number; // YYYYMMDD as a number, e.g. 20160523
  surface: EloSurface | null;
  winnerId: string;
  loserId: string;
  winnerName: string;
  loserName: string;
  round: string;
  level: string; // tourney_level (G grand slam, D Davis/team, F finals, M/A/etc.)
}

const SURFACES: Record<string, EloSurface> = { Hard: "Hard", Clay: "Clay", Grass: "Grass" };

/**
 * Parse a Sackmann yearly matches CSV into Elo rows. Header-index lookup; the bare-`,` split is safe
 * for Sackmann's quote-free schema. Rows with an empty winner/loser id or a non-numeric tourney_date
 * are skipped (can't be played into the engine). Unknown/empty surface maps to null (overall-only).
 */
export function parseEloMatchesCsv(csv: string): EloMatchRow[] {
  const lines = csv.split(/\r?\n/);
  const header = lines[0]?.split(",") ?? [];
  const col = (n: string): number => header.indexOf(n);
  const iName = col("tourney_name");
  const iSurf = col("surface");
  const iDate = col("tourney_date");
  const iWid = col("winner_id");
  const iLid = col("loser_id");
  const iWname = col("winner_name");
  const iLname = col("loser_name");
  const iRound = col("round");
  const iLevel = col("tourney_level");
  if ([iName, iDate, iWid, iLid, iWname, iLname, iRound, iLevel].includes(-1)) return [];

  const out: EloMatchRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = line.split(",");
    const winnerId = cols[iWid] ?? "";
    const loserId = cols[iLid] ?? "";
    if (!winnerId || !loserId) continue;
    const date = Number(cols[iDate]);
    if (!Number.isFinite(date) || !cols[iDate]) continue;
    out.push({
      tourneyName: cols[iName] ?? "",
      tourneyDate: date,
      surface: SURFACES[cols[iSurf] ?? ""] ?? null,
      winnerId,
      loserId,
      winnerName: cols[iWname] ?? "",
      loserName: cols[iLname] ?? "",
      round: cols[iRound] ?? "",
      level: cols[iLevel] ?? "",
    });
  }
  return out;
}

interface RatingState {
  overall: number;
  overallN: number;
  hard: number;
  hardN: number;
  clay: number;
  clayN: number;
  grass: number;
  grassN: number;
  name: string;
}

const freshState = (name: string, seed: number): RatingState => ({
  overall: seed,
  overallN: 0,
  hard: seed,
  hardN: 0,
  clay: seed,
  clayN: 0,
  grass: seed,
  grassN: 0,
  name,
});

/**
 * Incremental surface-aware Elo. Each `update(row)` applies an overall update to both players (each
 * side using its OWN dynamic K from its own prior count) and, if the surface is known, a separate
 * same-surface update with separate per-surface counts. Walkovers/retirements are real results —
 * Sackmann lists a winner, so they move ratings like any other win.
 */
export class EloEngine {
  readonly players = new Map<string, RatingState>();

  constructor(private readonly config: EloConfig = DEFAULT_ELO_CONFIG) {}

  private state(id: string, name: string, level: string, round: string): RatingState {
    let s = this.players.get(id);
    if (!s) {
      s = freshState(name, this.config.seedFor(level, round));
      this.players.set(id, s);
    } else if (name && !s.name) {
      s.name = name;
    }
    return s;
  }

  update(row: EloMatchRow): void {
    const w = this.state(row.winnerId, row.winnerName, row.level, row.round);
    const l = this.state(row.loserId, row.loserName, row.level, row.round);

    // Overall: symmetric update, each side with its own K from its own prior count.
    const eW = winProbability(w.overall, l.overall);
    const kW = kFactor(w.overallN);
    const kL = kFactor(l.overallN);
    w.overall += kW * (1 - eW);
    l.overall += kL * (0 - (1 - eW)); // expectation for the loser is (1 - eW)
    w.overallN += 1;
    l.overallN += 1;

    const surf = row.surface;
    if (surf === "Hard") this.surfaceUpdate(w, l, "hard", "hardN");
    else if (surf === "Clay") this.surfaceUpdate(w, l, "clay", "clayN");
    else if (surf === "Grass") this.surfaceUpdate(w, l, "grass", "grassN");
    // Unknown/empty surface: overall-only (already applied above).
  }

  private surfaceUpdate(
    w: RatingState,
    l: RatingState,
    rk: "hard" | "clay" | "grass",
    nk: "hardN" | "clayN" | "grassN",
  ): void {
    const eW = winProbability(w[rk], l[rk]);
    const kW = kFactor(w[nk]);
    const kL = kFactor(l[nk]);
    w[rk] += kW * (1 - eW);
    l[rk] += kL * (0 - (1 - eW));
    w[nk] += 1;
    l[nk] += 1;
  }
}

export interface ComputedElo extends PlayerElo {
  overall: number;
  hard: number | null;
  clay: number | null;
  grass: number | null;
  /** A representative source name for this rating, used to build the sigKey fallback in apply. */
  name: string;
}

export interface ComputedRatings {
  byId: Map<string, ComputedElo>;
  byName: Map<string, ComputedElo>; // keyed by fullKey(name); ambiguous fullKeys are dropped
}

/**
 * Sort rows into the deterministic replay order: (tourneyDate, original input index). Returns a NEW
 * array (input untouched). Sackmann shares one date across a whole tournament, so the original input
 * index is the only intra-date signal we have — a shuffled input must yield byte-identical output.
 */
export function sortEloRows(rows: EloMatchRow[]): EloMatchRow[] {
  return rows
    .map((row, idx) => ({ row, idx }))
    .sort((a, b) => a.row.tourneyDate - b.row.tourneyDate || a.idx - b.idx)
    .map(({ row }) => row);
}

/**
 * Compute frozen ratings as of `cutoffDate` from rows ALREADY in `sortEloRows` order: feed every row
 * with `tourneyDate < cutoffDate` (strict) into a fresh engine, then resolve per-surface values.
 * The backfill pre-sorts each tour's rows once and reuses this across ~113 snapshots.
 */
export function computeRatingsAsOfSorted(
  sortedRows: EloMatchRow[],
  cutoffDate: number,
  config: EloConfig = DEFAULT_ELO_CONFIG,
): ComputedRatings {
  const engine = new EloEngine(config);
  // Track distinct ids per fullKey so an ambiguous name (two players, one fullKey) can be dropped.
  const idsByName = new Map<string, Set<string>>();
  const noteName = (name: string, id: string): void => {
    const k = fullKey(name);
    if (!k) return;
    let set = idsByName.get(k);
    if (!set) {
      set = new Set();
      idsByName.set(k, set);
    }
    set.add(id);
  };

  for (const row of sortedRows) {
    if (row.tourneyDate >= cutoffDate) continue;
    engine.update(row);
    noteName(row.winnerName, row.winnerId);
    noteName(row.loserName, row.loserId);
  }

  const byId = new Map<string, ComputedElo>();
  const byName = new Map<string, ComputedElo>();
  for (const [id, s] of engine.players) {
    const computed: ComputedElo = {
      name: s.name,
      overall: s.overall,
      hard: resolveSurfaceElo(s.hard, s.hardN, s.overall),
      clay: resolveSurfaceElo(s.clay, s.clayN, s.overall),
      grass: resolveSurfaceElo(s.grass, s.grassN, s.overall),
    };
    byId.set(id, computed);
    const k = fullKey(s.name);
    if (k && idsByName.get(k)?.size === 1) byName.set(k, computed);
  }
  return { byId, byName };
}

/**
 * Compute frozen ratings as of `cutoffDate`: sort rows into deterministic order, then replay. Thin
 * wrapper so a shuffled input yields byte-identical output via `sortEloRows`; equal to
 * `computeRatingsAsOfSorted(sortEloRows(rows), cutoffDate, config)`.
 */
export function computeRatingsAsOf(
  rows: EloMatchRow[],
  cutoffDate: number,
  config: EloConfig = DEFAULT_ELO_CONFIG,
): ComputedRatings {
  return computeRatingsAsOfSorted(sortEloRows(rows), cutoffDate, config);
}

/**
 * Mutate `players`: attach each matched player's frozen ComputedElo by `fullKey(name)`, falling back
 * to `sigKey(name)` (surname+initial). The sigKey fallback joins only when the signature is
 * unambiguous on BOTH sides — within `byName` (two distinct CSV fullKeys sharing one signature map to
 * null) AND within the snapshot (two still-unmatched players sharing one signature: we can't tell
 * which is which, so neither joins). Unmatched players keep their existing `elo` (the caller decides
 * whether to null it).
 */
export function applyHistoricalElo(
  players: Record<string, Player>,
  byName: Map<string, ComputedElo>,
): { matched: number; unmatched: string[] } {
  // sigKey can't be recovered from a fullKey (token boundaries are gone), so build the fallback index
  // from each ComputedElo's source name. A signature shared by two distinct fullKeys is ambiguous and
  // maps to null — those players join nothing rather than risk a wrong rating.
  const bySig = new Map<string, ComputedElo | null>();
  const sigOwner = new Map<string, string>(); // sigKey -> the fullKey that first claimed it
  for (const [fk, elo] of byName) {
    const sk = sigKey(elo.name);
    if (!sk) continue;
    if (!bySig.has(sk)) {
      bySig.set(sk, elo);
      sigOwner.set(sk, fk);
    } else if (sigOwner.get(sk) !== fk) {
      bySig.set(sk, null); // distinct fullKeys collide on one signature -> ambiguous
    }
  }

  let matched = 0;
  const unmatched: string[] = [];

  // Pass 1 — exact fullKey join. Players with no direct hit become sig-fallback candidates.
  const sigCandidates: Player[] = [];
  for (const p of Object.values(players)) {
    const fk = fullKey(p.name);
    const direct = fk ? byName.get(fk) : undefined;
    if (direct) {
      p.elo = eloOf(direct);
      matched++;
    } else {
      sigCandidates.push(p);
    }
  }

  // How many candidates share each signature: when two collide we can't tell which one the CSV's sig
  // owner is, so neither may inherit it (the snapshot-side guard, mirroring seeds.ts applySeeds).
  const sigCandCount = new Map<string, number>();
  for (const p of sigCandidates) {
    const sk = sigKey(p.name);
    if (sk) sigCandCount.set(sk, (sigCandCount.get(sk) ?? 0) + 1);
  }

  // Pass 2 — surname+initial fallback for everything still unmatched after pass 1. A candidate joins
  // only when its sig is unambiguous on the CSV side (bySig non-null) AND on the snapshot side (count 1).
  for (const p of sigCandidates) {
    const sk = sigKey(p.name);
    const hit = sk ? bySig.get(sk) : undefined;
    if (hit && (sigCandCount.get(sk) ?? 0) === 1) {
      p.elo = eloOf(hit);
      matched++;
    } else {
      unmatched.push(p.name);
    }
  }
  return { matched, unmatched };
}

/** Project a ComputedElo down to the PlayerElo stored on the snapshot (drops the source name). */
const eloOf = (c: ComputedElo): PlayerElo => ({
  overall: c.overall,
  hard: c.hard,
  clay: c.clay,
  grass: c.grass,
});
