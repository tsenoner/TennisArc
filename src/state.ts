import type { Match, MatchStatus, Player, Round, SetScore, Snapshot } from "./model";
import { isPlaceholderPlayer, isInProgress } from "./model";

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
  live: boolean;              // this node's match is in progress (provisional time accruing, no winner yet)
  suspended: boolean;         // this node's match is paused mid-play (rain/bad light/curfew)
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
          { id: `${id}.0`, matchId: m.id, occupant: m.p1, projected: false, live: false, suspended: false, depth: depth + 1, children: [] },
          { id: `${id}.1`, matchId: m.id, occupant: m.p2, projected: false, live: false, suspended: false, depth: depth + 1, children: [] },
        ];
    // `live` requires no decided result yet (SunNode.live = "in progress, no winner"). A data-lag
    // match — winner already set while status still reads "live" — must NOT be both decided and
    // live, or render would draw it named + heat-filled AND hatched/breathing (and possibly .out).
    // `suspended` mirrors `live` but for a paused match (its own arc treatment, no breathing hatch).
    const undecided = decided === null;
    return {
      id, matchId: m.id, occupant, projected: undecided,
      live: undecided && m.status === "live", suspended: undecided && m.status === "suspended",
      depth, children,
    };
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

/** Short round label from a player's furthest-reached round index. */
export function roundAbbrev(reached: number, rounds: Round[]): string {
  if (reached >= rounds.length) return "Champion";
  const name = rounds[reached]?.name ?? `R${reached}`;
  return name
    .replace(/^Round of\s*/i, "R")
    .replace(/^Quarterfinal.*/i, "QF")
    .replace(/^Semifinal.*/i, "SF")
    .replace(/^Final$/i, "F");
}

export interface QuarterOwner {
  nodeId: string;            // the quarter's node id: r.0.0 (TR), r.0.1 (BR), r.1.0 (BL), r.1.1 (TL)
  playerId: string | null;   // drawn top seed; null = every slot in the quarter is still TBD
  seed: number | null;       // the owner's seed (null when the quarter holds no seeds at all)
  out: boolean;              // owner already eliminated — they KEEP the quarter, the label just dims
}

// Memoized per root tree: within one draw, the corner labels (draw()) and every depth-2
// crumb (sectionTitle) ask for the same owners — and the same `tree` object is shared across
// those calls, so a WeakMap keyed by root collapses them to one walk. A fresh draw builds a
// fresh tree (new key), so stale results never leak; old trees are GC'd with the entry.
const quarterOwnersMemo = new WeakMap<SunNode, QuarterOwner[] | null>();

/**
 * The "owner" of each quarter, draw-sheet style: the DRAWN top seed — minimum non-null
 * seed across the quarter's leaf entrants, ties broken by better ranking — falling back
 * to the best-ranked entrant when the quarter has no seeds, and to nobody when every
 * slot is TBD. The owner survives elimination ("Sinner's quarter" outlives Sinner's
 * exit; `out` flags it so the label can dim). Null when the draw has no quarter
 * structure: fewer than 3 rounds, or the depth-2 layer isn't exactly 4 nodes.
 */
export function quarterOwners(s: Snapshot, root: SunNode): QuarterOwner[] | null {
  const cached = quarterOwnersMemo.get(root);
  if (cached !== undefined) return cached;
  const result = computeQuarterOwners(s, root);
  quarterOwnersMemo.set(root, result);
  return result;
}

function computeQuarterOwners(s: Snapshot, root: SunNode): QuarterOwner[] | null {
  if (s.rounds.length < 3) return null;
  const quarters = root.children.flatMap((c) => c.children);
  if (quarters.length !== 4) return null;
  const out = eliminatedSet(s);
  return quarters.map((q) => {
    // Leaves carry the round-0 entrants directly (buildSunburst), so eliminated players
    // are still enumerated and a null occupant is a TBD slot, never a lost one.
    const entrants: Player[] = [];
    const walk = (n: SunNode): void => {
      if (n.children.length) { n.children.forEach(walk); return; }
      const p = n.occupant ? s.players[n.occupant] : undefined;
      if (p) entrants.push(p);
    };
    walk(q);
    let owner: Player | null = null;
    for (const p of entrants) {
      if (!owner) { owner = p; continue; }
      const sp = p.seed ?? Infinity, so = owner.seed ?? Infinity;
      if (sp < so || (sp === so && (p.ranking ?? Infinity) < (owner.ranking ?? Infinity))) owner = p;
    }
    return {
      nodeId: q.id,
      playerId: owner?.id ?? null,
      seed: owner?.seed ?? null,
      out: owner != null && out.has(owner.id),
    };
  });
}

