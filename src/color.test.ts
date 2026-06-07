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

  it("returns a colour for null in every dimension (neutral fallback)", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const t = timeOnCourt(s);
    for (const dim of COLOR_DIMS) {
      expect(colorScale(dim, s, t)(null)).toMatch(/^(#|rgb)/);
    }
  });
});
