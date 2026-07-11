import { describe, it, expect, vi, afterEach } from "vitest";
import { overlayLive, applyLivePatch, fetchLive, fetchPbp, samePatch } from "./live";
import type { LiveRecord, Match, Player, Snapshot } from "./model";

const player = (id: string, name: string): Player => ({
  id, name, country: "", seed: null, entry: null, ranking: null, sofaSlug: null, elo: null, birthdate: null,
});
const match = (id: string, p1: string, p2: string, extra: Partial<Match> = {}): Match => ({
  id, roundIndex: 0, slot: 0, nextMatchId: null, p1, p2, status: "scheduled", winner: null, score: null,
  live: null, durationSec: null, durationProvisional: false, sofaEventId: null, sofaCustomId: null, stats: null, ...extra,
});
const snap = (tour: "ATP" | "WTA", players: Player[], matches: Match[]): Snapshot => ({
  schemaVersion: 1, generatedAt: "2026-07-08T00:00:00Z", tour,
  tournament: { slam: "wimbledon", name: "Wimbledon", year: 2026, surface: "grass", sofaUniqueTournamentId: 0, sofaSeasonId: 0, drawSize: 128 },
  players: Object.fromEntries(players.map((p) => [p.id, p])), rounds: [],
  matches: Object.fromEntries(matches.map((m) => [m.id, m])),
});
const rec = (o: Partial<LiveRecord> & Pick<LiveRecord, "home" | "away" | "stage">): LiveRecord => ({
  id: "x", setsWon: [0, 0], sets: [], ...o,
});

afterEach(() => vi.restoreAllMocks());

describe("overlayLive", () => {
  it("joins by surname-pair and overlays a live score, oriented to p1/p2", () => {
    const s = snap("ATP", [player("a", "Taylor Fritz"), player("b", "Alexander Zverev")], [match("0-0", "a", "b")]);
    // Flashscore lists Zverev as home, Fritz as away → must orient to p1=Fritz(a)
    const r = rec({ id: "x", home: "Zverev A.", away: "Fritz T.", stage: 2, setsWon: [0, 1], sets: [[4, 6], [2, 3]] });
    const patch = overlayLive(s, [r]);
    expect(patch["0-0"]).toEqual({
      status: "live", score: [{ p1: 6, p2: 4 }, { p1: 3, p2: 2 }],
      flash: { id: "x", homeIsP1: false },
    });
  });
  it("sets winner on a finished match only when a side reaches the sets-to-win threshold (ATP=3)", () => {
    const s = snap("ATP", [player("a", "Carlos Alcaraz"), player("b", "Jannik Sinner")], [match("0-0", "a", "b")]);
    const patch = overlayLive(s, [rec({ home: "Alcaraz C.", away: "Sinner J.", stage: 3, setsWon: [3, 1], sets: [[6, 4]] })]);
    expect(patch["0-0"]!.status).toBe("finished");
    expect(patch["0-0"]!.winner).toBe("p1");
  });
  it("leaves winner unset on a retirement shape (leader below threshold)", () => {
    const s = snap("ATP", [player("a", "Rafael Nadal"), player("b", "Novak Djokovic")], [match("0-0", "a", "b")]);
    const patch = overlayLive(s, [rec({ home: "Nadal R.", away: "Djokovic N.", stage: 3, setsWon: [2, 0], sets: [] })]);
    expect(patch["0-0"]!.status).toBe("finished");
    expect("winner" in patch["0-0"]!).toBe(false);
  });
  it("uses the WTA threshold of 2", () => {
    const s = snap("WTA", [player("a", "Iga Swiatek"), player("b", "Aryna Sabalenka")], [match("0-0", "a", "b")]);
    const patch = overlayLive(s, [rec({ home: "Swiatek I.", away: "Sabalenka A.", stage: 3, setsWon: [2, 1], sets: [] })]);
    expect(patch["0-0"]!.winner).toBe("p1");
  });
  it("skips scheduled (stage 1) records", () => {
    const s = snap("ATP", [player("a", "Daniil Medvedev"), player("b", "Holger Rune")], [match("0-0", "a", "b")]);
    expect(overlayLive(s, [rec({ home: "Medvedev D.", away: "Rune H.", stage: 1 })])).toEqual({});
  });
  it("drops ambiguous surname-pairs rather than mis-joining", () => {
    const s = snap("ATP",
      [player("a", "Taylor Fritz"), player("b", "Alexander Zverev"), player("c", "Tommy Fritz"), player("d", "Andrey Zverev")],
      [match("0-0", "a", "b"), match("0-1", "c", "d")]);
    expect(overlayLive(s, [rec({ home: "Fritz T.", away: "Zverev A.", stage: 2, setsWon: [1, 0], sets: [[6, 0]] })])).toEqual({});
  });
  it("stamps flash/orientation/serving on a live patch", () => {
    // reuse the Alcaraz/Sinner snapshot (home = p1's short name), adding srv
    const s = snap("ATP", [player("a", "Carlos Alcaraz"), player("b", "Jannik Sinner")], [match("0-0", "a", "b")]);
    const r = rec({ home: "Alcaraz C.", away: "Sinner J.", stage: 2, srv: 2 }); // away serving
    const patch = overlayLive(s, [r])["0-0"]!;
    expect(patch.flash).toEqual({ id: r.id, homeIsP1: true });
    expect(patch.serving).toBe("p2"); // away = p2 when home is p1
  });
  it("resolves orientation and serving when the record's home is our p2", () => {
    const s = snap("ATP", [player("a", "Carlos Alcaraz"), player("b", "Jannik Sinner")], [match("0-0", "a", "b")]);
    const r = rec({ home: "Sinner J.", away: "Alcaraz C.", stage: 2, srv: 1 }); // record home (our p2) serving
    const patch = overlayLive(s, [r])["0-0"]!;
    expect(patch.flash?.homeIsP1).toBe(false);
    expect(patch.serving).toBe("p2"); // record home serving = our p2
  });
  it("puts NO transient live fields on a finished patch", () => {
    const s = snap("ATP", [player("a", "Carlos Alcaraz"), player("b", "Jannik Sinner")], [match("0-0", "a", "b")]);
    const r = rec({ home: "Alcaraz C.", away: "Sinner J.", stage: 3, setsWon: [3, 0], srv: 1 });
    const patch = overlayLive(s, [r])["0-0"]!;
    expect(patch.flash).toBeUndefined();
    expect(patch.serving).toBeUndefined();
  });
});

