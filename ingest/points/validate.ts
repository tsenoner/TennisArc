// Points-earned engine + validation vs published year-end standings (ATP/WTA 2019 & 2023, both Era-A).
// Per-tournament tier+round points are EXACT (Djokovic 2023=11245, Alcaraz 2023, Nadal/Federer 2019, +12
// of ATP-2019 top-30). Residual vs year-end RANKING is the 52-week rolling window + rank-scaled team events
// (United Cup/ATP Cup) — both irreducible from calendar-year match rounds. Era-correct tables in
// POINTS-TABLES.md; CSV-verified tier lists in TIER-LISTS.md.   npx tsx ingest/points/validate.ts ATP 2023
import { loadMatches, roundRank, type Match } from "../elo-reverse/lib";
import { fullKey } from "../names";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const tour = (process.argv[2] as "ATP" | "WTA") ?? "ATP";
const year = Number(process.argv[3] ?? 2023);
const SHOW = Number(process.argv[4] ?? 30);

const GT = JSON.parse(readFileSync(resolve(process.cwd(), "ingest/points/ground-truth.json"), "utf8"));

const all = loadMatches(tour, year - 1).filter((m) => Math.floor(m.date / 10000) === year);
const isQ = (r: string) => /^Q[1-4]$/.test(r);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// ---------- POINTS TABLES (Era A: ATP 2009-2023, WTA 2014-2023) ----------
type Tbl = Record<string, number>;
const ATP: Record<string, Tbl> = {
  GRAND_SLAM: { W: 2000, F: 1200, SF: 720, QF: 360, R16: 180, R32: 90, R64: 45, R128: 10 },
  M1000_96: { W: 1000, F: 600, SF: 360, QF: 180, R16: 90, R32: 45, R64: 25, R128: 10 },
  M1000_56: { W: 1000, F: 600, SF: 360, QF: 180, R16: 90, R32: 45, R64: 10, R128: 0 },
  A500_48: { W: 500, F: 300, SF: 180, QF: 90, R16: 45, R32: 20, R64: 0 },
  A500_32: { W: 500, F: 300, SF: 180, QF: 90, R16: 45, R32: 0 },
  A250_48: { W: 250, F: 150, SF: 90, QF: 45, R16: 20, R32: 10, R64: 0 },
  A250_32: { W: 250, F: 150, SF: 90, QF: 45, R16: 20, R32: 0 },
  CH125: { W: 125, F: 75, SF: 45, QF: 25, R16: 10, R32: 5, R64: 0 }, // ATP Challenger (approx CH125; level 'C')
};
// Qualifying bonus (Era-A ATP), added ON TOP of the main-draw result for a player who won >=1 qual match.
const QBONUS: Record<string, number> = { GRAND_SLAM: 25, M1000_96: 16, M1000_56: 16, A500_48: 10, A500_32: 20, A250_48: 5, A250_32: 12 };
const WTA: Record<string, Tbl> = {
  GRAND_SLAM: { W: 2000, F: 1300, SF: 780, QF: 430, R16: 240, R32: 130, R64: 70, R128: 10 },
  W1000M_96: { W: 1000, F: 650, SF: 390, QF: 215, R16: 120, R32: 65, R64: 35, R128: 10 },
  W1000M_56: { W: 1000, F: 650, SF: 390, QF: 215, R16: 120, R32: 65, R64: 10, R128: 0 },
  W900_56: { W: 900, F: 585, SF: 350, QF: 190, R16: 105, R32: 60, R64: 1, R128: 0 },
  W500_48: { W: 470, F: 305, SF: 185, QF: 100, R16: 55, R32: 30, R64: 1 },
  W500_32: { W: 470, F: 305, SF: 185, QF: 100, R16: 55, R32: 1 },
  W250_32: { W: 280, F: 180, SF: 110, QF: 60, R16: 30, R32: 1 },
};

// ATP 500 event lists (CSV-verified per the tier-research workflow; note 2023 has NO Astana — reverted to 250)
const ATP500: Record<number, string[]> = {
  2019: ["rotterdam", "dubai", "acapulco", "rio de janeiro", "barcelona", "halle", "queen s club", "hamburg", "washington", "beijing", "tokyo", "vienna", "basel"],
  2023: ["rotterdam", "dubai", "acapulco", "rio de janeiro", "barcelona", "halle", "queen s club", "hamburg", "washington", "beijing", "tokyo", "vienna", "basel"],
};
const ATP_MAND_MASTERS = (name: string) => !norm(name).includes("monte"); // 8 mandatory = all M except Monte-Carlo

