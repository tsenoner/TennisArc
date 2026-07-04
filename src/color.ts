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
// seed: four DISCRETE seeding bands (1–4, 5–8, 9–16, 17–32) rather than a continuous rank ramp —
// each classic seed tier reads as one solid block on the wheel. Same violet family as before
// (a deliberately different hue from HEAT so the Seed lens never reads like the Time lens):
// brightest pale lilac = the top 1–4 band, deepest indigo = the 17–32 band.
const SEED_TIER_MAX = [4, 8, 16, 32] as const;                                  // inclusive upper rank of each band
const SEED_TIER_STOPS = ["#e2cdff", "#a36bff", "#6d3fd4", "#352170"] as const;  // bands 1-4 → 17-32 (pale → deep)
/** The seeding-band colour for a 1..32 rank (seed# or ELO position); null when the rank is
 *  absent (unseeded / no ELO) or past the top 32. */
export function seedTierColor(rank: number | null | undefined): string | null {
  if (rank == null) return null;
  for (let i = 0; i < SEED_TIER_MAX.length; i++) if (rank <= SEED_TIER_MAX[i]) return SEED_TIER_STOPS[i];
  return null;
}
const COUNTRY_MUTED = { dark: "#2c3744", light: "#e2ded4" } as const;
const COUNTRY_HL = { dark: "#4ea1ff", light: "#1b63b4" } as const;   // keep in sync with --country in app.css

/** The per-arc inputs a colour function reads: who occupies the arc, which ring (depth) it is,
 *  and whether the arc is a projection (no decided result feeding it yet). */
export interface ArcColorInput { occupant: string | null; depth: number; projected: boolean; live?: boolean; suspended?: boolean; }
/** Maps an arc to a fill. Every lens exposes `pending`: arcs with nothing DECIDED to colour
 *  (unknown occupant, pure projection, or zero court time on the Time lens), which render.ts
 *  styles as the `.arc.pending` grey scaffold. A projection is a guess, so it never carries a
 *  lens hue forward — the one exception is an in-play (live/suspended) arc, which is happening,
 *  not forecast. */
export interface ColorFn { (arc: ArcColorInput): string; pending?(arc: ArcColorInput): boolean; }

export function colorScale(dim: ColorDim, s: Snapshot, selectedCountry?: string, seedSort: SeedSort = "seed", theme: Theme = "dark"): ColorFn {
  if (dim === "time") {
    // Each arc is coloured by its occupant's cumulative court time *through that ring's round* —
    // the outer ring (R128) is their first match and the heat builds inward — rather than one
    // flat per-player total. Ring → round: the outer leaf ring is round 0, the centre the final.
    const cum = cumulativeOnCourt(s);
    const numRounds = s.rounds.length;
    const t = scaleLinear<number>().domain([0, cum.max]).range([0, 1]).clamp(true);
    const ringRound = (depth: number) => Math.max(0, Math.min(numRounds - depth, numRounds - 1));
    // Time is a measured fact: only DECIDED arcs whose occupant has actually been on court carry
    // heat. An arc is "pending" when it has no real court time yet — an unknown occupant, a
    // not-yet-played projection, or a decided occupant still on zero minutes (e.g. a walkover
    // advance, or the unplayed entrant leaves of round 0, which are decided:false yet hold no
    // result). Pending arcs read as the NEUTRAL grey, never HEAT(0): the cool "fresh" tone is a
    // real low value, so painting the unplayed half with it makes it look like a dead zone.
    // A LIVE match is the one exception: it keeps its heat even at zero recorded time, because it
    // is real, current play (the hatch/breathing mark it live). So `live` short-circuits BOTH the
    // projection test AND the zero-time test — a just-started live match with no duration logged
    // yet stays heat (HEAT(0)), never falling through to the grey "not played yet" tier. A SUSPENDED
    // match is play-in-progress too (just paused), so it gets the same exemption — its arc stays lit
    // (styled distinctly by render.ts) rather than reading as an unplayed grey scaffold.
    const inPlay = (a: ArcColorInput) => a.live || a.suspended;
    const pending = (a: ArcColorInput): boolean =>
      !a.occupant || (!inPlay(a) && (a.projected || cum.through(a.occupant, ringRound(a.depth)) <= 0));
    const fn: ColorFn = (a) => {
      // mirrors `pending`, but computes cum.through ONCE and reuses it for the heat value
      if (!a.occupant || (!inPlay(a) && a.projected)) return NEUTRAL[theme];
      const sec = cum.through(a.occupant, ringRound(a.depth));
      return !inPlay(a) && sec <= 0 ? NEUTRAL[theme] : HEAT(t(sec));
    };
    fn.pending = pending;
    return fn;
  }
  // Seed/Country share one pending rule: an undecided (projected) arc is neutral scaffold — no
  // forward wash of the favourite's hue or nation — unless the match is in play right now.
  // withPending guards every branch with it, so `paint` only ever sees a non-null occupant.
  const inPlay = (a: ArcColorInput) => a.live || a.suspended;
  const pending = (a: ArcColorInput): boolean => !a.occupant || (!inPlay(a) && a.projected);
  const withPending = (paint: (a: ArcColorInput) => string): ColorFn =>
    Object.assign((a: ArcColorInput) => (pending(a) ? NEUTRAL[theme] : paint(a)), { pending });
  if (dim === "seed") {
    // Both sub-modes read a 1..32 ranking — tournament seed, or strongest-by-surface-ELO — and
    // paint it in the four seeding bands (seedTierColor); anything past the top 32 goes neutral.
    if (seedSort === "elo") {
      // ELO sort: the wheel lights the top 32 by surface ELO, keyed by their ELO rank.
      const rank = eloRank(s);
      return withPending((a) => seedTierColor(rank.get(a.occupant!)) ?? NEUTRAL[theme]);   // outside top 32 → neutral
    }
    return withPending((a) => seedTierColor(s.players[a.occupant!]?.seed) ?? NEUTRAL[theme]);   // unseeded / beyond-32 → neutral
  }
  // country — neutral wheel; the selected nation lights up (flags carry identity)
  return withPending((a) => {
    const c = s.players[a.occupant!]?.country;
    if (!c) return NEUTRAL[theme];
    return selectedCountry && c === selectedCountry ? COUNTRY_HL[theme] : COUNTRY_MUTED[theme];
  });
}
