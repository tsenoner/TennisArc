import { describe, it, expect } from "vitest";
import type { Match, Snapshot } from "../src/model";
import { DrawNotReadyError, drawGap, entrantIds } from "./draw-ready";

const DRAW = 128;

/**
 * A bracket of `matchCount` blocks whose first round names `entrants` players (two per match until
 * they run out, the rest left empty — how SofaScore publishes a skeleton before the draw ceremony).
 * Round 1 always carries players of its own (`q0`, `q1`, …) so a helper that failed to scope itself
 * to round 0 would count them and be caught. `played` marks that many round-0 matches finished.
 */
function snap(
  { matchCount = DRAW - 1, entrants = DRAW, played = 0 }: { matchCount?: number; entrants?: number; played?: number } = {},
): Snapshot {
  const matches: Record<string, Match> = {};
  const matchIds: string[] = [];
  const r0 = Math.min(matchCount, DRAW / 2);
  for (let i = 0; i < matchCount; i++) {
    const first = i < r0;
    const id = first ? `0-${i}` : `1-${i - r0}`;
    if (first) matchIds.push(id);
    matches[id] = {
      id, roundIndex: first ? 0 : 1, slot: first ? i : i - r0, nextMatchId: "x",
      p1: first ? (i * 2 < entrants ? `p${i * 2}` : null) : `q${i * 2}`,
      p2: first ? (i * 2 + 1 < entrants ? `p${i * 2 + 1}` : null) : `q${i * 2 + 1}`,
      status: first && i < played ? "finished" : "scheduled",
      winner: null, score: null, live: null, durationSec: null, durationProvisional: false,
      sofaEventId: null, sofaCustomId: null, stats: null,
    };
  }
  return {
    schemaVersion: 2, generatedAt: "", tour: "ATP",
    tournament: { slam: "us-open", name: "US Open", year: 2026, surface: "Hard",
      sofaUniqueTournamentId: 2449, sofaSeasonId: 1, drawSize: DRAW },
    players: {}, matches, rounds: [{ index: 0, name: "1/64", size: DRAW, matchIds }],
  };
}

describe("drawGap", () => {
  it("passes a published draw", () => {
    expect(drawGap(snap(), DRAW)).toBeNull();
    expect(drawGap(snap({ played: 64 }), DRAW)).toBeNull(); // and one already under way
  });

  it("reports a half-built tree", () => {
    expect(drawGap(snap({ matchCount: 63 }), DRAW)?.reason).toMatch(/draw not fully available yet \(63\/127 matches\)/);
  });

  it("reports a complete tree of empty slots — the state that published a playerless bracket", () => {
    // The US Open 2026 window opened onto 127 blocks with no participants; the old match-count
    // check passed it, and 48 force-pushes of an empty draw pinged healthy before the draw landed.
    expect(drawGap(snap({ entrants: 0 }), DRAW)?.reason).toMatch(/without a draw yet \(0\/128 entrants named\)/);
    expect(drawGap(snap({ entrants: 32 }), DRAW)?.reason).toMatch(/entrants named/);
  });

  it("does NOT fire on a real draw with holes in it", () => {
    // The thinnest brackets among the 117 snapshots published so far: WTA AO 2023 names 118
    // entrants, ATP RG 2014 names 96. Both must stay publishable — the floor is half the draw so a
    // legitimate gap can never be mistaken for an unpublished skeleton.
    expect(drawGap(snap({ entrants: 118 }), DRAW)).toBeNull();
    expect(drawGap(snap({ entrants: 96 }), DRAW)).toBeNull();
    expect(drawGap(snap({ entrants: 64 }), DRAW)).toBeNull();
  });

  it("is benign only until a ball is struck", () => {
    // Before play, an unpublished bracket is the window opening ahead of the draw: skip the cycle,
    // keep the dead-man ping green. The same shape once a match has been played means the bracket
    // regressed mid-slam, and that must fail the ping instead of hiding behind it.
    expect(drawGap(snap({ entrants: 0 }), DRAW)?.benign).toBe(true);
    expect(drawGap(snap({ matchCount: 63 }), DRAW)?.benign).toBe(true);
    expect(drawGap(snap({ entrants: 0, played: 1 }), DRAW)?.benign).toBe(false);
    expect(drawGap(snap({ matchCount: 63, played: 1 }), DRAW)?.benign).toBe(false);
  });
});

describe("entrantIds", () => {
  it("collects round-0 players and splits off the ones yet to play", () => {
    const { all, unplayed } = entrantIds(snap({ played: 4 }));
    expect(all.size).toBe(DRAW);
    expect(unplayed.size).toBe(DRAW - 8); // 4 finished matches → 8 entrants already on court
    expect(unplayed.has("p0")).toBe(false);
    expect(unplayed.has("p8")).toBe(true);
  });
  it("ignores later rounds, whose slots are synthetic until they are filled", () => {
    // The fixture gives round 1 its own `q…` players, so a helper that walked every match instead
    // of round 0 would come back with 190, not 128 — and the entrant floor would then never fire
    // on the skeleton it exists to catch.
    const { all } = entrantIds(snap());
    expect(all.size).toBe(DRAW);
    expect([...all].every((id) => id.startsWith("p"))).toBe(true);
    expect(entrantIds(snap({ entrants: 0 })).all.size).toBe(0); // 63 round-1 pairs are NOT entrants
  });
  it("survives a snapshot with no rounds at all", () => {
    const empty = { ...snap(), rounds: [] };
    expect(entrantIds(empty).all.size).toBe(0);
  });
});

describe("DrawNotReadyError", () => {
  it("survives `instanceof` across the catch that decides the exit status", () => {
    // publishSlam tells it from every other failure with `instanceof`: "no draw yet" keeps the
    // dead-man ping green, anything else fails it. Subclassing Error only preserves that under an
    // ES2015+ target — a downlevel build would quietly make every skipped cycle a hard failure.
    const err: unknown = new DrawNotReadyError("no draw");
    expect(err instanceof DrawNotReadyError).toBe(true);
    expect(err instanceof Error).toBe(true);
    expect(new Error("boom") instanceof DrawNotReadyError).toBe(false);
  });
});
