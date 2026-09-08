export interface SofaSeason { id: number; year?: string }

/**
 * Choose a SofaScore seasonId: the season for `year` if given, else the newest (first) season.
 *
 * Returns `null` — rather than throwing — when a specific `year` is asked for and the list simply
 * doesn't have it. That is not a failure: during a Slam's lead-in the edition genuinely does not
 * exist upstream yet, and the caller decides whether that is expected (before `drawBy`) or an
 * alarm (after it). An EMPTY list is different and still throws: a uniqueTournament id that returns
 * no seasons at all has rotted, and nothing about the calendar makes that benign.
 */
export function pickSeasonId(seasons: SofaSeason[], year?: number): number | null {
  if (!seasons.length) throw new Error("no seasons");
  if (year == null) {
    const newest = seasons[0];
    if (!newest?.id) throw new Error("no season id");
    return newest.id;
  }
  return seasons.find((s) => Number(s.year) === year)?.id ?? null;
}
