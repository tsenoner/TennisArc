import { describe, it, expect } from "vitest";
import { enrichMatch } from "./enrich";
import { eventSample, statsSample, liveEventSample } from "./fixtures/event-sample";
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
