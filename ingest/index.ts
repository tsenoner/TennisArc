import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { type AvailableSlam, type SlamIndex, type Snapshot, type Tour, snapshotPath } from "../src/model";
import { DRAW_SIZE, activeSlam, slamConfig, type SlamConfig } from "./config";
import { DrawNotReadyError, drawGap, entrantIds } from "./draw-ready";
import { openContext, fetchTournament, resolveSeasonId, fetchTeamCountry } from "./sofascore";
import { normalizeCuptrees } from "./normalize";
import { enrichMatch, carryForwardCountries, carryForwardSuspended, fillMissingCountries } from "./enrich";
import { fetchElo, applyElo } from "./elo";
import { fetchPlayers, applyBirthdates } from "./players";
import { availableSlamOf, mergeIndex, backfillTargets } from "./manifest";

const OUT_DIR = resolve(process.cwd(), "public/data");

async function ingestTour(cfg: SlamConfig, tour: Tour, isoNow: string, nowSec: number): Promise<Snapshot> {
  const utId = cfg.unitournament[tour];
  const { browser, page } = await openContext();
  try {
    let seasonId: number;
    try {
      seasonId = await resolveSeasonId(page, utId, cfg.year);
    } catch (err) {
      // Name the edition being asked for before the stack: after a season rollover the likeliest
      // cause is that SofaScore has no season for this year under this id (rotted id, or the
      // edition not published yet), and that is invisible in `pickSeasonId`'s message alone. The
      // original error rides along as the cause — it may equally be a Cloudflare block.
      throw new Error(
        `${cfg.slam} ${tour}: could not resolve the SofaScore ${cfg.year} season for uniqueTournament ${utId}`,
        { cause: err },
      );
    }
    const raw = await fetchTournament(page, utId, seasonId);
    const snap = normalizeCuptrees(raw.cuptrees as any, {
      tour, slam: cfg.slam, name: cfg.name, year: cfg.year, surface: cfg.surface,
      sofaUniqueTournamentId: utId, sofaSeasonId: seasonId, drawSize: DRAW_SIZE,
    });
    // Is there a draw at all? Checked here, before the enrichment fetches (Elo, birthdates, every
    // not-yet-played entrant's country) and before anything is written. The window deliberately
    // opens ahead of the draw release, so an unpublished bracket is the normal state for the first
    // cycles of a Slam and publishSlam counts it as "nothing to do"; the same shape once play has
    // started is a real regression and is thrown as an ordinary failure.
    const gap = drawGap(snap, DRAW_SIZE);
    if (gap) {
      const msg = `${cfg.slam} ${tour}: ${gap.reason} — keeping last-good`;
      throw gap.benign ? new DrawNotReadyError(msg) : new Error(msg);
    }
    for (const match of Object.values(snap.matches)) {
      if (match.sofaEventId == null) continue;
      const e = raw.events.get(match.sofaEventId);
      if (!e?.detail) continue;
      snap.matches[match.id] = enrichMatch(match, e.detail as any, (e.stats as any) ?? null, snap.players, nowSec);
    }
    // Tennis Abstract publishes *current* ratings only — stamping them onto a past year's
    // snapshot would be anachronistic, so historical backfills keep elo=null. On the live path
    // `cfg.year` IS the current UTC year by construction (activeSlam dates the edition off `now`),
    // so this only ever discriminates the backfill.
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
    // Not-yet-played entrants get no country from the (finished/live-only) event detail above, so
    // their flag would be missing — reuse last snapshot's country where we already know it, then look
    // up the rest off the team. Scope to the real draw entrants (round-0 participants); SofaScore also
    // seeds placeholder future-slot "teams" with no country that never render. Carry-forward is limited
    // to the still-not-yet-played entrants (whose nationality is immutable); once an entrant plays it
    // drops out of carry-forward, so its country is re-resolved from event detail / a fresh team lookup
    // rather than pinned to a possibly-stale cached value. Gated behind the draw-readiness guard
    // above so an unpublished-draw refresh that gets discarded doesn't pay for these lookups. Team
    // lookups are paced 60ms apart like fetchTournament to avoid provoking 429s; a sustained Cloudflare
    // block still relies on the refresh watchdog as the hard backstop. No-op once every match is finished.
    const { all: entrants, unplayed } = entrantIds(snap);
    const prior = await loadPriorSnapshot(tour, cfg.year, cfg.slam);
    const carried = carryForwardCountries(snap.players, prior?.players ?? null, unplayed);
    // Persist the sticky suspension flag: matches are re-derived from cuptrees each refresh, so a
    // once-suspended match would lose its flag once SofaScore reverts it to a plain "finished".
    const carriedSusp = carryForwardSuspended(snap.matches, prior?.matches ?? null);
    if (carriedSusp) console.log(`${cfg.slam} ${tour}: ${carriedSusp} suspension flag(s) carried forward`);
    const { filled, missing } = await fillMissingCountries(
      snap.players,
      async (teamId) => { const c = await fetchTeamCountry(page, teamId); await page.waitForTimeout(60); return c; },
      entrants,
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

/** The previous snapshot for a tour/year/slam, or null if there isn't a readable one yet (first run /
 *  missing / unreadable). Lets the country backfill reuse already-resolved countries instead of
 *  re-fetching every not-yet-played entrant's team, and lets the sticky suspension flag persist across
 *  refreshes (matches are re-derived from cuptrees each run, so the flag would otherwise reset). */
async function loadPriorSnapshot(tour: Tour, year: number, slam: string): Promise<Snapshot | null> {
  try {
    const raw = await readFile(resolve(OUT_DIR, snapshotPath(tour, year, slam)), "utf8");
    return JSON.parse(raw) as Snapshot;
  } catch {
    return null;
  }
}

/**
 * Ingest both tours for one slam config; write per-slam files; return the manifest entries plus how
 * many tours failed for a reason OTHER than "the draw isn't published yet". The two must stay
 * distinguishable because they mean opposite things about the system: a window that opened ahead of
 * the draw release is it working as designed, while a missing season, a rotted id or a dead network
 * is the failure the dead-man ping exists to surface. The caller reads `broken` only when NOTHING
 * published — a tour that fails while the other succeeds still exits 0, as it always has
 * (partial-failure exit codes are issue #207).
 */
async function publishSlam(
  cfg: SlamConfig, isoNow: string, nowSec: number,
): Promise<{ entries: AvailableSlam[]; broken: number }> {
  const entries: AvailableSlam[] = [];
  let broken = 0;
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
      if (err instanceof DrawNotReadyError) console.log(`ingest ${cfg.slam} ${tour} skipped: ${err.message}`);
      else { broken++; console.error(`ingest ${cfg.slam} ${tour} failed (keeping last-good):`, err); }
    }
  }
  return { entries, broken };
}

async function main(): Promise<void> {
  const backfill = backfillTargets(process.env.BACKFILL_YEARS, process.env.BACKFILL_SLAMS);
  if (backfill.length) {
    const isoNow = new Date().toISOString();
    const nowSec = Math.floor(Date.now() / 1000);
    await mkdir(OUT_DIR, { recursive: true });
    let entries: AvailableSlam[] = [];
    for (const { year, slam } of backfill) {
      console.log(`backfill: ${slam} (${year})`);
      // Deliberately ignores the failure count: a backfill sweep tolerates editions SofaScore has
      // no usable draw for (e.g. the missing 2011 ATP US Open) and keeps going.
      entries = entries.concat((await publishSlam(slamConfig(slam, year), isoNow, nowSec)).entries);
    }
    const idx = await loadIndex();
    const merged: SlamIndex = { schemaVersion: 2, generatedAt: isoNow, slams: mergeIndex(idx.slams, entries) };
    await writeFile(resolve(OUT_DIR, "index.json"), JSON.stringify(merged));
    console.log(`backfill done — index.json: ${merged.slams.length} slams`);
    return;
  }
  const active = activeSlam();
  if (!active) {
    console.log("no Slam in progress — skipping refresh (between tournaments, data unchanged)");
    return;
  }
  const isoNow = new Date().toISOString();
  const nowSec = Math.floor(Date.now() / 1000);
  const cfg = slamConfig(active.slam, active.year);
  console.log(`tracking slam: ${cfg.slam} (${cfg.year})`);
  await mkdir(OUT_DIR, { recursive: true });

  const { entries, broken } = await publishSlam(cfg, isoNow, nowSec);
  if (entries.length === 0) {
    if (broken === 0) {
      // Both tours reported an unpublished draw. The window opens ahead of the draw release on
      // purpose, so this is a normal pre-tournament cycle: exit 0, leaving the dead-man ping green
      // and letting publish-data.sh carry forward and reindex as usual.
      console.log(`${cfg.slam} ${cfg.year}: no published draw yet — nothing to refresh this cycle`);
      return;
    }
    // Inside an open window with nothing publishable and a real error: fail loudly so the runner
    // pings /fail. The likeliest cause after a season rollover is that SofaScore has no season for
    // this year under these ids, which is invisible from the alert alone — so name them.
    console.error(
      `no tour published for ${cfg.slam} ${cfg.year} inside its active window (${broken} failed). ` +
      `If this persists, check that SofaScore publishes a ${cfg.year} season for uniqueTournament ` +
      `${cfg.unitournament.ATP} (ATP) / ${cfg.unitournament.WTA} (WTA).`,
    );
    process.exitCode = 1; return;
  }

  const idx = await loadIndex();
  const merged: SlamIndex = { schemaVersion: 2, generatedAt: isoNow, slams: mergeIndex(idx.slams, entries) };
  await writeFile(resolve(OUT_DIR, "index.json"), JSON.stringify(merged));
  console.log(`index.json: ${merged.slams.length} slams`);
}

main().catch((err) => { console.error("ingest failed:", err); process.exitCode = 1; });
