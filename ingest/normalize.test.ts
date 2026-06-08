import { describe, it, expect } from "vitest";
import { normalizeCuptrees } from "./normalize";
import { cuptreesSample } from "./fixtures/cuptrees-sample";

const meta = {
  tour: "ATP" as const, slam: "roland-garros", name: "Roland Garros", year: 2026,
  surface: "Clay", sofaUniqueTournamentId: 2480, sofaSeasonId: 85951, drawSize: 4,
};

describe("normalizeCuptrees", () => {
  it("builds players with seeds and entry types from teamSeed", () => {
    const s = normalizeCuptrees(cuptreesSample, meta);
    expect(s.players["100"]).toMatchObject({ name: "Aaa Aaa", seed: 1, entry: null, ranking: 1, country: "" });
    expect(s.players["101"]).toMatchObject({ seed: null, entry: "WC" });
    expect(s.players["103"]).toMatchObject({ seed: null, entry: "Q" });
  });

  it("builds matches keyed by round-slot with winner, status, sofaEventId and nextMatchId", () => {
    const s = normalizeCuptrees(cuptreesSample, meta);
    const sf1 = s.matches["0-0"];
    expect(sf1).toMatchObject({ p1: "100", p2: "101", winner: "p1", status: "finished", sofaEventId: 9001, nextMatchId: "1-0" });
    expect(s.matches["0-1"].status).toBe("live");
    expect(s.matches["1-0"]).toMatchObject({ nextMatchId: null, sofaEventId: 9003, status: "scheduled", winner: null });
  });

  it("computes round metadata (entrant counts) and tournament block", () => {
    const s = normalizeCuptrees(cuptreesSample, meta);
    expect(s.rounds.map((r) => [r.index, r.name, r.size])).toEqual([[0, "Semifinal", 4], [1, "Final", 2]]);
    expect(s.tournament).toMatchObject({ slam: "roland-garros", drawSize: 4 });
    expect(s.tour).toBe("ATP");
    expect(s.schemaVersion).toBe(1);
  });
});
