import { describe, it, expect } from "vitest";
import { renderMatchDetail } from "./render";
import type { Match, Player } from "./model";

const player = (id: string, name: string, seed: number | null): Player => ({
  id, name, country: "ESP", seed, entry: null, ranking: 3, ageYears: 22, sofaSlug: id, elo: null,
});
const match = (over: Partial<Match> = {}): Match => ({
  id: "5-0", roundIndex: 5, slot: 0, nextMatchId: null, p1: "a", p2: "b",
  status: "finished", winner: "p1",
  score: [{ p1: 6, p2: 4 }, { p1: 7, p2: 6, tb: 5 }],
  live: null, durationSec: 9660, durationProvisional: false,
  sofaEventId: 1, sofaCustomId: "abc123",
  stats: { aces: [12, 5], doubleFaults: [2, 4], firstServePct: [71, 60] }, ...over,
});

describe("renderMatchDetail", () => {
  it("shows both players, score, duration, stats and a deep-link", () => {
    const html = renderMatchDetail(
      match(), player("a", "Carlos Alcaraz", 2), player("b", "Jannik Sinner", 1),
      "https://www.sofascore.com/tennis/match/x/abc123", "Final",
    );
    expect(html).toContain("Carlos Alcaraz");
    expect(html).toContain("Jannik Sinner");
    expect(html).toContain("Final");
    expect(html).toContain("6-4");
    expect(html).toContain("2h41"); // 9660s
    expect(html).toContain("12"); // aces
    expect(html).toContain('href="https://www.sofascore.com/tennis/match/x/abc123"');
    expect(html).toContain('data-action="close-detail"');
  });

  it("omits the link when there is no url and tolerates null players/stats", () => {
    const html = renderMatchDetail(
      match({ sofaCustomId: null, stats: null, p2: null }), player("a", "X", null), null, null, "Semifinal",
    );
    expect(html).not.toContain("Open in SofaScore");
    expect(html).toContain("TBD");
  });

  it("places the tiebreak superscript on the set winner's side", () => {
    const p1 = player("a", "A", 1), p2 = player("b", "B", 2);
    const won = renderMatchDetail(match({ score: [{ p1: 7, p2: 6, tb: 4 }] }), p1, p2, null, "F");
    expect(won).toContain("7<sup>4</sup>-6");
    const lost = renderMatchDetail(match({ score: [{ p1: 6, p2: 7, tb: 3 }], winner: "p2" }), p1, p2, null, "F");
    expect(lost).toContain("6-7<sup>3</sup>");
  });
});
