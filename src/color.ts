import { scaleLinear } from "d3-scale";
import { interpolateRgbBasis } from "d3-interpolate";
import type { Snapshot } from "./model";
import type { Theme } from "./theme";
import { cumulativeOnCourt, eloRank, type SeedSort } from "./state";

export type ColorDim = "time" | "seed" | "country";
export const COLOR_DIMS: ColorDim[] = ["time", "seed", "country"];

// Arc fills are SVG presentation attributes, which can't hold var() — so the wheel's
// surface tones (empty/muted/highlight) carry explicit per-theme values instead, each
// recessive against its own --bg rather than a fixed dark slate.
const NEUTRAL = { dark: "#3a4350", light: "#cfcbc1" } as const;
// time: cool → gold → clay
const HEAT = interpolateRgbBasis(["#2f6f8f", "#d9a441", "#e0683c"]);
// seed: recessive → vivid violet — a deliberately different hue family from HEAT so the
// Seed lens never reads like the Time lens. Top seed = bright lilac; lowest seed = deep indigo.
// Wide lightness sweep (deep → pale) + 4 perceptually-spaced stops so adjacent ranks separate.
const SEED = interpolateRgbBasis(["#352170", "#6d3fd4", "#a36bff", "#e2cdff"]);
const COUNTRY_MUTED = { dark: "#2c3744", light: "#e2ded4" } as const;
const COUNTRY_HL = { dark: "#4ea1ff", light: "#1b63b4" } as const;   // keep in sync with --country in app.css

// Legend gradients (left → right) mirroring each scale's domain order; kept in sync with the CSS.
export const HEAT_STOPS = ["#2f6f8f", "#d9a441", "#e0683c"];
export const SEED_STOPS = ["#352170", "#6d3fd4", "#a36bff", "#e2cdff"];

/** The per-arc inputs a colour function reads: who occupies the arc and which ring (depth) it is. */
export interface ArcColorInput { occupant: string | null; depth: number; }
export type ColorFn = (arc: ArcColorInput) => string;

export function colorScale(dim: ColorDim, s: Snapshot, selectedCountry?: string, seedSort: SeedSort = "seed", theme: Theme = "dark"): ColorFn {
  if (dim === "time") {
    // Each arc is coloured by its occupant's cumulative court time *through that ring's round* —
    // the outer ring (R128) is their first match and the heat builds inward — rather than one
    // flat per-player total. Ring → round: the outer leaf ring is round 0, the centre the final.
    const cum = cumulativeOnCourt(s);
    const numRounds = s.rounds.length;
    const t = scaleLinear<number>().domain([0, cum.max]).range([0, 1]).clamp(true);
    return ({ occupant, depth }) => {
      if (!occupant) return NEUTRAL[theme];
      const round = Math.max(0, Math.min(numRounds - depth, numRounds - 1));
      return HEAT(t(cum.through(occupant, round)));
    };
  }
  if (dim === "seed") {
    // Same violet ramp in both sub-modes — only the meaning changes (top seed ↔ strongest by ELO),
    // and both are top-32 rankings, so the 1→32 domain maps cleanly either way.
    const t = scaleLinear<number>().domain([1, 32]).range([1, 0]).clamp(true);
    if (seedSort === "elo") {
      // ELO sort: the wheel lights the top 32 by surface ELO, keyed by their ELO rank.
      const rank = eloRank(s);
      return ({ occupant }) => {
        const r = occupant ? rank.get(occupant) : undefined;
        return r != null && r <= 32 ? SEED(t(r)) : NEUTRAL[theme];   // outside the top 32 → neutral
      };
    }
    return ({ occupant }) => {
      const seed = occupant ? s.players[occupant]?.seed : null;
      return seed != null && seed <= 32 ? SEED(t(seed)) : NEUTRAL[theme];   // unseeded / beyond-32 → neutral (mirrors the ELO branch)
    };
  }
  // country — neutral wheel; the selected nation lights up (flags carry identity)
  return ({ occupant }) => {
    const c = occupant ? s.players[occupant]?.country : null;
    if (!c) return NEUTRAL[theme];
    return selectedCountry && c === selectedCountry ? COUNTRY_HL[theme] : COUNTRY_MUTED[theme];
  };
}
