import { describe, it, expect } from "vitest";
import type { Match, Snapshot } from "../src/model";
import { drawGap, entrantIds } from "./draw-ready";

const DRAW = 128;
/** The wall clock handed to `drawGap`, as Unix seconds. Fixtures without a `startsAt` carry no
 *  scheduled time at all, so this only bites in the tests that set one. */
const NOW = Date.UTC(2026, 7, 30, 12) / 1000;
const HOUR = 3600;

/**
 * A bracket of `matchCount` blocks whose first round names `entrants` players (two per match until
 * they run out, the rest left empty — how SofaScore publishes a skeleton before the draw ceremony).
 * Round 1 always carries players of its own (`q0`, `q1`, …) so a helper that failed to scope itself
 * to round 0 would count them and be caught. `played` marks that many round-0 matches finished, and
 * `startsAt` stamps the round-0 slots with the on-court time cuptrees carries on every block —
 * present even on a participant-less skeleton, which is what lets `drawGap` tell a pre-draw cycle
 * from a bracket that regressed after play began.
 */
function snap(
  { matchCount = DRAW - 1, entrants = DRAW, played = 0, startsAt }: { matchCount?: number; entrants?: number; played?: number; startsAt?: number } = {},
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
      ...(first && startsAt !== undefined ? { scheduledStart: startsAt } : {}),
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
    expect(drawGap(snap(), DRAW, NOW)).toBeNull();
    expect(drawGap(snap({ played: 64 }), DRAW, NOW)).toBeNull(); // and one already under way
  });

  it("reports a half-built tree", () => {
    expect(drawGap(snap({ matchCount: 63 }), DRAW, NOW)?.reason).toMatch(/draw not fully available yet \(63\/127 matches\)/);
  });

  it("reports a complete tree of empty slots — the state that published a playerless bracket", () => {
    // The US Open 2026 window opened onto 127 blocks with no participants; the old match-count
    // check passed it, and 48 force-pushes of an empty draw pinged healthy before the draw landed.
    expect(drawGap(snap({ entrants: 0 }), DRAW, NOW)?.reason).toMatch(/without a draw yet \(0\/128 entrants named\)/);
    expect(drawGap(snap({ entrants: 32 }), DRAW, NOW)?.reason).toMatch(/entrants named/);
  });

  it("does NOT fire on a real draw with holes in it", () => {
    // The thinnest brackets among the 117 snapshots published so far: WTA AO 2023 names 118
    // entrants, ATP RG 2014 names 96. Both must stay publishable — the floor is half the draw so a
    // legitimate gap can never be mistaken for an unpublished skeleton.
    expect(drawGap(snap({ entrants: 118 }), DRAW, NOW)).toBeNull();
    expect(drawGap(snap({ entrants: 96 }), DRAW, NOW)).toBeNull();
    expect(drawGap(snap({ entrants: 64 }), DRAW, NOW)).toBeNull();
  });

  it("is benign only until a ball is struck", () => {
    // Before play, an unpublished bracket is the window opening ahead of the draw: skip the cycle,
    // keep the dead-man ping green. The same shape once a match has been played means the bracket
    // regressed mid-slam, and that must fail the ping instead of hiding behind it.
    expect(drawGap(snap({ entrants: 0 }), DRAW, NOW)?.benign).toBe(true);
    expect(drawGap(snap({ matchCount: 63 }), DRAW, NOW)?.benign).toBe(true);
    expect(drawGap(snap({ entrants: 0, played: 1 }), DRAW, NOW)?.benign).toBe(false);
    expect(drawGap(snap({ matchCount: 63, played: 1 }), DRAW, NOW)?.benign).toBe(false);
  });

  it("is NOT benign once round 1 is due on court, even with nothing marked played", () => {
    // The failure the played-status test alone cannot see: a degraded mid-slam payload comes back
    // as 127 participant-less blocks, every one of them upcoming — the results are gone precisely
    // BECAUSE the payload is broken. Read as "no ball struck yet" it would skip the cycle and ping
    // green for the rest of the tournament. The block's own scheduled start still says play is due,
    // so the same shape after that moment has to be loud.
    expect(drawGap(snap({ entrants: 0, startsAt: NOW - HOUR }), DRAW, NOW)?.benign).toBe(false);
    expect(drawGap(snap({ matchCount: 63, startsAt: NOW - HOUR }), DRAW, NOW)?.benign).toBe(false);
  });

  it("stays benign while the schedule still puts round 1 in the future", () => {
    // The lead-in the widened windows exist for: the skeleton is up, the draw ceremony hasn't
    // happened, and play is days away. Skip the cycle and keep the ping green.
    expect(drawGap(snap({ entrants: 0, startsAt: NOW + 48 * HOUR }), DRAW, NOW)?.benign).toBe(true);
    // Exactly at the scheduled start counts as under way, not as lead-in.
    expect(drawGap(snap({ entrants: 0, startsAt: NOW }), DRAW, NOW)?.benign).toBe(false);
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
