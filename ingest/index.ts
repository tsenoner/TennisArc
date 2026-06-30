import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { type AvailableSlam, type Player, type SlamIndex, type Snapshot, type Tour, snapshotPath } from "../src/model";
import { DRAW_SIZE, SLAMS, activeSlam, type SlamConfig } from "./config";
import { openContext, fetchTournament, resolveSeasonId, fetchTeamCountry } from "./sofascore";
import { normalizeCuptrees } from "./normalize";
import { enrichMatch, carryForwardCountries, fillMissingCountries } from "./enrich";
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
    // Tennis Abstract publishes *current* ratings only — stamping them onto a past year's
    // snapshot would be anachronistic, so historical backfills keep elo=null.
    if (cfg.year === new Date().getUTCFullYear()) {
      try {
        const elo = await fetchElo(tour);
        const { matched, unmatched } = applyElo(snap.players, elo);
        console.log(`${cfg.slam} ${tour}: ELO matched ${matched}/${Object.keys(snap.players).length} (${unmatched.length} unmatched)`);
      } catch (err) {
        console.warn(`${cfg.slam} ${tour}: ELO enrichment skipped (keeping elo=null):`, err);
      }
    } else {
      console.log(`${cfg.slam} ${tour}: past season — ELO left null (only current ratings exist)`);
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
    // Not-yet-played entrants get no country from the (finished/live-only) event detail above, so
    // their flag would be missing — reuse last snapshot's country where we already know it, then look
    // up the rest off the team. Scope to the real draw entrants (round-0 participants); SofaScore also
    // seeds placeholder future-slot "teams" with no country that never render. Carry-forward is limited
    // to the still-not-yet-played entrants (whose nationality is immutable); once an entrant plays it
    // drops out of carry-forward, so its country is re-resolved from event detail / a fresh team lookup
    // rather than pinned to a possibly-stale cached value. Gated behind the draw-availability guard
    // above so an incomplete-draw refresh that gets discarded doesn't pay for these lookups. Team
    // lookups are paced 60ms apart like fetchTournament to avoid provoking 429s; a sustained Cloudflare
    // block still relies on the refresh watchdog as the hard backstop. No-op once every match is finished.
    const entrantIds = new Set<string>();
    const unplayedEntrantIds = new Set<string>();
    for (const id of snap.rounds[0]?.matchIds ?? []) {
      const m = snap.matches[id];
      const notYetPlayed = m.status === "scheduled" || m.status === "notstarted";
      for (const pid of [m.p1, m.p2]) {
        if (!pid) continue;
        entrantIds.add(pid);
        if (notYetPlayed) unplayedEntrantIds.add(pid);
      }
    }
    const prior = await loadPriorPlayers(tour, cfg.year, cfg.slam);
    const carried = carryForwardCountries(snap.players, prior, unplayedEntrantIds);
    const { filled, missing } = await fillMissingCountries(
      snap.players,
      async (teamId) => { const c = await fetchTeamCountry(page, teamId); await page.waitForTimeout(60); return c; },
      entrantIds,
    );
    if (carried || missing) console.log(`${cfg.slam} ${tour}: countries ${carried} reused, ${filled}/${missing} fetched`);
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

/** The previous snapshot's players map for a tour/year/slam, or null if there isn't a readable one
 *  yet (first run / missing / unreadable). Lets the country backfill reuse already-resolved countries
 *  instead of re-fetching every not-yet-played entrant's team on every refresh. */
async function loadPriorPlayers(tour: Tour, year: number, slam: string): Promise<Record<string, Player> | null> {
  try {
    const raw = await readFile(resolve(OUT_DIR, snapshotPath(tour, year, slam)), "utf8");
    return (JSON.parse(raw) as Snapshot).players ?? null;
  } catch {
    return null;
  }
}

/** Ingest both tours for one slam config; write per-slam files; return manifest entries. */
async function publishSlam(cfg: SlamConfig, isoNow: string, nowSec: number): Promise<AvailableSlam[]> {
  const entries: AvailableSlam[] = [];
  for (const tour of ["ATP", "WTA"] as Tour[]) {
    try {
      const snap = await ingestTour(cfg, tour, isoNow, nowSec);
      const file = resolve(OUT_DIR, snapshotPath(tour, cfg.year, cfg.slam));
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(snap));
      const played = Object.values(snap.matches).filter((m) => m.status !== "scheduled" && m.status !== "notstarted").length;
      console.log(`wrote ${snapshotPath(tour, cfg.year, cfg.slam)}: ${Object.keys(snap.matches).length} matches (${played} played)`);
      entries.push(availableSlamOf(snap, new Date(isoNow)));
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
      entries = entries.concat(await publishSlam(cfg, isoNow, nowSec));
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

  const entries = await publishSlam(cfg, isoNow, nowSec);
  if (entries.length === 0) { console.error("ingest failed for all tours"); process.exitCode = 1; return; }

  const idx = await loadIndex();
  const merged: SlamIndex = { schemaVersion: 2, generatedAt: isoNow, slams: mergeIndex(idx.slams, entries) };
  await writeFile(resolve(OUT_DIR, "index.json"), JSON.stringify(merged));
  console.log(`index.json: ${merged.slams.length} slams`);
}

main().catch((err) => { console.error("ingest failed:", err); process.exitCode = 1; });
