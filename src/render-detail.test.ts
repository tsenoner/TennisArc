import { describe, it, expect } from "vitest";
import { renderMatchInsight } from "./render";
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
  aces: [9, 12], doubleFaults: [3, 2],
};

describe("renderMatchInsight", () => {
  it("renders matchup, flags, score, badges, ELO line, stats and links", () => {
    const html = renderMatchInsight(base, "https://www.sofascore.com/tennis/match/x/abc", "r", rounds);
    expect(html).toContain("Carlos Alcaraz");
    expect(html).toContain("Jannik Sinner");
    expect(html).toMatch(/<span class="mi-fl"><img class="flag" src="[^"]*es[^"]*\.svg"/); // bundled SVG, not emoji
    expect(html).toContain("Final");
    expect(html).toContain("7<sup>5</sup>-6"); // set-2 tiebreak on winner side
    expect(html).toContain("Upset");
    expect(html).toContain("Clay-ELO favoured");
    expect(html).toContain("12"); // sinner aces
    expect(html).toContain('href="https://www.sofascore.com/tennis/match/x/abc"');
    expect(html).toContain('data-action="focus"');
    expect(html).toContain('data-action="close-detail"');
    expect(html).toContain("22y");
  });

  it("tolerates a TBD side and a missing link", () => {
    const ins = { ...base, winner: null, score: null, eloLine: "", badges: [], aces: null, doubleFaults: null,
      p2: { ...base.p2, id: null, name: "TBD", elo: null } };
    const html = renderMatchInsight(ins, null, "r", rounds);
    expect(html).toContain("TBD");
    expect(html).not.toContain("Open in SofaScore");
  });
});
