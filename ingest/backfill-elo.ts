import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Snapshot, Tour } from "../src/model";
import { fetchMatchesCsv, fetchQualChallCsv, keepWtaQualItf } from "./durations";
import { TOURNEY } from "./names";
import {
  applyHistoricalElo,
  computeRatingsAsOfSorted,
  parseEloMatchesCsv,
  sortEloRows,
  type EloConfig,
  type EloMatchRow,
} from "./historical-elo";
import { ATP_ELO_CONFIG, WTA_ELO_CONFIG } from "./elo-config";

// Recompute surface-aware historical Elo for every on-disk snapshot, frozen at each slam's own start
// date, from Jeff Sackmann's FULL match history (every event per tour, not just slams). The only
// network is GitHub raw — one CSV per tour-year, START_YEAR..max-year-on-disk. ingest/elo.ts scrapes
// *current* Tennis Abstract ratings, which can't be rewound; this rebuilds the ratings as they stood
// when each historical slam began. Safe to re-run: a no-op snapshot is skipped to keep diffs tight.
//   pnpm backfill-elo            # all years on disk
//   pnpm backfill-elo 2016 2017  # specific years
const OUT_DIR = resolve(process.cwd(), "public/data");
const SLAMS_DIR = resolve(OUT_DIR, "slams");
const START_YEAR = 2000;

/** Fetch + parse Sackmann CSVs START_YEAR..maxYear for one tour into a single EloMatchRow[], sorted
 *  ONCE into replay order so every per-snapshot recompute reuses it via computeRatingsAsOfSorted. */
async function loadTourRows(tour: Tour, maxYear: number): Promise<EloMatchRow[]> {
  const rows: EloMatchRow[] = [];
  const itfFilter = tour === "WTA" ? keepWtaQualItf : undefined;
  for (let year = START_YEAR; year <= maxYear; year++) {
    const main = await fetchMatchesCsv(tour, year).catch((e) => (console.warn(`${tour} ${year} main: ${e}`), null));
    if (main) rows.push(...parseEloMatchesCsv(main));
    const qc = await fetchQualChallCsv(tour, year).catch((e) => (console.warn(`${tour} ${year} qual: ${e}`), null));
    if (qc) rows.push(...parseEloMatchesCsv(qc, itfFilter));
  }
  return sortEloRows(rows);
}
const configFor = (tour: Tour): EloConfig => (tour === "ATP" ? ATP_ELO_CONFIG : WTA_ELO_CONFIG);

/** The shared tourney_date for a (year, slam) in the fetched rows, or null if Sackmann has no such
 *  event yet (current-slam lag) — that absence is the coverage gate, NOT a reason to write null elo. */
function slamCutoff(rows: EloMatchRow[], slam: string, year: number): number | null {
  const names = new Set(TOURNEY[slam] ?? []);
  let cutoff: number | null = null;
  for (const r of rows) {
    if (!names.has(r.tourneyName.toLowerCase())) continue;
    if (Math.floor(r.tourneyDate / 10000) !== year) continue;
    // Every row in a Sackmann tournament shares its start date; take the earliest to be safe.
    cutoff = cutoff === null ? r.tourneyDate : Math.min(cutoff, r.tourneyDate);
  }
  return cutoff;
}

async function main(): Promise<void> {
  const onDisk = (await readdir(SLAMS_DIR)).filter((d) => /^\d{4}$/.test(d));
  const wanted = process.argv.slice(2).filter((a) => /^\d{4}$/.test(a));
  const years = (wanted.length ? onDisk.filter((y) => wanted.includes(y)) : onDisk).sort();
  if (!years.length) return;
  const maxYear = Math.max(...years.map(Number));

  // One full-history load per tour covers every snapshot (per-snapshot recompute over ~50k rows ×
  // ~113 snapshots is fine). Load lazily so a tour with no snapshots in scope costs no fetches.
  const rowsByTour = new Map<Tour, EloMatchRow[]>();
  const rowsFor = async (tour: Tour): Promise<EloMatchRow[]> => {
    let r = rowsByTour.get(tour);
    if (!r) {
      r = await loadTourRows(tour, maxYear);
      rowsByTour.set(tour, r);
    }
    return r;
  };

  for (const year of years) {
    const files = (await readdir(resolve(SLAMS_DIR, year))).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const path = resolve(SLAMS_DIR, year, file);
      const snap = JSON.parse(await readFile(path, "utf8")) as Snapshot;
      const rows = await rowsFor(snap.tour);

      const cutoff = slamCutoff(rows, snap.tournament.slam, snap.tournament.year);
      if (cutoff === null) {
        console.log(`${year}/${file}: kept existing elo (Sackmann lag — no rows for this slam yet)`);
        continue;
      }

      const { byName } = computeRatingsAsOfSorted(rows, cutoff, configFor(snap.tour));
      // Snapshot the prior elo so we can detect a true no-op (idempotent re-runs leave git clean).
      const before = JSON.stringify(Object.values(snap.players).map((p) => p.elo ?? null));
      const { matched, unmatched } = applyHistoricalElo(snap.players, byName);
      const after = JSON.stringify(Object.values(snap.players).map((p) => p.elo ?? null));

      if (after === before) {
        console.log(`${year}/${file}: matched=${matched}/${matched + unmatched.length} (no change — skipped)`);
        continue;
      }
      await writeFile(path, JSON.stringify(snap));
      console.log(`${year}/${file}: cutoff=${cutoff} matched=${matched}/${matched + unmatched.length}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
