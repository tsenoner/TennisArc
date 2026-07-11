import { describe, it, expect } from "vitest";
import { deriveContext, pointState } from "./points";
import type { SetScore } from "./model";

const st = (over: Partial<Parameters<typeof pointState>[0]> = {}) => pointState({
  pts: { p1: "0", p2: "0" }, serving: "p1",
  games: { p1: 0, p2: 0 }, sets: { p1: 0, p2: 0 }, bestOf: 5, ...over,
});

describe("pointState — normal games", () => {
  it("no chip on a plain rally score", () => {
    expect(st({ pts: { p1: "30", p2: "15" } })).toEqual({ tb: false, chip: null, chipFor: null });
  });
  it("no chip at deuce", () => {
    expect(st({ pts: { p1: "40", p2: "40" } }).chip).toBeNull();
  });
  it("server's plain game point is NOT a chip", () => {
    expect(st({ pts: { p1: "40", p2: "30" }, serving: "p1" }).chip).toBeNull();
  });
  it("receiver's game point is a BP (40 and advantage forms)", () => {
    expect(st({ pts: { p1: "40", p2: "30" }, serving: "p2" })).toEqual({ tb: false, chip: "BP", chipFor: "p1" });
    expect(st({ pts: { p1: "40", p2: "A" }, serving: "p1" })).toEqual({ tb: false, chip: "BP", chipFor: "p2" });
  });
  it("unknown server → no BP (cannot attribute)", () => {
    expect(st({ pts: { p1: "40", p2: "15" }, serving: undefined }).chip).toBeNull();
  });
  it("game point that takes the set escalates to SP — even for the server", () => {
    expect(st({ pts: { p1: "40", p2: "15" }, serving: "p1", games: { p1: 5, p2: 3 } }))
      .toEqual({ tb: false, chip: "SP", chipFor: "p1" });
  });
  it("5-4 is SP but 5-5 is not (needs a 2-game margin at 6)", () => {
    expect(st({ pts: { p1: "40", p2: "0" }, games: { p1: 5, p2: 4 } }).chip).toBe("SP");
    expect(st({ pts: { p1: "40", p2: "0" }, games: { p1: 5, p2: 5 } }).chip).toBeNull();
    expect(st({ pts: { p1: "40", p2: "0" }, games: { p1: 6, p2: 5 } }).chip).toBe("SP"); // 7-5
  });
  it("set point that takes the match escalates to MP (bestOf-aware)", () => {
    expect(st({ pts: { p1: "40", p2: "0" }, games: { p1: 5, p2: 2 }, sets: { p1: 2, p2: 0 }, bestOf: 5 }).chip).toBe("MP");
    expect(st({ pts: { p1: "40", p2: "0" }, games: { p1: 5, p2: 2 }, sets: { p1: 1, p2: 0 }, bestOf: 5 }).chip).toBe("SP");
    expect(st({ pts: { p1: "40", p2: "0" }, games: { p1: 5, p2: 2 }, sets: { p1: 1, p2: 0 }, bestOf: 3 }).chip).toBe("MP");
  });
  it("BP that is also SP/MP for the receiver reports the higher chip", () => {
    expect(st({ pts: { p1: "0", p2: "40" }, serving: "p1", games: { p1: 3, p2: 5 }, sets: { p1: 0, p2: 1 }, bestOf: 3 }))
      .toEqual({ tb: false, chip: "MP", chipFor: "p2" });
  });
  it("junk point strings → no chip, no crash", () => {
    expect(st({ pts: { p1: "Adv?", p2: "" } })).toEqual({ tb: false, chip: null, chipFor: null });
  });
});

describe("pointState — tiebreaks", () => {
  const tb = (p1: string, p2: string, over: Partial<Parameters<typeof pointState>[0]> = {}) =>
    st({ pts: { p1, p2 }, games: { p1: 6, p2: 6 }, ...over });
  it("detects the tiebreak from 6-6 games and never awards BP", () => {
    expect(tb("6", "5", { serving: "p2" })).toEqual({ tb: true, chip: "SP", chipFor: "p1" });
  });
  it("no chip mid-tiebreak or level at 6-6 points", () => {
    expect(tb("3", "2").chip).toBeNull();
    expect(tb("6", "6").chip).toBeNull();
    expect(tb("7", "7").chip).toBeNull();
  });
  it("beyond the target it is one-point-from-winning whenever leading (8-7)", () => {
    expect(tb("8", "7")).toEqual({ tb: true, chip: "SP", chipFor: "p1" });
  });
  it("SP escalates to MP when the tiebreak decides the match", () => {
    // NOT a final set (2-1 in a best-of-5 → target 7): the leader already holds 2 sets, so
    // winning this tiebreak wins the match.
    expect(tb("6", "3", { sets: { p1: 2, p2: 1 }, bestOf: 5 }).chip).toBe("MP");
  });
  it("a FINAL-SET tiebreak plays to 10 (no chip at 6-5; SP/MP from 9)", () => {
    expect(tb("6", "5", { sets: { p1: 2, p2: 2 }, bestOf: 5 }).chip).toBeNull();
    expect(tb("9", "8", { sets: { p1: 2, p2: 2 }, bestOf: 5 }).chip).toBe("MP");
    expect(tb("9", "8", { sets: { p1: 1, p2: 1 }, bestOf: 3 }).chip).toBe("MP");
  });
  it("non-numeric tiebreak values → tb detected, chip suppressed", () => {
    expect(tb("A", "5")).toEqual({ tb: true, chip: null, chipFor: null });
  });
});

describe("deriveContext", () => {
  const s = (p1: number, p2: number, tbv?: number): SetScore => ({ p1, p2, tb: tbv ?? null });
  it("last entry is the current set; completed earlier sets are counted", () => {
    expect(deriveContext([s(6, 4), s(4, 6), s(2, 1)]))
      .toEqual({ games: { p1: 2, p2: 1 }, sets: { p1: 1, p2: 1 } });
  });
  it("7-6 and 7-5 count as completed; 6-5 and 5-4 do not", () => {
    expect(deriveContext([s(7, 6, 4), s(5, 7), s(6, 5), s(0, 0)]).sets).toEqual({ p1: 1, p2: 1 });
  });
  it("null/empty score → zeros", () => {
    expect(deriveContext(null)).toEqual({ games: { p1: 0, p2: 0 }, sets: { p1: 0, p2: 0 } });
    expect(deriveContext([])).toEqual({ games: { p1: 0, p2: 0 }, sets: { p1: 0, p2: 0 } });
  });
});
