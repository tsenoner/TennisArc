import { describe, it, expect } from "vitest";
import { makeSyntheticSnapshot } from "./fixtures/synthetic";
import { buildSunburst, winnerId, timeOnCourt, timeLeaderboard } from "./state";

describe("buildSunburst", () => {
  it("roots at the champion and has the draw size as leaves", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 3 });
    const root = buildSunburst(s);
    expect(root.depth).toBe(0);
    // champion = winner of the final
    const final = Object.values(s.matches).find((m) => m.nextMatchId === null)!;
    expect(root.occupant).toBe(winnerId(final));
    // leaves = 8 entrants
    const leaves: string[] = [];
    const walk = (n: typeof root) => n.children.length ? n.children.forEach(walk) : leaves.push(n.id);
    walk(root);
    expect(leaves).toHaveLength(8);
  });

  it("assigns a stable unique id per node and links each non-leaf to a match", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 4, seed: 2 });
    const root = buildSunburst(s);
    const ids = new Set<string>();
    const walk = (n: typeof root) => { ids.add(n.id); n.children.forEach(walk); };
    walk(root);
    // 4-draw: champion(1) + finalists(2) + entrants(4) = 7 nodes
    expect(ids.size).toBe(7);
    expect(root.matchId).toBe(Object.values(s.matches).find((m) => m.nextMatchId === null)!.id);
  });

  it("projects the top seed to the title when no results are in yet", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 5, completedRounds: 0 });
    const root = buildSunburst(s);
    expect(root.projected).toBe(true);
    expect(root.occupant).toBe("p0"); // seed 1 / ranking 1 wins every projected match
    // leaves (entrants) are known, not projected
    const leaf = (n: typeof root): typeof root => (n.children.length ? leaf(n.children[0]) : n);
    expect(leaf(root).projected).toBe(false);
  });
});

describe("timeOnCourt", () => {
  it("sums duration for finished matches and counts matches per player", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 4, seed: 1 });
    const t = timeOnCourt(s);
    expect(t.get("p0")!.sec).toBeGreaterThan(0);
    const champ = buildSunburst(s).occupant!;
    expect(t.get(champ)!.matches).toBe(2); // champion played R1 + final
  });

  it("counts each counted match's duration for both players; gating excludes walkover/null", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 2 });
    // walkover: excluded by status even though it still has a duration
    s.matches["0-0"] = { ...s.matches["0-0"], status: "walkover" };
    // retired: counted, keeps its duration
    s.matches["0-1"] = { ...s.matches["0-1"], status: "retired" };
    // finished but null duration: excluded (unknown, not zero)
    s.matches["0-2"] = { ...s.matches["0-2"], durationSec: null };
    const t = timeOnCourt(s);
    const totalSec = [...t.values()].reduce((a, v) => a + v.sec, 0);
    // independent re-derivation of the rule: counted statuses with a known duration, ×2 players
    const expected = Object.values(s.matches).reduce((a, m) => {
      const counted = m.status === "finished" || m.status === "retired" || m.status === "live";
      return a + (counted && m.durationSec != null ? m.durationSec * 2 : 0);
    }, 0);
    expect(totalSec).toBe(expected);
  });

  it("flags live totals provisional and tracks deepest round reached", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 4, seed: 1 });
    const live = s.matches["0-1"];
    s.matches["0-1"] = { ...live, status: "live", winner: null, durationSec: 1800, durationProvisional: true };
    const t = timeOnCourt(s);
    expect(t.get(live.p1!)!.provisional).toBe(true);
    // a first-round loser's deepest round is 0 (they never advance)
    const r1 = s.matches["0-0"];
    const r1Loser = r1.winner === "p1" ? r1.p2! : r1.p1!;
    expect(t.get(r1Loser)!.roundReached).toBe(0);
  });
});

describe("timeLeaderboard", () => {
  it("ranks players by descending time, caps at the limit, excludes zero-time", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 32, seed: 4 });
    const rows = timeLeaderboard(s, timeOnCourt(s), 5);
    expect(rows).toHaveLength(5);
    for (let i = 1; i < rows.length; i++) expect(rows[i].sec).toBeLessThanOrEqual(rows[i - 1].sec);
    for (const r of rows) {
      expect(r.sec).toBeGreaterThan(0);
      expect(r.name).toBe(s.players[r.playerId].name);
    }
  });

  it("carries the provisional flag through from live matches", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const m = s.matches["0-0"];
    s.matches["0-0"] = { ...m, status: "live", winner: null, durationSec: 9999, durationProvisional: true };
    const rows = timeLeaderboard(s, timeOnCourt(s), 20);
    const liveRow = rows.find((r) => r.playerId === m.p1);
    expect(liveRow?.provisional).toBe(true);
  });

  it("excludes players with zero court time (e.g. a walkover loser)", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const wo = s.matches["0-0"];
    // walkover with no duration: the loser played only this match → 0 counted time
    s.matches["0-0"] = { ...wo, status: "walkover", durationSec: null, winner: "p1" };
    const time = timeOnCourt(s);
    const loser = wo.p2!;
    expect(time.get(loser)!.sec).toBe(0);
    const rows = timeLeaderboard(s, time, 50);
    expect(rows.some((r) => r.playerId === loser)).toBe(false);
  });
});
