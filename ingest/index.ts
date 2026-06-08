import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Snapshot, Tour } from "../src/model";
import { CURRENT_SLAM, DRAW_SIZE, SLAMS } from "./config";
import { openContext, fetchTournament, resolveSeasonId } from "./sofascore";
import { normalizeCuptrees } from "./normalize";
import { enrichMatch } from "./enrich";

const OUT_DIR = resolve(process.cwd(), "public/data");

async function ingestTour(tour: Tour, isoNow: string, nowSec: number): Promise<Snapshot> {
  const cfg = SLAMS[CURRENT_SLAM];
  const utId = cfg.unitournament[tour];
  const { browser, page } = await openContext();
  try {
    const seasonId = await resolveSeasonId(page, utId);
    const raw = await fetchTournament(page, utId, seasonId);
    const snap = normalizeCuptrees(raw.cuptrees as any, {
      tour, slam: cfg.slam, name: cfg.name, year: cfg.year, surface: cfg.surface,
      sofaUniqueTournamentId: utId, sofaSeasonId: seasonId, drawSize: DRAW_SIZE,
    });
    for (const match of Object.values(snap.matches)) {
      if (match.sofaEventId == null) continue;
      const e = raw.events.get(match.sofaEventId);
      if (!e?.detail) continue;
      snap.matches[match.id] = enrichMatch(match, e.detail as any, (e.stats as any) ?? null, snap.players, nowSec);
    }
    snap.generatedAt = isoNow;
    return snap;
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  const isoNow = new Date().toISOString();
  const nowSec = Math.floor(Date.now() / 1000);
  await mkdir(OUT_DIR, { recursive: true });
  for (const tour of ["ATP", "WTA"] as Tour[]) {
    try {
      const snap = await ingestTour(tour, isoNow, nowSec);
      const file = resolve(OUT_DIR, `${tour.toLowerCase()}.json`);
      await writeFile(file, JSON.stringify(snap));
      const played = Object.values(snap.matches).filter((m) => m.status !== "scheduled" && m.status !== "notstarted").length;
      console.log(`wrote ${file}: ${Object.keys(snap.matches).length} matches (${played} played), ${Object.keys(snap.players).length} players`);
    } catch (err) {
      console.error(`ingest ${tour} failed (keeping last-good ${tour}.json):`, err);
      process.exitCode = 1;
    }
  }
}
main().catch((err) => { console.error("ingest failed:", err); process.exitCode = 1; });
