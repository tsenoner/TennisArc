// Points-earned engine SCAFFOLD (table-independent core). Round-reached extraction + per-year aggregation.
// Tier classification + exact point values are filled from the research workflow; here we use placeholder
// Slam values to VERIFY the mechanics (2023 Wimbledon: champion->W, runner-up->F, etc.).
//   npx tsx ingest/points/round-extraction.ts ATP 2023 "Wimbledon"
import { loadMatches, roundRank, type Match } from "../elo-reverse/lib";
import { isQ } from "./shared";

const tour = (process.argv[2] as "ATP" | "WTA") ?? "ATP";
const year = Number(process.argv[3] ?? 2023);
const filterT = process.argv[4];

const all = loadMatches(tour, year - 1).filter((m) => Math.floor(m.date / 10000) === year);

/** Per (tourneyId, playerId): the round they EXITED (the round of their single knockout loss), or "W" if
 *  they won the title (no main-draw loss), or "Qx" if they never made the main draw. Returns null if no matches. */
interface Entry { tourneyId: string; tourneyName: string; level: string; drawSize: number; date: number; playerId: string; exit: string; isQualifierRun: boolean }
function exitsForTourney(matches: Match[]): Entry[] {
  // group player -> their matches in this tourney
  const byPlayer = new Map<string, { won: Match[]; lost: Match[] }>();
  for (const m of matches) {
    (byPlayer.get(m.winnerId) ?? byPlayer.set(m.winnerId, { won: [], lost: [] }).get(m.winnerId)!).won.push(m);
    (byPlayer.get(m.loserId) ?? byPlayer.set(m.loserId, { won: [], lost: [] }).get(m.loserId)!).lost.push(m);
  }
  const t0 = matches[0];
  const out: Entry[] = [];
  for (const [pid, rec] of byPlayer) {
    const mainLost = rec.lost.filter((m) => !isQ(m.round));
    const mainWon = rec.won.filter((m) => !isQ(m.round));
    const qLost = rec.lost.filter((m) => isQ(m.round));
    let exit: string;
    const isQualifierRun = (mainWon.length > 0 || mainLost.length > 0) && rec.won.some((m) => isQ(m.round));
    if (mainLost.length === 0 && mainWon.length === 0) {
      // only qualifying matches → exited in qualifying (lost the deepest Q they reached)
      if (qLost.length === 0) continue; // qualified but no main match? skip (data oddity)
      exit = qLost.sort((a, b) => roundRank(b.round) - roundRank(a.round))[0].round;
    } else if (mainLost.length === 0) {
      exit = "W"; // won every main-draw match → champion
    } else {
      // exited at deepest main-draw loss
      exit = mainLost.sort((a, b) => roundRank(b.round) - roundRank(a.round))[0].round;
    }
    out.push({ tourneyId: t0.tourneyId, tourneyName: t0.tourneyName, level: t0.level, drawSize: t0.drawSize, date: t0.date, playerId: pid, exit, isQualifierRun });
  }
  return out;
}

function tourneyGroups(ms: Match[]): Map<string, Match[]> {
  const g = new Map<string, Match[]>();
  for (const m of ms) (g.get(m.tourneyId) ?? g.set(m.tourneyId, []).get(m.tourneyId)!).push(m);
  return g;
}

// --- PLACEHOLDER table (Slam 2009-2024) to verify mechanics only ---
const SLAM: Record<string, number> = { W: 2000, F: 1200, SF: 720, QF: 360, R16: 180, R32: 90, R64: 45, R128: 10 };

// --- ROUGH tables/tiers (ATP 2009-2024) to validate END-TO-END totals vs known year-end points. Exact
//     values + tier lists come from the research workflow; this just catches mechanical bugs. ---
type Tbl = Record<string, number>;
const ROUGH: Record<string, Tbl> = {
  slam: { W: 2000, F: 1200, SF: 720, QF: 360, R16: 180, R32: 90, R64: 45, R128: 10 },
  m1000: { W: 1000, F: 600, SF: 360, QF: 180, R16: 90, R32: 45, R64: 10, R128: 10 },
  a500: { W: 500, F: 300, SF: 180, QF: 90, R16: 45, R32: 0, R64: 0, R128: 0 },
  a250: { W: 250, F: 150, SF: 90, QF: 45, R16: 20, R32: 0, R64: 0, R128: 0 },
  finals: { W: 1300, F: 1100, SF: 800, RR: 200, R16: 0, R32: 0, QF: 0, R64: 0, R128: 0 },
  other: {},
};
function roughTier(e: { level: string; drawSize: number }): string {
  if (e.level === "G") return "slam";
  if (e.level === "M") return "m1000";
  if (e.level === "F") return "finals";
  if (e.level === "A") return e.drawSize >= 48 ? "a500" : "a250"; // ROUGH heuristic
  return "other";
}

if (process.argv.includes("--year")) {
  // aggregate per player for the whole year (rough), show top-12 vs intuition
  const tg = tourneyGroups(all);
  const pts = new Map<string, number>(); const nm = new Map<string, string>();
  for (const [, ms] of tg) {
    for (const e of exitsForTourney(ms)) {
      const tier = roughTier(e);
      const p = ROUGH[tier]?.[e.exit] ?? 0;
      pts.set(e.playerId, (pts.get(e.playerId) ?? 0) + p);
    }
    for (const m of ms) { nm.set(m.winnerId, m.winnerName); nm.set(m.loserId, m.loserName); }
  }
  const top = [...pts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log(`${tour} ${year} ROUGH points-earned (no best-N, no 500/250 list, no Challenger): top-12`);
  for (const [id, p] of top) console.log(`  ${String(p).padStart(6)}  ${nm.get(id)}`);
}

if (filterT) {
  const tg = tourneyGroups(all.filter((m) => m.tourneyName.toLowerCase().includes(filterT.toLowerCase())));
  for (const [tid, ms] of tg) {
    const t0 = ms[0];
    console.log(`\n${t0.tourneyName} [${t0.level}] draw=${t0.drawSize} ${t0.date} (${tid})`);
    const exits = exitsForTourney(ms);
    // name lookup
    const nm = new Map<string, string>();
    for (const m of ms) { nm.set(m.winnerId, m.winnerName); nm.set(m.loserId, m.loserName); }
    const order = ["W", "F", "SF", "QF", "R16", "R32", "R64", "R128"];
    exits.sort((a, b) => order.indexOf(a.exit) - order.indexOf(b.exit));
    const counts: Record<string, number> = {};
    for (const e of exits) counts[e.exit] = (counts[e.exit] ?? 0) + 1;
    console.log("  exit-round histogram:", JSON.stringify(counts));
    for (const e of exits.filter((x) => ["W", "F", "SF"].includes(x.exit)))
      console.log(`    ${e.exit.padEnd(3)} ${nm.get(e.playerId)}  -> ${SLAM[e.exit] ?? "?"} pts`);
  }
}
