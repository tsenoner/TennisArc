import { describe, it, expect } from "vitest";
import { makeSyntheticSnapshot } from "./fixtures/synthetic";
import { buildSunburst, timeOnCourt } from "./state";
import { layout } from "./layout";
import type { LayoutArc } from "./layout";
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

describe("renderSunburst labels", () => {
  const bigArc: LayoutArc = { id: "r", matchId: "1-0", occupant: "p0", projected: false, depth: 0, x0: 0, x1: Math.PI, y0: 40, y1: 120 };
  const color = () => "#fff";
  const labels = { anchors: new Set(["r"]), text: (id: string) => (id === "p0" ? "Sinner" : id) };

  it("emits a curved textPath label for an anchored, wide-enough arc", () => {
    const svg = renderSunburst([bigArc], color, 700, labels);
    expect(svg).toContain("<textPath");
    expect(svg).toContain("Sinner");
    expect(svg).toContain('data-occupant="p0"');
  });

  it("omits the label when the arc is not an anchor", () => {
    const svg = renderSunburst([bigArc], color, 700, { anchors: new Set<string>(), text: () => "Sinner" });
    expect(svg).not.toContain("<textPath");
  });

  it("omits the label on a projected arc", () => {
    const proj = { ...bigArc, projected: true };
    expect(renderSunburst([proj], color, 700, labels)).not.toContain("<textPath");
  });
});

import { renderReadout, type ReadoutInfo } from "./render";

describe("renderReadout", () => {
  const info: ReadoutInfo = {
    name: "Carlos Alcaraz", country: "ESP", ranking: 2, seed: 2,
    eloLabel: "Clay ELO 2107", roundLabel: "4th round", sec: 22320, provisional: false, projected: false,
  };

  it("renders name, rank/seed, country, elo and time", () => {
    const html = renderReadout(info);
    expect(html).toContain("Carlos Alcaraz");
    expect(html).toContain("ESP");
    expect(html).toContain("#2");
    expect(html).toContain("Clay ELO 2107");
    expect(html).toContain("6h12"); // 22320s
  });

  it("renders an empty container for null (no subject)", () => {
    expect(renderReadout(null)).toContain('class="readout"');
  });
});

import { renderSeedPanel, renderCountryPanel } from "./render";
import type { SeedInsights, NationRow } from "./state";

describe("renderSeedPanel", () => {
  const ins: SeedInsights = {
    seedsTotal: 32, seedsRemaining: 11,
    upsets: [{ winnerId: "a", winnerName: "Bublik", loserId: "b", loserName: "Medvedev", loserSeed: 6, roundName: "Round of 16", eloGap: 120 }],
  };
  it("shows seeds-in count and upset rows", () => {
    const html = renderSeedPanel(ins);
    expect(html).toContain("11");
    expect(html).toContain("Bublik");
    expect(html).toContain("Medvedev");
  });
});

describe("renderCountryPanel", () => {
  const rows: NationRow[] = [
    { country: "ITA", entrants: 4, stillIn: 1, players: [{ id: "x", name: "Sinner", roundReached: 5, alive: true }] },
  ];
  it("renders a nation row with flag, counts and select action; expands the selected one", () => {
    const html = renderCountryPanel(rows, "ITA");
    expect(html).toContain("🇮🇹");
    expect(html).toContain('data-action="country"');
    expect(html).toContain('data-country="ITA"');
    expect(html).toContain("Sinner"); // expanded because ITA is selected
  });
});
