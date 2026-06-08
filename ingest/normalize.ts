import type { EntryType, Match, MatchStatus, Player, Round, Snapshot, Tour } from "../src/model";

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
}
interface SofaCuptrees { cupTrees: { rounds: { description: string; blocks: SofaBlock[] }[] }[] }

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

/** Convert a SofaScore cuptrees payload into our base Snapshot (no per-event detail yet). */
export function normalizeCuptrees(cup: SofaCuptrees, meta: TournamentMeta): Snapshot {
  const rounds = cup.cupTrees[0]?.rounds ?? [];
  const lastRound = rounds.length - 1;
  const players: Record<string, Player> = {};
  const matches: Record<string, Match> = {};
  const roundList: Round[] = [];

  rounds.forEach((round, roundIndex) => {
    const matchIds: string[] = [];
    for (const b of round.blocks) {
      const slot = b.order - 1;
      const id = `${roundIndex}-${slot}`;
      const home = b.participants.find((p) => p.order === 1);
      const away = b.participants.find((p) => p.order === 2);

      for (const p of [home, away]) {
        if (!p) continue;
        const pid = String(p.team.id);
        if (!players[pid]) {
          const { seed, entry } = parseSeed(p.teamSeed);
          players[pid] = {
            id: pid, name: p.team.name, country: "", seed, entry,
            ranking: p.team.ranking ?? null, ageYears: null, sofaSlug: p.team.slug ?? null,
          };
        }
      }

      const winner = home?.winner ? "p1" : away?.winner ? "p2" : null;
      matches[id] = {
        id, roundIndex, slot,
        nextMatchId: roundIndex < lastRound ? `${roundIndex + 1}-${Math.floor(slot / 2)}` : null,
        p1: home ? String(home.team.id) : null,
        p2: away ? String(away.team.id) : null,
        status: blockStatus(b, !!home || !!away),
        winner,
        score: null, live: null, durationSec: null, durationProvisional: false,
        sofaEventId: b.events?.[0] ?? null, sofaCustomId: null, stats: null,
      };
      matchIds.push(id);
    }
    matchIds.sort((a, b) => Number(a.split("-")[1]) - Number(b.split("-")[1]));
    roundList.push({ index: roundIndex, name: round.description, size: round.blocks.length * 2, matchIds });
  });

  return {
    schemaVersion: 1, generatedAt: "", tour: meta.tour,
    tournament: {
      slam: meta.slam, name: meta.name, year: meta.year, surface: meta.surface,
      sofaUniqueTournamentId: meta.sofaUniqueTournamentId, sofaSeasonId: meta.sofaSeasonId, drawSize: meta.drawSize,
    },
    players, matches, rounds: roundList,
  };
}
