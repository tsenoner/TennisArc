import { describe, it, expect } from "vitest";
import { slamStatus, availableSlamOf } from "./manifest";
import type { Match, Snapshot } from "../src/model";

function snap(matches: Partial<Match>[]): Snapshot {
  const m: Record<string, Match> = {};
  matches.forEach((p, i) => {
    m[String(i)] = {
      id: String(i), roundIndex: 0, slot: i, nextMatchId: null, p1: "a", p2: "b",
      status: "scheduled", winner: null, score: null, live: null, durationSec: null,
      durationProvisional: false, sofaEventId: null, sofaCustomId: null, stats: null, ...p,
    };
  });
  return {
    schemaVersion: 2, generatedAt: "2026-06-09T00:00:00.000Z", tour: "ATP",
    tournament: { slam: "roland-garros", name: "Roland Garros", year: 2026, surface: "Clay",
      sofaUniqueTournamentId: 2480, sofaSeasonId: 85951, drawSize: 128 },
    players: {}, matches: m, rounds: [],
  };
}

describe("slamStatus", () => {
  it("is live when any match is live", () => {
    expect(slamStatus(snap([{ nextMatchId: null, status: "finished", winner: "p1" }, { id: "1", nextMatchId: "x", status: "live" }]))).toBe("live");
  });
  it("is complete when the final (nextMatchId null) is finished and nothing is live", () => {
    expect(slamStatus(snap([{ nextMatchId: null, status: "finished", winner: "p1" }]))).toBe("complete");
  });
  it("is live when the final is not yet finished", () => {
    expect(slamStatus(snap([{ nextMatchId: null, status: "scheduled" }]))).toBe("live");
  });
});

describe("availableSlamOf", () => {
  it("derives a manifest entry from a snapshot", () => {
    expect(availableSlamOf(snap([{ nextMatchId: null, status: "finished", winner: "p1" }]))).toEqual({
      tour: "ATP", year: 2026, slam: "roland-garros", name: "Roland Garros", surface: "Clay",
      status: "complete", generatedAt: "2026-06-09T00:00:00.000Z", drawSize: 128,
    });
  });
});
