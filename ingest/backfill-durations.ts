import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Snapshot, Tour } from "../src/model";
import { applyDurations, fetchMatchesCsv, parseMatchesCsv, type SlamDurationRow } from "./durations";

// Re-source every on-disk snapshot's match durations from Jeff Sackmann's CSVs (see durations.ts
// for why SofaScore's values can't be trusted historically). Offline w.r.t. SofaScore — the only
// network is GitHub raw, one CSV per tour-year. Safe to re-run; the merge policy is idempotent.
//   pnpm backfill-durations            # all years on disk
//   pnpm backfill-durations 2024 2025  # specific years
const OUT_DIR = resolve(process.cwd(), "public/data");
const SLAMS_DIR = resolve(OUT_DIR, "slams");

async function main(): Promise<void> {
  const onDisk = (await readdir(SLAMS_DIR)).filter((d) => /^\d{4}$/.test(d));
  const wanted = process.argv.slice(2).filter((a) => /^\d{4}$/.test(a));
  const years = (wanted.length ? onDisk.filter((y) => wanted.includes(y)) : onDisk).sort();

  for (const year of years) {
    const files = (await readdir(resolve(SLAMS_DIR, year))).filter((f) => f.endsWith(".json"));
    const csvByTour = new Map<Tour, string | null>();
    for (const tour of ["ATP", "WTA"] as const) {
      if (!files.some((f) => f.startsWith(tour.toLowerCase()))) continue;
      csvByTour.set(tour, await fetchMatchesCsv(tour, Number(year)).catch((err) => {
        console.warn(`${year} ${tour}: CSV unavailable (${err}) — local sanity bound still applies`);
        return null;
      }));
    }

    for (const file of files) {
      const path = resolve(SLAMS_DIR, year, file);
      const snap = JSON.parse(await readFile(path, "utf8")) as Snapshot;
      const csv = csvByTour.get(snap.tour) ?? null;
      const rows: SlamDurationRow[] = csv ? parseMatchesCsv(csv, snap.tournament.slam) : [];
      const s = applyDurations(snap.matches, snap.players, rows);
      await writeFile(path, JSON.stringify(snap));
      console.log(
        `${year}/${file}: csv=${s.fromCsv} kept=${s.keptLocal} dropped=${s.dropped} none=${s.unmatched}`,
      );
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
