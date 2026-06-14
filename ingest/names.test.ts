import { describe, it, expect } from "vitest";
import { nameTokens, fullKey, sigKey, pairKey, ROUND, TOURNEY } from "./names";

describe("nameTokens", () => {
  it("lowercases, strips accents, and splits on spaces and hyphens", () => {
    expect(nameTokens("Félix Auger-Aliassime")).toEqual(["felix", "auger", "aliassime"]);
  });
  it("maps Ł/ł that NFD cannot decompose", () => {
    expect(nameTokens("Hubert Hurkacz")).toEqual(["hubert", "hurkacz"]);
    expect(nameTokens("Łukasz Kubot")).toEqual(["lukasz", "kubot"]);
  });
  it("drops apostrophes inside a token rather than splitting", () => {
    expect(nameTokens("Christopher O'Connell")).toEqual(["christopher", "oconnell"]);
  });
});

describe("fullKey", () => {
  it("joins all tokens for an exact full-name key", () => {
    expect(fullKey("Barbora Krejčiková")).toBe("barborakrejcikova");
    expect(fullKey("Anastasia Pavlyuchenkova")).toBe("anastasiapavlyuchenkova");
  });
});

describe("sigKey", () => {
  it("is surname plus first initial, abbreviation-tolerant", () => {
    expect(sigKey("Alison Van Uytvanck")).toBe("uytvanck:a");
    expect(sigKey("A. van Uytvanck")).toBe("uytvanck:a");
  });
  it("is empty for an empty name", () => {
    expect(sigKey("")).toBe("");
  });
});

describe("pairKey", () => {
  it("is order-independent within a round", () => {
    expect(pairKey(6, "a", "b")).toBe(pairKey(6, "b", "a"));
    expect(pairKey(6, "a", "b")).not.toBe(pairKey(5, "a", "b"));
  });
});

describe("ROUND / TOURNEY", () => {
  it("maps Sackmann round codes to roundIndex", () => {
    expect(ROUND.R128).toBe(0);
    expect(ROUND.F).toBe(6);
  });
  it("carries the slam name variants used for filtering", () => {
    expect(TOURNEY["roland-garros"]).toContain("french open");
    expect(TOURNEY["us-open"]).toContain("us open");
  });
});
