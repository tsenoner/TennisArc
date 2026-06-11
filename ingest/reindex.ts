import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { AvailableSlam, SlamIndex, Snapshot } from "../src/model";
import { availableSlamOf } from "./manifest";

const OUT_DIR = resolve(process.cwd(), "public/data");

// Per-slam snapshots live at "slams/{year}/{tour}-{slam}.json". The manifest (index.json)
// and any legacy flat-layout leftovers at the root are deliberately excluded.
const SNAP_RE = /^slams\/\d{4}\/(atp|wta)-[a-z0-9-]+\.json$/;

/**
 * Rebuild the manifest from every per-slam snapshot on disk — no network, no scrape.
 * Used to freeze a backfilled slam into the seed (and as the canonical "manifest from
 * files" step). `generatedAt` is the newest snapshot's stamp so the output is
 * deterministic (re-running on the same files yields a byte-identical index).
 */
export async function reindex(dir = OUT_DIR): Promise<SlamIndex> {
  const files = (await readdir(dir, { recursive: true }))
    .map((f) => f.split(sep).join("/"))
    .filter((f) => SNAP_RE.test(f))
    .sort();
  const entries: AvailableSlam[] = [];
  for (const f of files) {
    const snap = JSON.parse(await readFile(resolve(dir, f), "utf8")) as Snapshot;
    entries.push(availableSlamOf(snap));
  }
  entries.sort((a, b) => b.year - a.year || a.slam.localeCompare(b.slam) || a.tour.localeCompare(b.tour));
  return {
    schemaVersion: 2,
    generatedAt: entries.reduce((max, e) => (e.generatedAt > max ? e.generatedAt : max), ""),
    slams: entries,
  };
}

async function main(): Promise<void> {
  const index = await reindex();
  await writeFile(resolve(OUT_DIR, "index.json"), JSON.stringify(index));
  console.log(`reindex: ${index.slams.length} slams → ${index.slams.map((s) => `${s.tour}/${s.year}/${s.slam}`).join(", ")}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error("reindex failed:", err); process.exitCode = 1; });
}
