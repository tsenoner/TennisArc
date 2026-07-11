import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseCurrentGame, parseLiveFeed } from "./flashscore";

const feed = readFileSync(fileURLToPath(new URL("./fixtures/flashscore-live.sample.txt", import.meta.url)), "utf8");

describe("parseLiveFeed", () => {
  it("keeps only the ATP-singles main-draw Wimbledon block", () => {
    const r = parseLiveFeed(feed, { tour: "ATP", slam: "wimbledon" });
    expect(r.map((m) => m.id).sort()).toEqual(["aaa1", "aaa2", "aaa3", "aaa4"]);
  });
  it("excludes doubles, qualification, and other tournaments", () => {
    const ids = parseLiveFeed(feed, { tour: "ATP", slam: "wimbledon" }).map((m) => m.id);
    expect(ids).not.toContain("ddd1"); // doubles
    expect(ids).not.toContain("qqq1"); // qualification
    expect(ids).not.toContain("zzz1"); // Bastad
    expect(ids).not.toContain("bbb1"); // WTA
  });
  it("filters by tour", () => {
    const r = parseLiveFeed(feed, { tour: "WTA", slam: "wimbledon" });
    expect(r.map((m) => m.id)).toEqual(["bbb1"]);
  });
  it("parses stage, names, sets won, and per-set games", () => {
    const live = parseLiveFeed(feed, { tour: "ATP", slam: "wimbledon" }).find((m) => m.id === "aaa1")!;
    expect(live).toMatchObject({ stage: 2, home: "Fritz T.", away: "Zverev A.", setsWon: [1, 0], sets: [[6, 4], [3, 2]] });
  });
  it("omits odds-noise fields", () => {
    const live = parseLiveFeed(feed, { tour: "ATP", slam: "wimbledon" }).find((m) => m.id === "aaa1")!;
    expect(Object.keys(live)).toEqual(["id", "stage", "home", "away", "setsWon", "sets"]);
  });
  it("emits srv from CX on a live record (1 = home, 2 = away)", () => {
    const feed =
      "ZA÷ATP - SINGLES: Wimbledon (United Kingdom), grass¬ZB÷5724¬~" +
      "AA÷aaaa1111¬AB÷2¬AE÷Sinner J.¬AF÷Djokovic N.¬CX÷Sinner J.¬AG÷1¬AH÷0¬BA÷6¬BB÷4¬~" +
      "AA÷bbbb2222¬AB÷2¬AE÷Alcaraz C.¬AF÷Zverev A.¬CX÷Zverev A.¬AG÷0¬AH÷0¬BA÷2¬BB÷3¬~";
    const recs = parseLiveFeed(feed, { tour: "ATP", slam: "wimbledon" });
    expect(recs.map((r) => r.srv)).toEqual([1, 2]);
  });
  it("omits srv when CX is absent, unmatched, or the record is not live", () => {
    const feed =
      "ZA÷ATP - SINGLES: Wimbledon (United Kingdom), grass¬ZB÷5724¬~" +
      "AA÷cccc3333¬AB÷2¬AE÷Fritz T.¬AF÷Paul T.¬AG÷0¬AH÷0¬BA÷1¬BB÷1¬~" +          // no CX
      "AA÷dddd4444¬AB÷2¬AE÷Ruud C.¬AF÷Rune H.¬CX÷Somebody E.¬AG÷0¬AH÷0¬BA÷1¬BB÷1¬~" + // unmatched CX
      "AA÷eeee5555¬AB÷3¬AE÷Fery A.¬AF÷Zverev A.¬CX÷Zverev A.¬AG÷0¬AH÷3¬BA÷6¬BB÷7¬~";  // finished (CX persists upstream)
    const recs = parseLiveFeed(feed, { tour: "ATP", slam: "wimbledon" });
    expect(recs.map((r) => r.srv)).toEqual([undefined, undefined, undefined]);
  });
});

describe("parseCurrentGame (df_mhs current-game feed)", () => {
  // Verbatim shape captured live 2026-07-10 (Sinner–Djokovic Wimbledon SF, between games).
  const BETWEEN_GAMES =
    "TS÷GR¬PT÷TI¬PV÷notab¬TS÷TA¬TS÷HD¬PT÷VA¬PV÷Current game¬TE÷HD¬TS÷RWP¬" +
    "TS÷SC¬PT÷PT¬PV÷1¬PT÷VA¬PV÷0¬TE÷SC¬TS÷SC¬PT÷PT¬PV÷2¬PT÷VA¬PV÷0¬TE÷SC¬" +
    "TE÷RWP¬TE÷TA¬TE÷GR¬A1÷559e897e9099399799bb8fe726208ada¬~";
  const MID_GAME = BETWEEN_GAMES.replace("PV÷1¬PT÷VA¬PV÷0", "PV÷1¬PT÷VA¬PV÷40")
    .replace("PV÷2¬PT÷VA¬PV÷0", "PV÷2¬PT÷VA¬PV÷A");

  it("reads both sides' point values (home = player 1)", () => {
    expect(parseCurrentGame(MID_GAME)).toEqual({ home: "40", away: "A" });
  });

  it("reads 0/0 between games", () => {
    expect(parseCurrentGame(BETWEEN_GAMES)).toEqual({ home: "0", away: "0" });
  });

  it("does NOT capture the 'Current game' header text as a value", () => {
    // the header block is PT÷VA¬PV÷Current game with no preceding PT÷PT — must be skipped
    const parsed = parseCurrentGame(BETWEEN_GAMES);
    expect(parsed).not.toBeNull();
    expect(Object.values(parsed!)).not.toContain("Current game");
  });

  it("reads tiebreak digit values", () => {
    const tb = BETWEEN_GAMES.replace("PV÷1¬PT÷VA¬PV÷0", "PV÷1¬PT÷VA¬PV÷6")
      .replace("PV÷2¬PT÷VA¬PV÷0", "PV÷2¬PT÷VA¬PV÷5");
    expect(parseCurrentGame(tb)).toEqual({ home: "6", away: "5" });
  });

  it("returns null when a side is missing (finished / not-started match)", () => {
    expect(parseCurrentGame("A1÷deadbeef¬~")).toBeNull();
    expect(parseCurrentGame("")).toBeNull();
    expect(parseCurrentGame("TS÷SC¬PT÷PT¬PV÷1¬PT÷VA¬PV÷15¬TE÷SC¬~")).toBeNull(); // only player 1
    expect(parseCurrentGame("TS÷SC¬PT÷PT¬PV÷2¬PT÷VA¬PV÷15¬TE÷SC¬~")).toBeNull(); // only player 2
  });

  it("returns null when orphaned pairing state leaks across block boundaries (drift regression)", () => {
    // Without block-boundary reset: orphaned PT÷PT¬PV÷1 (no matching VA) at end of first block
    // persists into the next block, where a header's PT÷VA incorrectly captures its value.
    // Result would be {home:"Some header", away:"0"} — wrong-loud.
    // With fix: pairing state resets at TS/TE, so header's PT÷VA sees player=null and is skipped.
    const orphanedPlayerWithHeaderDrift =
      "TS÷SC¬PT÷PT¬PV÷1¬TE÷SC¬" + // orphaned player 1, no value
      "TS÷HD¬PT÷VA¬PV÷Some header¬TE÷HD¬" + // header block: should not capture as player 1
      "TS÷SC¬PT÷PT¬PV÷2¬PT÷VA¬PV÷0¬TE÷SC¬~"; // player 2 block
    expect(parseCurrentGame(orphanedPlayerWithHeaderDrift)).toBeNull(); // missing player 1 value
  });
});
