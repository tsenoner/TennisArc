import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseLiveFeed } from "./flashscore";

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
