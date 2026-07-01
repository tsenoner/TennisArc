import { describe, it, expect } from "vitest";
import { makeSyntheticSnapshot } from "./fixtures/synthetic";
import { buildSunburst, eliminatedSet } from "./state";
import { layout } from "./layout";
import type { LayoutArc } from "./layout";
import { colorScale } from "./color";
import { renderSunburst, renderControls, renderQuarterFocusButtons } from "./render";
import type { SlamIndex } from "./model";

describe("renderSunburst", () => {
  it("returns an SVG string with one path per arc and a viewBox", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const arcs = layout(buildSunburst(s), 150);
    const svg = renderSunburst(arcs, colorScale("time", s), 340);
    expect(svg).toContain("<svg");
    expect(svg).toContain("viewBox");
    expect((svg.match(/<path/g) ?? []).length).toBe(arcs.length);
    // each arc carries its node id for click-to-inspect
    expect(svg).toContain('data-action="inspect"');
    expect(svg).toMatch(/fill="(#|rgb)/);
  });

  it("marks projected arcs with the projected class", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1, completedRounds: 0 });
    const arcs = layout(buildSunburst(s), 150);
    const svg = renderSunburst(arcs, colorScale("seed", s), 340);
    expect(svg).toContain("arc projected");
  });

  it("marks no-court-time arcs with the pending class under the time lens", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1, completedRounds: 0 });
    const arcs = layout(buildSunburst(s), 150);
    expect(renderSunburst(arcs, colorScale("time", s), 340)).toContain("pending");
    // the seed lens keeps projected arcs coloured by seed — no pending scaffold
    expect(renderSunburst(arcs, colorScale("seed", s), 340)).not.toContain("pending");
  });

  it("marks a live match arc with the live class (active, coloured, no winner name)", () => {
    const liveArc: LayoutArc = {
      id: "r.0", matchId: "1-0", occupant: "p0", projected: true, live: true,
      depth: 1, x0: 0, x1: Math.PI, y0: 40, y1: 120,
    };
    const svg = renderSunburst([liveArc], () => "rgb(200,120,60)", 700);
    expect(svg).toMatch(/class="arc[^"]*\blive\b[^"]*"/);
  });

  it("marks a suspended match arc with the suspended class (paused, still lit)", () => {
    const suspArc: LayoutArc = {
      id: "r.0", matchId: "1-0", occupant: "p0", projected: true, suspended: true,
      depth: 1, x0: 0, x1: Math.PI, y0: 40, y1: 120,
    };
    const svg = renderSunburst([suspArc], () => "rgb(200,120,60)", 700);
    expect(svg).toMatch(/class="arc[^"]*\bsuspended\b[^"]*"/);
    expect(svg).not.toMatch(/class="arc[^"]*\blive\b[^"]*"/); // suspended is its own tier, not live
  });

  it("hatches live arcs and announces the live count (Option A: static in-progress marker)", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1, completedRounds: 0 });
    s.matches["0-1"] = { ...s.matches["0-1"], status: "live", winner: null, durationSec: 1800, durationProvisional: true };
    const arcs = layout(buildSunburst(s), 150);
    const svg = renderSunburst(arcs, colorScale("time", s), 340);
    expect(svg).toContain('id="liveHatch"');             // hatch pattern defined once
    expect(svg).toContain('fill="url(#liveHatch)"');      // overlay drawn on the live arc
    expect(svg).toMatch(/aria-label="Tournament bracket sunburst[^"]*in progress"/); // SR live count
  });

  it("omits the hatch pattern and live count when nothing is live", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 }); // every match finished
    const arcs = layout(buildSunburst(s), 150);
    const svg = renderSunburst(arcs, colorScale("time", s), 340);
    expect(svg).not.toContain("liveHatch");
    expect(svg).toContain('aria-label="Tournament bracket sunburst"');
  });

  it("dims eliminated players' arcs with the out class (still-in players stay bright)", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 }); // whole draw played → losers exist
    const arcs = layout(buildSunburst(s), 150);
    const eliminated = eliminatedSet(s);
    const svg = renderSunburst(arcs, colorScale("time", s), 340, undefined, undefined, undefined, eliminated);
    expect(svg).toContain("arc out");
    // no eliminated set passed → no dimming
    expect(renderSunburst(arcs, colorScale("time", s), 340)).not.toContain(' out"');
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

  it("draws a rotated flag <image> instead of a textPath when an image url is provided (Country lens)", () => {
    const svg = renderSunburst([bigArc], color, 700, { ...labels, image: () => "/flags/it.svg" });
    expect(svg).toMatch(/<image class="arc-flag" href="\/flags\/it\.svg"[^>]*transform="rotate\(/);
    expect(svg).not.toContain("<textPath"); // the image replaces the text label
  });

  it("falls back to the text label when the image fn returns null (unmapped country)", () => {
    const svg = renderSunburst([bigArc], color, 700, { ...labels, image: () => null });
    expect(svg).toContain("<textPath");
    expect(svg).not.toContain("arc-flag");
  });
});

