import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type AvailableSlam, type SlamIndex, type Snapshot, type Tour, snapshotFilename } from "../src/model";
import { DRAW_SIZE, SLAMS, activeSlam, type SlamConfig } from "./config";
import { openContext, fetchTournament, resolveSeasonId } from "./sofascore";
import { normalizeCuptrees } from "./normalize";
import { enrichMatch } from "./enrich";
import { fetchElo, applyElo } from "./elo";
import { fetchPlayers, applyBirthdates } from "./players";
import { availableSlamOf, mergeIndex, backfillTargets } from "./manifest";

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
    try {
      const elo = await fetchElo(tour);
      const { matched, unmatched } = applyElo(snap.players, elo);
      console.log(`${cfg.slam} ${tour}: ELO matched ${matched}/${Object.keys(snap.players).length} (${unmatched.length} unmatched)`);
    } catch (err) {
      console.warn(`${cfg.slam} ${tour}: ELO enrichment skipped (keeping elo=null):`, err);
    }
    try {
      const dob = await fetchPlayers(tour);
      const { matched, unmatched } = applyBirthdates(snap.players, dob);
      console.log(`${cfg.slam} ${tour}: birthdates matched ${matched} (${unmatched} unmatched)`);
    } catch (err) {
      console.warn(`${cfg.slam} ${tour}: birthdate enrichment skipped:`, err);
    }
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

async function loadIndex(): Promise<SlamIndex> {
  try {
    return JSON.parse(await readFile(resolve(OUT_DIR, "index.json"), "utf8")) as SlamIndex;
  } catch {
    return { schemaVersion: 2, generatedAt: "", slams: [] };
  }
}

/** Ingest both tours for one slam config; write per-slam files (+ active alias); return manifest entries. */
async function publishSlam(cfg: SlamConfig, isoNow: string, nowSec: number, writeAlias: boolean): Promise<AvailableSlam[]> {
  const entries: AvailableSlam[] = [];
  for (const tour of ["ATP", "WTA"] as Tour[]) {
    try {
      const snap = await ingestTour(cfg, tour, isoNow, nowSec);
      await writeFile(resolve(OUT_DIR, snapshotFilename(tour, cfg.year, cfg.slam)), JSON.stringify(snap));
      if (writeAlias) await writeFile(resolve(OUT_DIR, `${tour.toLowerCase()}.json`), JSON.stringify(snap));
      const played = Object.values(snap.matches).filter((m) => m.status !== "scheduled" && m.status !== "notstarted").length;
      console.log(`wrote ${snapshotFilename(tour, cfg.year, cfg.slam)}: ${Object.keys(snap.matches).length} matches (${played} played)`);
      entries.push(availableSlamOf(snap));
    } catch (err) {
      console.error(`ingest ${cfg.slam} ${tour} failed (keeping last-good):`, err);
    }
  }
  return entries;
}

async function main(): Promise<void> {
  const backfill = backfillTargets(process.env.BACKFILL_YEARS, process.env.BACKFILL_SLAMS);
  if (backfill.length) {
    const isoNow = new Date().toISOString();
    const nowSec = Math.floor(Date.now() / 1000);
    await mkdir(OUT_DIR, { recursive: true });
    let entries: AvailableSlam[] = [];
    for (const { year, slam } of backfill) {
      const cfg = { ...SLAMS[slam], year };
      console.log(`backfill: ${slam} (${year})`);
      entries = entries.concat(await publishSlam(cfg, isoNow, nowSec, false));
    }
    const idx = await loadIndex();
    const merged: SlamIndex = { schemaVersion: 2, generatedAt: isoNow, slams: mergeIndex(idx.slams, entries) };
    await writeFile(resolve(OUT_DIR, "index.json"), JSON.stringify(merged));
    console.log(`backfill done — index.json: ${merged.slams.length} slams`);
    return;
  }
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

  const entries = await publishSlam(cfg, isoNow, nowSec, true);
  if (entries.length === 0) { console.error("ingest failed for all tours"); process.exitCode = 1; return; }

  const idx = await loadIndex();
  const merged: SlamIndex = { schemaVersion: 2, generatedAt: isoNow, slams: mergeIndex(idx.slams, entries) };
  await writeFile(resolve(OUT_DIR, "index.json"), JSON.stringify(merged));
  console.log(`index.json: ${merged.slams.length} slams`);
}

main().catch((err) => { console.error("ingest failed:", err); process.exitCode = 1; });
