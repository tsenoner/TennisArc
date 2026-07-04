import type { EntryType, Match, MatchStatus, Player, Round, Snapshot, Tour } from "../src/model";
import { PLACEHOLDER_TEAM_NAME, isUpcoming } from "../src/model";

export interface TournamentMeta {
  tour: Tour; slam: string; name: string; year: number; surface: string;
  sofaUniqueTournamentId: number; sofaSeasonId: number; drawSize: number;
}

interface SofaParticipant {
  order: number; winner: boolean; teamSeed?: string;
  team: { id: number; name: string; slug: string; ranking?: number; nameCode?: string };
}
interface SofaBlock {
  finished: boolean; eventInProgress: boolean; order: number;
  participants: SofaParticipant[]; events?: number[];
  seriesStartDateTimestamp?: number;  // per-block scheduled start; a shared nominal round-day time on future rounds
}
export interface SofaCuptrees { cupTrees: { rounds: { description: string; blocks: SofaBlock[] }[] }[] }

const ENTRY_TYPES = new Set(["Q", "WC", "LL", "PR"]);

function parseSeed(teamSeed?: string): { seed: number | null; entry: EntryType } {
  if (!teamSeed) return { seed: null, entry: null };
  if (/^\d+$/.test(teamSeed)) return { seed: Number(teamSeed), entry: null };
  return { seed: null, entry: ENTRY_TYPES.has(teamSeed) ? (teamSeed as EntryType) : null };
}

function blockStatus(b: SofaBlock, anyPresent: boolean): MatchStatus {
  if (b.eventInProgress) return "live";
  if (b.finished) return "finished";
  return anyPresent ? "scheduled" : "notstarted";
}

/** A participant is real unless its team is a SofaScore future-slot placeholder (name like
 *  "R64P3"/"Qf1"). Placeholders are treated as absent so they never become Players or occupy a
 *  match side — leaving the slot as a TBD null exactly like an unprovided participant. */
function realParticipant(p: SofaParticipant | undefined): SofaParticipant | undefined {
  return p && !PLACEHOLDER_TEAM_NAME.test(p.team.name) ? p : undefined;
}

/** Whether a block's `order`-th side (1 = home, 2 = away) is resolved to a real player. */
function realSide(b: SofaBlock, order: number): boolean {
  return !!realParticipant(b.participants.find((p) => p.order === order));
}

/**
 * The SofaScore event ids whose per-event detail is worth fetching: every finished or in-progress
 * match, PLUS every scheduled match whose BOTH sides are already real players — an imminent match
 * whose per-event detail we still want (court, the freshest order-of-play time, live score/stats)
 * — the coarse time for every round now comes from the blocks' seriesStartDateTimestamp. A
 * scheduled block still fed by a "winner-of" placeholder (name like "R32P17") is a far-future slot
 * that only carries a nominal round-day placeholder time, so its event is skipped to avoid a
 * pointless network round-trip.
 */
export function collectEventIds(cup: SofaCuptrees): number[] {
  const ids: number[] = [];
  for (const tree of cup?.cupTrees ?? [])
    for (const round of tree.rounds ?? [])
      for (const b of round.blocks ?? []) {
        if (!Array.isArray(b.events) || b.events.length === 0) continue;
        const played = b.finished || b.eventInProgress;
        const scheduledReal = !played && realSide(b, 1) && realSide(b, 2);
        if (played || scheduledReal) ids.push(...b.events);
      }
  return [...new Set(ids)];
}

/** Convert a SofaScore cuptrees payload into our base Snapshot (no per-event detail yet). */
export function normalizeCuptrees(cup: SofaCuptrees, meta: TournamentMeta): Snapshot {
  const rounds = cup.cupTrees[0]?.rounds ?? [];
  const lastRound = rounds.length - 1;
  const players: Record<string, Player> = {};
  const matches: Record<string, Match> = {};
  const roundList: Round[] = [];

  const realSides = (m: Match): number => (m.p1 ? 1 : 0) + (m.p2 ? 1 : 0);

  rounds.forEach((round, roundIndex) => {
    const matchIds: string[] = [];
    for (const b of round.blocks) {
      const slot = b.order - 1;
      const id = `${roundIndex}-${slot}`;
      const home = realParticipant(b.participants.find((p) => p.order === 1));
      const away = realParticipant(b.participants.find((p) => p.order === 2));

      for (const p of [home, away]) {
        if (!p) continue;
        const pid = String(p.team.id);
        if (!players[pid]) {
          const { seed, entry } = parseSeed(p.teamSeed);
          players[pid] = {
            id: pid, name: p.team.name, country: "", seed, entry,
            ranking: p.team.ranking ?? null, ageYears: null, sofaSlug: p.team.slug ?? null,
            elo: null, birthdate: null,
          };
        }
      }

      const winner = home?.winner ? "p1" : away?.winner ? "p2" : null;
      const status = blockStatus(b, !!home || !!away);
      const match: Match = {
        id, roundIndex, slot,
        nextMatchId: roundIndex < lastRound ? `${roundIndex + 1}-${Math.floor(slot / 2)}` : null,
        p1: home ? String(home.team.id) : null,
        p2: away ? String(away.team.id) : null,
        status, winner,
        // Coarse order-of-play tier: cuptrees carries seriesStartDateTimestamp on EVERY block, every
        // round — a real per-match time once the order of play is out, a shared nominal round-day time
        // on future placeholder rounds. Stamped only while unplayed; enrichMatch upgrades the imminent
        // matches to the precise per-event time (scheduledPrecise).
        scheduledStart: isUpcoming(status) ? b.seriesStartDateTimestamp : undefined,
        score: null, live: null, durationSec: null, durationProvisional: false,
        sofaEventId: b.events?.[0] ?? null, sofaCustomId: null, stats: null,
      };
      // A malformed payload can emit several blocks for one slot (the 2023 Australian Open snapshot
      // tripled 10 first-round slots, the extras carrying placeholder teams). Keep one entry per
      // slot, preferring the richest block so a real match is never clobbered by a placeholder one.
      const existing = matches[id];
      if (!existing) matchIds.push(id);
      if (!existing || realSides(match) > realSides(existing)) matches[id] = match;
    }
    matchIds.sort((a, b) => Number(a.split("-")[1]) - Number(b.split("-")[1]));
    roundList.push({ index: roundIndex, name: round.description, size: matchIds.length * 2, matchIds });
  });

  return {
    schemaVersion: 2, generatedAt: "", tour: meta.tour,
    tournament: {
      slam: meta.slam, name: meta.name, year: meta.year, surface: meta.surface,
      sofaUniqueTournamentId: meta.sofaUniqueTournamentId, sofaSeasonId: meta.sofaSeasonId, drawSize: meta.drawSize,
    },
    players, matches, rounds: roundList,
  };
}