describe("renderSunburst quarter-owner corner labels", () => {
  const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 32, seed: 7 });
  const RADIUS = 342; // the app's layout radius: SIZE/2 - 8 — the disc the hit rects must clear
  const arcs = layout(buildSunburst(s), RADIUS);
  const quarters = [
    { nodeId: "r.0.0", playerId: "p0", surname: "Sinner", country: "ITA", seed: 1, out: true },
    { nodeId: "r.0.1", playerId: "p8", surname: "Alcaraz", country: "ESP", seed: 9, out: false },
    { nodeId: "r.1.0", playerId: "p16", surname: "Zverev", country: "GER", seed: 17, out: false },
    { nodeId: "r.1.1", playerId: null, surname: "", country: "", seed: null, out: false },
  ];
  const svg = renderSunburst(arcs, colorScale("time", s), 700, undefined, undefined, quarters);
  const groups = svg.split('<g class="q-owner').slice(1).map((g) => g.split("</g>")[0]);

  it("emits four focus handles in TR/BR/BL/TL node order, with occupant + caption", () => {
    expect(groups).toHaveLength(4);
    const ids = [...svg.matchAll(/<g class="q-owner[^"]*" data-action="focus" data-id="([^"]*)"/g)].map((m) => m[1]);
    expect(ids).toEqual(["r.0.0", "r.0.1", "r.1.0", "r.1.1"]);
    expect(groups[0]).toContain('data-occupant="p0"');
    expect(groups[0]).toContain(">Q1 · seed 1</text>");
    expect(groups[0]).toContain(">Sinner</text>");
    // right corners anchor end at x = 336; left corners mirror at x = -336, anchor start
    expect(groups[0]).toContain('x="336" y="-306" text-anchor="end">Sinner</text>');
    expect(groups[2]).toContain('x="-336" y="306">Zverev</text>');
    // flags are bundled SVG <image>s — never emoji (WebKit won't paint them on SVG text)
    expect(groups[0]).toMatch(/<image class="q-flag" href="[^"]*it[^"]*\.svg"/);
    expect(svg).not.toMatch(/[\u{1F1E6}-\u{1F1FF}]/u);
  });

  it("keeps every hit rect fully outside the disc (it paints above the arcs and would steal taps)", () => {
    const rects = [...svg.matchAll(/<rect class="q-hit" x="(-?\d+)" y="(-?\d+)" width="(\d+)" height="(\d+)"/g)]
      .map((m) => m.slice(1).map(Number));
    expect(rects).toHaveLength(4);
    for (const [x, y, w, h] of rects) {
      // nearest point of the rect to the disc centre (0,0), clamped per axis
      const nx = Math.min(Math.max(0, x), x + w);
      const ny = Math.min(Math.max(0, y), y + h);
      expect(Math.hypot(nx, ny)).toBeGreaterThan(RADIUS);
    }
  });

  it("dims an eliminated owner via .q-out, keeping 'out' in the aria-label only", () => {
    expect(svg).toContain('<g class="q-owner q-out" data-action="focus" data-id="r.0.0"');
    expect(svg).not.toContain('q-out" data-action="focus" data-id="r.0.1'); // survivors stay undimmed
    expect(groups[0]).toContain("aria-label=\"Sinner&#39;s quarter · Q1 · seed 1 · out\"");
    expect(svg).not.toContain("· out</text>"); // the visible caption never says it — colour + aria carry the state
  });

  it("renders an all-TBD quarter caption-only (no name, no flag) but still tappable", () => {
    expect(groups[3]).toContain('data-occupant=""');
    expect(groups[3]).toContain('aria-label="Quarter 4"');
    expect(groups[3]).toContain(">Q4</text>");
    expect(groups[3]).not.toContain("q-name");
    expect(groups[3]).not.toContain("<image");
    expect(groups[3]).toContain('<rect class="q-hit"');
  });

  it("renders no corner labels when the quarters param is omitted", () => {
    expect(renderSunburst(arcs, colorScale("time", s), 700)).not.toContain("q-owner");
  });

  it("renders sr-only keyboard twins of the handles (the svg is role=img — its labels are presentational)", () => {
    const html = renderQuarterFocusButtons(quarters);
    expect(html.match(/<button class="sr-only q-owner-btn"/g)).toHaveLength(4);
    expect(html).toContain('data-action="focus" data-id="r.0.0"');     // same delegation as the labels
    expect(html).toContain("Sinner&#39;s quarter · Q1 · seed 1 · out"); // full aria text as the button name
    expect(html).toContain(">Quarter 4<");                              // the all-TBD quarter stays focusable
  });
});

import { renderReadout, type ReadoutInfo } from "./render";

