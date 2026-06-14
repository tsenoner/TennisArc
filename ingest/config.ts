import type { Tour } from "../src/model";

export interface SlamConfig {
  slam: string; name: string; surface: string; year: number;
  from: string; // ISO date (UTC) the active window opens (≈ when the main draw is released)
  to: string;   // ISO date (UTC, exclusive) the active window closes (≈ final + ~2 days of buffer)
  unitournament: Record<Tour, number>; // SofaScore uniqueTournament ids
}

// SofaScore uniqueTournament ids per tour. Each Slam has an *active window* `[from, to)`:
//   from ≈ the day the main draw is released (a day or two before play);
//   to   ≈ a couple of days after the final, so late stat corrections are still captured.
// The ingest only does work while `now` is inside a window — between Slams the bracket is frozen,
// so refreshing would just relaunch a browser and push nothing. The data branch keeps holding the
// most recent Slam's final state until the next Slam's window opens.
// NOTE: dates/ids are for the 2026 season — bump them when rolling to a new year (windows are
// generous on the late side on purpose: a few wasted cycles beats truncating a live tournament).
export const SLAMS: Record<string, SlamConfig> = {
  "australian-open": { slam: "australian-open", name: "Australian Open", surface: "Hard",  year: 2026, from: "2026-01-15", to: "2026-02-03", unitournament: { ATP: 2363, WTA: 2571 } },
  "roland-garros":   { slam: "roland-garros",   name: "Roland Garros",   surface: "Clay",  year: 2026, from: "2026-05-21", to: "2026-06-09", unitournament: { ATP: 2480, WTA: 2577 } },
  wimbledon:         { slam: "wimbledon",       name: "Wimbledon",       surface: "Grass", year: 2026, from: "2026-06-26", to: "2026-07-14", unitournament: { ATP: 2361, WTA: 2600 } },
  "us-open":         { slam: "us-open",         name: "US Open",         surface: "Hard",  year: 2026, from: "2026-08-25", to: "2026-09-15", unitournament: { ATP: 2449, WTA: 2601 } },
};

export const DRAW_SIZE = 128;

/**
 * The event window `[from, to)` for a slam in an arbitrary `year`, as UTC ms timestamps — or `null`
 * for an unknown slam. The SLAMS config carries 2026 dates; this reparametrizes the month-day onto
 * any season (the windows are intra-year and never hit Feb-29, so substituting the year is safe).
 * Approximate to the week (a slam's exact start drifts a few days year to year) — fine for the only
 * caller that needs it: classifying a snapshot as upcoming / live / complete by event recency.
 * Irregular editions — e.g. the COVID-shifted Australian Open 2021 (played in February) or the late
 * US Open 2020 — can fall partly or wholly outside the reparametrized window; this is harmless for
 * classifying historical slams (`now` is far past `to`, so they resolve `complete` regardless) and
 * only matters for the current-year in-progress slam, whose real dates track the template closely.
 */
export function eventWindow(slam: string, year: number): { from: number; to: number } | null {
  const cfg = SLAMS[slam];
  if (!cfg) return null;
  const md = (iso: string): [number, number] => {
    const [, m, d] = iso.split("-").map(Number);
    return [m, d];
  };
  const [fm, fd] = md(cfg.from);
  const [tm, td] = md(cfg.to);
  return { from: Date.UTC(year, fm - 1, fd), to: Date.UTC(year, tm - 1, td) };
}

/**
 * The Slam to ingest right now, or `null` if none is in progress. Returns the Slam whose active
 * window `[from, to)` contains `now`; between tournaments returns `null` so the caller can skip the
 * (expensive) fetch entirely — the published data won't change until the next window opens. Windows
 * don't overlap, so at most one matches. Force a specific Slam regardless of the window with the
 * `SLAM` env var (e.g. `SLAM=wimbledon pnpm ingest`) — handy for testing out of season.
 */
export function activeSlam(now: Date = new Date(), override = process.env.SLAM): keyof typeof SLAMS | null {
  if (override && override in SLAMS) return override;
  const ts = now.getTime();
  for (const [key, cfg] of Object.entries(SLAMS)) {
    if (Date.parse(cfg.from) <= ts && ts < Date.parse(cfg.to)) return key;
  }
  return null;
}
