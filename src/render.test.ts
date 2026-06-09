import { describe, it, expect } from "vitest";
import { makeSyntheticSnapshot } from "./fixtures/synthetic";
import { buildSunburst, timeOnCourt } from "./state";
import { layout } from "./layout";
import { colorScale } from "./color";
import { renderSunburst, renderControls } from "./render";
import type { SlamIndex } from "./model";

describe("renderSunburst", () => {
  it("returns an SVG string with one path per arc and a viewBox", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const arcs = layout(buildSunburst(s), 150);
    const svg = renderSunburst(arcs, colorScale("time", s, timeOnCourt(s)), 340);
    expect(svg).toContain("<svg");
    expect(svg).toContain("viewBox");
    expect((svg.match(/<path/g) ?? []).length).toBe(arcs.length);
    // each arc carries its node id for click-to-zoom
    expect(svg).toContain('data-action="zoom"');
    expect(svg).toMatch(/fill="(#|rgb)/);
  });

  it("marks projected arcs with the projected class", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1, completedRounds: 0 });
    const arcs = layout(buildSunburst(s), 150);
    const svg = renderSunburst(arcs, colorScale("seed", s, timeOnCourt(s)), 340);
    expect(svg).toContain("arc projected");
  });
});

describe("renderControls slam switcher", () => {
  const index: SlamIndex = {
    schemaVersion: 2, generatedAt: "t",
    slams: [
      { tour: "ATP", year: 2026, slam: "roland-garros", name: "Roland Garros", surface: "Clay", status: "complete", generatedAt: "t", drawSize: 128 },
      { tour: "ATP", year: 2026, slam: "wimbledon", name: "Wimbledon", surface: "Grass", status: "live", generatedAt: "t", drawSize: 128 },
    ],
  };
  const html = renderControls({ tour: "ATP", colorDim: "time", theme: "dark", index, year: 2026, slam: "wimbledon" });

  it("renders a slam segment per slot with the active one marked", () => {
    expect(html).toContain('data-action="slam"');
    expect(html).toContain('data-slam="wimbledon"');
    expect(html).toMatch(/data-slam="wimbledon"[^>]*class="[^"]*active/);
  });
  it("disables a slot with no data for the year", () => {
    expect(html).toMatch(/data-slam="australian-open"[^>]*disabled/);
  });
  it("renders a year stepper", () => {
    expect(html).toContain('data-action="year"');
    expect(html).toContain("2026");
  });
});
