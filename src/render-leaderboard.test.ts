import { describe, it, expect } from "vitest";
import { renderLeaderboard } from "./render";
import type { LeaderRow } from "./state";

const rows: LeaderRow[] = [
  { playerId: "a", name: "Carlos Alcaraz", country: "ESP", sec: 12000, provisional: false, roundReached: 5 },
  { playerId: "b", name: "Jannik <Sinner>", country: "ITA", sec: 6000, provisional: true, roundReached: 4 },
  { playerId: "c", name: "Casper Ruud", country: "NOR", sec: 3000, provisional: false, roundReached: 3 },
];

describe("renderLeaderboard", () => {
  it("shows an empty state (no rows) when fewer than 3 players qualify (too sparse to rank honestly)", () => {
    for (const sparse of [rows.slice(0, 2), []]) {
      const html = renderLeaderboard(sparse);
      expect(html).not.toContain("lb-row"); // no ranking rendered
      expect(html).toContain("panel-empty"); // explains the absence instead of a 1-2 row "leaderboard"
      // the bottom-sheet chrome must survive so the mobile drawer stays touch-controllable
      expect(html).toContain("sheet-bar");
      expect(html).toContain('data-action="panel"'); // the ✕ close button
    }
  });

  it("renders one row per leader with rank, escaped name, bar and formatted time", () => {
    const html = renderLeaderboard(rows);
    expect((html.match(/class="lb-row"/g) ?? []).length).toBe(3);
    expect(html).toContain("Carlos Alcaraz");
    expect(html).toContain("Jannik &lt;Sinner&gt;"); // escaped, no raw <
    expect(html).not.toContain("Jannik <Sinner>");
    expect(html).toContain("3h20"); // 12000s = 200m = 3h20
    expect(html).toContain("*"); // provisional marker on the live leader
    expect(html).toContain("width:100%");
  });

  it("marks each row for hover path-highlight with the player id", () => {
    const html = renderLeaderboard(rows);
    expect((html.match(/data-hl-path/g) ?? []).length).toBe(3);
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
});
