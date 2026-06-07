import { scaleLinear, scaleOrdinal } from "d3-scale";
import { interpolateRgbBasis } from "d3-interpolate";
import type { Snapshot } from "./model";
import type { PlayerTime } from "./state";

export type ColorDim = "time" | "seed" | "country";
export const COLOR_DIMS: ColorDim[] = ["time", "seed", "country"];

const NEUTRAL = "#3a4350";
// cool → gold → clay
const HEAT = interpolateRgbBasis(["#2f6f8f", "#d9a441", "#e0683c"]);
const CATEGORICAL = [
  "#e0683c", "#36b3a8", "#d9a441", "#7c83ff", "#e06ca0",
  "#6fae5a", "#c2627a", "#4aa3df", "#b07cc6", "#d98a3c",
];

export type ColorFn = (playerId: string | null) => string;

export function colorScale(dim: ColorDim, s: Snapshot, time: Map<string, PlayerTime>): ColorFn {
  if (dim === "time") {
    const max = Math.max(1, ...[...time.values()].map((v) => v.sec));
    const t = scaleLinear<number>().domain([0, max]).range([0, 1]).clamp(true);
    return (id) => (id && time.has(id) ? HEAT(t(time.get(id)!.sec)) : NEUTRAL);
  }
  if (dim === "seed") {
    const t = scaleLinear<number>().domain([1, 32]).range([1, 0]).clamp(true);
    return (id) => {
      const seed = id ? s.players[id]?.seed : null;
      return seed != null ? HEAT(t(seed)) : NEUTRAL;   // null/undefined seed → neutral (seed 0 never occurs but is treated as valid)
    };
  }
  // country — explicit sorted domain so a country's colour is stable across renders
  const countries = [...new Set(Object.values(s.players).map((p) => p.country))].sort();
  const ord = scaleOrdinal<string, string>().domain(countries).range(CATEGORICAL);
  return (id) => {
    const c = id ? s.players[id]?.country : null;
    return c ? ord(c) : NEUTRAL;
  };
}
