import type { AvailableSlam, SlamStatus, Snapshot } from "../src/model";

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
