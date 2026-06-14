import type { Player } from "../src/model";
import { ROUND, TOURNEY, fullKey, sigKey } from "./names";

// Historical seeds come from Jeff Sackmann's tennis_atp / tennis_wta CSVs (winner_seed/loser_seed),
// the same source durations.ts uses. Twelve slams shipped with missing or partial seeds because the
// SofaScore draw payload omitted them historically; this re-sources players[*].seed by name-joining
// the snapshot players to the Sackmann rows. A player's seed is constant across all their draw
// matches, so the first row that names them is authoritative.
//
// JOIN POLICY (shared with durations.ts): fullKey exact first, sigKey (surname+initial) fallback,
// and an *ambiguous* sigKey (two distinct full names share it) joins nothing — never a wrong seed.
// On top of that, a sigKey fallback may never hand a player a seed already claimed by another player
// (THE PLISKOVA GUARD): Karolina Pliskova (seed 11) joins by fullKey; her unseeded twin Kristyna
// shares sigKey "pliskova:k" and must stay null rather than inherit 11.

export interface SeedMap {
  byFull: Map<string, number>;        // fullKey(name) -> seed
  sigOwner: Map<string, number | null>; // sigKey(name) -> seed iff one full name owns the sig, else null
}

export interface SeedStats {
  filledFull: number;       // assigned via exact fullKey join
  filledSig: number;        // assigned via surname+initial fallback
  sigAmbiguousSkip: number; // fallback skipped: sigKey owned by >1 distinct full name
  alreadySeeded: number;    // left untouched (merge mode, existing non-null seed)
  takenSkip: number;        // fallback skipped: that seed already claimed (twin guard)
  unjoined: number;         // no fullKey and no sigKey match at all
}

/** Parse a Sackmann yearly matches CSV down to one slam's main-draw seed map. Only numeric seeds
 *  (`/^\d+$/`) count — entry codes (WC/Q/LL) live in the separate *_entry column and the snapshot
 *  `entry` field, never in `*_seed`. The bare-`,` split is safe for Sackmann's quote-free schema
 *  (none of the columns used carry a comma), matching parseMatchesCsv in durations.ts. */
export function parseSeedsCsv(csv: string, slam: string): SeedMap {
  const names = new Set(TOURNEY[slam] ?? []);
  const lines = csv.split(/\r?\n/);
  const header = lines[0]?.split(",") ?? [];
  const col = (n: string): number => header.indexOf(n);
  const [iName, iRound, iWinN, iWinS, iLoseN, iLoseS] = [
    col("tourney_name"), col("round"),
    col("winner_name"), col("winner_seed"),
    col("loser_name"), col("loser_seed"),
  ];

  const byFull = new Map<string, number>();
  // sig -> set of distinct fullKeys seen; resolves to a single seed only when one full name owns it.
  const sigFulls = new Map<string, Set<string>>();
  const fullSeed = new Map<string, number>();

  if ([iName, iRound, iWinN, iWinS, iLoseN, iLoseS].includes(-1)) {
    return { byFull, sigOwner: new Map() };
  }

  const collect = (name: string, seedRaw: string): void => {
    if (!/^\d+$/.test(seedRaw)) return; // numeric seeds only; entry codes / blanks skipped
    const seed = Number(seedRaw);
    const fk = fullKey(name);
    if (!fk) return;
    byFull.set(fk, seed);
    fullSeed.set(fk, seed);
    const sk = sigKey(name);
    if (sk) (sigFulls.get(sk) ?? sigFulls.set(sk, new Set()).get(sk)!).add(fk);
  };

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (!names.has(cols[iName]?.toLowerCase() ?? "")) continue;
    if (ROUND[cols[iRound] ?? ""] === undefined) continue;
    collect(cols[iWinN] ?? "", cols[iWinS] ?? "");
    collect(cols[iLoseN] ?? "", cols[iLoseS] ?? "");
  }

  const sigOwner = new Map<string, number | null>();
  for (const [sk, fulls] of sigFulls) {
    sigOwner.set(sk, fulls.size === 1 ? fullSeed.get([...fulls][0])! : null);
  }
  return { byFull, sigOwner };
}

/**
 * Mutate players[*].seed from a SeedMap in two passes. Pass 1 joins by exact fullKey and records each
 * assigned seed in a `taken` set. Pass 2 falls back to the surname+initial signature, but skips a
 * fallback whose seed is already `taken` (the Pliskova twin guard) or whose sig is ambiguous.
 *
 * Default overwrite=false => MERGE: a player who already has a non-null seed is left exactly as-is
 * (counted alreadySeeded). Seeds present in the snapshot before this run also pre-occupy `taken`, so
 * a fallback can't duplicate them. Never fabricates a seed to reach 32; only players named in the CSV
 * get one. Mutates only players[id].seed.
 */
export function applySeeds(
  players: Record<string, Player>, seedMap: SeedMap, opts?: { overwrite?: boolean },
): SeedStats {
  const overwrite = opts?.overwrite ?? false;
  const stats: SeedStats = {
    filledFull: 0, filledSig: 0, sigAmbiguousSkip: 0, alreadySeeded: 0, takenSkip: 0, unjoined: 0,
  };
  const list = Object.values(players);

  // Seeds already on the snapshot occupy `taken` so a fallback can't duplicate an existing seed.
  const taken = new Set<number>();
  if (!overwrite) for (const p of list) if (p.seed !== null) taken.add(p.seed);

  // Pass 1 — exact fullKey join.
  const sigCandidates: Player[] = [];
  for (const p of list) {
    if (p.seed !== null && !overwrite) { stats.alreadySeeded++; continue; }
    const seed = seedMap.byFull.get(fullKey(p.name));
    if (seed !== undefined) {
      p.seed = seed;
      taken.add(seed);
      stats.filledFull++;
    } else {
      sigCandidates.push(p);
    }
  }

  // Pass 2 — surname+initial fallback for everything still unseeded after pass 1.
  for (const p of sigCandidates) {
    const owner = seedMap.sigOwner.get(sigKey(p.name));
    if (owner === undefined) {
      stats.unjoined++;          // no fullKey and no sigKey match at all
    } else if (owner === null) {
      stats.sigAmbiguousSkip++;  // sig owned by >1 distinct full name
    } else if (taken.has(owner)) {
      stats.takenSkip++;         // twin guard: that seed already belongs to someone
    } else {
      p.seed = owner;
      taken.add(owner);
      stats.filledSig++;
    }
  }
  return stats;
}

/** Count distinct numeric seeds the Sackmann CSV declares for this draw — the target ceiling used by
 *  the backfill to decide whether a snapshot is under-seeded (so we never touch fully-seeded draws). */
export function distinctSeedCount(seedMap: SeedMap): number {
  return new Set(seedMap.byFull.values()).size;
}