/**
 * Human name for a focusable section of the draw, in draw-sheet language: depth 1 is the
 * sheet's "Top half"/"Bottom half" (r.0 / r.1), a quarter is named for its drawn-top-seed
 * owner ("Sinner's quarter" — see quarterOwners; the name survives the owner's exit), and
 * anything else falls back to its own round ("QF section"). Unknown ids → "".
 */
export function sectionTitle(s: Snapshot, root: SunNode, id: string): string {
  if (id === root.id) return "Full draw";
  const segs = id.split(".");
  if (segs[0] !== root.id) return "";
  let node: SunNode | undefined = root;
  for (const seg of segs.slice(1)) node = node?.children[Number(seg)];
  if (!node) return "";
  if (node.depth === 1) return node.id === `${root.id}.0` ? "Top half" : "Bottom half";
  const last = node.occupant ? (s.players[node.occupant]?.name ?? "").split(" ").slice(-1)[0] : "";
  if (!node.children.length) return last;             // a single slot (hand-crafted id): just the player
  if (node.depth === 2) {
    // a quarter belongs to its drawn top seed, NOT whoever currently leads it; an
    // owner-less (all-TBD) quarter falls through to the round fallback below
    const nid = node.id;
    const q = quarterOwners(s, root)?.find((o) => o.nodeId === nid);
    const p = q?.playerId ? s.players[q.playerId] : undefined;
    if (p) return `${p.name.split(" ").slice(-1)[0]}'s quarter`;
  }
  const ri = s.rounds.length - 1 - node.depth;        // the node's own match round
  return ri >= 0 ? `${roundAbbrev(ri, s.rounds)} section` : last;
}

export interface PlayerTime {
  sec: number;
  provisional: boolean;
  matches: number;            // matches with a recorded duration that contributed time
  roundReached: number;       // deepest roundIndex reached (winner → roundIndex+1)
  complete: boolean;          // every counted match had a duration — totals are comparable
}

/** Whether a match's on-court time should be counted, and whether it's provisional. */
export function countsTime(m: Match): { count: boolean; provisional: boolean } {
  // A finished match's time is measured — UNLESS its duration is a locally-healed suspension estimate
  // (durationProvisional), which ranks with a `*` until Sackmann's exact minutes backfill it.
  if (m.status === "finished" || m.status === "retired") return { count: true, provisional: m.durationProvisional };
  if (isInProgress(m.status)) return { count: true, provisional: true };
  return { count: false, provisional: false }; // walkover / scheduled / notstarted
}

/** Cumulative time-on-court per player across the tournament. */
export function timeOnCourt(s: Snapshot): Map<string, PlayerTime> {
  const out = new Map<string, PlayerTime>();
  const ensure = (id: string): PlayerTime => {
    let v = out.get(id);
    if (!v) { v = { sec: 0, provisional: false, matches: 0, roundReached: 0, complete: true }; out.set(id, v); }
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
      } else if (count && provisional) {
        // An in-progress (live/suspended) match whose current on-court time is still unknown — resumed
        // after an overnight suspension, or paused mid-play. Its time simply isn't counted yet, so flag
        // the running total provisional (the `*`) rather than dropping the player off the board — and
        // with them the prior rounds they HAVE completed — for the whole time the match hangs.
        v.provisional = true;
      } else if (count) {
        v.complete = false; // a FINISHED match with unknown duration — the total genuinely undercounts
      }
    }
  }
  return out;
}

export interface CumulativeTime {
  /** Cumulative on-court seconds a player had accrued *through* the given round index (inclusive). */
  through(playerId: string, round: number): number;
  max: number; // largest end-of-tournament total, for the colour domain
}

/**
 * Running cumulative on-court time per player, by round — for the Time lens, where each ring shows
 * the time a player had spent *so far* by the time they reached that round (R128 arc = their first
 * match; deeper arcs add each subsequent match), rather than one flat per-player total.
 */
