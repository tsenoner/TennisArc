import type { CurrentGame, LiveRecord, Match, SetScore, Snapshot, Tour } from "./model";
import { tryFetch } from "./api";
import { flashSigKey, sigKey, sortedPairKey } from "./names";
import { bestOfForTour, isTiebreak, setsToWin } from "./points";

/** Fetch the same-origin live overlay for a view. Null on any failure (dev server has no function,
 *  network error, non-JSON) → the caller simply applies no overlay. Always same-origin (the Vercel
 *  function is co-deployed) — NOT VITE_DATA_BASE_URL, which points at the data branch. `no-store`
 *  because live scores must bypass the browser HTTP cache (the function's own s-maxage coalesces upstream). */
export async function fetchLive(tour: Tour, slam: string): Promise<LiveRecord[] | null> {
  const url = `/api/live?tour=${tour.toLowerCase()}&slam=${encodeURIComponent(slam)}`;
  const data = await tryFetch<{ matches: LiveRecord[] }>(url, (d) => Array.isArray(d?.matches), "no-store");
  return data ? data.matches : null;
}

/** The selected live match's current-game points, from the same-origin /api/pbp proxy.
 *  Null on any failure or when there is no current game ({} body) — the caller keeps
 *  showing its last value and retries on the next tick. `no-store` for the same reason
 *  as fetchLive: the function's own s-maxage does the coalescing. */
export type { CurrentGame } from "./model"; // the shape is named once, in model.ts (app.ts imports it from here)
export async function fetchPbp(mid: string): Promise<CurrentGame | null> {
  return tryFetch<CurrentGame>(
    `/api/pbp?mid=${encodeURIComponent(mid)}`,
    (d) => typeof d?.home === "string" && typeof d?.away === "string",
    "no-store",
  );
}

/**
 * Join Flashscore live records onto snapshot matches by sorted surname-pair (unique within a live
 * singles draw). Returns matchId → Partial<Match> for LIVE (stage 2) and FINISHED (stage 3) records.
 * Orientation (which Flashscore side is p1) is resolved per record. Ambiguous pairs — two matches
 * sharing a key — are dropped rather than mis-joined. Winner is set on a finished match ONLY when a
 * side reached the sets-to-win threshold (ATP best-of-5 → 3, WTA best-of-3 → 2); otherwise it is
 * left to the snapshot (the retirement/walkover shape).
 */
export function overlayLive(snap: Snapshot, records: LiveRecord[]): Record<string, Partial<Match>> {
  const keyOf = (m: Match): string | null => {
    const n1 = m.p1 ? snap.players[m.p1]?.name : undefined;
    const n2 = m.p2 ? snap.players[m.p2]?.name : undefined;
    if (!n1 || !n2) return null;
    const a = sigKey(n1), b = sigKey(n2);
    return a && b ? sortedPairKey(a, b) : null;
  };
  const index = new Map<string, Match | null>(); // null = ambiguous
  for (const m of Object.values(snap.matches)) {
    const k = keyOf(m);
    if (k) index.set(k, index.has(k) ? null : m);
  }

  const toWin = setsToWin(bestOfForTour(snap.tour));
  const out: Record<string, Partial<Match>> = {};
  for (const r of records) {
    if (r.stage !== 2 && r.stage !== 3) continue;
    const hk = flashSigKey(r.home), ak = flashSigKey(r.away);
    if (!hk || !ak) continue;
    const m = index.get(sortedPairKey(hk, ak));
    if (!m) continue; // unmatched or ambiguous

    const p1name = m.p1 ? snap.players[m.p1]?.name : undefined;
    const homeIsP1 = p1name != null && hk === sigKey(p1name);
    const score: SetScore[] = r.sets.map(([h, a]) => (homeIsP1 ? { p1: h, p2: a } : { p1: a, p2: h }));
    const patch: Partial<Match> = {
      status: r.stage === 2 ? "live" : "finished",
      score: score.length ? score : null,
    };
    if (r.stage === 2) {
      patch.flash = { id: r.id, homeIsP1 };
      // Tiebreak (last set reads e.g. 6-6, or the rare 12-12+): CX (r.srv) rotates every two
      // points, far faster than the 30s poll, so each tick would produce a differing patch and
      // defeat samePatch. The client hides the serve dot in tiebreaks anyway, so omit `serving`.
      const last = r.sets[r.sets.length - 1];
      const inTb = last != null && isTiebreak(last[0], last[1]);
      if (r.srv && !inTb) {
        const homeServes = r.srv === 1;
        patch.serving = homeServes ? (homeIsP1 ? "p1" : "p2") : (homeIsP1 ? "p2" : "p1");
      }
    }
    if (r.stage === 3) {
      const [p1Won, p2Won] = homeIsP1 ? r.setsWon : [r.setsWon[1], r.setsWon[0]];
      if (p1Won >= toWin) patch.winner = "p1";
      else if (p2Won >= toWin) patch.winner = "p2";
      // else: leave winner to the snapshot (retirement/walkover)
    }
    out[m.id] = patch;
  }
  return out;
}

/** Order-insensitive equality of two live-patch maps. Flashscore can reorder matches between polls
 *  with no score change; JSON.stringify would read that as different and trigger a redraw that wipes
 *  panel scroll / focus. Compare by sorted match id + per-match value (overlayLive builds each
 *  Partial<Match> with a fixed key order, so JSON.stringify of a value is stable for its content). */
export function samePatch(a: Record<string, Partial<Match>>, b: Record<string, Partial<Match>>): boolean {
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.length !== kb.length) return false;
  return ka.every((k, i) => k === kb[i] && JSON.stringify(a[k]) === JSON.stringify(b[k]));
}

/** A new snapshot with `patch` merged over its matches; the original is never mutated. Returns the
 *  same object (no clone) when there is nothing to apply. */
export function applyLivePatch(snap: Snapshot, patch: Record<string, Partial<Match>> | undefined): Snapshot {
  if (!patch || Object.keys(patch).length === 0) return snap;
  const matches: Record<string, Match> = {};
  for (const [id, m] of Object.entries(snap.matches)) matches[id] = patch[id] ? { ...m, ...patch[id] } : m;
  return { ...snap, matches };
}
