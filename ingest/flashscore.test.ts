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
  });
});
