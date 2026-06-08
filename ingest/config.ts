import type { Tour } from "../src/model";

export interface SlamConfig {
  slam: string; name: string; surface: string; year: number;
  from: string; // ISO date (UTC) from which to track this slam (≈ when the main draw is released)
  unitournament: Record<Tour, number>; // SofaScore uniqueTournament ids
}

// SofaScore uniqueTournament ids per tour. `from` ≈ the day the main draw is released (a day or
// two before play). The ingest tracks the slam with the latest `from` already past, so it keeps
// showing the most recent Slam between tournaments and auto-switches to the next once its draw
// window opens — no manual edit needed.
// NOTE: dates/ids are for the 2026 season — bump them when rolling to a new year.
export const SLAMS: Record<string, SlamConfig> = {
  "australian-open": { slam: "australian-open", name: "Australian Open", surface: "Hard",  year: 2026, from: "2026-01-15", unitournament: { ATP: 2363, WTA: 2521 } },
  "roland-garros":   { slam: "roland-garros",   name: "Roland Garros",   surface: "Clay",  year: 2026, from: "2026-05-21", unitournament: { ATP: 2480, WTA: 2577 } },
  wimbledon:         { slam: "wimbledon",       name: "Wimbledon",       surface: "Grass", year: 2026, from: "2026-06-26", unitournament: { ATP: 2361, WTA: 2600 } },
  "us-open":         { slam: "us-open",         name: "US Open",         surface: "Hard",  year: 2026, from: "2026-08-25", unitournament: { ATP: 2449, WTA: 2547 } },
};

export const DRAW_SIZE = 128;

/**
 * The Slam to ingest right now: the one with the latest `from` date already in the past. Keeps
 * showing the most recent Slam between tournaments and auto-switches to the next once its draw
 * window opens. Force a specific Slam with the `SLAM` env var (e.g. `SLAM=wimbledon pnpm ingest`).
 */
export function currentSlam(now: Date = new Date(), override = process.env.SLAM): keyof typeof SLAMS {
  if (override && override in SLAMS) return override;
  const ts = now.getTime();
  let pick: keyof typeof SLAMS = "australian-open";
  let best = -Infinity;
  for (const [key, cfg] of Object.entries(SLAMS)) {
    const from = Date.parse(cfg.from);
    if (from <= ts && from > best) { best = from; pick = key; }
  }
  return pick;
}
