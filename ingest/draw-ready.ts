import type { Snapshot } from "../src/model";
import { isUpcoming } from "../src/model";

/**
 * Thrown when SofaScore's bracket exists but isn't populated enough to publish. Distinct from every
 * other ingest failure on purpose: the active window opens days ahead of the draw release, so
 * "not ready yet" is the EXPECTED state for the first cycles of a Slam and must not fail the
 * dead-man ping — while a rotted uniqueTournament id, a missing season or a dead network must.
 */
export class DrawNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DrawNotReadyError";
  }
}

/** The real draw entrants: every player id sitting in a round-0 slot, plus the subset whose
 *  first-round match hasn't been played yet. SofaScore fills later rounds with synthetic
 *  future-slot teams, so round 0 is the only round that names actual entrants. */
export function entrantIds(snap: Snapshot): { all: Set<string>; unplayed: Set<string> } {
  const all = new Set<string>();
  const unplayed = new Set<string>();
  for (const id of snap.rounds[0]?.matchIds ?? []) {
    const m = snap.matches[id];
    if (!m) continue;
    const notYetPlayed = isUpcoming(m.status);
    for (const pid of [m.p1, m.p2]) {
      if (!pid) continue;
      all.add(pid);
      if (notYetPlayed) unplayed.add(pid);
    }
  }
  return { all, unplayed };
}

/**
 * Why a freshly normalized snapshot is not publishable, as a human-readable `reason` — or `null`
 * when it is. Two ways an upstream bracket can be unfinished:
 *
 *  - fewer blocks than a full draw needs, i.e. the tree itself is still being built;
 *  - a complete tree of empty slots. SofaScore publishes the 127-block skeleton days before the
 *    draw ceremony fills it, so a match count alone says nothing. Publishing that state writes a
 *    playerless bracket over the real one and flips the app onto it — observed at the US Open 2026
 *    window open, which force-pushed an empty draw for ~25 h while every healthcheck went green.
 *
 * The entrant floor is half the draw, well below any real bracket: of the 117 snapshots published
 * so far, 115 name all 128 and the two thinnest name 118 (WTA AO 2023) and 96 (ATP RG 2014, a
 * historical hole). Anything under 64 is an unpublished skeleton, not a draw with gaps.
 *
 * `benign` says which of the two stories this is, and it decides whether the refresh cycle fails
 * the dead-man ping. Before a ball is struck an unpublished bracket is simply the window opening
 * ahead of the draw, which is by design. Once ANY match has been played, the same shape means a
 * bracket that regressed — SofaScore serving a degraded payload, or the wrong tournament — and
 * that has to be loud, or a mid-slam upstream break would sit behind a green check.
 */
export function drawGap(snap: Snapshot, drawSize: number): { reason: string; benign: boolean } | null {
  const played = Object.values(snap.matches).some((m) => !isUpcoming(m.status));
  const gap = (reason: string) => ({ reason, benign: !played });
  const matchCount = Object.keys(snap.matches).length;
  if (matchCount < drawSize - 1) return gap(`draw not fully available yet (${matchCount}/${drawSize - 1} matches)`);
  const { all } = entrantIds(snap);
  if (all.size < drawSize / 2) return gap(`bracket published without a draw yet (${all.size}/${drawSize} entrants named)`);
  return null;
}
