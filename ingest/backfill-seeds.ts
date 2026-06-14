import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Snapshot, Tour } from "../src/model";
import { fetchMatchesCsv } from "./durations";
import { applySeeds, distinctSeedCount, parseSeedsCsv, type SeedMap } from "./seeds";

// Re-source missing player seeds from Jeff Sackmann's CSVs (winner_seed/loser_seed). Twelve slams
// shipped with absent or partial seeds (the SofaScore draw payload historically omitted them); this
// fills players[*].seed by name-joining the snapshot players to the Sackmann rows. Offline w.r.t.
// SofaScore — the only network is GitHub raw, one CSV per tour-year. Merge mode (never overwrites an
// existing seed) and idempotent — safe to re-run.
//   pnpm backfill-seeds            # all years on disk
//   pnpm backfill-seeds 2015 2016  # specific years
const OUT_DIR = resolve(process.cwd(), "public/data");
const SLAMS_DIR = resolve(OUT_DIR, "slams");

const seededCount = (snap: Snapshot): number =>
  Object.values(snap.players).filter((p) => p.seed !== null).length;

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
        console.warn(`${year} ${tour}: CSV unavailable (${err}) — seeds left unchanged`);
        return null;
      }));
    }

    for (const file of files) {
      const path = resolve(SLAMS_DIR, year, file);
      const snap = JSON.parse(await readFile(path, "utf8")) as Snapshot;
      const csv = csvByTour.get(snap.tour) ?? null;
      if (!csv) continue; // fetch failed for this tour — leave data unchanged
      const seedMap: SeedMap = parseSeedsCsv(csv, snap.tournament.slam);

      // Only touch under-seeded snapshots: a draw already holding as many seeds as Sackmann declares
      // is left alone (this also spares the legit sub-32 draws that are already complete). distinct
      // Sackmann seeds is the ceiling; before is the snapshot's current count.
      const before = seededCount(snap);
      const target = distinctSeedCount(seedMap);
      if (before >= target) {
        console.log(`${year}/${file}: seeded=${before}/${target} — already complete, skipped`);
        continue;
      }

      const s = applySeeds(snap.players, seedMap); // merge: never overwrites existing seeds
      const after = seededCount(snap);
      if (after === before) {
        // Nothing joined (e.g. all snapshot names diverge from the CSV) — skip the rewrite so the
        // git diff stays empty and generatedAt is untouched.
        console.log(`${year}/${file}: seeded=${before}/${target} — no joins, unchanged`);
        continue;
      }
      await writeFile(path, JSON.stringify(snap));
      console.log(
        `${year}/${file}: seeded ${before}->${after}/${target} ` +
        `full=${s.filledFull} sig=${s.filledSig} ambig=${s.sigAmbiguousSkip} ` +
        `taken=${s.takenSkip} unjoined=${s.unjoined}`,
      );
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
