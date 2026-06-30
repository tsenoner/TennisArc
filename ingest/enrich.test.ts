import { describe, it, expect } from "vitest";
import { enrichMatch, fillMissingCountries } from "./enrich";
import { eventSample, statsSample, liveEventSample } from "./fixtures/event-sample";
import { flagAssetUrl } from "../src/flags";
import type { Match, Player } from "../src/model";

const baseMatch = (over: Partial<Match> = {}): Match => ({
  id: "0-0", roundIndex: 0, slot: 0, nextMatchId: "1-0", p1: "100", p2: "101",
  status: "finished", winner: "p1", score: null, live: null,
  durationSec: null, durationProvisional: false, sofaEventId: 16214963, sofaCustomId: null, stats: null, ...over,
});
const players = (): Record<string, Player> => ({
  100: { id: "100", name: "A", country: "", seed: 1, entry: null, ranking: 1, ageYears: null, sofaSlug: "a", elo: null, birthdate: null },
  101: { id: "101", name: "B", country: "", seed: null, entry: "WC", ranking: 80, ageYears: null, sofaSlug: "b", elo: null, birthdate: null },
});

describe("enrichMatch", () => {
  it("fills customId, per-set score, finished duration (Σ periods) and stats", () => {
    const pl = players();
    const m = enrichMatch(baseMatch(), eventSample, statsSample, pl, 0);
    expect(m.sofaCustomId).toBe("vGHbscHHb");
    expect(m.score).toEqual([{ p1: 6, p2: 1 }, { p1: 6, p2: 3 }, { p1: 6, p2: 4 }]);
    expect(m.durationSec).toBe(1822 + 2463 + 3450);
    expect(m.durationProvisional).toBe(false);
    expect(m.stats).toMatchObject({ aces: [8, 2], doubleFaults: [1, 2], breakPointsConverted: ["4/9", "0/1"], firstServePct: [64, 64] });
    expect(pl["100"].country).toBe("ITA");
    expect(pl["101"].country).toBe("FRA");
  });

  it("nulls a finished duration past the 6h SofaScore bound (suspension wall-clock garbage)", () => {
    const ev = { ...eventSample, time: { period1: 1822, period2: 341176 } }; // rain-suspended set
    const m = enrichMatch(baseMatch(), ev, null, players(), 0);
    expect(m.durationSec).toBeNull();
    expect(m.durationProvisional).toBe(false);
  });

  it("conservatively nulls a 6h+ periodN (a genuine epic and a suspension are indistinguishable; Sackmann backfills it)", () => {
    const ev = { ...eventSample, time: { period1: 12000, period2: 11760 } }; // 23 760s ≈ 6h36 wall-clock
    const m = enrichMatch(baseMatch(), ev, null, players(), 0);
    expect(m.durationSec).toBeNull(); // > MAX_LOCAL_SEC (6h); the CSV pass restores the real on-court time
  });

  it("for a live event derives provisional duration from now - startTimestamp and sets status live", () => {
    const nowSec = liveEventSample.startTimestamp + 1800;
    const m = enrichMatch(baseMatch({ status: "live", winner: null, sofaEventId: 555 }), liveEventSample, null, players(), nowSec);
    expect(m.status).toBe("live");
    expect(m.durationSec).toBe(1800);
    expect(m.durationProvisional).toBe(true);
    expect(m.stats).toBeNull();
  });

  it("maps a retired match (status description) and still counts played time", () => {
    const retEvent = {
      ...eventSample,
      status: { code: 100, description: "Retired", type: "finished" },
      time: { period1: 1822, period2: 600 },
    };
    const m = enrichMatch(baseMatch(), retEvent, statsSample, players(), 0);
    expect(m.status).toBe("retired");
    expect(m.durationSec).toBe(1822 + 600); // partial time still counts
  });
});

describe("fillMissingCountries", () => {
  const player = (id: string, country: string): Player => ({
    id, name: id, country, seed: null, entry: null, ranking: null,
    ageYears: null, sofaSlug: null, elo: null, birthdate: null,
  });

  it("looks up only blank-country players (not-yet-played entrants) and fills them", async () => {
    const players: Record<string, Player> = {
      100: player("100", "ITA"),   // already enriched from a played match — must be skipped
      235576: player("235576", ""), // not-yet-played — needs a country
      999: player("999", ""),
    };
    const seen: number[] = [];
    const lookup = async (teamId: number): Promise<string | null> => {
      seen.push(teamId);
      return teamId === 235576 ? "USA" : "GBR";
    };

    const res = await fillMissingCountries(players, lookup);

    expect(seen.sort((a, b) => a - b)).toEqual([999, 235576]); // the enriched player is never looked up
    expect(players["100"].country).toBe("ITA");   // existing country untouched
    expect(players["235576"].country).toBe("USA");
    expect(players["999"].country).toBe("GBR");
    expect(res).toEqual({ filled: 2, missing: 2 });
  });

  it("skips non-entrant placeholders (SofaScore future-slot 'teams') when entrantIds is given", async () => {
    const players: Record<string, Player> = {
      235576: player("235576", ""), // real round-0 entrant
      900001: player("900001", ""), // placeholder like "Qf1" — never an arc occupant
    };
    const seen: number[] = [];
    const lookup = async (id: number) => { seen.push(id); return "USA"; };

    const res = await fillMissingCountries(players, lookup, new Set(["235576"]));

    expect(seen).toEqual([235576]);              // the placeholder is never looked up
    expect(players["235576"].country).toBe("USA");
    expect(players["900001"].country).toBe("");  // left untouched
    expect(res).toEqual({ filled: 1, missing: 1 });
  });

  it("leaves a player blank when the lookup yields nothing (no spurious country)", async () => {
    const players: Record<string, Player> = { 42: player("42", "") };
    const res = await fillMissingCountries(players, async () => null);
    expect(players["42"].country).toBe("");
    expect(res).toEqual({ filled: 0, missing: 1 });
  });

  it("turns a flagless entrant into one that renders a flag (the reported symptom)", async () => {
    const players: Record<string, Player> = { 235576: player("235576", "") };
    expect(flagAssetUrl(players["235576"].country)).toBeNull(); // before: "" → no flag
    await fillMissingCountries(players, async () => "USA");
    expect(flagAssetUrl(players["235576"].country)).not.toBeNull(); // after: USA → flag
  });

  it("counts only the successful fills when some lookups come back empty", async () => {
    const players: Record<string, Player> = {
      111: player("111", ""),
      222: player("222", ""),
    };
    const lookup = async (id: number) => (id === 111 ? "FRA" : null); // 222 has no country on file

    const res = await fillMissingCountries(players, lookup);

    expect(players["111"].country).toBe("FRA");
    expect(players["222"].country).toBe(""); // still blank — no spurious country
    expect(res).toEqual({ filled: 1, missing: 2 }); // filled counts hits; missing counts blanks
  });

  it("ignores an entrant id that isn't in the players map (no stray lookup, no throw)", async () => {
    const players: Record<string, Player> = { 235576: player("235576", "") };
    const seen: number[] = [];
    const lookup = async (id: number) => { seen.push(id); return "USA"; };

    // entrantIds and the players map can diverge; the players map drives the work.
    const res = await fillMissingCountries(players, lookup, new Set(["235576", "404404"]));

    expect(seen).toEqual([235576]); // 404404 is not in players → never looked up
    expect(players["235576"].country).toBe("USA");
    expect(res).toEqual({ filled: 1, missing: 1 });
  });
});
