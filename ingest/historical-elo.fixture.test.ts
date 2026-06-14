import { describe, test, expect } from "vitest";
import type { Tour } from "../src/model";
import { computeRatingsAsOfSorted } from "./historical-elo";
import { loadSorted } from "./calibrate-elo";
import { ATP_ELO_CONFIG, WTA_ELO_CONFIG } from "./elo-config";
import { fullKey } from "./names";
import ref from "./fixtures/ta-elo-reference.json";

// Regression guard: re-deriving Elo to "today" must still reproduce the pinned live Tennis Abstract
// board at the CALIBRATED quality. We assert AGGREGATE median |error| per metric (robust to per-player
// outliers and TA's ~weekly drift), not tight per-player bounds. A real regression — reverting the 50/50
// surface blend, or dropping the qual/challenger scope, or losing the fitted seed — blows these medians
// far past the bands (overall jumps ~250, surfaces ~200). Byte-exact is impossible (see RESEARCH.md).
//
// NETWORK + full-history replay, so it's OPT-IN: run `ELO_FIXTURE=1 TZ=UTC npx vitest run
// ingest/historical-elo.fixture.test.ts`. CSVs are served from ingest/.cache/elo when present.
// TA drifts weekly: when these bands fail for non-bug reasons, re-capture the fixture deliberately
// (.scratch/capture-ta-reference.ts) and re-run the calibration.

// Bands sit ~3x the observed top-18 median |error| (ATP overall 8 / WTA 5; ATP grass ~71 is the known
// thin-sample weak spot), leaving room for TA's weekly drift while still tripping on a gross regression
// (reverting the 50/50 blend or the qual/challenger scope blows overall past 200).
const BANDS: Record<Tour, { overall: number; hard: number; clay: number; grass: number; minJoin: number }> = {
  ATP: { overall: 30, hard: 35, clay: 30, grass: 100, minJoin: 16 },
  WTA: { overall: 20, hard: 35, clay: 35, grass: 55, minJoin: 16 },
};

const medianAbs = (a: number[]): number => {
  const s = a.map(Math.abs).sort((x, y) => x - y);
  if (!s.length) return NaN;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const run = process.env.ELO_FIXTURE === "1" ? describe : describe.skip;

run(`Elo reproduces Tennis Abstract within calibrated bands (TA as-of ${ref.asOf})`, () => {
  for (const tour of ["ATP", "WTA"] as const) {
    test(`${tour}: median |error| stays within band`, async () => {
      const sorted = await loadSorted(tour, new Date().getUTCFullYear());
      const config = tour === "ATP" ? ATP_ELO_CONFIG : WTA_ELO_CONFIG;
      // Freeze at the board's as-of date (real cutoff, not the all-rows sentinel) so the injury/absence
      // dock applies to players the live board has docked for inactivity.
      const asOf = Number(ref.asOf.replace(/-/g, ""));
      // Dominant-id join (byName), same as production, so fragmented players aren't naive-join artifacts.
      const { byName } = computeRatingsAsOfSorted(sorted, asOf, config);

      const players = (ref as any)[tour.toLowerCase()] as Array<{ name: string; overall: number; hard: number | null; clay: number | null; grass: number | null }>;
      const d: number[] = [], dh: number[] = [], dc: number[] = [], dg: number[] = [];
      let joined = 0;
      for (const p of players) {
        const o = byName.get(fullKey(p.name));
        if (!o) continue;
        joined++;
        d.push(o.overall - p.overall);
        if (p.hard != null && o.hard != null) dh.push(o.hard - p.hard);
        if (p.clay != null && o.clay != null) dc.push(o.clay - p.clay);
        if (p.grass != null && o.grass != null) dg.push(o.grass - p.grass);
      }
      const b = BANDS[tour];
      // eslint-disable-next-line no-console
      console.log(`${tour} fixture: joined=${joined}/${players.length} medianAbs overall=${medianAbs(d).toFixed(1)} hard=${medianAbs(dh).toFixed(1)} clay=${medianAbs(dc).toFixed(1)} grass=${medianAbs(dg).toFixed(1)}`);

      expect(joined).toBeGreaterThanOrEqual(b.minJoin);
      expect(medianAbs(d)).toBeLessThanOrEqual(b.overall);
      expect(medianAbs(dh)).toBeLessThanOrEqual(b.hard);
      expect(medianAbs(dc)).toBeLessThanOrEqual(b.clay);
      expect(medianAbs(dg)).toBeLessThanOrEqual(b.grass);
    }, 180_000);
  }
});
