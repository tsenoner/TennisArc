import { describe, it, expect } from "vitest";
import { makeSyntheticSnapshot } from "./fixtures/synthetic";
import { snapshotFilename } from "./model";

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

describe("snapshotFilename", () => {
  it("encodes tour (lowercased), year and slam", () => {
    expect(snapshotFilename("ATP", 2026, "roland-garros")).toBe("atp-2026-roland-garros.json");
    expect(snapshotFilename("WTA", 2025, "wimbledon")).toBe("wta-2025-wimbledon.json");
  });
});

describe("synthetic fixture — behaviour", () => {
  it("is deterministic for a given seed", () => {
    const a = makeSyntheticSnapshot({ tour: "ATP", drawSize: 16, seed: 42 });
    const b = makeSyntheticSnapshot({ tour: "ATP", drawSize: 16, seed: 42 });
    expect(a).toEqual(b);
  });

  it("throws when drawSize is not a power of 2", () => {
    expect(() => makeSyntheticSnapshot({ tour: "ATP", drawSize: 6 })).toThrow();
  });

  it("respects completedRounds: only early rounds are finished", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1, completedRounds: 1 });
    const byRound = (r: number) =>
      Object.values(s.matches).filter((m) => m.roundIndex === r);
    expect(byRound(0).every((m) => m.status === "finished")).toBe(true);
    expect(byRound(1).every((m) => m.status === "scheduled")).toBe(true);
    expect(byRound(2).every((m) => m.status === "scheduled")).toBe(true);
  });

  it("uses WTA tournament ids for the WTA tour", () => {
    const s = makeSyntheticSnapshot({ tour: "WTA", drawSize: 8, seed: 1 });
    expect(s.tournament.sofaUniqueTournamentId).toBe(2577);
    expect(s.tournament.sofaSeasonId).toBe(85953);
  });

  it("populates each round's matchIds with its real matches", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    // sizes 8,4,2 → 4,2,1 matches per round
    expect(s.rounds.map((r) => r.matchIds.length)).toEqual([4, 2, 1]);
    for (const round of s.rounds) {
      for (const id of round.matchIds) {
        expect(s.matches[id]).toBeDefined();
        expect(s.matches[id].roundIndex).toBe(round.index);
      }
    }
  });
});
