import type { Match, Player, Round, Snapshot, Tour } from "../model";

// deterministic PRNG (mulberry32) — no Math.random, reproducible in tests
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COUNTRIES = ["ITA", "ESP", "USA", "FRA", "SRB", "GER", "GBR", "AUS", "RUS", "ARG"];
// keyed by entrants-in-round: 128→"Round of 128" … 2→"Final"
const ROUND_NAMES: Record<number, string> = {
  128: "Round of 128", 64: "Round of 64", 32: "Round of 32", 16: "Round of 16",
  8: "Quarterfinal", 4: "Semifinal", 2: "Final",
};

export interface SyntheticOpts { tour: Tour; drawSize: number; seed?: number; completedRounds?: number; }

/** Build a balanced single-elimination draw with deterministic pseudo-results. */
export function makeSyntheticSnapshot(opts: SyntheticOpts): Snapshot {
  const { tour, drawSize, seed = 1 } = opts;
  const rounds = Math.log2(drawSize);
  if (!Number.isInteger(rounds)) throw new Error("drawSize must be a power of 2");
  const completedRounds = opts.completedRounds ?? rounds; // default: whole draw played
  const rand = rng(seed);

  const players: Record<string, Player> = {};
  for (let i = 0; i < drawSize; i++) {
    const id = `p${i}`;
    players[id] = {
      id, name: `Player ${i}`, country: COUNTRIES[i % COUNTRIES.length],
      seed: i < 32 ? i + 1 : null, entry: null,
      ranking: i + 1, ageYears: 18 + Math.floor(rand() * 18),
      sofaSlug: `player-${i}`, elo: null,
    };
  }

  const matches: Record<string, Match> = {};
  const roundsArr: Round[] = [];
  // round 0 (outer) entrants = players in seed/draw order
  let entrants: (string | null)[] = Object.keys(players);

  for (let r = 0; r < rounds; r++) {
    const size = entrants.length;          // entrants this round
    const matchIds: string[] = [];
    const winners: (string | null)[] = [];
    for (let slot = 0; slot < size / 2; slot++) {
      const p1 = entrants[slot * 2];
      const p2 = entrants[slot * 2 + 1];
      const id = `${r}-${slot}`;
      matchIds.push(id);
      const nextMatchId = r === rounds - 1 ? null : `${r + 1}-${Math.floor(slot / 2)}`;
      const played = r < completedRounds && p1 != null && p2 != null;
      const winSide: "p1" | "p2" = rand() < 0.5 ? "p1" : "p2";
      const sets = 2 + Math.floor(rand() * 2);                  // 2–3 sets
      const durationSec = 60 * (75 + Math.floor(rand() * 110)); // 75–185 min
      const loserGames = 2 + Math.floor(rand() * 3);           // 2–4 games
      if (played) {
        const winner = winSide === "p1" ? (p1 as string) : (p2 as string);
        matches[id] = {
          id, roundIndex: r, slot, nextMatchId, p1, p2,
          status: "finished",
          winner: winSide,
          score: Array.from({ length: sets }, () => ({ p1: 6, p2: loserGames })),
          live: null,
          durationSec,
          durationProvisional: false,
          sofaEventId: 1000 + r * 100 + slot,
          sofaCustomId: `cid${r}_${slot}`,
          stats: {
            aces: [3 + ((r * 7 + slot) % 18), 2 + ((r * 5 + slot + 3) % 15)],
            doubleFaults: [1 + ((slot + r) % 5), 1 + ((slot + r + 2) % 6)],
            firstServePct: [58 + ((r * 3 + slot) % 22), 55 + ((r * 4 + slot + 1) % 22)],
            servicePointsWonPct: [60 + ((r * 2 + slot) % 18), 57 + ((r * 6 + slot + 2) % 18)],
            breakPointsConverted: [`${1 + ((r + slot) % 5)}/${3 + ((r + slot) % 6)}`, `${1 + ((r + slot + 1) % 5)}/${3 + ((r + slot + 2) % 6)}`],
          },
        };
        winners.push(winner);
      } else {
        matches[id] = {
          id, roundIndex: r, slot, nextMatchId, p1, p2,
          status: "scheduled",
          winner: null,
          score: null,
          live: null,
          durationSec: null,
          durationProvisional: false,
          sofaEventId: 1000 + r * 100 + slot,
          sofaCustomId: `cid${r}_${slot}`,
          stats: null,
        };
        winners.push(null);
      }
    }
    roundsArr.push({ index: r, name: ROUND_NAMES[size] ?? `Round of ${size}`, size, matchIds });
    entrants = winners;
  }

  return {
    schemaVersion: 1,
    generatedAt: "2026-06-07T00:00:00.000Z",
    tour,
    tournament: {
      slam: "roland-garros", name: "Roland Garros", year: 2026, surface: "Clay",
      sofaUniqueTournamentId: tour === "ATP" ? 2480 : 2577,
      sofaSeasonId: tour === "ATP" ? 85951 : 85953, drawSize,
    },
    players, matches, rounds: roundsArr,
  };
}
