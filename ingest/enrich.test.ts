import { describe, it, expect } from "vitest";
import { enrichMatch, carryForwardCountries, carryForwardSuspended, fillMissingCountries } from "./enrich";
import { eventSample, statsSample, liveEventSample, scheduledEventSample } from "./fixtures/event-sample";
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

  it("recovers a finished duration from the un-suspended sets instead of nulling the whole match", () => {
    // set 3 spanned an overnight curfew suspension (65 336s ≈ 18h); sets 1–2 are normal. The healed
    // duration estimates set 3 as the mean of the clean sets — so the finished match shows real time.
    const ev = { ...eventSample, time: { period1: 2546, period2: 3217, period3: 65336 } };
    const m = enrichMatch(baseMatch(), ev, null, players(), 0);
    const mean = (2546 + 3217) / 2;
    expect(m.durationSec).toBe(Math.round(2546 + 3217 + mean));
    expect(m.durationProvisional).toBe(true); // healed = estimated, so provisional until Sackmann backfills
  });

  it("conservatively nulls a finished match where EVERY set is implausibly long (genuine epic and uniform garbage are indistinguishable; Sackmann backfills it)", () => {
    const ev = { ...eventSample, time: { period1: 12000, period2: 11760 } }; // both sets > 3h: no clean anchor
    const m = enrichMatch(baseMatch(), ev, null, players(), 0);
    expect(m.durationSec).toBeNull(); // the CSV pass restores the real on-court time
  });

  it("for a live event derives provisional duration from now - startTimestamp and sets status live", () => {
    const nowSec = liveEventSample.startTimestamp + 1800;
    const m = enrichMatch(baseMatch({ status: "live", winner: null, sofaEventId: 555 }), liveEventSample, null, players(), nowSec);
    expect(m.status).toBe("live");
    expect(m.durationSec).toBe(1800);
    expect(m.durationProvisional).toBe(true);
    expect(m.stats).toBeNull();
  });

  it("nulls a live duration whose elapsed exceeds the 6h bound (match resumed after an overnight suspension)", () => {
    const ev = { ...liveEventSample, startTimestamp: 1000 };
    const nowSec = ev.startTimestamp + 23 * 3600; // ~23h of wall-clock since it first started yesterday
    const m = enrichMatch(baseMatch({ status: "live", winner: null, sofaEventId: 555 }), ev, null, players(), nowSec);
    expect(m.status).toBe("live");
    expect(m.durationSec).toBeNull(); // suspension wall-clock must not dominate the live leaderboard
    expect(m.durationProvisional).toBe(false);
  });

  it("flags a live match with no point update for >20min as suspended (play has stopped)", () => {
    const nowSec = 1_000_000;
    // last point was 3h ago (overnight curfew): the feed has gone stale
    const ev = { ...liveEventSample, startTimestamp: nowSec - 3600, changes: { changeTimestamp: nowSec - 3 * 3600 } };
    const m = enrichMatch(baseMatch({ status: "live", winner: null, sofaEventId: 555 }), ev, null, players(), nowSec);
    expect(m.status).toBe("suspended");
    expect(m.durationSec).toBeNull();          // on-court time is unknown while paused
    expect(m.durationProvisional).toBe(false);
    expect(m.wasSuspended).toBe(true);
  });

  it("suppresses a suspended match's partial mid-play stats, exactly as for a live one", () => {
    const nowSec = 1_000_000;
    // paused mid-play (last point 3h ago) but SofaScore still serves a partial /statistics payload
    const ev = { ...liveEventSample, startTimestamp: nowSec - 3600, changes: { changeTimestamp: nowSec - 3 * 3600 } };
    const m = enrichMatch(baseMatch({ status: "live", winner: null, sofaEventId: 555 }), ev, statsSample, players(), nowSec);
    expect(m.status).toBe("suspended");
    expect(m.stats).toBeNull(); // half-played aces/DF must not read as final while play is paused
  });

  it("does not flag a decided match as suspended even with a stale feed (winner already in)", () => {
    const nowSec = 1_000_000;
    // SofaScore lags on "inprogress" after the deciding point, so the feed is 3h stale — but winnerCode is set
    const ev = { ...liveEventSample, winnerCode: 1, startTimestamp: nowSec - 3600, changes: { changeTimestamp: nowSec - 3 * 3600 } };
    const m = enrichMatch(baseMatch({ status: "live", winner: null, sofaEventId: 555 }), ev, null, players(), nowSec);
    expect(m.status).not.toBe("suspended"); // play is over, not paused
    expect(m.wasSuspended).toBeFalsy();      // so no sticky suspension flag / badge is minted
  });

  it("keeps a live match with a fresh feed as live — even a RESUMED one whose set has been 'open' for hours", () => {
    const nowSec = 1_000_000;
    // currentPeriodStartTimestamp stays frozen at the pre-suspension value after a mid-set resumption,
    // but points are flowing again (updated 30s ago) → the staleness signal correctly reads it as live.
    const ev = { ...liveEventSample, startTimestamp: nowSec - 16 * 3600,
      time: { currentPeriodStartTimestamp: nowSec - 16 * 3600 }, changes: { changeTimestamp: nowSec - 30 } };
    const m = enrichMatch(baseMatch({ status: "live", winner: null }), ev, null, players(), nowSec);
    expect(m.status).toBe("live");
    expect(m.wasSuspended).toBeFalsy();
  });

  it("falls back to an implausibly-long-open set when the event carries no update timestamp", () => {
    const setStart = 100_000;
    const nowSec = setStart + 16 * 3600; // set 'open' 16h and no `changes` field at all
    const ev = { ...liveEventSample, startTimestamp: setStart, time: { currentPeriodStartTimestamp: setStart } };
    const m = enrichMatch(baseMatch({ status: "live", winner: null }), ev, null, players(), nowSec);
    expect(m.status).toBe("suspended");
  });

  it("keeps a normal live match as live (a point landed a minute ago)", () => {
    const nowSec = 100_000;
    const ev = { ...liveEventSample, startTimestamp: nowSec - 1800, changes: { changeTimestamp: nowSec - 60 } };
    const m = enrichMatch(baseMatch({ status: "live", winner: null }), ev, null, players(), nowSec);
    expect(m.status).toBe("live");
    expect(m.durationSec).toBe(1800);
    expect(m.wasSuspended).toBeFalsy();
  });

  it("flags a FINISHED match whose per-set time carries a suspension-inflated set as wasSuspended", () => {
    const ev = { ...eventSample, time: { period1: 2546, period2: 3217, period3: 65336 } };
    const m = enrichMatch(baseMatch(), ev, null, players(), 0);
    expect(m.status).toBe("finished");
    expect(m.wasSuspended).toBe(true);
  });

  it("does not flag a normal finished match as wasSuspended", () => {
    const m = enrichMatch(baseMatch(), eventSample, statsSample, players(), 0);
    expect(m.wasSuspended).toBeFalsy();
  });

  it("records a scheduled match's order-of-play start and court, and leaves it timeless", () => {
    const m = enrichMatch(baseMatch({ status: "scheduled", winner: null, sofaEventId: 999 }), scheduledEventSample, null, players(), 0);
    expect(m.status).toBe("scheduled");
    expect(m.scheduledStart).toBe(1782999600);
    expect(m.scheduledCourt).toBe("Court 2");
    expect(m.winner).toBeNull();
    expect(m.durationSec).toBeNull();
    expect(m.wasSuspended).toBeFalsy();
  });

  it("falls back to the stadium name when the venue has no direct name", () => {
    const ev = { ...scheduledEventSample, venue: { stadium: { name: "Centre Court" } } };
    const m = enrichMatch(baseMatch({ status: "scheduled", winner: null }), ev, null, players(), 0);
    expect(m.scheduledCourt).toBe("Centre Court");
  });

  it("falls back to the stadium name when the venue name is blank (not just absent)", () => {
    const ev = { ...scheduledEventSample, venue: { name: "", stadium: { name: "Centre Court" } } };
    const m = enrichMatch(baseMatch({ status: "scheduled", winner: null }), ev, null, players(), 0);
    expect(m.scheduledCourt).toBe("Centre Court");
  });

  it("does NOT stamp scheduled fields onto a finished match", () => {
    const m = enrichMatch(baseMatch(), eventSample, statsSample, players(), 0);
    expect(m.scheduledStart).toBeUndefined();
    expect(m.scheduledCourt).toBeUndefined();
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

describe("carryForwardSuspended", () => {
  it("ORs a prior wasSuspended flag onto the current match (sticky across refreshes)", () => {
    const matches = { "0-1": baseMatch({ id: "0-1", wasSuspended: false }) };
    const prior = { "0-1": baseMatch({ id: "0-1", wasSuspended: true }) };
    const n = carryForwardSuspended(matches, prior);
    expect(matches["0-1"].wasSuspended).toBe(true);
    expect(n).toBe(1);
  });

  it("never clears a flag the current refresh already set, and needs no prior entry", () => {
    const matches = { "0-1": baseMatch({ id: "0-1", wasSuspended: true }) };
    expect(carryForwardSuspended(matches, { "0-1": baseMatch({ id: "0-1", wasSuspended: false }) })).toBe(0);
    expect(matches["0-1"].wasSuspended).toBe(true);
  });

  it("is a no-op with no prior snapshot (first run)", () => {
    const matches = { "0-1": baseMatch({ id: "0-1" }) };
    expect(carryForwardSuspended(matches, null)).toBe(0);
    expect(matches["0-1"].wasSuspended).toBeFalsy();
  });
});

describe("carryForwardCountries", () => {
  const player = (id: string, country: string): Player => ({
    id, name: id, country, seed: null, entry: null, ranking: null,
    ageYears: null, sofaSlug: null, elo: null, birthdate: null,
  });

  it("reuses a prior country for a still-blank entrant, leaving enriched ones untouched", () => {
    const players: Record<string, Player> = {
      235576: player("235576", ""),    // not-yet-played — prior run knew the country
      100: player("100", "ITA"),       // enriched from a played match this run — must win
    };
    const prior: Record<string, Player> = {
      235576: player("235576", "USA"),
      100: player("100", "GBR"),        // stale/different — must NOT overwrite the fresh ITA
    };

    const carried = carryForwardCountries(players, prior);

    expect(players["235576"].country).toBe("USA"); // carried forward
    expect(players["100"].country).toBe("ITA");    // fresh enrichment untouched
    expect(carried).toBe(1);
  });

  it("carries nothing the prior snapshot also lacked (no spurious country)", () => {
    const players: Record<string, Player> = { 42: player("42", "") };
    const prior: Record<string, Player> = { 42: player("42", "") };
    expect(carryForwardCountries(players, prior)).toBe(0);
    expect(players["42"].country).toBe("");
  });

  it("respects entrantIds scope — a placeholder is not carried even if prior had one", () => {
    const players: Record<string, Player> = {
      235576: player("235576", ""), // real round-0 entrant
      900001: player("900001", ""), // placeholder future-slot
    };
    const prior: Record<string, Player> = {
      235576: player("235576", "USA"),
      900001: player("900001", "ZZZ"), // stray — must be ignored (out of entrant scope)
    };

    const carried = carryForwardCountries(players, prior, new Set(["235576"]));

    expect(players["235576"].country).toBe("USA");
    expect(players["900001"].country).toBe(""); // untouched
    expect(carried).toBe(1);
  });

  it("carries nothing on the first run (no prior snapshot) or when prior lacks the player", () => {
    const players: Record<string, Player> = { 42: player("42", "") };
    expect(carryForwardCountries(players, null)).toBe(0);
    expect(carryForwardCountries(players, {}, new Set(["42"]))).toBe(0);
    expect(players["42"].country).toBe("");
  });
});
