import type { Tour } from "../src/model";

/** A calendar month-day with no year — deliberately NOT a string. A `"01-15"` would still compile
 *  everywhere a date-shaped string is expected (`Date.parse("01-15")` is 2001-01-15 in the host
 *  zone, not an error), which is the exact shape of the bug this type exists to prevent: a window
 *  that silently never opens. `{ month, day }` makes that a type error instead. */
export interface MonthDay { month: number; day: number }

/** Everything about a Slam that does not depend on which season is being ingested. */
export interface SlamTemplate {
  slam: string; name: string; surface: string;
  from: MonthDay; // the active window opens (a few days before the main draw is released)
  to: MonthDay;   // the active window closes, exclusive (a couple of days after the latest final)
  unitournament: Record<Tour, number>; // SofaScore uniqueTournament ids — stable across seasons
}

/** One edition: a template bound to the season a run is actually ingesting. */
export interface SlamConfig extends SlamTemplate { year: number }

/** Which edition to ingest — the slam key plus the season it belongs to. */
export interface SlamEdition { slam: string; year: number }

// SofaScore uniqueTournament ids per tour, plus each Slam's *active window* `[from, to)` as a
// month-day template:
//   from ≈ a few days before the main draw is released;
//   to   ≈ a couple of days after the latest final, so late stat corrections are still captured.
// The ingest only does work while `now` is inside a window — between Slams the bracket is frozen,
// so refreshing would just relaunch a browser and push nothing. The data branch keeps holding the
// most recent Slam's final state until the next Slam's window opens.
//
// NOTHING HERE CARRIES A SEASON AND NOTHING HERE EXPIRES. The windows are applied to whichever
// season `now` is in (see `activeSlam`), and the ids are season-stable — which is why the backfill
// has always reused them for any year. This used to be a table of 2026 literals with a "bump it
// annually" note; from 2027 nothing would have matched and every refresh would have been a silent,
// healthy-looking no-op (issue #208).
//
// The windows are sized off the real 2009-2026 calendar — Jeff Sackmann's tourney_date per slam,
// corrected to the true first day for the Sunday-start editions (Roland Garros throughout, the
// Australian Open from 2024, the US Open from 2025) and to the rain-delayed Monday where a final
// actually ran late (US Open 2009, Roland Garros 2012):
//   AO      starts 01-12…01-20, finals 01-26…02-02
//   RG      starts 05-22…05-30, finals 06-05…06-13
//   W       starts 06-27…07-03, finals 07-10…07-16  (the 2015+ calendar; before that it ran a week
//                                                    earlier, a rule that has been dead for a decade)
//   USO     starts 08-24…08-31, finals 09-07…09-14
// Each window clears those extremes by ~4 days on both sides, because nobody re-tunes them now and
// the bands themselves move: the 15-day Sunday-start format pulled the AO earlier in 2024 and the
// USO in 2025. Being generous is close to free — a cycle that finds no published draw stops there
// without publishing (ingest/draw-ready.ts) — while being a day short truncates a live tournament
// at the semis for a whole year. The COVID editions (AO 2021 in February, RG 2020 in September) and
// the pre-2015 Wimbledon calendar sit outside any sane static window and are out of reach by
// design; they only ever mattered live, and they are long since history.
export const SLAMS: Record<string, SlamTemplate> = {
  "australian-open": { slam: "australian-open", name: "Australian Open", surface: "Hard",  from: { month: 1, day: 8 },  to: { month: 2, day: 5 },  unitournament: { ATP: 2363, WTA: 2571 } },
  "roland-garros":   { slam: "roland-garros",   name: "Roland Garros",   surface: "Clay",  from: { month: 5, day: 18 }, to: { month: 6, day: 16 }, unitournament: { ATP: 2480, WTA: 2577 } },
  wimbledon:         { slam: "wimbledon",       name: "Wimbledon",       surface: "Grass", from: { month: 6, day: 24 }, to: { month: 7, day: 19 }, unitournament: { ATP: 2361, WTA: 2600 } },
  "us-open":         { slam: "us-open",         name: "US Open",         surface: "Hard",  from: { month: 8, day: 20 }, to: { month: 9, day: 17 }, unitournament: { ATP: 2449, WTA: 2601 } },
};

