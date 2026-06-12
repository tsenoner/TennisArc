import type { Match, MatchStats, MatchStatus, Player, SetScore } from "../src/model";

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
    // Suspended matches carry wall-clock spans in periodN (a rain delay "lasts" 18h+);
    // no genuine slam match in the covered era exceeds 6h, so past that the value is garbage.
    durationSec = periods > 0 && periods <= 21_600 ? periods : null;
  }

  if (m.p1 && players[m.p1] && ev.homeTeam?.country?.alpha3) players[m.p1].country = ev.homeTeam.country.alpha3;
  if (m.p2 && players[m.p2] && ev.awayTeam?.country?.alpha3) players[m.p2].country = ev.awayTeam.country.alpha3;

  const winner = ev.winnerCode === 1 ? "p1" : ev.winnerCode === 2 ? "p2" : m.winner;

  return {
    ...m, status, winner,
    score: buildScore(ev.homeScore, ev.awayScore),
    durationSec, durationProvisional: provisional,
    sofaCustomId: ev.customId ?? m.sofaCustomId,
    stats: live ? null : buildStats(stats),
  };
}
