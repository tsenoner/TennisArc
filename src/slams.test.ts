import { describe, it, expect } from "vitest";
import { availableYears, slamsForYear, pickDefaultSlam, SLAM_ORDER } from "./slams";
import type { AvailableSlam, SlamIndex } from "./model";

const slam = (o: Partial<AvailableSlam>): AvailableSlam => ({
  tour: "ATP", year: 2026, slam: "roland-garros", name: "Roland Garros", surface: "Clay",
  status: "complete", generatedAt: "t", drawSize: 128, ...o,
});
const index = (slams: AvailableSlam[]): SlamIndex => ({ schemaVersion: 2, generatedAt: "t", slams });

describe("SLAM_ORDER", () => {
  it("is the calendar order", () => {
    expect(SLAM_ORDER).toEqual(["australian-open", "roland-garros", "wimbledon", "us-open"]);
  });
});

describe("availableYears", () => {
  it("returns distinct years descending for a tour", () => {
    const idx = index([slam({ year: 2024 }), slam({ year: 2026 }), slam({ year: 2026, slam: "wimbledon" }), slam({ tour: "WTA", year: 2025 })]);
    expect(availableYears(idx, "ATP")).toEqual([2026, 2024]);
  });
});

describe("slamsForYear", () => {
  it("returns all four slots in calendar order, marking which exist", () => {
    const idx = index([slam({ year: 2026, slam: "roland-garros" }), slam({ year: 2026, slam: "wimbledon", status: "live" })]);
    const slots = slamsForYear(idx, 2026, "ATP");
    expect(slots.map((s) => s.slam)).toEqual(SLAM_ORDER);
    expect(slots.find((s) => s.slam === "roland-garros")!.entry).not.toBeNull();
    expect(slots.find((s) => s.slam === "australian-open")!.entry).toBeNull();
    expect(slots.find((s) => s.slam === "wimbledon")!.entry!.status).toBe("live");
  });
});

describe("pickDefaultSlam", () => {
  it("prefers the most recent live slam for the tour", () => {
    const idx = index([slam({ year: 2026, slam: "roland-garros", status: "complete" }), slam({ year: 2026, slam: "wimbledon", status: "live" })]);
    expect(pickDefaultSlam(idx, "ATP")).toEqual({ year: 2026, slam: "wimbledon" });
  });
  it("falls back to the most recent complete slam", () => {
    const idx = index([slam({ year: 2024, slam: "us-open", status: "complete" }), slam({ year: 2026, slam: "roland-garros", status: "complete" })]);
    expect(pickDefaultSlam(idx, "ATP")).toEqual({ year: 2026, slam: "roland-garros" });
  });
  it("opens the latest tournament when every slam is complete", () => {
    const idx = index([
      slam({ year: 2021, slam: "us-open", status: "complete" }),
      slam({ year: 2026, slam: "roland-garros", status: "complete" }),
      slam({ year: 2024, slam: "wimbledon", status: "complete" }),
    ]);
    expect(pickDefaultSlam(idx, "ATP")).toEqual({ year: 2026, slam: "roland-garros" });
  });
  it("does not hijack the boot pick with an old slam once spurious 'live' is gone (issue #19 regression)", () => {
    // before the fix the 2021 US Open was wrongly 'live' and won the pick; now everything past is complete
    const idx = index([
      slam({ year: 2021, slam: "us-open", status: "complete" }),
      slam({ year: 2026, slam: "australian-open", status: "complete" }),
    ]);
    expect(pickDefaultSlam(idx, "ATP")).toEqual({ year: 2026, slam: "australian-open" });
  });
  it("returns null when the tour has no slams", () => {
    expect(pickDefaultSlam(index([slam({ tour: "WTA" })]), "ATP")).toBeNull();
  });
});
