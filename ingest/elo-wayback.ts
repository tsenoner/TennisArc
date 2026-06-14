// Reproducible Wayback pipeline for the historical Elo reference fixture (committed tooling — replaces
// the old .scratch versions). Enumerates every distinct MONTHLY capture of Tennis Abstract's published
// Elo boards from the Internet Archive (CDX API; ~120/tour back to Feb 2016 — none predate it), downloads
// them into data/wayback/raw/, and extracts the top-N (name, overall) per board "Last update" date into
// ingest/fixtures/ta-elo-historical.json. Overall is cells[3] in every schema era (2016 = 8 cells,
// 2017-18 blended, 2019+ raw+blended, current = 17). The raw captures are also preserved as a committed
// tarball (data/wayback/ta-elo-boards-2016-2026.tar.gz) against Wayback loss; see data/README.md.
//   npx tsx ingest/elo-wayback.ts          # build the fixture from data/wayback/raw (or the tarball)
//   npx tsx ingest/elo-wayback.ts --fetch  # re-download every monthly capture first (network)
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Tour } from "../src/model";

const RAW = resolve(process.cwd(), "data/wayback/raw");
const OUT = resolve(process.cwd(), "ingest/fixtures/ta-elo-historical.json");
const TOP_N = 40;
const boardUrl = (tour: string) => `tennisabstract.com/reports/${tour}_elo_ratings.html`;

interface Board { date: number; players: { name: string; overall: number }[] }

/** Parse one archived board page into its "Last update" date + top-N (name, overall). */
export function parseBoard(html: string): Board | null {
  const m = html.match(/Last update:\s*(\d{4})-(\d{2})-(\d{2})/i);
  if (!m) return null;
  const date = Number(`${m[1]}${m[2]}${m[3]}`);
  const players: { name: string; overall: number }[] = [];
  for (const tr of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) =>
      c[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim());
    if (cells.length < 4) continue;
    const name = cells[1];
    const overall = Number.parseFloat(cells[3]);
    if (name && /[A-Za-z]/.test(name) && Number.isFinite(overall) && overall > 1000 && overall < 3000)
      players.push({ name, overall });
  }
  return players.length >= 30 ? { date, players: players.slice(0, TOP_N) } : null;
}

/** Download every distinct monthly capture of both boards into data/wayback/raw (idempotent). */
async function fetchCaptures(): Promise<void> {
  mkdirSync(RAW, { recursive: true });
  for (const tour of ["atp", "wta"]) {
    const cdx = `http://web.archive.org/cdx/search/cdx?url=${boardUrl(tour)}&output=text&fl=timestamp&filter=statuscode:200&collapse=timestamp:6`;
    const list = (await (await fetch(cdx)).text()).trim().split(/\r?\n/).filter(Boolean);
    for (const ts of list) {
      const out = resolve(RAW, `${tour}_${ts.slice(0, 8)}.html`);
      if (existsSync(out) && /last update/i.test(readFileSync(out, "utf8"))) continue;
      try {
        const html = await (await fetch(`https://web.archive.org/web/${ts}/https://${boardUrl(tour)}`)).text();
        if (/last update/i.test(html)) writeFileSync(out, html);
      } catch { /* skip a flaky capture */ }
    }
    console.log(`${tour}: ${readdirSync(RAW).filter((f) => f.startsWith(tour)).length} captures on disk`);
  }
}

/** Build the committed fixture from the captures in data/wayback/raw, deduping by board date. */
function buildFixture(): void {
  if (!existsSync(RAW)) throw new Error(`${RAW} missing — run with --fetch, or extract the tarball (see data/README.md)`);
  const out: Record<Tour, Board[]> = { ATP: [], WTA: [] };
  for (const t of ["ATP", "WTA"] as const) {
    const byDate = new Map<number, Board>();
    for (const f of readdirSync(RAW).filter((f) => f.startsWith(t.toLowerCase()) && f.endsWith(".html"))) {
      const b = parseBoard(readFileSync(resolve(RAW, f), "utf8"));
      if (!b) continue;
      const cur = byDate.get(b.date);
      if (!cur || b.players.length > cur.players.length) byDate.set(b.date, b);
    }
    out[t] = [...byDate.values()].sort((a, b) => a.date - b.date);
    const years = [...new Set(out[t].map((b) => Math.floor(b.date / 10000)))].sort();
    console.log(`${t}: ${out[t].length} board dates, ${out[t][0]?.date}..${out[t][out[t].length - 1]?.date}, years ${years.join(",")}`);
  }
  writeFileSync(OUT, JSON.stringify(out, null, 0) + "\n");
  console.log(`wrote ${OUT}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    if (process.argv.includes("--fetch")) await fetchCaptures();
    buildFixture();
  })().catch((e) => { console.error(e); process.exit(1); });
}