describe("applyLivePatch", () => {
  it("returns a new snapshot with patched matches and leaves the original untouched", () => {
    const s = snap("ATP", [player("a", "Taylor Fritz"), player("b", "Alexander Zverev")], [match("0-0", "a", "b")]);
    const out = applyLivePatch(s, { "0-0": { status: "live" } });
    expect(out).not.toBe(s);
    expect(out.matches["0-0"].status).toBe("live");
    expect(s.matches["0-0"].status).toBe("scheduled"); // original immutable
  });
  it("returns the same object when there is no patch", () => {
    const s = snap("ATP", [player("a", "X Y")], []);
    expect(applyLivePatch(s, undefined)).toBe(s);
    expect(applyLivePatch(s, {})).toBe(s);
  });
});

describe("samePatch", () => {
  it("is true regardless of match-id insertion order (a reordered feed is not a change)", () => {
    const a: Record<string, Partial<Match>> = { "0-0": { status: "live" }, "0-1": { status: "finished" } };
    const b: Record<string, Partial<Match>> = { "0-1": { status: "finished" }, "0-0": { status: "live" } };
    expect(samePatch(a, b)).toBe(true);
  });
  it("is false when a match's value differs", () => {
    expect(samePatch({ "0-0": { status: "live" } }, { "0-0": { status: "finished" } })).toBe(false);
  });
  it("is false when the key sets differ", () => {
    expect(samePatch({ "0-0": {} }, { "0-0": {}, "0-1": {} })).toBe(false);
  });
});

describe("fetchLive", () => {
  it("returns the matches array on a valid response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ matches: [rec({ home: "A B.", away: "C D.", stage: 2 })] }) })));
    expect(await fetchLive("ATP", "wimbledon")).toHaveLength(1);
  });
  it("returns null on a non-ok response or non-JSON body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    expect(await fetchLive("ATP", "wimbledon")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => { throw new Error("html"); } })));
    expect(await fetchLive("ATP", "wimbledon")).toBeNull();
  });
});

describe("fetchPbp", () => {
  it("fetches same-origin with no-store and returns the game", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ home: "30", away: "15" }) } as Response));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchPbp("nkXJ8mYa")).toEqual({ home: "30", away: "15" });
    expect(fetchMock).toHaveBeenCalledWith("/api/pbp?mid=nkXJ8mYa", { cache: "no-store" });
  });
  it("returns null on the empty {} body (no current game)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) } as Response)));
    expect(await fetchPbp("nkXJ8mYa")).toBeNull();
  });
  it("returns null on HTTP failure and thrown fetch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 } as Response)));
    expect(await fetchPbp("nkXJ8mYa")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("net"); }));
    expect(await fetchPbp("nkXJ8mYa")).toBeNull();
  });
});
