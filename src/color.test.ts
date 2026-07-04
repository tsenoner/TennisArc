import { describe, it, expect } from "vitest";
import { makeSyntheticSnapshot } from "./fixtures/synthetic";
import { colorScale, seedTierColor, COLOR_DIMS, type ArcColorInput } from "./color";

const arc = (occupant: string | null, depth = 1, projected = false, live = false, suspended = false): ArcColorInput => ({ occupant, depth, projected, live, suspended });
// Seed/neutral colours are all hex ("#rrggbb"); pull out [r, g, b] for channel assertions.
const rgbOf = (c: string): number[] => { const h = c.replace("#", ""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };

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

  it("colours the seed lens in four discrete seeding bands (1–4, 5–8, 9–16, 17–32), same violet family", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const scale = colorScale("seed", s);
    // p0..p7 hold seeds 1..8 → p0-p3 in the 1-4 band, p4-p7 in the 5-8 band
    expect(scale(arc("p0"))).toBe(scale(arc("p3")));       // seeds 1 and 4 share the top band
    expect(scale(arc("p3"))).not.toBe(scale(arc("p4")));   // seed 4 (band 1-4) ≠ seed 5 (band 5-8)
    // violet ⇒ blue channel exceeds green (the warm time ramp is the opposite)
    const [, g, b] = rgbOf(scale(arc("p0")));
    expect(b).toBeGreaterThan(g);
    // unseeded → neutral fallback
    s.players["p3"] = { ...s.players["p3"], seed: null };
    expect(colorScale("seed", s)(arc("p3"))).toMatch(/^(#|rgb)/);
  });

  it("ELO sort bands the top 32 by surface ELO with the same tiers; players with no ELO go neutral", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    // give six players a descending clay ELO → ELO ranks 1..6 (p0 strongest); p6,p7 stay elo:null → neutral
    Object.keys(s.players).slice(0, 6).forEach((id, i) => {
      const e = 2200 - i * 50;
      s.players[id] = { ...s.players[id], elo: { overall: e, hard: e, clay: e, grass: e } };
    });
    const scale = colorScale("seed", s, undefined, "elo");
    expect(scale(arc("p0"))).toBe(scale(arc("p3")));       // ELO ranks 1 and 4 share the top band
    expect(scale(arc("p3"))).not.toBe(scale(arc("p4")));   // rank 4 (band 1-4) ≠ rank 5 (band 5-8)
    expect(scale(arc("p7"))).toBe(scale(arc(null)));       // no ELO → neutral, same as the null fallback
    const [, g, b] = rgbOf(scale(arc("p0")));
    expect(b).toBeGreaterThan(g);                          // still the violet family
  });

  it("returns a colour for null in every dimension (neutral fallback)", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    for (const dim of COLOR_DIMS) {
      expect(colorScale(dim, s)(arc(null))).toMatch(/^(#|rgb)/);
    }
  });
});

describe("seedTierColor — discrete seeding bands", () => {
  it("groups ranks into 1–4, 5–8, 9–16, 17–32 (same colour within a band, different across)", () => {
    expect(seedTierColor(1)).toBe(seedTierColor(4));       // band 1-4
    expect(seedTierColor(4)).not.toBe(seedTierColor(5));   // 1-4 vs 5-8
    expect(seedTierColor(5)).toBe(seedTierColor(8));       // band 5-8
    expect(seedTierColor(8)).not.toBe(seedTierColor(9));   // 5-8 vs 9-16
    expect(seedTierColor(9)).toBe(seedTierColor(16));      // band 9-16
    expect(seedTierColor(16)).not.toBe(seedTierColor(17)); // 9-16 vs 17-32
    expect(seedTierColor(17)).toBe(seedTierColor(32));     // band 17-32
  });
  it("returns null once past the top 32", () => {
    expect(seedTierColor(32)).not.toBeNull();
    expect(seedTierColor(33)).toBeNull();
  });
  it("gives all four bands distinct colours", () => {
    expect(new Set([1, 5, 9, 17].map(seedTierColor)).size).toBe(4);
  });
});