// WTA tier lists (CSV-verified). 2019: Premier era (PM/Premier5/Premier700). 2023: WTA-1000 era.
const WTA_PM = ["indian wells", "miami", "madrid", "beijing"]; // Premier Mandatory / 1000-mandatory (both eras)
const WTA1000_900: Record<number, string[]> = { // Premier 5 (900, pre-2021) / non-mandatory 1000 (900, 2021-23)
  2019: ["dubai", "rome", "toronto", "cincinnati", "wuhan"],
  2023: ["dubai", "rome", "montreal", "cincinnati", "guadalajara"],
};
const WTA500: Record<number, string[]> = { // Premier 700 (470, pre-2021) / WTA 500
  2019: ["brisbane", "sydney", "st petersburg", "doha", "charleston", "stuttgart", "birmingham", "eastbourne", "san jose", "zhengzhou", "osaka", "moscow"],
  2023: ["adelaide", "abu dhabi", "doha", "charleston", "stuttgart", "berlin", "eastbourne", "washington", "san diego", "tokyo", "zhengzhou"],
};

// ---------- tier classification ----------
function atpTier(m: Match): { tbl: string | null; tier: string } {
  const lv = m.level, nm = norm(m.tourneyName), d = m.drawSize;
  if (/olympic/.test(nm) || lv === "O" || lv === "D") return { tbl: null, tier: "ZERO" };
  if (/laver|next gen|nextgen|united cup|atp cup|davis/.test(nm)) return { tbl: null, tier: "EXCLUDE" };
  if (/tour finals|world tour finals|atp finals|masters cup/.test(nm)) return { tbl: "FINALS", tier: "FINALS" }; // level 'A' in Sackmann!
  if (lv === "F") return { tbl: null, tier: "EXCLUDE" }; // NextGen Finals etc — 0 ranking points
  if (lv === "G") return { tbl: "GRAND_SLAM", tier: "SLAM" };
  if (lv === "M") return { tbl: d >= 96 ? "M1000_96" : "M1000_56", tier: ATP_MAND_MASTERS(m.tourneyName) ? "MAND_M" : "OTHER" };
  if (lv === "A") {
    const is500 = (ATP500[year] ?? []).some((x) => nm.includes(x) || x.includes(nm.split(" ")[0]));
    return { tbl: is500 ? (d >= 48 ? "A500_48" : "A500_32") : (d >= 48 ? "A250_48" : "A250_32"), tier: "OTHER" };
  }
  if (lv === "C") return { tbl: "CH125", tier: "OTHER" }; // ATP Challenger — flows into the best-6 others pool
  return { tbl: null, tier: "OTHER_CH" };
}
function wtaTier(m: Match): { tbl: string | null; tier: string } {
  const lv = m.level, nm = norm(m.tourneyName), d = m.drawSize;
  if (/olympic/.test(nm) || lv === "O" || lv === "D") return { tbl: null, tier: "ZERO" };
  if (/united cup|hopman|billie jean|bjk|fed cup/.test(nm)) return { tbl: null, tier: "EXCLUDE" };
  if (lv === "F") return { tbl: "FINALS", tier: "FINALS" };
  if (lv === "G") return { tbl: "GRAND_SLAM", tier: "SLAM" };
  if (/^\d/.test(lv)) return { tbl: null, tier: "OTHER_ITF" };
  if (lv === "C") return { tbl: null, tier: "OTHER_125" };
  const isPM = WTA_PM.some((x) => nm.includes(x));
  if (isPM) return { tbl: d >= 96 ? "W1000M_96" : "W1000M_56", tier: "MAND_M" };
  const is900 = (WTA1000_900[year] ?? []).some((x) => nm.includes(x));
  if (is900) return { tbl: "W900_56", tier: "OTHER" };
  const is500 = (WTA500[year] ?? []).some((x) => nm.includes(x));
  if (is500) return { tbl: d >= 48 ? "W500_48" : "W500_32", tier: "OTHER" };
  return { tbl: "W250_32", tier: "OTHER" }; // International / WTA 250
}
const TIER = tour === "ATP" ? atpTier : wtaTier;
const TBL = tour === "ATP" ? ATP : WTA;

// ---------- per-player per-event exit + points ----------
interface PE { tourneyId: string; name: string; tier: string; pts: number }
const byT = new Map<string, Match[]>();
for (const m of all) (byT.get(m.tourneyId) ?? byT.set(m.tourneyId, []).get(m.tourneyId)!).push(m);

const playerEvents = new Map<string, PE[]>(); // playerId -> events
const idName = new Map<string, string>();
for (const m of all) { idName.set(m.winnerId, m.winnerName); idName.set(m.loserId, m.loserName); }

