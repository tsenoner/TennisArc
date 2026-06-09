import type { AvailableSlam, SlamStatus, Snapshot } from "../src/model";
import { SLAMS } from "./config";

/** live if any match is in play; complete once the final is decided; otherwise still live. */
export function slamStatus(snap: Snapshot): SlamStatus {
  const matches = Object.values(snap.matches);
  if (matches.some((m) => m.status === "live")) return "live";
  const final = matches.find((m) => m.nextMatchId === null);
  if (final && (final.status === "finished" || final.status === "retired" || final.status === "walkover")) {
    return "complete";
  }
  return "live";
}

/** Build the index.json entry describing a snapshot. */
export function availableSlamOf(snap: Snapshot): AvailableSlam {
  return {
    tour: snap.tour,
    year: snap.tournament.year,
    slam: snap.tournament.slam,
    name: snap.tournament.name,
    surface: snap.tournament.surface,
    status: slamStatus(snap),
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

/** Expand a "2024,2025" env string into {year, slam} targets across all four slams. */
export function backfillTargets(yearsCsv: string | undefined): { year: number; slam: string }[] {
  if (!yearsCsv) return [];
  const years = yearsCsv.split(",").map((y) => Number(y.trim())).filter((y) => Number.isInteger(y));
  const out: { year: number; slam: string }[] = [];
  for (const year of years) for (const slam of Object.keys(SLAMS)) out.push({ year, slam });
  return out;
}
