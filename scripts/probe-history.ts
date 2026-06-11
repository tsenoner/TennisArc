// One-off probe: how far back does SofaScore have usable Grand Slam data?
// For every (slam, tour) pair in ingest/config.ts, list the seasons SofaScore knows about, then
// walk them newest→oldest fetching /cuptrees to find where real draws end. Also samples one event
// per era to see when per-match detail and statistics start existing. Needs a residential IP and
// the sandbox off (Cloudflare). Run: pnpm tsx scripts/probe-history.ts [--json out.json]
import { writeFile } from "node:fs/promises";
import { SLAMS } from "../ingest/config";
import { apiGet, openContext } from "../ingest/sofascore";
import type { Page } from "playwright";

const DELAY_MS = 80;
const MAX_SEASON_PROBES = 80; // per (slam, tour) pair
const STOP_AFTER_EMPTY = 4; // consecutive seasons without a cuptree → assume nothing older

interface SeasonProbe {
  year: number;
  seasonId: number;
  events: number; // finished/in-progress event ids reachable from the cuptrees (127 ⇒ full 128 draw)
  trees: number;
  rounds: number;
  sampleEventId: number | null;
  error?: string;
}

interface PairReport {
  slam: string;
  tour: string;
  utId: number;
  seasonsListed: number;
  newestYear: number | null;
  oldestYearListed: number | null;
  probes: SeasonProbe[];
  oldestUsableYear: number | null; // oldest season whose cuptree yields ≥ half a 128-draw
  samples: { year: number; eventId: number; hasDetail: boolean; hasStats: boolean; hasPower: boolean }[];
}

function summarizeCuptrees(j: any): { events: number; trees: number; rounds: number; sampleEventId: number | null } {
  const ids = new Set<number>();
  let trees = 0;
  let rounds = 0;
  for (const tree of j?.cupTrees ?? []) {
    trees++;
    rounds = Math.max(rounds, (tree.rounds ?? []).length);
    for (const round of tree.rounds ?? [])
      for (const block of round.blocks ?? [])
        if ((block.finished || block.eventInProgress) && Array.isArray(block.events))
          for (const id of block.events) ids.add(id);
  }
  const first = ids.values().next();
  return { events: ids.size, trees, rounds, sampleEventId: first.done ? null : first.value };
}

async function probePair(page: Page, slam: string, tour: string, utId: number): Promise<PairReport> {
  const report: PairReport = {
    slam, tour, utId, seasonsListed: 0, newestYear: null, oldestYearListed: null,
    probes: [], oldestUsableYear: null, samples: [],
  };
  let seasons: { id: number; year?: string }[] = [];
  try {
    seasons = ((await apiGet(page, `/unique-tournament/${utId}/seasons`)) as any).seasons ?? [];
  } catch (err) {
    console.error(`${slam} ${tour}: seasons list failed: ${err}`);
    return report;
  }
  const byYear = seasons
    .map((s) => ({ id: s.id, year: Number(s.year) }))
    .filter((s) => Number.isFinite(s.year))
    .sort((a, b) => b.year - a.year);
  report.seasonsListed = byYear.length;
  report.newestYear = byYear[0]?.year ?? null;
  report.oldestYearListed = byYear[byYear.length - 1]?.year ?? null;

  let consecutiveEmpty = 0;
  for (const s of byYear.slice(0, MAX_SEASON_PROBES)) {
    await page.waitForTimeout(DELAY_MS);
    try {
      const j = await apiGet(page, `/unique-tournament/${utId}/season/${s.id}/cuptrees`);
      const sum = summarizeCuptrees(j);
      report.probes.push({ year: s.year, seasonId: s.id, ...sum });
      if (sum.events > 0) consecutiveEmpty = 0;
      else consecutiveEmpty++;
    } catch (err) {
      report.probes.push({ year: s.year, seasonId: s.id, events: 0, trees: 0, rounds: 0, sampleEventId: null, error: String(err).slice(0, 60) });
      consecutiveEmpty++;
    }
    if (consecutiveEmpty >= STOP_AFTER_EMPTY) break;
  }
  // "usable" = a substantially complete 128-draw (≥64 reachable events), not just a final-rounds stub
  const usable = report.probes.filter((p) => p.events >= 64);
  report.oldestUsableYear = usable.length ? Math.min(...usable.map((p) => p.year)) : null;

  // Sample per-era event detail + statistics availability (oldest usable, then one per ~5y era)
  const eras = new Set<number>();
  if (report.oldestUsableYear != null) eras.add(report.oldestUsableYear);
  for (const y of [2000, 2005, 2010, 2015, 2020]) {
    const p = usable.find((u) => u.year === y);
    if (p) eras.add(y);
  }
  for (const y of [...eras].sort()) {
    const p = report.probes.find((pp) => pp.year === y && pp.sampleEventId != null);
    if (!p?.sampleEventId) continue;
    await page.waitForTimeout(DELAY_MS);
    let hasDetail = false, hasStats = false, hasPower = false;
    try {
      const d = await apiGet(page, `/event/${p.sampleEventId}`);
      hasDetail = Boolean(d?.event ?? d);
    } catch { /* not available */ }
    try {
      const st = await apiGet(page, `/event/${p.sampleEventId}/statistics`);
      hasStats = Boolean((st?.statistics ?? []).length);
    } catch { /* not available */ }
    try {
      const pw = await apiGet(page, `/event/${p.sampleEventId}/graph`);
      hasPower = Boolean((pw?.graphPoints ?? []).length);
    } catch { /* not available */ }
    report.samples.push({ year: y, eventId: p.sampleEventId, hasDetail, hasStats, hasPower });
  }
  return report;
}

function fmt(r: PairReport): string {
  const probed = r.probes.filter((p) => p.events > 0);
  const oldestAny = probed.length ? Math.min(...probed.map((p) => p.year)) : null;
  const lines = [
    `\n=== ${r.slam} ${r.tour} (ut ${r.utId}) ===`,
    `seasons listed: ${r.seasonsListed} (${r.oldestYearListed}–${r.newestYear})`,
    `oldest season with ANY cuptree events: ${oldestAny ?? "none"}`,
    `oldest season with a usable draw (≥64 events): ${r.oldestUsableYear ?? "none"}`,
    `per-season events (year:events/rounds): ${r.probes
      .slice()
      .sort((a, b) => a.year - b.year)
      .map((p) => `${p.year}:${p.events}/${p.rounds}${p.error ? "!" : ""}`)
      .join(" ")}`,
    `era samples (detail/stats/power): ${r.samples.map((s) => `${s.year}:${s.hasDetail ? "D" : "-"}${s.hasStats ? "S" : "-"}${s.hasPower ? "P" : "-"}`).join(" ") || "none"}`,
  ];
  return lines.join("\n");
}

async function main(): Promise<void> {
  const jsonOut = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;
  const { browser, page } = await openContext();
  const reports: PairReport[] = [];
  try {
    for (const cfg of Object.values(SLAMS)) {
      for (const tour of ["ATP", "WTA"] as const) {
        const r = await probePair(page, cfg.slam, tour, cfg.unitournament[tour]);
        reports.push(r);
        console.log(fmt(r));
      }
    }
  } finally {
    await browser.close();
  }
  if (jsonOut) {
    await writeFile(jsonOut, JSON.stringify(reports, null, 2));
    console.log(`\nwrote ${jsonOut}`);
  }
}

main().catch((err) => { console.error("probe failed:", err); process.exitCode = 1; });
