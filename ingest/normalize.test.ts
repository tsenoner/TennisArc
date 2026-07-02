import { describe, it, expect } from "vitest";
import { normalizeCuptrees, collectEventIds } from "./normalize";
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

describe("collectEventIds", () => {
  const side = (id: number, name: string) => ({ order: id % 2 === 0 ? 2 : 1, winner: false, team: { id, name, slug: name.toLowerCase() } });
  // one block per case, all in a single round
  const cup = {
    cupTrees: [{
      rounds: [{
        description: "Round of 64",
        blocks: [
          // finished + in-progress: always fetched (existing behaviour)
          { finished: true, eventInProgress: false, order: 1, events: [1], participants: [side(11, "Real A"), side(12, "Real B")] },
          { finished: false, eventInProgress: true, order: 2, events: [2], participants: [side(13, "Real C"), side(14, "Real D")] },
          // scheduled with BOTH sides real → an imminent order-of-play match: fetch it for its time/court
          { finished: false, eventInProgress: false, order: 3, events: [3], participants: [side(15, "Real E"), side(16, "Real F")] },
          // scheduled but one side is a "winner-of" placeholder (opponent undecided) → skip
          { finished: false, eventInProgress: false, order: 4, events: [4], participants: [side(17, "Real G"), { order: 2, winner: false, team: { id: 904, name: "R64P4", slug: "r64p4" } }] },
          // scheduled with BOTH sides placeholders (far-future slot, nominal time only) → skip
          { finished: false, eventInProgress: false, order: 5, events: [5], participants: [{ order: 1, winner: false, team: { id: 909, name: "R64P9", slug: "r64p9" } }, { order: 2, winner: false, team: { id: 910, name: "R64P10", slug: "r64p10" } }] },
        ],
      }],
    }],
  };

  it("fetches finished, in-progress AND scheduled-with-two-real-players events, skipping placeholder-fed slots", () => {
    expect(collectEventIds(cup as never).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it("dedupes an event id that appears in more than one block", () => {
    const dup = { cupTrees: [{ rounds: [{ description: "R", blocks: [
      { finished: true, eventInProgress: false, order: 1, events: [7], participants: [] },
      { finished: true, eventInProgress: false, order: 2, events: [7], participants: [] },
    ] }] }] };
    expect(collectEventIds(dup as never)).toEqual([7]);
  });
});

describe("normalizeCuptrees — scheduledStart (coarse order-of-play tier)", () => {
  const s = normalizeCuptrees(cuptreesSample as never, meta);

  it("stamps a not-yet-played match's scheduledStart from the block's seriesStartDateTimestamp", () => {
    expect(s.matches["1-0"].scheduledStart).toBe(1783868400); // scheduled final
  });

  it("leaves finished and live matches timeless", () => {
    expect(s.matches["0-0"].scheduledStart).toBeUndefined(); // finished
    expect(s.matches["0-1"].scheduledStart).toBeUndefined(); // live
  });

  it("stamps a notstarted match (both sides placeholders) too — future rounds carry a nominal date", () => {
    const cup = { cupTrees: [{ rounds: [{ description: "Quarterfinal", blocks: [{
      finished: false, eventInProgress: false, order: 1, events: [77], seriesStartDateTimestamp: 1783418400,
      participants: [
        { order: 1, winner: false, team: { id: 901, name: "Qf1", slug: "qf1" } },
        { order: 2, winner: false, team: { id: 902, name: "Qf2", slug: "qf2" } },
      ],
    }] }] }] };
    const snap = normalizeCuptrees(cup as never, meta);
    expect(snap.matches["0-0"].status).toBe("notstarted");
    expect(snap.matches["0-0"].scheduledStart).toBe(1783418400);
  });
});
