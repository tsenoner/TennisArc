export interface SofaSeason { id: number; year?: string }

/** Choose a SofaScore seasonId: the season for `year` if given, else the newest (first) season. */
export function pickSeasonId(seasons: SofaSeason[], year?: number): number {
  if (!seasons.length) throw new Error("no seasons");
  if (year == null) {
    const newest = seasons[0];
    if (!newest?.id) throw new Error("no season id");
    return newest.id;
  }
  const match = seasons.find((s) => Number(s.year) === year);
  if (!match?.id) throw new Error(`no season for year ${year}`);
  return match.id;
}
