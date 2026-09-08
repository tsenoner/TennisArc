import { describe, it, expect } from "vitest";
import { pickSeasonId } from "./seasons";

const seasons = [
  { id: 90000, year: "2026" },
  { id: 85951, year: "2025" },
  { id: 70000, year: "2024" },
];

describe("pickSeasonId", () => {
  it("returns the newest (first) season when no year is given", () => {
    expect(pickSeasonId(seasons)).toBe(90000);
  });
  it("returns the season matching a requested year", () => {
    expect(pickSeasonId(seasons, 2024)).toBe(70000);
  });
  it("returns null when the requested year has no season — not published yet, not a failure", () => {
    expect(pickSeasonId(seasons, 2019)).toBeNull(); // not published yet — the caller dates it, see drawBy
  });
  it("throws when there are no seasons", () => {
    expect(() => pickSeasonId([])).toThrow(/no seasons/);
  });
});
