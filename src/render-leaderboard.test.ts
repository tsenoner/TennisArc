import { describe, it, expect } from "vitest";
import { renderLeaderboard } from "./render";
import type { LeaderRow } from "./state";

const rows: LeaderRow[] = [
  { playerId: "a", name: "Carlos Alcaraz", country: "ESP", sec: 12000, provisional: false, roundReached: 5 },
  { playerId: "b", name: "Jannik <Sinner>", country: "ITA", sec: 6000, provisional: true, roundReached: 4 },
];

describe("renderLeaderboard", () => {
  it("renders one row per leader with rank, escaped name, bar and formatted time", () => {
    const html = renderLeaderboard(rows);
    expect((html.match(/class="lb-row"/g) ?? []).length).toBe(2);
    expect(html).toContain("Carlos Alcaraz");
    expect(html).toContain("Jannik &lt;Sinner&gt;"); // escaped, no raw <
    expect(html).not.toContain("Jannik <Sinner>");
    expect(html).toContain("3h20"); // 12000s = 200m = 3h20
    expect(html).toContain("*"); // provisional marker on the live leader
    expect(html).toContain("width:100%");
  });

  it("marks each row for hover path-highlight with the player id", () => {
    const html = renderLeaderboard(rows);
    expect((html.match(/data-hl-path/g) ?? []).length).toBe(2);
    expect(html).toContain('data-occupant="a"');
    expect(html).toContain('data-occupant="b"');
  });

  it("puts the name and country on separate spans so the full name gets the row", () => {
    const html = renderLeaderboard(rows);
    expect(html).toContain('<span class="lb-who">Carlos Alcaraz</span>');
    expect(html).toMatch(/<span class="lb-ctry"><img class="flag"[^>]*> ESP<\/span>/);
    // country is no longer nested inline after the name on the same span
    expect(html).not.toMatch(/Carlos Alcaraz <span class="lb-ctry">/);
  });

  it("renders an empty list without throwing", () => {
    expect(renderLeaderboard([]).toString()).toContain("leaderboard");
  });
});
