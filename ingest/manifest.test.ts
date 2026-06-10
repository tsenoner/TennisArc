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

import { mergeIndex } from "./manifest";
import type { AvailableSlam } from "../src/model";

const entry = (over: Partial<AvailableSlam>): AvailableSlam => ({
  tour: "ATP", year: 2026, slam: "roland-garros", name: "Roland Garros", surface: "Clay",
  status: "live", generatedAt: "t0", drawSize: 128, ...over,
});

describe("mergeIndex", () => {
  it("updates an existing slam in place (by tour+year+slam) and preserves others", () => {
    const existing = [entry({ status: "live", generatedAt: "t0" }), entry({ slam: "australian-open", name: "Australian Open", surface: "Hard", status: "complete" })];
    const merged = mergeIndex(existing, [entry({ status: "complete", generatedAt: "t1" })]);
    expect(merged).toHaveLength(2);
    const rg = merged.find((s) => s.slam === "roland-garros")!;
    expect(rg).toMatchObject({ status: "complete", generatedAt: "t1" });
    expect(merged.find((s) => s.slam === "australian-open")!.status).toBe("complete");
  });
  it("adds new slams and sorts newest year first", () => {
    const merged = mergeIndex([entry({ year: 2024 })], [entry({ year: 2026 })]);
    expect(merged.map((s) => s.year)).toEqual([2026, 2024]);
  });
});

import { backfillTargets } from "./manifest";

describe("backfillTargets", () => {
  it("returns empty for no input", () => {
    expect(backfillTargets(undefined)).toEqual([]);
    expect(backfillTargets("")).toEqual([]);
  });
  it("expands a comma list of years across all four slams", () => {
    const t = backfillTargets("2024,2025");
    expect(t).toHaveLength(8);
    expect(t).toContainEqual({ year: 2024, slam: "roland-garros" });
    expect(t).toContainEqual({ year: 2025, slam: "wimbledon" });
  });
  it("ignores non-numeric years", () => {
    expect(backfillTargets("2024,foo")).toHaveLength(4);
  });
  it("restricts to the given slams when a slams filter is passed", () => {
    const t = backfillTargets("2026", "australian-open");
    expect(t).toEqual([{ year: 2026, slam: "australian-open" }]);
  });
  it("accepts multiple slams and ignores unknown keys", () => {
    const t = backfillTargets("2026", "australian-open,not-a-slam,wimbledon");
    expect(t).toEqual([
      { year: 2026, slam: "australian-open" },
      { year: 2026, slam: "wimbledon" },
    ]);
  });
});
