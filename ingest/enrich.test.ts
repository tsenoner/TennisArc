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
  100: { id: "100", name: "A", country: "", seed: 1, entry: null, ranking: 1, ageYears: null, sofaSlug: "a" },
  101: { id: "101", name: "B", country: "", seed: null, entry: "WC", ranking: 80, ageYears: null, sofaSlug: "b" },
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

  it("for a live event derives provisional duration from now - startTimestamp and sets status live", () => {
    const nowSec = liveEventSample.startTimestamp + 1800;
    const m = enrichMatch(baseMatch({ status: "live", winner: null, sofaEventId: 555 }), liveEventSample, null, players(), nowSec);
    expect(m.status).toBe("live");
    expect(m.durationSec).toBe(1800);
    expect(m.durationProvisional).toBe(true);
    expect(m.stats).toBeNull();
  });
});
