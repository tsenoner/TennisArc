import { scaleLinear } from "d3-scale";
import { interpolateRgbBasis } from "d3-interpolate";
import type { Snapshot } from "./model";
import type { PlayerTime } from "./state";

export type ColorDim = "time" | "seed" | "country";
export const COLOR_DIMS: ColorDim[] = ["time", "seed", "country"];

const NEUTRAL = "#3a4350";
// time: cool → gold → clay
const HEAT = interpolateRgbBasis(["#2f6f8f", "#d9a441", "#e0683c"]);
// seed: recessive → vivid violet — a deliberately different hue family from HEAT so the
// Seed lens never reads like the Time lens. Top seed = vivid violet; lowest seed = muted.
const SEED = interpolateRgbBasis(["#433f5c", "#7c5cc9", "#b794f6"]);
const COUNTRY_MUTED = "#2c3744";
const COUNTRY_HL = "#4ea1ff";

// Legend gradients (left → right) mirroring each scale's domain order; kept in sync with the CSS.
export const HEAT_STOPS = ["#2f6f8f", "#d9a441", "#e0683c"];
export const SEED_STOPS = ["#433f5c", "#7c5cc9", "#b794f6"];

export type ColorFn = (playerId: string | null) => string;

export function colorScale(
  dim: ColorDim, s: Snapshot, time: Map<string, PlayerTime>, selectedCountry?: string,
): ColorFn {
  if (dim === "time") {
    const max = Math.max(1, ...[...time.values()].map((v) => v.sec));
    const t = scaleLinear<number>().domain([0, max]).range([0, 1]).clamp(true);
    return (id) => (id && time.has(id) ? HEAT(t(time.get(id)!.sec)) : NEUTRAL);
  }
  if (dim === "seed") {
    const t = scaleLinear<number>().domain([1, 32]).range([1, 0]).clamp(true);
    return (id) => {
      const seed = id ? s.players[id]?.seed : null;
      return seed != null ? SEED(t(seed)) : NEUTRAL;   // null/undefined seed → neutral (seed 0 never occurs but is treated as valid)
    };
  }
  // country — neutral wheel; the selected nation lights up (flags carry identity)
  return (id) => {
    const c = id ? s.players[id]?.country : null;
    if (!c) return NEUTRAL;
    return selectedCountry && c === selectedCountry ? COUNTRY_HL : COUNTRY_MUTED;
  };
}
