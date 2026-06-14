// Build-only Elo calibration harness. Runs our engine forward to "today" over the TA-scoped match set
// (tour + qualifying/Challenger for ATP, + ITF>=$50K for WTA), scrapes the LIVE Tennis Abstract board,
// joins by normalized name, and grid-searches the per-tour entrant seed (seedTour x seedSub) to minimize
// the median |Elo error| against TA's top players. Prints the best fit + a residual table per tour.
// Byte-exact reproduction is impossible (TA's seed/penalty/code are unpublished — see the Elo plan);
// this finds the closest documented-methodology approximation. Transcribe the winning seeds into
// ingest/elo-config.ts. Network + sandbox-off:  npx tsx ingest/calibrate-elo.ts
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Tour } from "../src/model";
import { fetchMatchesCsv, fetchQualChallCsv, keepWtaQualItf } from "./durations";
import {
  parseEloMatchesCsv,
  computeRatingsAsOfSorted,
  sortEloRows,
  type EloMatchRow,
} from "./historical-elo";
import { seedConfig } from "./elo-config";
import { fetchElo, normalizeName } from "./elo";

const CACHE = resolve(process.cwd(), "ingest/.cache/elo");
mkdirSync(CACHE, { recursive: true });
const START_YEAR = 2000;
// seedTour is held at TA's documented tradition (1500) plus a sensitivity pair; seedSub (the unpublished
// "low 1200s") is swept finely. We choose by the HEADLINE overall meanAbs, not the surface-dragged sum.
const SEED_TOURS = [1400, 1450, 1500];
const SEED_SUBS = [1050, 1090, 1130, 1170, 1210];
const TOP_N = 50;

async function cachedCsv(name: string, fetcher: () => Promise<string | null>): Promise<string | null> {
  const p = resolve(CACHE, name);
  if (existsSync(p)) return readFileSync(p, "utf8") || null;
  const csv = await fetcher();
  writeFileSync(p, csv ?? ""); // cache empties too, so a 404 year isn't refetched every run
  return csv;
}

/** Load + parse + sort ONCE per tour so the grid search only re-runs the (cheap) engine replay.
 *  Exported so the regression fixture reuses the same cached load. */
export async function loadSorted(tour: Tour, maxYear: number): Promise<EloMatchRow[]> {
  const rows: EloMatchRow[] = [];
  const itf = tour === "WTA" ? keepWtaQualItf : undefined;
  for (let y = START_YEAR; y <= maxYear; y++) {
    const main = await cachedCsv(`${tour}_${y}.csv`, () => fetchMatchesCsv(tour, y).catch(() => null));
    if (main) rows.push(...parseEloMatchesCsv(main));
    const qc = await cachedCsv(`${tour}_qc_${y}.csv`, () => fetchQualChallCsv(tour, y).catch(() => null));
    if (qc) rows.push(...parseEloMatchesCsv(qc, itf));
  }
  return sortEloRows(rows);
}

const median = (a: number[]): number => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const meanAbs = (a: number[]): number => (a.length ? a.reduce((p, c) => p + Math.abs(c), 0) / a.length : NaN);

async function calibrate(tour: Tour): Promise<void> {
  const maxYear = new Date().getUTCFullYear();
  const sorted = await loadSorted(tour, maxYear);
  const ta = await fetchElo(tour);
  const taTop = [...ta.values()]
    .filter((e) => e.elo.overall != null)
    .sort((a, b) => (b.elo.overall as number) - (a.elo.overall as number))
    .slice(0, TOP_N);
  console.log(`\n=== ${tour}: ${sorted.length} rows, ${taTop.length} TA reference players ===`);
  console.log("seedTour\tseedSub\tovr_meanAbs\tovr_med\thard\tclay\tgrass\tjoined");

  let bestOvr = { seedTour: 0, seedSub: 0, ovr: Infinity, om: 0, h: 0, c: 0, g: 0, joined: 0 };
  for (const seedTour of SEED_TOURS) {
    for (const seedSub of SEED_SUBS) {
      const { byId } = computeRatingsAsOfSorted(sorted, 99999999, seedConfig(seedTour, seedSub));
      const ours = new Map<string, { overall: number; hard: number | null; clay: number | null; grass: number | null }>();
      for (const cmp of byId.values()) { const k = normalizeName(cmp.name); if (k) ours.set(k, cmp); }
      const d: number[] = [], dh: number[] = [], dc: number[] = [], dg: number[] = [];
      for (const t of taTop) {
        const o = ours.get(normalizeName(t.name)); if (!o) continue;
        d.push(o.overall - (t.elo.overall as number));
        if (t.elo.hard != null && o.hard != null) dh.push(o.hard - t.elo.hard);
        if (t.elo.clay != null && o.clay != null) dc.push(o.clay - t.elo.clay);
        if (t.elo.grass != null && o.grass != null) dg.push(o.grass - t.elo.grass);
      }
      const om = meanAbs(d), oMed = median(d);
      console.log(`${seedTour}\t${seedSub}\t${om.toFixed(1)}\t${oMed.toFixed(1)}\t${meanAbs(dh).toFixed(1)}\t${meanAbs(dc).toFixed(1)}\t${meanAbs(dg).toFixed(1)}\t${d.length}`);
      if (om < bestOvr.ovr) bestOvr = { seedTour, seedSub, ovr: om, om: oMed, h: meanAbs(dh), c: meanAbs(dc), g: meanAbs(dg), joined: d.length };
    }
  }
  console.log(`${tour} BEST-by-overall: seedTour=${bestOvr.seedTour} seedSub=${bestOvr.seedSub}  overall meanAbs=${bestOvr.ovr.toFixed(1)} (median ${bestOvr.om.toFixed(1)})  hard=${bestOvr.h.toFixed(1)} clay=${bestOvr.c.toFixed(1)} grass=${bestOvr.g.toFixed(1)}`);
}

// Only run the (slow, network) grid search when invoked directly — importing this module (e.g. from the
// regression fixture) must NOT kick off a calibration.
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    for (const tour of ["ATP", "WTA"] as const) await calibrate(tour);
  })().catch((e) => { console.error(e); process.exit(1); });
}
