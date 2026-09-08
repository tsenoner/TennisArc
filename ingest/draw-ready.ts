import type { Snapshot } from "../src/model";
import { isUpcoming } from "../src/model";

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
 * the dead-man ping. Before the edition is under way an unpublished bracket is simply the window
 * opening ahead of the draw, which is by design. Once it IS under way, the same shape means a
 * bracket that regressed — SofaScore serving a degraded payload, or the wrong tournament — and
 * that has to be loud, or a mid-slam upstream break would sit behind a green check. See
 * `underWay` for why that question is NOT just "has a match been played".
 */
export function drawGap(
  snap: Snapshot, drawSize: number, when: WindowClock,
): { reason: string; benign: boolean } | null {
  const gap = (reason: string) => ({ reason, benign: !underWay(snap, when) });
  const matchCount = Object.keys(snap.matches).length;
  if (matchCount < drawSize - 1) return gap(`draw not fully available yet (${matchCount}/${drawSize - 1} matches)`);
  const { all } = entrantIds(snap);
  if (all.size < drawSize / 2) return gap(`bracket published without a draw yet (${all.size}/${drawSize} entrants named)`);
  return null;
}

/** Now, and when this edition's draw was due (`drawDueAt` in config.ts) — both Unix seconds. */
export interface WindowClock { nowSec: number; drawDueSec: number }

/**
 * Is the edition overdue — past the date its draw was due? This is the benign/loud split for every
 * state the payload itself cannot explain: SofaScore serving no season for the year at all, or a
 * bracket carrying neither results nor scheduled starts. Before it, that is the window's deliberate
 * lead-in and the cycle is a no-op; from it on, the edition should exist and doesn't.
 */
export const isOverdue = ({ nowSec, drawDueSec }: WindowClock): boolean => nowSec >= drawDueSec;

/**
 * Is this edition under way — i.e. should a draw exist by now? Deliberately NOT just "some match
 * has a played status", because the payload that makes `drawGap` fire is exactly the one that
 * destroys that evidence: a degraded bracket comes back as 127 participant-less blocks, every one
 * of them `notstarted`, so a mid-slam upstream break would look identical to a pre-draw cycle and
 * slip out as benign — hiding behind a green ping, which is what this whole guard exists to stop.
 *
 * Three independent signals, cheapest first, any one of which settles it:
 *
 *  1. a match with a played status — direct evidence, but the one a degraded payload erases;
 *  2. the bracket's own schedule. cuptrees stamps `seriesStartDateTimestamp` on every block whether
 *     or not the slot names a player, and normalize carries it onto unplayed matches as
 *     `scheduledStart`, so even a playerless skeleton still says when round 1 is due on court;
 *  3. the calendar. `drawBy` is a fact about the tournament, not about the payload, so it holds
 *     even when SofaScore sends a bracket carrying neither results nor stamps — the case where the
 *     first two both go quiet and the guard would otherwise fall back to "benign" by default.
 */
function underWay(snap: Snapshot, { nowSec, drawDueSec }: WindowClock): boolean {
  if (Object.values(snap.matches).some((m) => !isUpcoming(m.status))) return true;
  for (const id of snap.rounds[0]?.matchIds ?? []) {
    const t = snap.matches[id]?.scheduledStart;
    if (typeof t === "number" && t <= nowSec) return true;
  }
  return isOverdue({ nowSec, drawDueSec });
}
