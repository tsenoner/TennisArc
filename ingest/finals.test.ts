import { describe, it, expect } from "vitest";
import { parseSackmannScore, parseFinalRow, applyFinal, type FinalRow } from "./finals";
import type { Match, Player } from "../src/model";

const player = (id: string, name: string): Player => ({
  id, name, country: "", seed: null, entry: null, ranking: null, ageYears: null, sofaSlug: null, elo: null, birthdate: null,
});
const finalMatch = (p1: string, p2: string): Match => ({
  id: "6-0", roundIndex: 6, slot: 0, nextMatchId: null, p1, p2,
  status: "scheduled", winner: null, score: null, live: null,
  durationSec: null, durationProvisional: false, sofaEventId: null, sofaCustomId: null, stats: null,
});

describe("parseSackmannScore", () => {
  it("parses straight sets with the winner in slot p1", () => {
    const { sets, status } = parseSackmannScore("6-4 6-4 6-4", true);
    expect(status).toBe("finished");
    expect(sets).toEqual([{ p1: 6, p2: 4 }, { p1: 6, p2: 4 }, { p1: 6, p2: 4 }]);
  });

  it("attaches the tiebreak minor-score on a tiebreak set (winner p1)", () => {
    const { sets } = parseSackmannScore("7-6(2) 5-7 6-4", true);
    expect(sets).toEqual([{ p1: 7, p2: 6, tb: 2 }, { p1: 5, p2: 7 }, { p1: 6, p2: 4 }]);
  });

  it("flips games but not tb when winner is p2 — 2020 US Open final set 7-6(6)", () => {
    // Thiem (winner) beat Zverev (p1); winner is p2, so the final set's games swap to {p1:6,p2:7}
    // while tb stays 6.
    const { sets, status } = parseSackmannScore("2-6 4-6 6-4 6-3 7-6(6)", false);
    expect(status).toBe("finished");
    expect(sets).toEqual([
      { p1: 6, p2: 2 }, { p1: 6, p2: 4 }, { p1: 4, p2: 6 }, { p1: 3, p2: 6 }, { p1: 6, p2: 7, tb: 6 },
    ]);
  });

  it("flips straight sets when winner is p2 — 2021 US Open Medvedev d. Djokovic", () => {
    // Medvedev (winner) is p2 in the snapshot slots; each "6-4" becomes {p1:4,p2:6}.
    const { sets } = parseSackmannScore("6-4 6-4 6-4", false);
    expect(sets).toEqual([{ p1: 4, p2: 6 }, { p1: 4, p2: 6 }, { p1: 4, p2: 6 }]);
  });

  it("parses a 3-set WTA score (winner p1)", () => {
    const { sets, status } = parseSackmannScore("6-1 6-3", true);
    expect(status).toBe("finished");
    expect(sets).toEqual([{ p1: 6, p2: 1 }, { p1: 6, p2: 3 }]);
  });

  it("marks a retirement and keeps only the completed sets", () => {
    const { sets, status } = parseSackmannScore("6-3 2-1 RET", true);
    expect(status).toBe("retired");
    expect(sets).toEqual([{ p1: 6, p2: 3 }, { p1: 2, p2: 1 }]);
  });

  it("marks a walkover with no sets", () => {
    const { sets, status } = parseSackmannScore("W/O", true);
    expect(status).toBe("walkover");
    expect(sets).toEqual([]);
  });
});

describe("parseFinalRow", () => {
  const header =
    "tourney_name,surface,tourney_date,round,minutes,score,winner_name,loser_name";
  const csv = [
    header,
    "Australian Open,Hard,20210208,R128,95,6-3 6-4,Some Player,Other Player",
    "Australian Open,Hard,20210208,F,113,7-5 6-2 6-2,Novak Djokovic,Daniil Medvedev",
    "Us Open,Hard,20210830,F,135,6-4 6-4 6-4,Daniil Medvedev,Novak Djokovic",
  ].join("\n");

  it("returns the F row for the requested slam with minutes→seconds", () => {
    const row = parseFinalRow(csv, "australian-open");
    expect(row).toEqual({
      winnerName: "Novak Djokovic", loserName: "Daniil Medvedev",
      score: "7-5 6-2 6-2", minutes: 113 * 60,
    });
  });

  it("matches the 'Us Open' casing for us-open", () => {
    const row = parseFinalRow(csv, "us-open");
    expect(row?.winnerName).toBe("Daniil Medvedev");
    expect(row?.minutes).toBe(135 * 60);
  });

  it("returns null when no F row exists for the slam", () => {
    expect(parseFinalRow(csv, "wimbledon")).toBeNull();
  });
});