describe("renderReadout", () => {
  const info: ReadoutInfo = {
    name: "Carlos Alcaraz", country: "ESP", ranking: 2, seed: 2,
    eloLabel: "Clay ELO 2107", roundLabel: "4th round", sec: 22320, provisional: false, projected: false,
    age: null, birthday: "", birthdayNear: false,
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
import type { SeedProgress, NationRow } from "./state";

const SLAM_ROUNDS = [
  { index: 0, name: "Round of 128", size: 128, matchIds: [] },
  { index: 1, name: "Round of 64", size: 64, matchIds: [] },
  { index: 2, name: "Round of 32", size: 32, matchIds: [] },
  { index: 3, name: "Round of 16", size: 16, matchIds: [] },
  { index: 4, name: "Quarterfinal", size: 8, matchIds: [] },
  { index: 5, name: "Semifinal", size: 4, matchIds: [] },
  { index: 6, name: "Final", size: 2, matchIds: [] },
];

describe("renderSeedPanel", () => {
  const prog: SeedProgress = {
    mode: "seed", total: 32, remaining: 1,
    rows: [
      { rank: 1, seed: 1, playerId: "a", name: "Sinner", country: "ITA", elo: 2107.6, roundReached: 7, alive: true, upset: false },
      { rank: 6, seed: 6, playerId: "b", name: "Medvedev", country: "RUS", elo: 1980.2, roundReached: 1, alive: false, upset: true },
    ],
  };
  it("shows the seeds-in count, the champion, ELO, and a fallen seed's exit round (not the giant-killer)", () => {
    const html = renderSeedPanel(prog, SLAM_ROUNDS);
    expect(html).toContain("1 / 32");
    expect(html).toContain("Seeds still in");
    expect(html).toContain("Sinner");
    expect(html).toContain("Champion");        // roundReached 7 ≥ rounds.length
    expect(html).toContain("Medvedev");
    expect(html).toContain("R64");             // fell in the Round of 64
    expect(html).not.toContain("out · R64");   // the redundant "out" word is gone
    expect(html).toContain("⚡");              // upset flag, without naming who beat them
    expect(html).toContain("2108");            // surface ELO, rounded, shown persistently
    expect(html).toContain('data-hl-path data-occupant="a"'); // seed rows carry their player id for hover-highlight
    expect(html).toContain('data-action="seed-sort"'); // the Seed | ELO toggle is present
  });

  it("ELO sort retitles the panel, tags unseeded contenders, and arrows the still-alive", () => {
    const eloProg: SeedProgress = {
      mode: "elo", total: 32, remaining: 2,
      rows: [
        { rank: 1, seed: null, playerId: "c", name: "Surger", country: "USA", elo: 2010, roundReached: 2, alive: true, upset: false },
        { rank: 2, seed: 3, playerId: "d", name: "Djokovic", country: "SRB", elo: 1990, roundReached: 1, alive: false, upset: false },
      ],
    };
    const html = renderSeedPanel(eloProg, SLAM_ROUNDS);
    expect(html).toContain("Top 32 by ELO");
    expect(html).toContain("unseeded");   // the unseeded ELO #1 is flagged
    expect(html).toContain("→ R32");      // alive player shows a forward arrow, not "in ·"
  });
});

describe("renderCountryPanel", () => {
  const rows: NationRow[] = [
    { country: "ITA", entrants: 4, stillIn: 1, players: [{ id: "x", name: "Sinner", roundReached: 5, alive: true }] },
  ];
  it("renders a nation row with flag, counts and select action; expands the selected one", () => {
    const rounds = [
      { index: 0, name: "Round of 128", size: 128, matchIds: [] },
      { index: 1, name: "Round of 64", size: 64, matchIds: [] },
      { index: 2, name: "Round of 32", size: 32, matchIds: [] },
      { index: 3, name: "Round of 16", size: 16, matchIds: [] },
      { index: 4, name: "Quarterfinal", size: 8, matchIds: [] },
      { index: 5, name: "Semifinal", size: 4, matchIds: [] },
      { index: 6, name: "Final", size: 2, matchIds: [] },
    ];
    const html = renderCountryPanel(rows, "ITA", rounds);
    expect(html).toMatch(/<span class="ct-flag"><img class="flag" src="[^"]*it[^"]*\.svg"/); // bundled SVG, not emoji
    expect(html).toContain('data-action="country"');
    expect(html).toContain('data-country="ITA"');
    expect(html).toContain("Sinner"); // expanded because ITA is selected
    expect(html).toContain('data-hl-path data-occupant="x"'); // expanded player hover-highlights their path
  });
});

import { renderCenterId, renderCenterSection } from "./render";

describe("renderCenterId", () => {
  it("carries the flag + name; projection italicizes; empty name renders nothing", () => {
    const html = renderCenterId("SRB", "Djokovic", false);
    expect(html).toContain("Djokovic");
    expect(html).toContain("center-id");
    expect(html).not.toContain("projected");
    expect(renderCenterId("SRB", "Djokovic", true)).toContain("projected");
    expect(renderCenterId("SRB", "", false)).toBe("");
  });
});

describe("renderCenterSection", () => {
  it("renders the quieter section pill (occupant unknown); empty title renders nothing", () => {
    const html = renderCenterSection("Top half");
    expect(html).toContain('class="center-id center-sec"');
    expect(html).toContain("Top half");
    expect(renderCenterSection("")).toBe("");
  });
});
