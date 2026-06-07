import { describe, it, expect } from "vitest";
import { makeSyntheticSnapshot } from "./fixtures/synthetic";
import { buildSunburst, timeOnCourt } from "./state";
import { layout } from "./layout";
import { colorScale } from "./color";
import { renderSunburst } from "./render";

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
  });

  it("marks projected arcs with the projected class", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1, completedRounds: 0 });
    const arcs = layout(buildSunburst(s), 150);
    const svg = renderSunburst(arcs, colorScale("seed", s, timeOnCourt(s)), 340);
    expect(svg).toContain("arc projected");
  });
});
