import type { Match, MatchStatus, Player, SetScore, Snapshot } from "./model";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Integer age of a player (ISO birthdate) as of an ISO date. */
export function ageOn(birthdate: string | null, onISO: string): number | null {
  if (!birthdate) return null;
  const b = new Date(birthdate + "T00:00:00Z"), on = new Date(onISO);
  if (Number.isNaN(b.getTime()) || Number.isNaN(on.getTime())) return null;
  let age = on.getUTCFullYear() - b.getUTCFullYear();
  const m = on.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && on.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

/** True if the player's birthday falls within `days` before (or on) the reference date — i.e. during the slam. */
export function birthdayInWindow(birthdate: string | null, refISO: string, days = 16): boolean {
  if (!birthdate) return false;
  const b = new Date(birthdate + "T00:00:00Z"), ref = new Date(refISO);
  if (Number.isNaN(b.getTime()) || Number.isNaN(ref.getTime())) return false;
  const bday = Date.UTC(ref.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  const diffDays = (ref.getTime() - bday) / 86400000;
  return diffDays >= 0 && diffDays <= days;
}

/** Short "22 May" label from an ISO birthdate. */
export function formatBirthday(birthdate: string | null): string {
  if (!birthdate) return "";
  const b = new Date(birthdate + "T00:00:00Z");
  if (Number.isNaN(b.getTime())) return "";
  return `${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]}`;
}

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

export interface NationPlayer { id: string; name: string; roundReached: number; alive: boolean; }
export interface NationRow { country: string; entrants: number; stillIn: number; players: NationPlayer[]; }

/** Per-country breakdown: entrants, players still in, and each player's furthest round. */
export function countryBreakdown(s: Snapshot): NationRow[] {
  const out = eliminatedSet(s);
  const reached = new Map<string, number>();
  for (const m of Object.values(s.matches)) {
    for (const side of ["p1", "p2"] as const) {
      const pid = m[side];
      if (!pid) continue;
      const r = m.winner === side ? m.roundIndex + 1 : m.roundIndex;
      if (r > (reached.get(pid) ?? -1)) reached.set(pid, r);
    }
  }
  const byCountry = new Map<string, NationRow>();
  for (const p of Object.values(s.players)) {
    const c = p.country || "—";
    let row = byCountry.get(c);
    if (!row) { row = { country: c, entrants: 0, stillIn: 0, players: [] }; byCountry.set(c, row); }
    const alive = !out.has(p.id);
    row.entrants++;
    if (alive) row.stillIn++;
    row.players.push({ id: p.id, name: p.name, roundReached: reached.get(p.id) ?? 0, alive });
  }
  for (const row of byCountry.values()) row.players.sort((a, b) => b.roundReached - a.roundReached);
  return [...byCountry.values()].sort(
    (a, b) => b.stillIn - a.stillIn || b.entrants - a.entrants || a.country.localeCompare(b.country),
  );
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

export interface InsightSide {
  id: string | null; name: string; country: string;
  seed: number | null; ranking: number | null;
  elo: number | null; roundReached: number; sec: number;
}

export interface MatchInsight {
  matchId: string; roundName: string; surface: string;
  status: MatchStatus; winner: "p1" | "p2" | null;
  score: SetScore[] | null; durationSec: number | null; durationProvisional: boolean;
  p1: InsightSide; p2: InsightSide;
  badges: string[]; upset: boolean; eloLine: string;
  aces: [number, number] | null; doubleFaults: [number, number] | null;
}

function insightSide(s: Snapshot, pid: string | null, surface: string, time: Map<string, PlayerTime>): InsightSide {
  const p = pid ? s.players[pid] : null;
  const t = pid ? time.get(pid) : undefined;
  return {
    id: pid, name: p?.name ?? "TBD", country: p?.country ?? "",
    seed: p?.seed ?? null, ranking: p?.ranking ?? null,
    elo: p ? surfaceElo(p, surface) : null,
    roundReached: t?.roundReached ?? 0, sec: t?.sec ?? 0,
  };
}

/** Derive a rich, narrative match insight (badges, ELO context, per-player path) for one match. */
export function matchInsight(s: Snapshot, matchId: string, time: Map<string, PlayerTime>): MatchInsight | null {
  const m = s.matches[matchId];
  if (!m) return null;
  const surface = s.tournament.surface;
  const p1 = insightSide(s, m.p1, surface, time);
  const p2 = insightSide(s, m.p2, surface, time);
  const badges: string[] = [];
  let upset = false;
  let eloLine = "";

  if (p1.elo != null && p2.elo != null) {
    const favSide = p1.elo >= p2.elo ? "p1" : "p2";
    const fav = favSide === "p1" ? p1 : p2;
    const oth = favSide === "p1" ? p2 : p1;
    eloLine = `${surface}-ELO favoured ${fav.name} ${Math.round(winProbability(fav.elo!, oth.elo!) * 100)}%`;
    if (m.winner && m.winner !== favSide) { upset = true; badges.push("Upset"); }
  }
  if (m.winner && m.score && m.score.length) {
    const won = (set: SetScore) => (m.winner === "p1" ? set.p1 > set.p2 : set.p2 > set.p1);
    if (!won(m.score[0])) badges.push("From a set down");
    if (m.score.every(won)) badges.push("Straight sets");
    const tb = m.score.filter((set) => set.tb != null).length;
    if (tb) badges.push(`${tb} tiebreak${tb > 1 ? "s" : ""}`);
  }
  if (m.durationSec != null) {
    if (m.durationSec >= 10800) badges.push("Marathon");
    else if (m.status === "finished" && m.durationSec < 5400) badges.push("Quick");
  }

  return {
    matchId, roundName: s.rounds[m.roundIndex]?.name ?? "", surface,
    status: m.status, winner: m.winner, score: m.score,
    durationSec: m.durationSec, durationProvisional: m.durationProvisional,
    p1, p2, badges, upset, eloLine,
    aces: m.stats?.aces ?? null, doubleFaults: m.stats?.doubleFaults ?? null,
  };
}
