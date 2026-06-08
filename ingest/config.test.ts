import { describe, it, expect } from "vitest";
import { activeSlam } from "./config";

describe("activeSlam", () => {
  it("returns the Slam in progress within its [from, to) window", () => {
    // RG window 2026-05-21 … 2026-06-09
    expect(activeSlam(new Date("2026-05-21"))).toBe("roland-garros"); // draw day → window opens
    expect(activeSlam(new Date("2026-06-08"))).toBe("roland-garros"); // day after the final, still in window
    expect(activeSlam(new Date("2026-06-30"))).toBe("wimbledon");
    expect(activeSlam(new Date("2026-01-20"))).toBe("australian-open");
    expect(activeSlam(new Date("2026-09-01"))).toBe("us-open");
  });

  it("returns null between Slams — nothing to refresh, data won't change", () => {
    expect(activeSlam(new Date("2026-06-15"))).toBeNull(); // after RG closes, before the Wimbledon draw
    expect(activeSlam(new Date("2026-07-20"))).toBeNull(); // after Wimbledon closes
    expect(activeSlam(new Date("2026-03-01"))).toBeNull(); // deep off-season
    expect(activeSlam(new Date("2026-12-25"))).toBeNull(); // year-end, before next AO
  });

  it("honours a valid SLAM override even out of window, ignores an invalid one", () => {
    expect(activeSlam(new Date("2026-03-01"), "wimbledon")).toBe("wimbledon"); // forced out of season
    expect(activeSlam(new Date("2026-06-08"), "nonsense")).toBe("roland-garros"); // invalid → fall back to window
    expect(activeSlam(new Date("2026-03-01"), "nonsense")).toBeNull(); // invalid + off-season → null
  });
});
