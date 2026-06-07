import { describe, it, expect } from "vitest";
import { renderLeaderboard } from "./render";
import type { LeaderRow } from "./state";

const rows: LeaderRow[] = [
  { playerId: "a", name: "Carlos Alcaraz", country: "ESP", sec: 12000, provisional: false, roundReached: 5 },
  { playerId: "b", name: "Jannik <Sinner>", country: "ITA", sec: 6000, provisional: true, roundReached: 4 },
];

describe("renderLeaderboard", () => {
  it("renders one row per leader with rank, escaped name, bar and formatted time", () => {
    const html = renderLeaderboard(rows, () => "#e0683c");
    expect((html.match(/class="lb-row"/g) ?? []).length).toBe(2);
    expect(html).toContain("Carlos Alcaraz");
    expect(html).toContain("Jannik &lt;Sinner&gt;"); // escaped, no raw <
    expect(html).not.toContain("Jannik <Sinner>");
    expect(html).toContain("3h20"); // 12000s = 200m = 3h20
    expect(html).toContain("*"); // provisional marker on the live leader
  });

  it("renders an empty list without throwing", () => {
    expect(renderLeaderboard([], () => "#000")).toContain("leaderboard");
  });
});
