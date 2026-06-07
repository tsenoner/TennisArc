import { describe, it, expect } from "vitest";
import { makeSyntheticSnapshot } from "./fixtures/synthetic";

describe("synthetic fixture", () => {
  it("builds a balanced single-elim draw of the requested size", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    expect(s.tournament.drawSize).toBe(8);
    expect(Object.keys(s.players)).toHaveLength(8);
    // 8 entrants → 4 + 2 + 1 = 7 matches
    expect(Object.keys(s.matches)).toHaveLength(7);
    expect(s.rounds.map((r) => r.size)).toEqual([8, 4, 2]);
  });

  it("links every non-final match to a next match", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const finals = Object.values(s.matches).filter((m) => m.nextMatchId === null);
    expect(finals).toHaveLength(1);
    for (const m of Object.values(s.matches)) {
      if (m.nextMatchId) expect(s.matches[m.nextMatchId]).toBeDefined();
    }
  });
});
