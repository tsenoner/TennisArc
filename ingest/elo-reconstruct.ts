// Per-player month-by-month Elo reconstruction (committed tooling). Replays the production engine and,
// for ONE player, snapshots their in-state overall after every match — flagging each on-return injury
// dock (combine-and-differential) and the boosted-K recovery window — then compares our frozen value to
// TA's at every archived board date in the fixture. This is the tool to "fully understand how a single
// player's score updates each month" and to see exactly where/why we diverge from TA.
//   npx tsx ingest/elo-reconstruct.ts ATP "Novak Djokovic"
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadSorted } from "./calibrate-elo";
import { EloEngine, activeLayoffDays, openGapDock } from "./historical-elo";
import { ATP_ELO_CONFIG, WTA_ELO_CONFIG, TA_LAYOFF_DOCK } from "./elo-config";
import { fullKey } from "./names";
import type { Tour } from "../src/model";

const tour = (process.argv[2] as Tour) || "ATP";
const name = process.argv[3] || "Novak Djokovic";
const config = tour === "ATP" ? ATP_ELO_CONFIG : WTA_ELO_CONFIG;
const key = fullKey(name);

interface Board { date: number; players: { name: string; overall: number }[] }
const fixture: Record<string, Board[]> = JSON.parse(readFileSync(resolve(process.cwd(), "ingest/fixtures/ta-elo-historical.json"), "utf8"));

(async () => {
  const sorted = await loadSorted(tour, 2026);
  const cnt = new Map<string, number>();
  for (const r of sorted) for (const [id, n] of [[r.winnerId, r.winnerName], [r.loserId, r.loserName]] as const) if (fullKey(n) === key) cnt.set(id, (cnt.get(id) ?? 0) + 1);
  const id = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!id) { console.log(`${name}: not found`); return; }

  const engine = new EloEngine(config);
  type Snap = { date: number; overall: number; n: number; gap: number; rec: number; cd: number; cdock: number };
  const traj: Snap[] = [];
  let prevDate = 0;
  for (const row of sorted) {
    const involves = row.winnerId === id || row.loserId === id;
    engine.update(row);
    if (involves) {
      const s = engine.players.get(id)!;
      traj.push({ date: row.tourneyDate, overall: s.overall, n: s.overallN, gap: prevDate ? activeLayoffDays(prevDate, row.tourneyDate) : 0, rec: s.recoveryLeft, cd: s.clusterDays, cdock: s.clusterDock });
      prevDate = row.tourneyDate;
    }
  }

  console.log(`\n=== ${name} (${tour}) per-match trajectory since 2024 ===`);
  console.log("date      overall  n    gapDays  clusterDock  recLeft");
  let prevDock = 0;
  for (const s of traj.filter((s) => s.date >= 20240101)) {
    const fresh = s.cdock > prevDock + 0.5;
    const flag = fresh ? `  <== RETURN dock +${(s.cdock - prevDock).toFixed(0)} (gap ${s.gap}d, cluster −${s.cdock.toFixed(0)})` : (s.rec > 0 ? `  (recovering K, ${s.rec} left)` : "");
    console.log(`${s.date}  ${s.overall.toFixed(0).padStart(5)}  ${String(s.n).padStart(4)}  ${String(s.gap).padStart(5)}  ${s.cdock.toFixed(0).padStart(6)}      ${String(s.rec).padStart(3)}${flag}`);
    prevDock = s.cdock;
  }

  const boards = (fixture[tour] ?? []).filter((b) => b.players.some((p) => fullKey(p.name) === key));
  console.log(`\n=== ${name}: ours (frozen, post-dock) vs TA at ${boards.length} archived boards ===`);
  console.log("boardDate   TA    ours   err   openGapDock");
  for (const b of boards) {
    const ta = b.players.find((p) => fullKey(p.name) === key)!.overall;
    const last = [...traj].reverse().find((s) => s.date < b.date);
    if (!last) continue;
    const dock = openGapDock(TA_LAYOFF_DOCK, activeLayoffDays(last.date, b.date), last.cd, last.cdock, last.overall + last.cdock);
    const ours = last.overall - dock;
    console.log(`${b.date}  ${ta.toFixed(0)}  ${ours.toFixed(0)}  ${(ours - ta >= 0 ? "+" : "") + (ours - ta).toFixed(0)}   −${dock.toFixed(0)}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
