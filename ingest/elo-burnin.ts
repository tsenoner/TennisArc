// Historical burn-in validation (committed tooling). Replays the PRODUCTION engine (1968 history +
// injury model + fitted seeds) frozen at each archived Tennis-Abstract board date in the committed
// fixture (ingest/fixtures/ta-elo-historical.json), and reports the scale offset (ours − TA) per board,
// aggregated by year. Quantifies the documented time-varying offset: 2016-17 run ~−90 (peak-era
// compression / burn-in), 2018+ settles to within ~±20. Build the fixture first via ingest/elo-wayback.ts.
//   npx tsx ingest/elo-burnin.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadSorted } from "./calibrate-elo";
import { computeRatingsAsOfSorted } from "./historical-elo";
import { ATP_ELO_CONFIG, WTA_ELO_CONFIG } from "./elo-config";
import { fullKey } from "./names";

interface Board { date: number; players: { name: string; overall: number }[] }
const fixture: Record<string, Board[]> = JSON.parse(
  readFileSync(resolve(process.cwd(), "ingest/fixtures/ta-elo-historical.json"), "utf8"));

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };

(async () => {
  for (const tour of ["ATP", "WTA"] as const) {
    const boards = fixture[tour] ?? [];
    if (!boards.length) { console.log(`\n${tour}: no fixture boards`); continue; }
    const sorted = await loadSorted(tour, 2026);
    const config = tour === "ATP" ? ATP_ELO_CONFIG : WTA_ELO_CONFIG;
    const perYear = new Map<number, number[]>();
    for (const b of boards) {
      const { byName } = computeRatingsAsOfSorted(sorted, b.date, config);
      const errs: number[] = [];
      for (const r of b.players.slice(0, 40)) { const o = byName.get(fullKey(r.name)); if (o) errs.push(o.overall - r.overall); }
      if (errs.length < 10) continue;
      const yr = Math.floor(b.date / 10000);
      (perYear.get(yr) ?? perYear.set(yr, []).get(yr)!).push(median(errs));
    }
    console.log(`\n=== ${tour}: burn-in by year (median of per-board median errors, ${boards.length} boards) ===`);
    for (const yr of [...perYear.keys()].sort()) {
      const ms = perYear.get(yr)!;
      console.log(`  ${yr}: ${(median(ms) >= 0 ? "+" : "") + median(ms).toFixed(0)}  (${ms.length} boards)`);
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
