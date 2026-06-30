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
    expect(s.schemaVersion).toBe(2);
  });

  it("drops placeholder future-slot teams and survives duplicate blocks for a slot", () => {
    // Mirrors the 2023 Australian Open malformation: a round with extra blocks colliding on `order`,
    // the duplicates carrying synthetic "R64Pn" placeholder teams. Placeholders must not become
    // players, must not occupy a match side, and must never clobber the real match for the slot.
    const malformed = {
      cupTrees: [{
        rounds: [{
          description: "Quarterfinal",
          blocks: [
            // slot 0: real block first, placeholder duplicate second → real must survive
            { finished: true, eventInProgress: false, order: 1, events: [1], participants: [
              { order: 1, winner: true, teamSeed: "1", team: { id: 200, name: "Real One", slug: "real-one", ranking: 1, nameCode: "RE1" } },
              { order: 2, winner: false, team: { id: 201, name: "Real Two", slug: "real-two", ranking: 9, nameCode: "RE2" } },
            ] },
            { finished: false, eventInProgress: false, order: 1, events: [], participants: [
              { order: 1, winner: false, team: { id: 990, name: "R64P3", slug: "r64p3" } },
            ] },
            // slot 1: placeholder block first, real duplicate second → real must still win (richer)
            { finished: false, eventInProgress: false, order: 2, events: [], participants: [
              { order: 1, winner: false, team: { id: 991, name: "R64P4", slug: "r64p4" } },
            ] },
            { finished: true, eventInProgress: false, order: 2, events: [2], participants: [
              { order: 1, winner: false, teamSeed: "2", team: { id: 202, name: "Real Three", slug: "real-three", ranking: 2, nameCode: "RE3" } },
              { order: 2, winner: true, team: { id: 203, name: "Real Four", slug: "real-four", ranking: 7, nameCode: "RE4" } },
            ] },
          ],
        }],
      }],
    };

    const s = normalizeCuptrees(malformed, { ...meta, drawSize: 4 });

    // No placeholder players, no placeholder team ids.
    expect(Object.values(s.players).some((p) => /^R\d+P\d+$/.test(p.name))).toBe(false);
    expect(s.players["990"]).toBeUndefined();
    expect(s.players["991"]).toBeUndefined();
    expect(Object.keys(s.players).sort()).toEqual(["200", "201", "202", "203"]);
    // One match per slot, real participants preserved regardless of block order.
    expect(Object.keys(s.matches).sort()).toEqual(["0-0", "0-1"]);
    expect(s.matches["0-0"]).toMatchObject({ p1: "200", p2: "201", winner: "p1" });
    expect(s.matches["0-1"]).toMatchObject({ p1: "202", p2: "203", winner: "p2" });
    // Round metadata reflects unique matches, not the inflated block count.
    expect(s.rounds[0]).toMatchObject({ size: 4, matchIds: ["0-0", "0-1"] });
  });
});
