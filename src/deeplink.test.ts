import { describe, it, expect } from "vitest";
import { slugify, sofascoreMatchUrl } from "./deeplink";
import type { Match, Player } from "./model";

const player = (id: string, name: string): Player => ({
  id, name, country: "ITA", seed: 1, entry: null, ranking: 1, ageYears: 24, sofaSlug: id,
});
const baseMatch = (over: Partial<Match> = {}): Match => ({
  id: "1-0", roundIndex: 1, slot: 0, nextMatchId: null, p1: "a", p2: "b",
  status: "finished", winner: "p1", score: null, live: null,
  durationSec: 6000, durationProvisional: false, sofaEventId: 5, sofaCustomId: "HXfsvGHb",
  stats: null, ...over,
});

describe("deeplink", () => {
  it("builds a sofascore URL ending in the customId, with a player-name slug", () => {
    const url = sofascoreMatchUrl(baseMatch(), player("a", "Jannik Sinner"), player("b", "Carlos Alcaraz"));
    expect(url).toBe("https://www.sofascore.com/tennis/match/jannik-sinner-carlos-alcaraz/HXfsvGHb");
  });

  it("returns null when there is no customId (cannot deep-link)", () => {
    expect(sofascoreMatchUrl(baseMatch({ sofaCustomId: null }), null, null)).toBeNull();
  });

  it("slugify strips accents, spaces and punctuation", () => {
    expect(slugify("Stéfanos Tsitsipás")).toBe("stefanos-tsitsipas");
    expect(slugify("")).toBe("match");
  });

  it("uses the 'match' slug when a player is missing but a customId exists", () => {
    const url = sofascoreMatchUrl(baseMatch(), player("a", "Jannik Sinner"), null);
    expect(url).toBe("https://www.sofascore.com/tennis/match/match/HXfsvGHb");
  });
});
