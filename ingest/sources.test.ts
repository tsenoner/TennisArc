import { describe, it, expect } from "vitest";
import { playersUrl, playersSchema, matchesUrl, qualChallUrl } from "./sources";

// Jeff Sackmann's tennis_atp / tennis_wta repos went 404 ~2026-07-02 (#41). ATP is repointed to the
// TML mirror (stats.tennismylife.org); WTA has no equivalent and stays on Sackmann (degrades to a
// caught 404 until tennis_wta returns). These lock in that per-tour routing.
describe("data sources", () => {
  it("routes ATP players + matches + qual/chall to TML", () => {
    expect(playersUrl("ATP")).toBe("https://stats.tennismylife.org/data/ATP_Database.csv");
    expect(playersSchema("ATP")).toBe("tml");
    expect(matchesUrl("ATP", 2026)).toBe("https://stats.tennismylife.org/data/2026.csv");
    expect(qualChallUrl("ATP", 2026)).toBe("https://stats.tennismylife.org/data/2026_challenger.csv");
  });

  it("keeps WTA on Sackmann (no TML equivalent yet)", () => {
    expect(playersUrl("WTA")).toBe(
      "https://raw.githubusercontent.com/JeffSackmann/tennis_wta/master/wta_players.csv");
    expect(playersSchema("WTA")).toBe("sackmann");
    expect(matchesUrl("WTA", 2024)).toBe(
      "https://raw.githubusercontent.com/JeffSackmann/tennis_wta/master/wta_matches_2024.csv");
    expect(qualChallUrl("WTA", 2024)).toBe(
      "https://raw.githubusercontent.com/JeffSackmann/tennis_wta/master/wta_matches_qual_itf_2024.csv");
  });
});
