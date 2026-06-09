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

const surfaceKey = (surface: string): "hard" | "clay" | "grass" => {
  const s = surface.toLowerCase();
  if (s.includes("clay")) return "clay";
  if (s.includes("grass")) return "grass";
  return "hard";
};

/** A player's ELO for the slam surface, falling back to overall, then null. */
export function surfaceElo(p: Player, surface: string): number | null {
  if (!p.elo) return null;
  return p.elo[surfaceKey(surface)] ?? p.elo.overall ?? null;
}

/** ELO win-probability of A over B (standard logistic, base 10 / 400). */
export function winProbability(eloA: number, eloB: number): number {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
}

/**
 * The projected winner of a matchup: higher surface-ELO wins; falls back to
 * lower ranking, then lower seed, then A. Used for unplayed (TBD) matches.
 */
export function projectFavorite(
  players: Record<string, Player>, a: string | null, b: string | null, surface: string,
): string | null {
  if (!a) return b;
  if (!b) return a;
  const pa = players[a], pb = players[b];
  if (!pa) return pb ? b : null;
  if (!pb) return a;
  const ea = surfaceElo(pa, surface), eb = surfaceElo(pb, surface);
  if (ea != null && eb != null && ea !== eb) return ea > eb ? a : b;
  const ra = pa.ranking ?? Infinity, rb = pb.ranking ?? Infinity;
  if (ra !== rb) return ra < rb ? a : b;
  const sa = pa.seed ?? Infinity, sb = pb.seed ?? Infinity;
  if (sa !== sb) return sa < sb ? a : b;
  return a;
}

/** Projected winner of a match: decided result if any, else the projected favourite (by surface ELO). */
export function projectedWinner(s: Snapshot, matchId: string): string | null {
  const m = s.matches[matchId];
  const decided = winnerId(m);
  if (decided) return decided;
  const feeders = feedersOf(s, matchId);
  const a = feeders[0] ? projectedWinner(s, feeders[0].id) : m.p1;
  const b = feeders[1] ? projectedWinner(s, feeders[1].id) : m.p2;
  return projectFavorite(s.players, a, b, s.tournament.surface);
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

/**
 * The set of node ids that should carry their occupant's single label: a node is an
 * anchor when its occupant is decided here and did not also win the next round —
 * i.e. the parent is the root, is projected, or is won by someone else. This labels
 * each player exactly once, on the furthest ring they actually reached.
 */
export function labelAnchors(root: SunNode): Set<string> {
  const out = new Set<string>();
  const walk = (n: SunNode, parent: SunNode | null) => {
    if (!n.projected && n.occupant && (!parent || parent.projected || parent.occupant !== n.occupant)) {
      out.add(n.id);
    }
    for (const c of n.children) walk(c, n);
  };
  walk(root, null);
  return out;
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

export interface LeaderRow {
  playerId: string;
  name: string;
  country: string;
  sec: number;
  provisional: boolean;
  roundReached: number;
}

/** Players who lost a decided (finished/retired/walkover) match. */
export function eliminatedSet(s: Snapshot): Set<string> {
  const out = new Set<string>();
  for (const m of Object.values(s.matches)) {
    if (m.winner == null) continue;
    const loser = m.winner === "p1" ? m.p2 : m.p1;
    if (loser) out.add(loser);
  }
  return out;
}

export interface Upset {
  winnerId: string; winnerName: string; loserId: string; loserName: string;
  loserSeed: number | null; roundName: string; eloGap: number; // loser elo − winner elo (>0)
}

export interface SeedInsights { seedsTotal: number; seedsRemaining: number; upsets: Upset[]; }

/** Seeds still alive + biggest upsets (winner was the surface-ELO underdog), strongest first. */
export function seedInsights(s: Snapshot, limit = 8): SeedInsights {
  const out = eliminatedSet(s);
  const seeded = Object.values(s.players).filter((p) => p.seed != null);
  const surface = s.tournament.surface;
  const upsets: Upset[] = [];
  for (const m of Object.values(s.matches)) {
    if (m.winner == null) continue;
    const winId = m.winner === "p1" ? m.p1 : m.p2;
    const loseId = m.winner === "p1" ? m.p2 : m.p1;
    if (!winId || !loseId) continue;
    const w = s.players[winId], l = s.players[loseId];
    if (!w || !l) continue;
    const ew = surfaceElo(w, surface), el = surfaceElo(l, surface);
    if (ew == null || el == null || el <= ew) continue; // upset only when winner was the ELO underdog
    upsets.push({
      winnerId: winId, winnerName: w.name, loserId: loseId, loserName: l.name,
      loserSeed: l.seed, roundName: s.rounds[m.roundIndex]?.name ?? "", eloGap: el - ew,
    });
  }
  upsets.sort((a, b) => b.eloGap - a.eloGap);
  return {
    seedsTotal: seeded.length,
    seedsRemaining: seeded.filter((p) => !out.has(p.id)).length,
    upsets: upsets.slice(0, limit),
  };
}

/** Players ranked by cumulative time on court (descending), zero-time excluded. */
export function timeLeaderboard(s: Snapshot, time: Map<string, PlayerTime>, limit = 10): LeaderRow[] {
  return [...time.entries()]
    .filter(([, v]) => v.sec > 0)
    .map(([id, v]) => {
      const p = s.players[id];
      return {
        playerId: id,
        name: p?.name ?? id,
        country: p?.country ?? "",
        sec: v.sec,
        provisional: v.provisional,
        roundReached: v.roundReached,
      };
    })
    .sort((a, b) => b.sec - a.sec)
    .slice(0, limit);
}