export function cumulativeOnCourt(s: Snapshot): CumulativeTime {
  const numRounds = s.rounds.length;
  const prefix = new Map<string, number[]>(); // playerId → per-round seconds (later prefix-summed)
  const ensure = (pid: string): number[] => {
    let a = prefix.get(pid);
    if (!a) { a = new Array(Math.max(1, numRounds)).fill(0); prefix.set(pid, a); }
    return a;
  };
  for (const m of Object.values(s.matches)) {
    const { count } = countsTime(m);
    if (!count || m.durationSec == null) continue;
    if (m.roundIndex < 0 || m.roundIndex >= numRounds) continue;
    for (const side of ["p1", "p2"] as const) {
      const pid = m[side];
      if (pid) ensure(pid)[m.roundIndex] += m.durationSec; // ≤ 1 match per player per round
    }
  }
  let max = 1;
  for (const arr of prefix.values()) {
    for (let r = 1; r < arr.length; r++) arr[r] += arr[r - 1]; // in-place prefix sum
    if (arr[arr.length - 1] > max) max = arr[arr.length - 1];
  }
  return {
    through: (pid, round) => {
      const arr = prefix.get(pid);
      if (!arr || !arr.length) return 0;
      return arr[Math.max(0, Math.min(round, arr.length - 1))];
    },
    max,
  };
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

export type SeedSort = "seed" | "elo";

export interface SeedRow {
  rank: number;           // the badge number: seed# (seed sort) or ELO position 1..32 (elo sort)
  seed: number | null;    // tournament seed (null = unseeded; only reachable under the elo sort)
  playerId: string; name: string; country: string;
  elo: number | null;     // surface ELO for the slam surface
  roundReached: number;   // deepest round index reached (winner → roundIndex + 1)
  alive: boolean;         // still in the draw
  upset: boolean;         // went out to a lower surface-ELO opponent
}
export interface SeedProgress { mode: SeedSort; total: number; remaining: number; rows: SeedRow[]; }

/** Players ranked by surface ELO, strongest first → pid → 1-based rank. Only players with an ELO. */
export function eloRank(s: Snapshot): Map<string, number> {
  const surface = s.tournament.surface;
  const ranked = Object.values(s.players)
    .map((p) => ({ id: p.id, e: surfaceElo(p, surface) }))
    .filter((x): x is { id: string; e: number } => x.e != null)
    .sort((a, b) => b.e - a.e || a.id.localeCompare(b.id)); // id tie-break → deterministic across snapshots
  return new Map(ranked.map((x, i) => [x.id, i + 1]));
}

/**
 * The draw's strongest 32 and how far each got — by tournament seed, or by surface ELO.
 * "seed" sort lists the seeds in seed order; "elo" sort lists the top 32 by surface ELO
 * (which can include unseeded players), strongest first — the same set the wheel lights up.
 * `upset` flags a player beaten by a lower surface-ELO opponent, so the fall is shown
 * without naming the giant-killer.
 */
export function seedProgress(s: Snapshot, sort: SeedSort = "seed"): SeedProgress {
  const out = eliminatedSet(s);
  const surface = s.tournament.surface;
  const reached = new Map<string, number>();
  const upsetLosers = new Set<string>();
  for (const m of Object.values(s.matches)) {
    for (const side of ["p1", "p2"] as const) {
      const pid = m[side];
      if (!pid) continue;
      const r = m.winner === side ? m.roundIndex + 1 : m.roundIndex;
      if (r > (reached.get(pid) ?? -1)) reached.set(pid, r);
    }
    if (m.winner == null) continue;
    const winId = m.winner === "p1" ? m.p1 : m.p2;
    const loseId = m.winner === "p1" ? m.p2 : m.p1;
    const w = winId ? s.players[winId] : null, l = loseId ? s.players[loseId] : null;
    if (!w || !l || !loseId) continue;
    const ew = surfaceElo(w, surface), el = surfaceElo(l, surface);
    if (ew != null && el != null && el > ew) upsetLosers.add(loseId); // loser was the favourite
  }

  let pool: Player[];
  let badge: (p: Player) => number;
  if (sort === "elo") {
    const rank = eloRank(s);
    pool = Object.values(s.players)
      .filter((p) => (rank.get(p.id) ?? Infinity) <= 32)
      .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
    badge = (p) => rank.get(p.id)!;
  } else {
    pool = Object.values(s.players).filter((p) => p.seed != null).sort((a, b) => a.seed! - b.seed!);
    badge = (p) => p.seed!;
  }

  const rows: SeedRow[] = pool.map((p) => ({
    rank: badge(p), seed: p.seed ?? null,
    playerId: p.id, name: p.name, country: p.country, elo: surfaceElo(p, surface),
    roundReached: reached.get(p.id) ?? 0, alive: !out.has(p.id), upset: upsetLosers.has(p.id),
  }));
  return { mode: sort, total: rows.length, remaining: rows.filter((r) => r.alive).length, rows };
}

export interface NationPlayer { id: string; name: string; roundReached: number; alive: boolean; }
export interface NationRow { country: string; entrants: number; stillIn: number; players: NationPlayer[]; }

/** Per-country breakdown: entrants, players still in, and each player's furthest round. */
export function countryBreakdown(s: Snapshot): NationRow[] {
  const out = eliminatedSet(s);
  const reached = new Map<string, number>();
  // SofaScore seeds the players map with synthetic future-slot "teams" (R16P1, Qf1, …) for the
  // still-undecided later-round slots; they aren't real people. Drop those outright. A real draw
  // entrant always leaves a fingerprint — a first-round (round-0) slot, or a country / seed /
  // ranking — even when the source data drops their first-round block (older snapshots can list a
  // real player only from round 1 on, e.g. Federer at 2014 Roland Garros); keep anyone with such a
  // fingerprint. Together this avoids a phantom "—" nation for the unresolved bracket while never
  // dropping a real entrant, including placeholders that a malformed payload embedded into a
  // round-0 slot (e.g. the R64Pn teams in the 2023 Australian Open snapshot).
  const firstRound = new Set<string>();
  for (const m of Object.values(s.matches)) {
    if (m.roundIndex === 0) { if (m.p1) firstRound.add(m.p1); if (m.p2) firstRound.add(m.p2); }
    for (const side of ["p1", "p2"] as const) {
      const pid = m[side];
      if (!pid) continue;
      const r = m.winner === side ? m.roundIndex + 1 : m.roundIndex;
      if (r > (reached.get(pid) ?? -1)) reached.set(pid, r);
    }
  }
  const isEntrant = (p: Player) =>
    !isPlaceholderPlayer(p) && (firstRound.has(p.id) || !!p.country || p.seed != null || p.ranking != null);
  const byCountry = new Map<string, NationRow>();
  for (const p of Object.values(s.players)) {
    if (!isEntrant(p)) continue; // skip synthetic future-slot placeholders (not draw entrants)
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

/** Players ranked by cumulative time on court (descending); zero-time and partially-covered
 *  players excluded — an undercounted total ranked among complete ones is a lie, not a stat. */
export function timeLeaderboard(s: Snapshot, time: Map<string, PlayerTime>, limit = 10): LeaderRow[] {
  return [...time.entries()]
    .filter(([, v]) => v.sec > 0 && v.complete)
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

export interface ScheduledInfo { start: number; court: string | null; precise: boolean; }

// Two-tier order-of-play display. PRECISE = the per-event startTimestamp override (scheduledPrecise,
// set at ingest) within a ~36h backstop — only that tier shows a clock time; an event-sourced stamp
// for a round 2+ days out can itself still be a nominal placeholder. Everything else upcoming is
// COARSE: a date-only nominal round-day stamp. Hide rules differ: a precise slot >6h past is stale
// (the match surely started); a coarse slot survives until its UTC calendar day — the venue day —
// is fully over, so a rain-slipped round keeps its date while the feed catches up.
const SCHED_PRECISE_AHEAD_SEC = 36 * 3600;
const SCHED_STALE_BEHIND_SEC = 6 * 3600;

/** The order-of-play info to display for a not-yet-played match, or null when there is nothing
 *  trustworthy to show. `nowSec` is the WALL-CLOCK reference (Unix seconds) — never derive it from
 *  the snapshot's generatedAt, which can lag hours when the refresh wedges. */
export function scheduledInfo(m: Match, nowSec: number): ScheduledInfo | null {
  const upcoming = m.status === "scheduled" || m.status === "notstarted"; // allowlist: walkover/retired never leak a time
  if (!upcoming || m.scheduledStart == null) return null;
  const dt = m.scheduledStart - nowSec;
  const precise = m.scheduledPrecise === true && dt <= SCHED_PRECISE_AHEAD_SEC;
  if (precise) {
    if (dt < -SCHED_STALE_BEHIND_SEC) return null;
  } else if (nowSec >= (Math.floor(m.scheduledStart / 86400) + 1) * 86400) {
    return null; // coarse: its UTC day is over
  }
  return { start: m.scheduledStart, court: m.scheduledCourt ?? null, precise };
}

export interface InsightSide {
  id: string | null; name: string; country: string;
  seed: number | null; ranking: number | null;
  elo: number | null; roundReached: number; sec: number;
  age: number | null; birthday: string; birthdayNear: boolean;
}

export interface MatchInsight {
  matchId: string; roundName: string; surface: string;
  status: MatchStatus; winner: "p1" | "p2" | null;
  score: SetScore[] | null; durationSec: number | null; durationProvisional: boolean;
  p1: InsightSide; p2: InsightSide;
  badges: string[]; upset: boolean; eloLine: string;
  aces: [number, number] | null; doubleFaults: [number, number] | null;
  scheduled: ScheduledInfo | null;
}

function insightSide(s: Snapshot, pid: string | null, surface: string, time: Map<string, PlayerTime>, ref: string): InsightSide {
  const p = pid ? s.players[pid] : null;
  const t = pid ? time.get(pid) : undefined;
  return {
    id: pid, name: p?.name ?? "TBD", country: p?.country ?? "",
    seed: p?.seed ?? null, ranking: p?.ranking ?? null,
    elo: p ? surfaceElo(p, surface) : null,
    roundReached: t?.roundReached ?? 0, sec: t?.sec ?? 0,
    age: p ? ageOn(p.birthdate, ref) : null,
    birthday: p ? formatBirthday(p.birthdate) : "",
    birthdayNear: p ? birthdayInWindow(p.birthdate, ref) : false,
  };
}

/** Derive a rich, narrative match insight (badges, ELO context, per-player path) for one match. */
export function matchInsight(
  s: Snapshot, matchId: string, time: Map<string, PlayerTime>,
  nowSec: number = Math.floor(Date.now() / 1000),
): MatchInsight | null {
  const m = s.matches[matchId];
  if (!m) return null;
  const surface = s.tournament.surface;
  const ref = s.generatedAt ?? new Date().toISOString(); // ages/birthdays reference only — never gates scheduled display
  const p1 = insightSide(s, m.p1, surface, time, ref);
  const p2 = insightSide(s, m.p2, surface, time, ref);
  const badges: string[] = [];
  let upset = false;
  let eloLine = "";

  if (p1.elo != null && p2.elo != null) {
    const favSide = p1.elo >= p2.elo ? "p1" : "p2";
    const fav = favSide === "p1" ? p1 : p2;
    const oth = favSide === "p1" ? p2 : p1;
    const pct = Math.round(winProbability(fav.elo!, oth.elo!) * 100);
    const diff = Math.round(fav.elo! - oth.elo!);
    eloLine = `${surface}-ELO favoured ${fav.name} ${pct}% (+${diff})`;
    if (m.winner && m.winner !== favSide) { upset = true; badges.push("Upset"); }
  }
  if (m.winner && m.score && m.score.length) {
    const won = (set: SetScore) => (m.winner === "p1" ? set.p1 > set.p2 : set.p2 > set.p1);
    if (!won(m.score[0])) badges.push("From a set down");
    if (m.score.every(won)) badges.push("Straight sets");
    const tb = m.score.filter((set) => set.tb != null).length;
    if (tb) badges.push(`${tb} tiebreak${tb > 1 ? "s" : ""}`);
  }
  // Marathon/Quick describe a measured final duration — skip them while the value is provisional (a live
  // elapsed, or a suspension-healed estimate), so an estimate can't mint "Marathon" until it's confirmed.
  if (m.durationSec != null && !m.durationProvisional) {
    if (m.durationSec >= 10800) badges.push("Marathon");
    else if (m.status === "finished" && m.durationSec < 5400) badges.push("Quick");
  }
  // A completed match that spanned a stoppage: surface the persisted flag so its duration (a per-set
  // estimate until Sackmann's minutes land) reads in context rather than as a bare number.
  if (m.wasSuspended && (m.status === "finished" || m.status === "retired")) badges.push("Suspended");

  return {
    matchId, roundName: s.rounds[m.roundIndex]?.name ?? "", surface,
    status: m.status, winner: m.winner, score: m.score,
    durationSec: m.durationSec, durationProvisional: m.durationProvisional,
    p1, p2, badges, upset, eloLine,
    aces: m.stats?.aces ?? null, doubleFaults: m.stats?.doubleFaults ?? null,
    scheduled: scheduledInfo(m, nowSec),
  };
}
