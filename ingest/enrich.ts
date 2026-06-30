import type { Match, MatchStats, MatchStatus, Player, SetScore } from "../src/model";
import { MAX_LOCAL_SEC } from "./durations";
import { alpha3Of } from "./sofa-country";

interface SofaScoreSide { [k: string]: number | undefined }
interface SofaEvent {
  customId?: string; startTimestamp?: number; winnerCode?: number;
  status?: { type?: string; description?: string };
  time?: Record<string, number>;
  homeTeam?: { country?: { alpha3?: string } };
  awayTeam?: { country?: { alpha3?: string } };
  homeScore?: SofaScoreSide; awayScore?: SofaScoreSide;
}
interface SofaStats {
  statistics?: { period: string; groups: { groupName: string; statisticsItems: StatItem[] }[] }[];
}
interface StatItem { key: string; name: string; home: string; away: string; homeValue?: number; awayValue?: number }

function mapStatus(t?: string, desc?: string): MatchStatus | null {
  if (desc && /retir/i.test(desc)) return "retired";
  if (desc && /walk.?over|w\/o/i.test(desc)) return "walkover";
  if (t === "inprogress") return "live";
  if (t === "finished") return "finished";
  if (t === "notstarted") return "scheduled";
  return null;
}

function buildScore(home?: SofaScoreSide, away?: SofaScoreSide): SetScore[] | null {
  if (!home || !away) return null;
  const sets: SetScore[] = [];
  for (let n = 1; n <= 5; n++) {
    const p1 = home[`period${n}`], p2 = away[`period${n}`];
    if (p1 == null || p2 == null) break;
    const tb = home[`period${n}TieBreak`] ?? away[`period${n}TieBreak`];
    sets.push(tb != null ? { p1, p2, tb } : { p1, p2 });
  }
  return sets.length ? sets : null;
}

function allItems(stats: SofaStats): Map<string, StatItem> {
  const list = stats.statistics ?? [];
  const all = list.find((s) => s.period === "ALL") ?? (list.length === 1 ? list[0] : undefined);
  const m = new Map<string, StatItem>();
  for (const g of all?.groups ?? []) for (const it of g.statisticsItems ?? []) m.set(it.key, it);
  return m;
}

function buildStats(stats: SofaStats | null): MatchStats | null {
  if (!stats) return null;
  const items = allItems(stats);
  const out: MatchStats = {};
  const num = (k: string): [number, number] | undefined => {
    const it = items.get(k);
    return it && it.homeValue != null && it.awayValue != null ? [it.homeValue, it.awayValue] : undefined;
  };
  const aces = num("aces"); if (aces) out.aces = aces;
  const df = num("doubleFaults"); if (df) out.doubleFaults = df;
  const fs = num("firstServe"); if (fs) out.firstServePct = fs;
  const sp = num("firstServePointsWon") ?? num("servicePointsWon"); if (sp) out.servicePointsWonPct = sp;
  const bp = items.get("breakPointsConverted"); if (bp) out.breakPointsConverted = [bp.home, bp.away];
  return Object.keys(out).length ? out : null;
}

/**
 * Merge SofaScore event detail (+ optional stats) into a base match, and write each
 * player's country onto the players map. `nowSec` is used for live-match elapsed time.
 */
