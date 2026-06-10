import { describe, it, expect } from "vitest";
import { makeSyntheticSnapshot } from "./fixtures/synthetic";
import { colorScale, COLOR_DIMS, type ArcColorInput } from "./color";

const arc = (occupant: string | null, depth = 1): ArcColorInput => ({ occupant, depth });

describe("colorScale", () => {
  it("exposes the supported dimensions", () => {
    expect(COLOR_DIMS).toContain("time");
    expect(COLOR_DIMS).toContain("seed");
    expect(COLOR_DIMS).toContain("country");
  });

  it("returns a hex/rgb colour for a known player and a fallback for null", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const scale = colorScale("time", s);
    expect(scale(arc("p0"))).toMatch(/^(#|rgb)/);
    expect(scale(arc(null))).toMatch(/^(#|rgb)/);
  });

  it("colours an arc by cumulative time through its ring — deeper (later-round) arcs run warmer", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const scale = colorScale("time", s);
    const red = (c: string) => Number(c.match(/\d+/g)![0]); // HEAT returns "rgb(r, g, b)"
    const final = Object.values(s.matches).find((m) => m.nextMatchId === null)!;
    const champ = final.winner === "p1" ? final.p1! : final.p2!;
    const numRounds = s.rounds.length;
    // champion's inner arc (later round → full cumulative) vs their outer R128 arc (first match)
    expect(red(scale(arc(champ, 1)))).toBeGreaterThan(red(scale(arc(champ, numRounds))));
  });

  it("colours the seed lens by seed number with a violet ramp, distinct from the time heat ramp", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const scale = colorScale("seed", s);
    // top seed (1) and a lower seed get different colours
    expect(scale(arc("p0"))).not.toBe(scale(arc("p7")));
    // violet ⇒ blue channel exceeds green (the warm time ramp is the opposite)
    const [, g, b] = scale(arc("p0")).match(/\d+/g)!.map(Number);
    expect(b).toBeGreaterThan(g);
    // unseeded → neutral fallback
    s.players["p3"] = { ...s.players["p3"], seed: null };
    expect(colorScale("seed", s)(arc("p3"))).toMatch(/^(#|rgb)/);
  });

  it("ELO sort colours the top 32 by surface ELO with the same ramp; players with no ELO go neutral", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    // give two players a clay ELO; the rest keep elo:null (outside the top 32 → neutral)
    s.players["p0"] = { ...s.players["p0"], elo: { overall: 2200, hard: 2200, clay: 2200, grass: 2200 } };
    s.players["p1"] = { ...s.players["p1"], elo: { overall: 1900, hard: 1900, clay: 1900, grass: 1900 } };
    const scale = colorScale("seed", s, undefined, "elo");
    expect(scale(arc("p0"))).not.toBe(scale(arc("p1")));   // strongest ≠ second by ELO
    expect(scale(arc("p7"))).toBe(scale(arc(null)));        // no ELO → neutral, same as the null fallback
    const [, g, b] = scale(arc("p0")).match(/\d+/g)!.map(Number);
    expect(b).toBeGreaterThan(g);                           // still the violet ramp
  });

  it("returns a colour for null in every dimension (neutral fallback)", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    for (const dim of COLOR_DIMS) {
      expect(colorScale(dim, s)(arc(null))).toMatch(/^(#|rgb)/);
    }
  });
});

describe("colorScale country lens", () => {
  it("highlights the selected country and mutes the rest", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const ids = Object.keys(s.players);
    s.players[ids[0]] = { ...s.players[ids[0]], country: "ESP" };
    s.players[ids[1]] = { ...s.players[ids[1]], country: "FRA" };
    const sel = colorScale("country", s, "ESP");
    const none = colorScale("country", s);
    expect(sel(arc(ids[0]))).not.toBe(sel(arc(ids[1]))); // ESP highlighted, FRA muted
    expect(none(arc(ids[0]))).toBe(none(arc(ids[1])));   // no selection → both muted (same colour)
  });
});
