import { describe, it, expect } from "vitest";
import { renderMatchStrip, renderMatchDetail } from "./render";
import type { MatchInsight } from "./state";

const rounds = [
  { index: 0, name: "Round of 128", size: 128, matchIds: [] },
  { index: 5, name: "Semifinal", size: 4, matchIds: [] },
  { index: 6, name: "Final", size: 2, matchIds: [] },
];
const base: MatchInsight = {
  matchId: "6-0", roundName: "Final", surface: "Clay", status: "finished", winner: "p1", wasSuspended: false,
  score: [{ p1: 4, p2: 6 }, { p1: 7, p2: 6, tb: 5 }, { p1: 6, p2: 3 }],
  durationSec: 11760, durationProvisional: false,
  p1: { id: "a", name: "Carlos Alcaraz", country: "ESP", seed: 2, ranking: 2, elo: 2106, roundReached: 7, sec: 22320, age: 22, birthday: "5 May", birthdayNear: true },
  p2: { id: "b", name: "Jannik Sinner", country: "ITA", seed: 1, ranking: 1, elo: 2215, roundReached: 6, sec: 19000, age: 24, birthday: "16 Aug", birthdayNear: false },
  badges: ["Upset", "From a set down", "1 tiebreak", "Marathon"], upset: true,
  eloLine: "Clay-ELO favoured Jannik Sinner 65% (+109)",
  aces: [9, 12], doubleFaults: [3, 2],
};
const opts = { expanded: false, focused: false };

describe("renderMatchStrip", () => {
  it("renders caption, flags, dual-form names, winner check and the tiebreak score", () => {
    const html = renderMatchStrip(base, "r.0.1", opts);
    expect(html).toContain('class="match-strip"');
    expect(html).toContain("Final · Clay");
    expect(html).toMatch(/<span class="ms-fl"><img class="flag" src="[^"]*es[^"]*\.svg"/); // bundled SVG, not emoji
    // both name forms always render — CSS (not resize JS) picks full vs surname per viewport
    expect(html).toContain('<span class="nm-full">Carlos Alcaraz</span>');
    expect(html).toContain('<span class="nm-short">Alcaraz</span>');
    expect(html).toContain('<span class="nm-short">Sinner</span>');
    expect(html).toContain('<span class="mi-chk">✓</span>');   // winner tick
    expect(html).toContain("7<sup>5</sup>-6");                 // set-2 tiebreak on winner side
  });

  it("renders an amber 'suspended' tag and score fallback for a paused match", () => {
    const ins: MatchInsight = { ...base, status: "suspended", winner: null, score: null };
    const html = renderMatchStrip(ins, "r.0", opts);
    expect(html).toContain('class="ms-susp"');
    expect(html).toContain("suspended");   // the status tag
    expect(html).toContain("Suspended");   // insightScore fallback in the score slot
  });

  it("wires the strip actions: accented Zoom (focus), Details toggle, close", () => {
    const html = renderMatchStrip(base, "r.0.1", opts);
    expect(html).toContain('data-action="focus" data-id="r.0.1"');
    expect(html).toContain("⊕ Zoom");
    expect(html).toContain('data-action="detail-expand"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('aria-controls'); // collapsed: the #match-detail region isn't in the DOM, so no dangling IDREF
    expect(html).toContain('data-action="close-detail"');
  });

  it("keeps the heavy tail OUT of the strip (demoted to the detail tier)", () => {
    const html = renderMatchStrip(base, "r.0.1", opts);
    expect(html).not.toContain("Open in SofaScore");
    expect(html).not.toContain("Aces");
    expect(html).not.toContain("Clay-ELO favoured");
    expect(html).not.toContain("Upset");
  });

  it("flips the Zoom button to Reset zoom while focused — empty-id focus, NOT the nuclear reset", () => {
    const html = renderMatchStrip(base, "r.0.1", { expanded: true, focused: true });
    expect(html).toContain("Reset zoom");
    expect(html).toContain('data-action="focus" data-id=""'); // routes through setFocus(undefined)
    expect(html).not.toContain('data-action="reset"');        // pin + match must survive the un-zoom
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-controls="match-detail"');   // expanded: IDREF now resolves to the live region
  });

  it("marks a live match with a pulsing dot in the caption", () => {
    const live = { ...base, status: "live" as const, winner: null, score: null, durationProvisional: true };
    const html = renderMatchStrip(live, "r", opts);
    expect(html).toContain('class="ms-dot"');
    expect(html).toContain("live");
  });

  it("tolerates a TBD side and a missing score", () => {
    const ins = { ...base, winner: null, score: null, p2: { ...base.p2, id: null, name: "TBD", elo: null } };
    const html = renderMatchStrip(ins, "r", opts);
    expect(html).toContain("TBD");
    expect(html).toContain("—"); // placeholder score
  });
});

describe("renderMatchDetail", () => {
  it("renders per-player meta, badges, accented ELO line, stats, duration and the link", () => {
    const html = renderMatchDetail(base, "https://www.sofascore.com/tennis/match/x/abc", rounds);
    expect(html).toContain("Carlos Alcaraz");
    expect(html).toContain("#1 · seed 1");                       // rank/seed meta
    expect(html).toContain("22y");                               // age meta
    expect(html).toContain("Clay-ELO favoured");
    expect(html).toContain('class="mi-elo upset"');              // the single upset signal…
    expect(html).not.toContain("— upset");                       // …not the old suffix
    expect(html).not.toContain(">Upset<");                       // …and not the duplicate badge
    expect(html).toContain("Marathon");                          // other badges survive
    expect(html).toContain("12");                                // sinner aces
    expect(html).toContain("3h16");                              // match duration
    expect(html).not.toContain("6h12");                          // per-player time-on-court is CUT
    expect(html).toContain('href="https://www.sofascore.com/tennis/match/x/abc"');
  });

  it("carries the bottom-sheet chrome, all collapsing only the tier (detail-expand)", () => {
    const html = renderMatchDetail(base, null, rounds);
    // a disclosure REGION, not a (false) modal dialog — desktop renders it in-flow and the
    // phone sheet has no focus containment; tabindex -1 = programmatic focus target on expand
    expect(html).toContain('<aside id="match-detail" class="mi-detail" role="region" aria-label="Match details" tabindex="-1">');
    expect(html).not.toContain('role="dialog"');
    expect(html).toContain('class="mi-scrim" data-action="detail-expand"');
    expect(html).toContain('class="sheet-grip" data-action="detail-expand"');
    expect(html).toContain('class="sheet-close" data-action="detail-expand"');
    expect(html).not.toContain('data-action="close-detail"'); // ✕-the-match lives in the strip only
  });

  it("tolerates a TBD side and a missing link", () => {
    const ins = { ...base, winner: null, score: null, eloLine: "", badges: [], aces: null, doubleFaults: null,
      p2: { ...base.p2, id: null, name: "TBD", elo: null } };
    const html = renderMatchDetail(ins, null, rounds);
    expect(html).toContain("TBD");
    expect(html).not.toContain("Open in SofaScore");
  });
});
