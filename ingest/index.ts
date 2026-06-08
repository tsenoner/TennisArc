import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Snapshot, Tour } from "../src/model";
import { DRAW_SIZE, SLAMS, activeSlam, type SlamConfig } from "./config";
import { openContext, fetchTournament, resolveSeasonId } from "./sofascore";
import { normalizeCuptrees } from "./normalize";
import { enrichMatch } from "./enrich";

const OUT_DIR = resolve(process.cwd(), "public/data");

async function ingestTour(cfg: SlamConfig, tour: Tour, isoNow: string, nowSec: number): Promise<Snapshot> {
  const utId = cfg.unitournament[tour];
  const { browser, page } = await openContext();
  try {
    const seasonId = await resolveSeasonId(page, utId, cfg.year);
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
    // Guard against an unreleased/partial draw (e.g. right after a slam switch, before the new
    // bracket is published): keep last-good rather than publishing a broken bracket.
    const matchCount = Object.keys(snap.matches).length;
    if (matchCount < DRAW_SIZE - 1) {
      throw new Error(`${cfg.slam} ${tour}: draw not fully available yet (${matchCount}/${DRAW_SIZE - 1} matches) — keeping last-good`);
    }
    snap.generatedAt = isoNow;
    return snap;
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  // Only fetch while a Slam is actually in progress. Between tournaments the bracket is frozen, so
  // skip before launching any browser — the published data branch keeps the last Slam's final state.
  const slamKey = activeSlam();
  if (!slamKey) {
    console.log("no Slam in progress — skipping refresh (between tournaments, data unchanged)");
    return;
  }
  const isoNow = new Date().toISOString();
  const nowSec = Math.floor(Date.now() / 1000);
  const cfg = SLAMS[slamKey];
  console.log(`tracking slam: ${cfg.slam} (${cfg.year})`);
  await mkdir(OUT_DIR, { recursive: true });
  let ok = 0;
  for (const tour of ["ATP", "WTA"] as Tour[]) {
    try {
      const snap = await ingestTour(cfg, tour, isoNow, nowSec);
      const file = resolve(OUT_DIR, `${tour.toLowerCase()}.json`);
      await writeFile(file, JSON.stringify(snap));
      const played = Object.values(snap.matches).filter((m) => m.status !== "scheduled" && m.status !== "notstarted").length;
      console.log(`wrote ${file}: ${Object.keys(snap.matches).length} matches (${played} played), ${Object.keys(snap.players).length} players`);
      ok++;
    } catch (err) {
      console.error(`ingest ${tour} failed (keeping last-good ${tour}.json):`, err);
    }
  }
  if (ok === 0) { console.error("ingest failed for all tours"); process.exitCode = 1; }
}
main().catch((err) => { console.error("ingest failed:", err); process.exitCode = 1; });