describe("applyFinal", () => {
  it("joins the winner to the correct slot when winner is p1 (Djokovic d. Medvedev, AO 2021)", () => {
    const players = { a: player("a", "Novak Djokovic"), b: player("b", "Daniil Medvedev") };
    const m = finalMatch("a", "b");
    const row: FinalRow = {
      winnerName: "Novak Djokovic", loserName: "Daniil Medvedev", score: "7-5 6-2 6-2", minutes: 113 * 60,
    };
    expect(applyFinal(m, players, row)).toBe(true);
    expect(m.winner).toBe("p1");
    expect(m.status).toBe("finished");
    expect(m.score).toEqual([{ p1: 7, p2: 5 }, { p1: 6, p2: 2 }, { p1: 6, p2: 2 }]);
    expect(m.durationSec).toBe(113 * 60);
    expect(m.durationProvisional).toBe(false);
  });

  it("joins the winner to slot p2 when the winner is the p2 finalist (US 2020 Thiem d. Zverev)", () => {
    const players = { a: player("a", "Alexander Zverev"), b: player("b", "Dominic Thiem") };
    const m = finalMatch("a", "b");
    const row: FinalRow = {
      winnerName: "Dominic Thiem", loserName: "Alexander Zverev",
      score: "2-6 4-6 6-4 6-3 7-6(6)", minutes: 250 * 60,
    };
    expect(applyFinal(m, players, row)).toBe(true);
    expect(m.winner).toBe("p2");
    expect(m.score).toEqual([
      { p1: 6, p2: 2 }, { p1: 6, p2: 4 }, { p1: 4, p2: 6 }, { p1: 3, p2: 6 }, { p1: 6, p2: 7, tb: 6 },
    ]);
  });

  it("joins accented finalist names (Krejčíková / Pavlyuchenkova, RG 2021)", () => {
    // Snapshot spells the winner "Barbora Krejčiková"; the CSV uses ASCII "Barbora Krejcikova".
    const players = {
      a: player("a", "Barbora Krejčiková"), b: player("b", "Anastasia Pavlyuchenkova"),
    };
    const m = finalMatch("a", "b");
    const row: FinalRow = {
      winnerName: "Barbora Krejcikova", loserName: "Anastasia Pavlyuchenkova",
      score: "6-1 2-6 6-4", minutes: 116 * 60,
    };
    expect(applyFinal(m, players, row)).toBe(true);
    expect(m.winner).toBe("p1");
    expect(m.score).toEqual([{ p1: 6, p2: 1 }, { p1: 2, p2: 6 }, { p1: 6, p2: 4 }]);
  });

  it("joins accented loser name (Kvitová) with the winner in slot p1 (AO 2019 WTA)", () => {
    const players = { a: player("a", "Naomi Osaka"), b: player("b", "Petra Kvitová") };
    const m = finalMatch("a", "b");
    const row: FinalRow = {
      winnerName: "Naomi Osaka", loserName: "Petra Kvitova", score: "7-6(2) 5-7 6-4", minutes: 167 * 60,
    };
    expect(applyFinal(m, players, row)).toBe(true);
    expect(m.winner).toBe("p1");
    expect(m.score).toEqual([{ p1: 7, p2: 6, tb: 2 }, { p1: 5, p2: 7 }, { p1: 6, p2: 4 }]);
  });

  it("sets null score for a walkover final", () => {
    const players = { a: player("a", "Some One"), b: player("b", "Other Two") };
    const m = finalMatch("a", "b");
    const row: FinalRow = { winnerName: "Some One", loserName: "Other Two", score: "W/O", minutes: null };
    expect(applyFinal(m, players, row)).toBe(true);
    expect(m.status).toBe("walkover");
    expect(m.score).toBeNull();
    expect(m.durationSec).toBeNull();
  });

  it("is an idempotent no-op when the final is already finished (returns false)", () => {
    const players = { a: player("a", "Novak Djokovic"), b: player("b", "Daniil Medvedev") };
    const m: Match = {
      ...finalMatch("a", "b"), status: "finished", winner: "p1",
      score: [{ p1: 7, p2: 5 }, { p1: 6, p2: 2 }, { p1: 6, p2: 2 }],
    };
    const row: FinalRow = {
      winnerName: "Novak Djokovic", loserName: "Daniil Medvedev", score: "6-0 6-0 6-0", minutes: 60,
    };
    expect(applyFinal(m, players, row)).toBe(false);
    // untouched
    expect(m.score).toEqual([{ p1: 7, p2: 5 }, { p1: 6, p2: 2 }, { p1: 6, p2: 2 }]);
  });

  it("returns false on an ambiguous name-join (winner signature matches both slots)", () => {
    // Both finalists share surname "Williams" and first initial — sigKey collides, no exact full
    // match for the abbreviated CSV winner, so the join is ambiguous and must not guess.
    const players = { a: player("a", "Serena Williams"), b: player("b", "Steffi Williams") };
    const m = finalMatch("a", "b");
    const row: FinalRow = { winnerName: "S. Williams", loserName: "Other", score: "6-4 6-4", minutes: 60 };
    expect(applyFinal(m, players, row)).toBe(false);
    expect(m.status).toBe("scheduled");
    expect(m.winner).toBeNull();
  });

  it("returns false when the winner matches neither slot", () => {
    const players = { a: player("a", "Novak Djokovic"), b: player("b", "Daniil Medvedev") };
    const m = finalMatch("a", "b");
    const row: FinalRow = { winnerName: "Rafael Nadal", loserName: "Roger Federer", score: "6-4 6-4", minutes: 60 };
    expect(applyFinal(m, players, row)).toBe(false);
    expect(m.winner).toBeNull();
  });
});
