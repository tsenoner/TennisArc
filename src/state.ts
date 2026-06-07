import type { Match, Player, Snapshot } from "./model";

export interface SunNode {
  id: string;                 // unique path id, e.g. "r", "r.0", "r.0.1" (for focus/zoom)
  matchId: string;            // the match this node represents (leaf → its round-0 match)
  occupant: string | null;    // playerId (decided winner or projected); null = unknown (both feeders TBD)
  projected: boolean;         // occupant is a projection, not a decided result
  depth: number;              // 0 = champion (centre)
  children: SunNode[];
}

export function winnerId(m: Match): string | null {
  if (m.winner === "p1") return m.p1;
  if (m.winner === "p2") return m.p2;
  return null;
}

export function finalMatch(s: Snapshot): Match {
  const final = Object.values(s.matches).find((m) => m.nextMatchId === null);
  if (!final) throw new Error("no final match (nextMatchId === null) in snapshot");
  return final;
}

function feedersOf(s: Snapshot, matchId: string): Match[] {
  return Object.values(s.matches)
    .filter((m) => m.nextMatchId === matchId)
    .sort((a, b) => a.slot - b.slot);
}

/** Better-seeded player wins a projection: seeded beats unseeded; lower seed/ranking wins; tie → a. */
export function betterSeed(players: Record<string, Player>, a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  const pa = players[a], pb = players[b];
  if (!pa) return pb ? b : null;
  if (!pb) return a;
  const sa = pa.seed ?? Infinity, sb = pb.seed ?? Infinity;
  if (sa !== sb) return sa < sb ? a : b;
  const ra = pa.ranking ?? Infinity, rb = pb.ranking ?? Infinity;
  if (ra !== rb) return ra < rb ? a : b;
  return a;
}

/** Projected winner of a match: decided result if any, else the better-seeded projected finalist. */
export function projectedWinner(s: Snapshot, matchId: string): string | null {
  const m = s.matches[matchId];
  const decided = winnerId(m);
  if (decided) return decided;
  const feeders = feedersOf(s, matchId);
  const a = feeders[0] ? projectedWinner(s, feeders[0].id) : m.p1;
  const b = feeders[1] ? projectedWinner(s, feeders[1].id) : m.p2;
  return betterSeed(s.players, a, b);
}

/** Build the champion-centred sunburst tree from the flat match list. */
export function buildSunburst(s: Snapshot): SunNode {
  const build = (m: Match, depth: number, id: string): SunNode => {
    const decided = winnerId(m);
    const occupant = decided ?? projectedWinner(s, m.id);
    const feeders = feedersOf(s, m.id);
    const children: SunNode[] = feeders.length
      ? feeders.map((f, i) => build(f, depth + 1, `${id}.${i}`))
      : [
          { id: `${id}.0`, matchId: m.id, occupant: m.p1, projected: false, depth: depth + 1, children: [] },
          { id: `${id}.1`, matchId: m.id, occupant: m.p2, projected: false, depth: depth + 1, children: [] },
        ];
    return { id, matchId: m.id, occupant, projected: decided === null, depth, children };
  };
  return build(finalMatch(s), 0, "r");
}

export interface PlayerTime {
  sec: number;
  provisional: boolean;
  matches: number;            // matches with a recorded duration that contributed time
  roundReached: number;       // deepest roundIndex reached (winner → roundIndex+1)
}

/** Whether a match's on-court time should be counted, and whether it's provisional. */
function countsTime(m: Match): { count: boolean; provisional: boolean } {
  if (m.status === "finished" || m.status === "retired") return { count: true, provisional: false };
  if (m.status === "live") return { count: true, provisional: true };
  return { count: false, provisional: false }; // walkover / scheduled / notstarted
}

/** Cumulative time-on-court per player across the tournament. */
export function timeOnCourt(s: Snapshot): Map<string, PlayerTime> {
  const out = new Map<string, PlayerTime>();
  const ensure = (id: string): PlayerTime => {
    let v = out.get(id);
    if (!v) { v = { sec: 0, provisional: false, matches: 0, roundReached: 0 }; out.set(id, v); }
    return v;
  };
  for (const m of Object.values(s.matches)) {
    const { count, provisional } = countsTime(m);
    for (const side of ["p1", "p2"] as const) {
      const pid = m[side];
      if (!pid) continue;
      const v = ensure(pid);
      const reached = m.winner === side ? m.roundIndex + 1 : m.roundIndex;
      if (reached > v.roundReached) v.roundReached = reached;
      if (count && m.durationSec != null) {
        v.sec += m.durationSec;
        v.matches += 1;
        if (provisional) v.provisional = true;
      }
    }
  }
  return out;
}