for (const [tid, ms] of byT) {
  const cls = TIER(ms[0]);
  // group player matches
  const byP = new Map<string, { won: Match[]; lost: Match[] }>();
  for (const m of ms) {
    (byP.get(m.winnerId) ?? byP.set(m.winnerId, { won: [], lost: [] }).get(m.winnerId)!).won.push(m);
    (byP.get(m.loserId) ?? byP.set(m.loserId, { won: [], lost: [] }).get(m.loserId)!).lost.push(m);
  }
  // BYE RULE (ATP/WTA rulebook): a player who reaches the 2nd round via a BYE and then loses is scored as a
  // FIRST-ROUND loser. Detect the draw's first main round (shallowest non-qual round present); a player who
  // never played it (entered above it) and won 0 main matches = bye-then-lose -> first-round value.
  const mainRounds = ms.filter((m) => !isQ(m.round)).map((m) => m.round);
  const firstRoundLabel = mainRounds.sort((a, b) => roundRank(a) - roundRank(b))[0];
  const firstRank = firstRoundLabel ? roundRank(firstRoundLabel) : 0;
  for (const [pid, rec] of byP) {
    let pts = 0;
    if (cls.tier === "FINALS") {
      // RR accumulation
      const rrWins = rec.won.filter((m) => m.round === "RR").length;
      const sfWin = rec.won.some((m) => m.round === "SF");
      const fWin = rec.won.some((m) => m.round === "F");
      const rrPlayed = rec.won.filter((m) => m.round === "RR").length + rec.lost.filter((m) => m.round === "RR").length;
      if (tour === "ATP") pts = 200 * rrWins + (sfWin ? 400 : 0) + (fWin ? 500 : 0);
      else pts = 125 * rrPlayed + 125 * rrWins + (sfWin ? 330 : 0) + (fWin ? 420 : 0);
    } else if (cls.tbl) {
      const mainLost = rec.lost.filter((m) => !isQ(m.round));
      const mainWon = rec.won.filter((m) => !isQ(m.round));
      let exit: string;
      if (mainLost.length === 0 && mainWon.length === 0) continue; // qual-only — 0 for top players
      else if (mainLost.length === 0) exit = "W";
      else {
        const lossRound = mainLost.sort((a, b) => roundRank(b.round) - roundRank(a.round))[0].round;
        // bye-then-lose: 0 main wins AND entered above the first round -> first-round-loss value
        exit = mainWon.length === 0 && roundRank(lossRound) > firstRank ? firstRoundLabel : lossRound;
      }
      pts = TBL[cls.tbl]?.[exit] ?? 0;
      // qualifying bonus: a player who won >=1 qual match (reached MD via qualifying) earns the Q column on top
      if (tour === "ATP" && rec.won.some((m) => isQ(m.round)) && QBONUS[cls.tbl]) pts += QBONUS[cls.tbl];
    } else continue; // ZERO/EXCLUDE/Challenger/ITF — skip (0 or not in top-N sum)
    (playerEvents.get(pid) ?? playerEvents.set(pid, []).get(pid)!).push({ tourneyId: tid, name: ms[0].tourneyName, tier: cls.tier, pts });
  }
}

// ---------- best-N ----------
function bestN(events: PE[]): number {
  const slams = events.filter((e) => e.tier === "SLAM");
  const mand = events.filter((e) => e.tier === "MAND_M");
  const finals = events.filter((e) => e.tier === "FINALS");
  const others = events.filter((e) => e.tier === "OTHER").sort((a, b) => b.pts - a.pts);
  const otherSlots = tour === "ATP" ? 6 : 8; // 4+8+6=18 ATP; 4+4+8=16 WTA
  const forced = slams.reduce((s, e) => s + e.pts, 0) + mand.reduce((s, e) => s + e.pts, 0);
  const topOthers = others.slice(0, otherSlots).reduce((s, e) => s + e.pts, 0);
  const finalsBonus = finals.reduce((s, e) => s + e.pts, 0);
  return forced + topOthers + finalsBonus;
}

// ---------- optional per-player event dump ----------
const DBG = process.argv.find((a) => a.startsWith("--p="));
if (DBG) {
  const want = fullKey(DBG.slice(4));
  for (const [id, ev] of playerEvents) {
    if (fullKey(idName.get(id) ?? "") !== want) continue;
    console.log(`${idName.get(id)} events:`);
    for (const e of ev.sort((a, b) => b.pts - a.pts)) console.log(`  ${String(e.pts).padStart(5)}  [${e.tier}] ${e.name}`);
    console.log(`  bestN total = ${bestN(ev)}`);
  }
  process.exit(0);
}

// ---------- join ground truth & compare ----------
const gt = GT[`${tour}_${year}`] as { rank: number; player: string; points: number }[];
const idByKey = new Map<string, string>();
for (const [id, nm] of idName) idByKey.set(fullKey(nm), id);

let exactN = 0, within10 = 0;
const rows: string[] = [];
for (const g of gt.slice(0, SHOW)) {
  const id = idByKey.get(fullKey(g.player));
  if (!id) { rows.push(`  ${String(g.rank).padStart(2)} ${g.player.padEnd(26)} NO-JOIN`); continue; }
  const ev = playerEvents.get(id) ?? [];
  const comp = bestN(ev);
  const d = comp - g.points;
  if (d === 0) exactN++;
  if (Math.abs(d) <= 10) within10++;
  rows.push(`  ${String(g.rank).padStart(2)} ${g.player.padEnd(26)} official ${String(g.points).padStart(6)}  comp ${String(comp).padStart(6)}  Δ${d > 0 ? "+" : ""}${d}${d === 0 ? "  ✓" : ""}`);
}
console.log(`${tour} ${year}: points-earned vs official year-end (top ${SHOW})`);
for (const r of rows) console.log(r);
console.log(`\n  EXACT: ${exactN}/${SHOW}  | within ±10: ${within10}/${SHOW}`);
