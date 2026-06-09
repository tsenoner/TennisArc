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
  it("throws when the requested year has no season", () => {
    expect(() => pickSeasonId(seasons, 2019)).toThrow(/no season for year 2019/);
  });
  it("throws when there are no seasons", () => {
    expect(() => pickSeasonId([])).toThrow(/no seasons/);
  });
});
