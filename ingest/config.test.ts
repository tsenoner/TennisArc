import { describe, it, expect } from "vitest";
import { currentSlam } from "./config";

describe("currentSlam", () => {
  it("picks the slam whose draw window is current (latest `from` already past)", () => {
    // RG just finished, Wimbledon draw not out yet → still RG
    expect(currentSlam(new Date("2026-06-08"), undefined)).toBe("roland-garros");
    // Wimbledon draw day → auto-switch
    expect(currentSlam(new Date("2026-06-26"), undefined)).toBe("wimbledon");
    // between Wimbledon and US Open → keep showing Wimbledon (most recent)
    expect(currentSlam(new Date("2026-07-20"), undefined)).toBe("wimbledon");
    expect(currentSlam(new Date("2026-02-10"), undefined)).toBe("australian-open");
    expect(currentSlam(new Date("2026-09-01"), undefined)).toBe("us-open");
  });

  it("honours a valid SLAM override and ignores an invalid one", () => {
    expect(currentSlam(new Date("2026-06-08"), "wimbledon")).toBe("wimbledon");
    expect(currentSlam(new Date("2026-06-08"), "nonsense")).toBe("roland-garros");
  });
});