export function enrichMatch(
  m: Match, ev: SofaEvent, stats: SofaStats | null, players: Record<string, Player>, nowSec: number,
): Match {
  const status = mapStatus(ev.status?.type, ev.status?.description) ?? m.status;
  const live = status === "live";

  let durationSec: number | null = null;
  let provisional = false;
  if (live) {
    durationSec = ev.startTimestamp ? Math.max(0, nowSec - ev.startTimestamp) : null;
    provisional = durationSec != null;
  } else if (status === "finished" || status === "retired") {
    const periods = Object.entries(ev.time ?? {})
      .filter(([k]) => /^period\d+$/.test(k))
      .reduce((sum, [, v]) => sum + (v ?? 0), 0);
    // SofaScore periodN counts rain/curfew suspensions as play time — a suspended match "lasts" 6h+
    // of wall-clock (observed floor ~21675s; one corrupt event reported 94.8h), indistinguishable by
    // magnitude from a genuine epic. Cap live scrapes at MAX_LOCAL_SEC (6h): conservative against
    // suspension garbage; a genuine >6h match is backfilled from Sackmann's minutes (see durations.ts).
    durationSec = periods > 0 && periods <= MAX_LOCAL_SEC ? periods : null;
  }

  const homeCountry = alpha3Of(ev.homeTeam);
  if (m.p1 && players[m.p1] && homeCountry) players[m.p1].country = homeCountry;
  const awayCountry = alpha3Of(ev.awayTeam);
  if (m.p2 && players[m.p2] && awayCountry) players[m.p2].country = awayCountry;

  const winner = ev.winnerCode === 1 ? "p1" : ev.winnerCode === 2 ? "p2" : m.winner;

  return {
    ...m, status, winner,
    score: buildScore(ev.homeScore, ev.awayScore),
    durationSec, durationProvisional: provisional,
    sofaCustomId: ev.customId ?? m.sofaCustomId,
    stats: live ? null : buildStats(stats),
  };
}

/**
 * Carry already-resolved countries forward from the previous snapshot, before the network backfill,
 * so a still-not-yet-played entrant isn't re-fetched from its team on every refresh. A not-yet-played
 * entrant's country is their (immutable) nationality, so a value resolved on an earlier run is still
 * valid now — this turns the per-refresh team lookups into a one-time cost per entrant. Only fills
 * players still blank after per-match enrichment (so fresh live/finished event detail always wins).
 * Pass `entrantIds` = the NOT-YET-PLAYED entrants: once an entrant plays it drops out of carry-forward
 * and its country is re-resolved fresh (event detail, then a team lookup) instead of being pinned to a
 * possibly-stale cached value, so a country SofaScore later corrects can't persist past that entrant's
 * first match. `prior` is the previous snapshot's players map (null on the first run / unreadable).
 * Returns how many were carried forward.
 */
export function carryForwardCountries(
  players: Record<string, Player>,
  prior: Record<string, Player> | null,
  entrantIds?: Set<string>,
): number {
  if (!prior) return 0;
  let carried = 0;
  for (const p of Object.values(players)) {
    if (p.country || (entrantIds && !entrantIds.has(p.id))) continue;
    const priorCountry = prior[p.id]?.country;
    if (priorCountry) { p.country = priorCountry; carried++; }
  }
  return carried;
}

/**
 * Backfill the country of every player still missing one after per-match enrichment.
 *
 * Country reaches us only via per-event detail (enrichMatch, above), and the ingest fetches
 * event detail solely for finished/live matches. A not-yet-played entrant therefore keeps the
 * default `country: ""` from normalizeCuptrees — and `flagAssetUrl("")` is null, so their arc
 * draws no flag even though we know who they are from the draw. Here we look the country up
 * straight off each such player's SofaScore team, in the same ISO alpha-3 namespace the played
 * players already use (so the Country lens/panel don't fragment one nation into two codes).
 *
 * `lookup` is injected (the network call lives in sofascore.ts) so this stays a pure, testable
 * transform. It's a no-op for complete slams, where every match is finished and thus enriched.
 *
 * `entrantIds`, when given, restricts the backfill to those player ids — pass the real draw
 * entrants (round-0 participants). SofaScore seeds the players map with placeholder "teams" for
 * unresolved future slots ("R16P1", "Qf1", …) that have no country and never render as an arc
 * occupant; without this they'd each cost a pointless team lookup every refresh.
 */
export async function fillMissingCountries(
  players: Record<string, Player>,
  lookup: (teamId: number) => Promise<string | null>,
  entrantIds?: Set<string>,
): Promise<{ filled: number; missing: number }> {
  const missing = Object.values(players).filter(
    (p) => !p.country && (!entrantIds || entrantIds.has(p.id)),
  );
  let filled = 0;
  for (const p of missing) {
    const country = await lookup(Number(p.id));
    if (country) { p.country = country; filled++; }
  }
  return { filled, missing: missing.length };
}
