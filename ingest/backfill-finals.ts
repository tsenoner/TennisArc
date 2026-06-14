import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Snapshot, Tour } from "../src/model";
import { fetchMatchesCsv } from "./durations";
import { applyFinal, parseFinalRow } from "./finals";

// Backfill the five slam finals that shipped as status:"scheduled" with both finalists present but
// no result (the live SofaScore ingest never captured the final's outcome). The winner + per-set
// score + on-court minutes come from Jeff Sackmann's F rows (network = GitHub raw, one CSV per
// tour-year, same as backfill-durations). Idempotent: a final that already has a result is skipped,
// and a no-op leaves the file (and its generatedAt) byte-for-byte unchanged.
//   pnpm backfill-finals
const SLAMS_DIR = resolve(process.cwd(), "public/data/slams");

interface Target {
  year: number;
  tour: Tour;
  slam: string;
}

const TARGETS: Target[] = [
  { year: 2019, tour: "WTA", slam: "australian-open" },
  { year: 2020, tour: "ATP", slam: "us-open" },
  { year: 2021, tour: "ATP", slam: "australian-open" },
  { year: 2021, tour: "ATP", slam: "us-open" },
  { year: 2021, tour: "WTA", slam: "roland-garros" },
];

async function main(): Promise<void> {
  for (const { year, tour, slam } of TARGETS) {
    const label = `${year} ${tour} ${slam}`;
    const path = resolve(SLAMS_DIR, String(year), `${tour.toLowerCase()}-${slam}.json`);
    const snap = JSON.parse(await readFile(path, "utf8")) as Snapshot;

    const final = Object.values(snap.matches).find((m) => m.nextMatchId === null);
    if (!final) {
      console.warn(`${label}: no final found (nextMatchId===null) — skipped`);
      continue;
    }
    if (final.status !== "scheduled") {
      console.log(`${label}: final already ${final.status} — skipped`);
      continue;
    }

    const csv = await fetchMatchesCsv(tour, year).catch((err) => {
      console.warn(`${label}: CSV unavailable (${err}) — skipped`);
      return null;
    });
    if (csv === null) continue;

    const row = parseFinalRow(csv, slam);
    if (!row) {
      console.warn(`${label}: no Sackmann F row for slam — skipped`);
      continue;
    }

    if (!applyFinal(final, snap.players, row)) {
      console.warn(`${label}: name-join FAILED for "${row.winnerName}" (finalists left scheduled)`);
      continue;
    }

    await writeFile(path, JSON.stringify(snap));
    console.log(
      `${label}: ${row.winnerName} won — winner=${final.winner} status=${final.status} ` +
        `sets=${final.score?.length ?? 0} durationSec=${final.durationSec}`,
    );
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
