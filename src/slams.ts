import type { AvailableSlam, SlamIndex, Tour } from "./model";

export const SLAM_ORDER = ["australian-open", "roland-garros", "wimbledon", "us-open"] as const;
export const SLAM_ABBR: Record<string, string> = {
  "australian-open": "AO", "roland-garros": "RG", wimbledon: "W", "us-open": "US",
};
export const SLAM_SURFACE: Record<string, string> = {
  "australian-open": "Hard", "roland-garros": "Clay", wimbledon: "Grass", "us-open": "Hard",
};

export interface SlamSlot { slam: string; abbr: string; surface: string; entry: AvailableSlam | null; }

const orderIdx = (slam: string): number => {
  const i = (SLAM_ORDER as readonly string[]).indexOf(slam);
  return i < 0 ? SLAM_ORDER.length : i;
};
const byRecency = (a: AvailableSlam, b: AvailableSlam): number =>
  b.year - a.year || orderIdx(b.slam) - orderIdx(a.slam);

/** Distinct years (descending) that have at least one slam for the tour. */
export function availableYears(index: SlamIndex, tour: Tour): number[] {
  const years = new Set(index.slams.filter((s) => s.tour === tour).map((s) => s.year));
  return [...years].sort((a, b) => b - a);
}

/** The four slam slots for a year (calendar order), each with its manifest entry or null. */
export function slamsForYear(index: SlamIndex, year: number, tour: Tour): SlamSlot[] {
  return SLAM_ORDER.map((slam) => ({
    slam,
    abbr: SLAM_ABBR[slam],
    surface: SLAM_SURFACE[slam],
    entry: index.slams.find((s) => s.tour === tour && s.year === year && s.slam === slam) ?? null,
  }));
}

/** Default selection for a tour: most recent live, else most recent complete, else most recent of any. */
export function pickDefaultSlam(index: SlamIndex, tour: Tour): { year: number; slam: string } | null {
  const mine = index.slams.filter((s) => s.tour === tour);
  const pick = (list: AvailableSlam[]) => (list.length ? { year: list[0].year, slam: list[0].slam } : null);
  return (
    pick(mine.filter((s) => s.status === "live").sort(byRecency)) ??
    pick(mine.filter((s) => s.status === "complete").sort(byRecency)) ??
    pick([...mine].sort(byRecency))
  );
}
