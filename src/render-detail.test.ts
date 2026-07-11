// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderMatchStrip, renderMatchDetail } from "./render";
import type { MatchInsight } from "./state";

const rounds = [
  { index: 0, name: "Round of 128", size: 128, matchIds: [] },
  { index: 5, name: "Semifinal", size: 4, matchIds: [] },
  { index: 6, name: "Final", size: 2, matchIds: [] },
];
const base: MatchInsight = {
  matchId: "6-0", roundName: "Final", surface: "Clay", status: "finished", winner: "p1",
  score: [{ p1: 4, p2: 6 }, { p1: 7, p2: 6, tb: 5 }, { p1: 6, p2: 3 }],
  durationSec: 11760, durationProvisional: false,
  p1: { id: "a", name: "Carlos Alcaraz", country: "ESP", seed: 2, ranking: 2, elo: 2106, roundReached: 7, sec: 22320, age: 22, birthday: "5 May", birthdayNear: true },
  p2: { id: "b", name: "Jannik Sinner", country: "ITA", seed: 1, ranking: 1, elo: 2215, roundReached: 6, sec: 19000, age: 24, birthday: "16 Aug", birthdayNear: false },
  badges: ["Upset", "From a set down", "1 tiebreak", "Marathon"], upset: true,
  eloLine: "Clay-ELO favoured Jannik Sinner 65% (+109)",
  aces: [9, 12], doubleFaults: [3, 2], scheduled: null, live: null,
};
const NOW = 1_782_999_600; // Thu 02 Jul 2026, 13:40 UTC — the shared reference clock for every call below
const opts = { expanded: false, focused: false, nowSec: NOW };

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
    const html = renderMatchStrip(base, "r.0.1", { expanded: true, focused: true, nowSec: NOW });
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

  it("shows a compact precise scheduled tag for an imminent match", () => {
    const ins: MatchInsight = { ...base, status: "scheduled", winner: null, score: null,
      scheduled: { start: NOW + 2 * 3600, court: "Centre Court" } };
    const html = renderMatchStrip(ins, "r.0", opts);
    expect(html).toContain("ms-sched");
    expect(html).toContain("Today 15:40");
    expect(html).toContain("Centre Court");
  });

  it("shows weekday + provisional time for a far-future TBD match (uniform compact shape)", () => {
    const ins: MatchInsight = { ...base, status: "scheduled", winner: null, score: null,
      scheduled: { start: NOW + 5 * 86400, court: null } };
    const html = renderMatchStrip(ins, "r.0", opts);
    expect(html).toMatch(/\d{2}:\d{2}/); // the nominal stamp's provisional time shows too
    expect(html).not.toContain("7 Jul");  // compact strip: weekday word carries the day
  });
});

describe("renderMatchDetail", () => {
  it("renders per-player meta, badges, accented ELO line, stats, duration and the link", () => {
    const html = renderMatchDetail(base, "https://www.sofascore.com/tennis/match/x/abc", rounds, NOW);
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

  it("escapes the SofaScore URL in the link href (#11)", () => {
    const url = 'https://www.sofascore.com/tennis/match/a-b/x"><script>alert(1)</script>';
    const html = renderMatchDetail(base, url, rounds, NOW);
    expect(html).not.toContain('x"><script>');
    expect(html).toContain("x&quot;&gt;&lt;script&gt;");
  });

  it("carries the bottom-sheet chrome, all collapsing only the tier (detail-expand)", () => {
    const html = renderMatchDetail(base, null, rounds, NOW);
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
    const html = renderMatchDetail(ins, null, rounds, NOW);
    expect(html).toContain("TBD");
    expect(html).not.toContain("Open in SofaScore");
  });

  it("renders the full scheduled line, flagged provisional", () => {
    const ins: MatchInsight = { ...base, status: "scheduled", winner: null, score: null, durationSec: null,
      scheduled: { start: NOW + 24 * 3600, court: "Court 2" } };
    const html = renderMatchDetail(ins, null, rounds, NOW);
    expect(html).toContain("mi-sched");
    expect(html).toContain("Tomorrow 3 Jul, 13:40");
    expect(html).toContain("Court 2");
    expect(html).toContain("subject to change");
  });

  it("omits the scheduled line for a match with no scheduled info", () => {
    expect(renderMatchDetail(base, null, rounds, NOW)).not.toContain("mi-sched");
  });
});

describe("renderMatchStrip — live current-game block", () => {
  const liveIns = (over: Partial<MatchInsight> = {}): MatchInsight => ({
    ...base,
    status: "live", winner: null,
    live: { flashId: "nkXJ8mYa", homeIsP1: true, serving: "p1" },
    ...over,
  });
  const liveOpts = { expanded: false, focused: false, nowSec: 1_750_000_000 };

  it("renders the points placeholders, separator and hidden chip for a live match", () => {
    const html = renderMatchStrip(liveIns(), "r.0", liveOpts);
    const el = document.createElement("div"); el.innerHTML = html;
    const pts = el.querySelectorAll(".ms-game .ms-pts");
    expect(pts).toHaveLength(2);
    expect(pts[0].getAttribute("data-side")).toBe("p1");
    expect(pts[1].getAttribute("data-side")).toBe("p2");
    expect(pts[0].textContent).toBe("–");
    expect(el.querySelector<HTMLElement>(".ms-chip")!.hidden).toBe(true);
  });

  it("marks the serving player's side with the serve dot", () => {
    const el = document.createElement("div");
    el.innerHTML = renderMatchStrip(liveIns({ live: { flashId: "nkXJ8mYa", homeIsP1: true, serving: "p2" } }), "r.0", liveOpts);
    const sides = el.querySelectorAll(".ms-side");
    expect(sides[0].querySelector(".ms-serve")).toBeNull();
    expect(sides[1].querySelector(".ms-serve")).not.toBeNull();
  });

  it("renders no game block when the match is not live (live: null)", () => {
    const el = document.createElement("div");
    el.innerHTML = renderMatchStrip(liveIns({ status: "finished", live: null, winner: "p1" }), "r.0", liveOpts);
    expect(el.querySelector(".ms-game")).toBeNull();
    expect(el.querySelector(".ms-serve")).toBeNull();
  });
});
