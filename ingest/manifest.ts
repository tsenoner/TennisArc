import type { AvailableSlam, SlamStatus, Snapshot } from "../src/model";
import { SLAMS, eventWindow } from "./config";

const decided = (status: string): boolean =>
  status === "finished" || status === "retired" || status === "walkover";

/**
 * Classify a snapshot relative to `now`, anchored to the event's calendar window (not just the
 * final-match state). Past events are `complete` even if the final never got a result — so a future
 * data hole degrades to a `complete`-with-gap instead of masquerading as `live` and hijacking the
 * boot pick (issue #19). Within the window: `live` while a match is in play (or the draw is up but
 * not yet decided), `complete` once the final is decided. Before the window: `upcoming`. Unknown
 * slam (no window) falls back to the old final-decided-only test. `now` is injected so the function
 * stays pure and reindex can derive a deterministic clock from the files.
 */
export function slamStatus(snap: Snapshot, now: Date): SlamStatus {
  const matches = Object.values(snap.matches);
  const final = matches.find((m) => m.nextMatchId === null);
  const finalDecided = !!final && decided(final.status);
  const window = eventWindow(snap.tournament.slam, snap.tournament.year);
  if (!window) return finalDecided ? "complete" : "live";

  const ts = now.getTime();
  if (ts >= window.to) return "complete"; // event is in the past — never live, even with a hole
  if (ts < window.from) return "upcoming"; // event hasn't started yet
  // inside the window: genuinely in progress
  if (matches.some((m) => m.status === "live")) return "live";
  return finalDecided ? "complete" : "live";
}

/** Build the index.json entry describing a snapshot. `now` anchors the status to event recency. */
export function availableSlamOf(snap: Snapshot, now: Date): AvailableSlam {
  return {
    tour: snap.tour,
    year: snap.tournament.year,
    slam: snap.tournament.slam,
    name: snap.tournament.name,
    surface: snap.tournament.surface,
    status: slamStatus(snap, now),
    generatedAt: snap.generatedAt,
    drawSize: snap.tournament.drawSize,
  };
}

/** Merge fresh entries into an existing manifest list, keyed by tour+year+slam; newest year first. */
export function mergeIndex(existing: AvailableSlam[], entries: AvailableSlam[]): AvailableSlam[] {
  const key = (a: AvailableSlam) => `${a.tour}:${a.year}:${a.slam}`;
  const byKey = new Map(existing.map((s) => [key(s), s]));
  for (const e of entries) byKey.set(key(e), e);
  return [...byKey.values()].sort(
    (a, b) => b.year - a.year || a.slam.localeCompare(b.slam) || a.tour.localeCompare(b.tour),
  );
}

/**
 * Expand a "2024,2025" years env into {year, slam} targets. By default every slam in `SLAMS`;
 * pass `slamsCsv` (e.g. "australian-open") to restrict to specific slams — handy for backfilling
 * one major without re-scraping the others. Unknown slam keys are ignored.
 */
export function backfillTargets(
  yearsCsv: string | undefined, slamsCsv?: string,
): { year: number; slam: string }[] {
  if (!yearsCsv) return [];
  const years = yearsCsv.split(",").map((y) => Number(y.trim())).filter((y) => Number.isInteger(y));
  const all = Object.keys(SLAMS);
  const slams = slamsCsv
    ? slamsCsv.split(",").map((s) => s.trim()).filter((s) => all.includes(s))
    : all;
  const out: { year: number; slam: string }[] = [];
  for (const year of years) for (const slam of slams) out.push({ year, slam });
  return out;
}
