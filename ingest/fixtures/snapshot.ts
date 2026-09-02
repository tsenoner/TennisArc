import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Match, Snapshot, Tour } from "../../src/model";

/** A minimal valid Snapshot: one decided final, no players, no rounds. */
export function snap(
  tour: Tour, year: number, slam: string, name: string, surface: string, generatedAt: string,
  finalOver: Partial<Match> = {},
): Snapshot {
  const final: Match = {
    id: "0", roundIndex: 0, slot: 0, nextMatchId: null, p1: "a", p2: "b",
    status: "finished", winner: "p1", score: null, live: null, durationSec: null,
    durationProvisional: false, sofaEventId: null, sofaCustomId: null, stats: null, ...finalOver,
  };
  return {
    schemaVersion: 2, generatedAt, tour,
    tournament: { slam, name, year, surface, sofaUniqueTournamentId: 1, sofaSeasonId: 1, drawSize: 128 },
    players: {}, matches: { "0": final }, rounds: [],
  };
}

/** Write a snapshot where reindex expects it: <dir>/slams/{year}/{file}. */
export async function writeSnap(dir: string, year: number, file: string, s: Snapshot): Promise<void> {
  await mkdir(resolve(dir, "slams", String(year)), { recursive: true });
  await writeFile(resolve(dir, "slams", String(year), file), JSON.stringify(s));
}
