import type { Match, MatchStats, MatchStatus, Player, SetScore } from "../src/model";
import { MAX_LOCAL_SEC, MAX_SET_SEC, recoverLocalDurationSec, hasSuspendedPeriod } from "./durations";
import { alpha3Of } from "./sofa-country";

// A live match stops receiving point updates the moment play is paused: SofaScore stamps
// changes.changeTimestamp on every point (its `changes` array literally reads ["homeScore.point"]),
// and actively-played matches refresh within ~10min at the very most. A gap far beyond that means play
// has stopped (rain/bad light/the 11pm curfew). This is the primary live-suspension signal — it works
// for every event (unlike currentPeriodStartTimestamp, absent on ~1/3 of live events) and self-clears
// on resumption (points resume → fresh timestamp → live again), with no set-duration false positive.
const SUSPEND_STALE_SEC = 1_200; // 20 min with no point update ⇒ paused

interface SofaScoreSide { [k: string]: number | undefined }
interface SofaEvent {
  customId?: string; startTimestamp?: number; winnerCode?: number;
  status?: { type?: string; description?: string };
  time?: Record<string, number>;            // per-set periodN + currentPeriodStartTimestamp
  changes?: { changeTimestamp?: number };   // last time SofaScore mutated the event (fresh ⇒ live play)
  venue?: { name?: string; stadium?: { name?: string } }; // the specific court, once assigned
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
  const time = ev.time ?? {};
  let status = mapStatus(ev.status?.type, ev.status?.description) ?? m.status;
  const winner = ev.winnerCode === 1 ? "p1" : ev.winnerCode === 2 ? "p2" : m.winner;

  // Detect a CURRENT stoppage deterministically from the feed, not by guessing from play-time magnitude.
  // A match with a decided winner is never "suspended" even if SofaScore still lags on "inprogress": its
  // feed is stale because play is OVER, not paused. Guarding on !winner mirrors the buildSunburst
  // undecided guard, so a stale post-match feed can't get stickily mislabeled (and badged) as suspended.
  const noUpdateSec = ev.changes?.changeTimestamp != null ? nowSec - ev.changes.changeTimestamp : null;
  const curStart = time.currentPeriodStartTimestamp;
  const currentlySuspended = status === "live" && !winner && (
    // Primary: no point update in SUSPEND_STALE_SEC ⇒ play has stopped (see the constant above).
    noUpdateSec != null ? noUpdateSec > SUSPEND_STALE_SEC
    // Fallback only when the event carries no update timestamp: an implausibly-long-open current set —
    // no single set runs MAX_SET_SEC (3h), so a live set "open" that long is paused.
    : curStart != null ? nowSec - curStart > MAX_SET_SEC
    : false
  );
  if (currentlySuspended) status = "suspended";

  const live = status === "live";
  const finished = status === "finished" || status === "retired";
  // A finished match whose per-set time still carries a suspension-inflated set: recoverLocalDurationSec
  // heals it by ESTIMATING the inflated set from the clean ones, so the recovered duration is not a
  // measured value. Computed once — it is also the finished-branch signal for the sticky wasSuspended flag.
  const suspensionHealed = finished && hasSuspendedPeriod(time);

