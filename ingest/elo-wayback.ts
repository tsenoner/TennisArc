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
import { parseBoard as parseFullBoard } from "./elo-reverse/parse-boards";
import { cdxTimestamps, fetchWaybackCapture } from "./elo-reverse/wayback";
import { dedupeByDateKeepDeepest } from "./elo-reverse/lib";

const RAW = resolve(process.cwd(), "data/wayback/raw");
const OUT = resolve(process.cwd(), "ingest/fixtures/ta-elo-historical.json");
const TOP_N = 40;
const eloSlug = (tour: string) => `${tour}_elo_ratings`; // tennisabstract.com/reports/{slug}.html

interface Board { date: number; players: { name: string; overall: number }[] }

/**
 * Parse one archived board page into its "Last update" date + top-N (name, overall).
 * Delegates the full parse to elo-reverse/parse-boards (one shared parser) and projects it to this
 * fixture's thin shape: top-`TOP_N` rows, only (name, overall). The tour/captureDate args are unused
 * by the projection here, so we pass placeholders. (parse-boards keeps every valid row at overall>800;
 * the band 800<overall<=1000 never occurs in any archived board, so this is identical to the old
 * overall>1000 cut.)
 */
export function parseBoard(html: string): Board | null {
  const b = parseFullBoard(html, "ATP", 0);
  if (!b) return null;
  return { date: b.lastUpdate, players: b.players.slice(0, TOP_N).map((p) => ({ name: p.name, overall: p.overall })) };
}

/** Download every distinct monthly capture of both boards into data/wayback/raw (idempotent). */
async function fetchCaptures(): Promise<void> {
  mkdirSync(RAW, { recursive: true });
  for (const tour of ["atp", "wta"]) {
    const slug = eloSlug(tour);
    const cdx = `http://web.archive.org/cdx/search/cdx?url=tennisabstract.com/reports/${slug}.html&output=text&fl=timestamp&filter=statuscode:200&collapse=timestamp:6`;
    const list = await cdxTimestamps(cdx); // fl=timestamp → identity map, drop only empty lines, no retry
    for (const ts of list) {
      // monthly fixture keeps an 8-digit (YYYYMMDD) filename; single attempt, no UA, status ignored.
      await fetchWaybackCapture(slug, ts, resolve(RAW, `${tour}_${ts.slice(0, 8)}.html`));
    }
    console.log(`${tour}: ${readdirSync(RAW).filter((f) => f.startsWith(tour)).length} captures on disk`);
  }
}

/** Build the committed fixture from the captures in data/wayback/raw, deduping by board date. */
function buildFixture(): void {
  if (!existsSync(RAW)) throw new Error(`${RAW} missing — run with --fetch, or extract the tarball (see data/README.md)`);
  const out: Record<Tour, Board[]> = { ATP: [], WTA: [] };
  for (const t of ["ATP", "WTA"] as const) {
    const parsed: Board[] = [];
    for (const f of readdirSync(RAW).filter((f) => f.startsWith(t.toLowerCase()) && f.endsWith(".html"))) {
      const b = parseBoard(readFileSync(resolve(RAW, f), "utf8"));
      if (b) parsed.push(b);
    }
    out[t] = dedupeByDateKeepDeepest(parsed, (b) => b.date, (b) => b.players.length);
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
