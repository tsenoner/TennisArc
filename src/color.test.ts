import { describe, it, expect } from "vitest";
import { makeSyntheticSnapshot } from "./fixtures/synthetic";
import { timeOnCourt } from "./state";
import { colorScale, COLOR_DIMS } from "./color";

describe("colorScale", () => {
  it("exposes the supported dimensions", () => {
    expect(COLOR_DIMS).toContain("time");
    expect(COLOR_DIMS).toContain("seed");
    expect(COLOR_DIMS).toContain("country");
  });

  it("returns a hex/rgb colour for a known player and a fallback for null", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const scale = colorScale("time", s, timeOnCourt(s));
    expect(scale("p0")).toMatch(/^(#|rgb)/);
    expect(scale(null)).toMatch(/^(#|rgb)/);
  });

  it("maps higher time-on-court to a warmer (redder) colour than lower", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const t = timeOnCourt(s);
    const ids = [...t.keys()].sort((a, b) => t.get(a)!.sec - t.get(b)!.sec);
    const scale = colorScale("time", s, t);
    const red = (c: string) => Number(c.match(/\d+/g)![0]); // HEAT returns "rgb(r, g, b)"
    expect(red(scale(ids[ids.length - 1]))).toBeGreaterThan(red(scale(ids[0])));
  });

  it("colours the seed lens by seed number with a violet ramp, distinct from the time heat ramp", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const t = timeOnCourt(s);
    const scale = colorScale("seed", s, t);
    // top seed (1) and a lower seed get different colours
    expect(scale("p0")).not.toBe(scale("p7"));
    // violet ⇒ blue channel exceeds green (the warm time ramp is the opposite)
    const [, g, b] = scale("p0").match(/\d+/g)!.map(Number);
    expect(b).toBeGreaterThan(g);
    // unseeded → neutral fallback
    s.players["p3"] = { ...s.players["p3"], seed: null };
    expect(colorScale("seed", s, t)("p3")).toMatch(/^(#|rgb)/);
  });

  it("returns a colour for null in every dimension (neutral fallback)", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const t = timeOnCourt(s);
    for (const dim of COLOR_DIMS) {
      expect(colorScale(dim, s, t)(null)).toMatch(/^(#|rgb)/);
    }
  });
});

describe("colorScale country lens", () => {
  it("highlights the selected country and mutes the rest", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const ids = Object.keys(s.players);
    s.players[ids[0]] = { ...s.players[ids[0]], country: "ESP" };
    s.players[ids[1]] = { ...s.players[ids[1]], country: "FRA" };
    const time = timeOnCourt(s);
    const sel = colorScale("country", s, time, "ESP");
    const none = colorScale("country", s, time);
    expect(sel(ids[0])).not.toBe(sel(ids[1])); // ESP highlighted, FRA muted
    expect(none(ids[0])).toBe(none(ids[1]));   // no selection → both muted (same colour)
  });
});