  let durationSec: number | null = null;
  let provisional = false;
  if (live) {
    // now − startTimestamp is on-court time for a same-day match, but a match resumed after an overnight
    // curfew/rain suspension reports its ORIGINAL (yesterday's) start, so elapsed balloons to many hours
    // of wall-clock that isn't play. Treat anything past the 6h local bound as unknown rather than let
    // suspension wall-clock dominate the live "time on court" leaderboard; the finished pass recovers it.
    const elapsed = ev.startTimestamp ? Math.max(0, nowSec - ev.startTimestamp) : null;
    durationSec = elapsed != null && elapsed <= MAX_LOCAL_SEC ? elapsed : null;
    provisional = durationSec != null;
  } else if (finished) {
    // SofaScore periodN counts rain/curfew suspensions as play time — the ONE set that spanned the
    // stoppage absorbs the whole overnight gap (~16–18h) while the rest stay normal. recoverLocalDurationSec
    // heals that per set (estimating the inflated set from the clean ones) instead of nulling the whole
    // finished match; a genuine >6h epic with no clean anchor still defers to Sackmann's minutes.
    durationSec = recoverLocalDurationSec(time);
    // A healed duration is an ESTIMATE, not measured — flag it provisional so it ranks with a `*` and
    // mints no Marathon/Quick until Sackmann's exact minutes backfill it (applyDurations clears it then).
    provisional = durationSec != null && suspensionHealed;
  }
  // status === "suspended" → durationSec stays null: on-court time is unknown while play is paused.

  // Sticky suspension record: currently paused, OR a finished match whose per-set time still carries the
  // suspension-inflated set. Persistence across refreshes is carryForwardSuspended's job (below) — it ORs
  // any prior-refresh flag onto the freshly-normalized match so it survives once SofaScore drops the
  // finished event back to a plain code-100 with no stoppage marker.
  const wasSuspended = currentlySuspended || suspensionHealed;

  const homeCountry = alpha3Of(ev.homeTeam);
  if (m.p1 && players[m.p1] && homeCountry) players[m.p1].country = homeCountry;
  const awayCountry = alpha3Of(ev.awayTeam);
  if (m.p2 && players[m.p2] && awayCountry) players[m.p2].country = awayCountry;

  // Precise order-of-play tier: the per-event startTimestamp is the published per-match slot (and
  // the freshest value under intra-day reshuffles) — it overrides normalize's coarse cuptrees stamp
  // and flags the time precise. Every other status passes the normalize-set fields through
  // untouched; the next refresh's normalize drops them once the match is no longer upcoming.
  const scheduled = status === "scheduled";
  const scheduledStart = scheduled ? (ev.startTimestamp ?? m.scheduledStart) : m.scheduledStart;
  const scheduledPrecise = scheduled && ev.startTimestamp != null ? true : m.scheduledPrecise;
  // `||` not `??`: a blank venue name ("") should fall through to the stadium name, not stand as an
  // empty court that renders no court at all (formatScheduled drops a falsy court).
  const scheduledCourt = scheduled ? (ev.venue?.name || ev.venue?.stadium?.name) : m.scheduledCourt;

  return {
    ...m, status, winner,
    score: buildScore(ev.homeScore, ev.awayScore),
    durationSec, durationProvisional: provisional, wasSuspended,
    scheduledStart, scheduledPrecise, scheduledCourt,
    sofaCustomId: ev.customId ?? m.sofaCustomId,
    // A suspended match is paused mid-play, so its /statistics payload is as partial as a live match's —
    // suppress it in both in-progress states (a half-played ace/DF line reads as final otherwise).
    stats: live || status === "suspended" ? null : buildStats(stats),
  };
}

/**
 * Persist the sticky `wasSuspended` flag across refreshes by ORing each prior-snapshot match's flag
 * onto the freshly-ingested one (matches are re-derived from cuptrees every refresh, so the flag would
 * otherwise reset). This is what makes suspension detection deterministic rather than a per-refresh
 * guess: once we saw a match paused (or finished with an inflated set), it STAYS flagged even after
 * SofaScore reverts the finished event to a plain code-100 with no stoppage marker. Mirrors
 * carryForwardCountries. `prior` is the previous snapshot's matches map (null on first run). Returns
 * how many matches gained the flag from the prior snapshot.
 */
export function carryForwardSuspended(
  matches: Record<string, Match>,
  prior: Record<string, Match> | null,
): number {
  if (!prior) return 0;
  let carried = 0;
  for (const [id, m] of Object.entries(matches)) {
    if (!m.wasSuspended && prior[id]?.wasSuspended) { m.wasSuspended = true; carried++; }
  }
  return carried;
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