export const DRAW_SIZE = 128;

const utc = (year: number, md: MonthDay): number => Date.UTC(year, md.month - 1, md.day);

/**
 * The event window `[from, to)` for a slam in an arbitrary `year`, as UTC ms timestamps — or `null`
 * for an unknown slam. Approximate to the week (a slam's exact dates drift a few days year to
 * year), which is all either caller needs: picking the Slam to ingest, and classifying a snapshot
 * as upcoming / live / complete by event recency.
 *
 * Irregular editions — the COVID-shifted Australian Open 2021 (played in February) or Roland Garros
 * 2020 (September) — fall outside the window entirely. That is harmless for classifying historical
 * slams (`now` is far past `to`, so they resolve `complete` regardless) and only ever mattered for
 * an in-progress edition.
 *
 * INVARIANT: every window lives inside ONE calendar year, so an edition is fully identified by that
 * year. That is what lets `activeSlam` test only `now`'s own season, and what makes
 * `eventWindow(slam, snapshot.year)` the right window in manifest.ts. A slam that moved its draw
 * release into the previous December would break it (start year ≠ edition year, so a snapshot would
 * be written under the wrong year); config.test.ts fails the build rather than let that ship.
 */
export function eventWindow(slam: string, year: number): { from: number; to: number } | null {
  const cfg = SLAMS[slam];
  if (!cfg) return null;
  return { from: utc(year, cfg.from), to: utc(year, cfg.to) };
}

/**
 * The runtime config for one edition: a slam's season-free template bound to `year`. Which season
 * is being ingested is a per-run derivation, never config — keeping it out of `SLAMS` is what stops
 * the table going stale. Throws on an unknown slam: spreading a missing key would otherwise yield
 * an object whose every field is `undefined`, failing much later and much less legibly. The key
 * test is hasOwnProperty for the same reason as in `activeSlam` — `SLAMS["toString"]` is a
 * truthy inherited function, so a plain falsy check would wave it through.
 */
export function slamConfig(slam: string, year: number): SlamConfig {
  if (!Object.prototype.hasOwnProperty.call(SLAMS, slam)) {
    throw new Error(`unknown slam "${slam}" (known: ${Object.keys(SLAMS).join(", ")})`);
  }
  return { ...SLAMS[slam]!, year };
}

/**
 * The Slam edition to ingest right now, or `null` if none is in progress: the slam whose active
 * window `[from, to)` contains `now`, paired with the season that window belongs to. Between
 * tournaments returns `null` so the caller can skip the (expensive) fetch entirely — the published
 * data won't change until the next window opens. Windows don't overlap, so at most one matches.
 *
 * Returns the *edition* rather than the bare key so exactly one place decides which season is live.
 * A caller that re-derived the year itself could disagree with the matched window and write the
 * snapshot under the wrong year — silently, since the file simply lands in another directory.
 * Only `now`'s own UTC year needs testing, because every window is intra-year (see `eventWindow`):
 * a window in `year ± 1` either closed before `now` or opens after it.
 *
 * Force a specific Slam regardless of the window with the `SLAM` env var (e.g.
 * `SLAM=wimbledon pnpm ingest`) — handy for re-running the current edition out of season. The
 * override names the slam, not the edition: it always resolves to `now`'s season. To ingest a PAST
 * edition use the backfill instead: `BACKFILL_YEARS=2025 BACKFILL_SLAMS=wimbledon pnpm ingest`.
 */
export function activeSlam(now: Date = new Date(), override = process.env.SLAM): SlamEdition | null {
  const year = now.getUTCFullYear();
  // hasOwnProperty, not `in`: `"toString" in SLAMS` is true and would name a slam that isn't one.
  if (override && Object.prototype.hasOwnProperty.call(SLAMS, override)) return { slam: override, year };
  const ts = now.getTime();
  for (const slam of Object.keys(SLAMS)) {
    const w = eventWindow(slam, year)!; // the key came from SLAMS, so never null
    if (w.from <= ts && ts < w.to) return { slam, year };
  }
  return null;
}
