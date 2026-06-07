import { describe, it, expect } from "vitest";
import { makeSyntheticSnapshot } from "./fixtures/synthetic";
import { buildSunburst, winnerId } from "./state";

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