describe("colorScale time lens — pending vs played", () => {
  // HEAT (played) returns "rgb(...)"; NEUTRAL (pending / unknown) is the hex "#3a4350".
  // So a colour starting with "#" is the grey pending tone; "rgb(" is real heat.
  const PENDING = /^#/;
  const PLAYED = /^rgb/;

  it("greys a projected (not-yet-decided) arc instead of forward-filling heat", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 }); // whole draw played
    const scale = colorScale("time", s);
    const final = Object.values(s.matches).find((m) => m.nextMatchId === null)!;
    const champ = final.winner === "p1" ? final.p1! : final.p2!;
    // a DECIDED inner arc for the champ is warm heat…
    expect(scale(arc(champ, 1, false))).toMatch(PLAYED);
    // …but the SAME champ on a PROJECTED arc is pending → neutral grey, never forward-filled heat
    expect(scale(arc(champ, 1, true))).toMatch(PENDING);
    expect(scale(arc(champ, 1, true))).toBe(scale(arc(null)));
  });

  it("greys a decided arc whose occupant has no court time yet (nothing played)", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1, completedRounds: 0 });
    const scale = colorScale("time", s);
    const numRounds = s.rounds.length;
    // p0 has zero on-court time → neutral grey, NOT HEAT(0)'s teal "fresh" tone
    expect(scale(arc("p0", numRounds, false))).toMatch(PENDING);
    expect(scale(arc("p0", numRounds, false))).toBe(scale(arc(null)));
  });

  it("keeps a SUSPENDED arc lit like live (heat, not the grey pending tier) even at zero time", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1, completedRounds: 0 });
    const scale = colorScale("time", s);
    const numRounds = s.rounds.length;
    // same zero-time occupant: a plain projected arc is grey pending, but marked suspended it keeps heat
    expect(scale(arc("p0", numRounds, true, false, false))).toMatch(PENDING);      // projected, not in play
    expect(scale(arc("p0", numRounds, true, false, true))).toMatch(PLAYED);        // suspended → in play → heat
    expect(scale.pending!(arc("p0", numRounds, true, false, true))).toBe(false);   // not pending
  });

  it("still colours a played, decided arc with warm heat (regression guard)", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const scale = colorScale("time", s);
    const final = Object.values(s.matches).find((m) => m.nextMatchId === null)!;
    const champ = final.winner === "p1" ? final.p1! : final.p2!;
    expect(scale(arc(champ, 1, false))).toMatch(PLAYED);
  });

  it("exposes a `pending` predicate: true for projected / unknown / zero-time, false for played", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 }); // whole draw played
    const scale = colorScale("time", s);
    expect(typeof scale.pending).toBe("function");
    const final = Object.values(s.matches).find((m) => m.nextMatchId === null)!;
    const champ = final.winner === "p1" ? final.p1! : final.p2!;
    expect(scale.pending!(arc(champ, 1, false))).toBe(false); // played, decided
    expect(scale.pending!(arc(champ, 1, true))).toBe(true);   // projection
    expect(scale.pending!(arc(null, 1, false))).toBe(true);   // unknown occupant
  });

  it("marks a zero-time occupant pending when nothing has been played", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1, completedRounds: 0 });
    const scale = colorScale("time", s);
    expect(scale.pending!(arc("p0", s.rounds.length, false))).toBe(true);
  });

  it("keeps a live (in-progress) arc coloured by court time instead of greying it", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 }); // occupants have court time
    const scale = colorScale("time", s);
    const final = Object.values(s.matches).find((m) => m.nextMatchId === null)!;
    const champ = final.winner === "p1" ? final.p1! : final.p2!;
    // an undecided (projected) arc is pending grey — UNLESS the match is live, which still accrues time
    expect(scale.pending!(arc(champ, 1, true, false))).toBe(true);  // projected, not live → pending
    expect(scale.pending!(arc(champ, 1, true, true))).toBe(false);  // live → coloured by its court time
    expect(scale(arc(champ, 1, true, true))).toMatch(PLAYED);
  });

  it("keeps a JUST-STARTED live arc (zero recorded time) coloured, not grey pending", () => {
    // A live match before any duration is logged: cumulativeOnCourt skips matches with no
    // durationSec, so the occupant's through() is 0. The zero-time clause must NOT win over `live`,
    // or the arc would render grey "not played yet" while also carrying the live hatch + breathing.
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1, completedRounds: 0 }); // nobody has time
    const scale = colorScale("time", s);
    expect(scale.pending!(arc("p0", s.rounds.length, true, true))).toBe(false); // live → not pending
    expect(scale(arc("p0", s.rounds.length, true, true))).toMatch(PLAYED);      // heat (HEAT(0)), never grey
    // the same arc, NOT live, stays pending grey
    expect(scale.pending!(arc("p0", s.rounds.length, true, false))).toBe(true);
    expect(scale(arc("p0", s.rounds.length, true, false))).toMatch(PENDING);
  });

  it("seed and country lenses expose no `pending` predicate (projections keep their hue)", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    expect(colorScale("seed", s).pending).toBeUndefined();
    expect(colorScale("country", s).pending).toBeUndefined();
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
