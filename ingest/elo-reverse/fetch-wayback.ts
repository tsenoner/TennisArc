// Full Wayback acquisition for ALL four Tennis Abstract Elo leaderboards (issue #25, 2026-06-15).
//   ATP Elo  : tennisabstract.com/reports/atp_elo_ratings.html          (793 captures, 412 distinct)
//   ATP yElo : tennisabstract.com/reports/atp_season_yelo_ratings.html  (42 captures,  34 distinct)
//   WTA Elo  : tennisabstract.com/reports/wta_elo_ratings.html          (542 captures, 271 distinct)
//   WTA yElo : tennisabstract.com/reports/wta_season_yelo_ratings.html  (42 captures,  36 distinct)
// We fetch every DISTINCT-CONTENT capture (CDX collapse=digest, statuscode:200) — i.e. every board state
// TA ever published that the Internet Archive saved; the un-counted remainder are byte-identical re-archives
// that carry no new information. Captures land in data/wayback/raw-full/{slug}_{YYYYMMDDhhmmss}.html.
// Idempotent + resumable (skips files already on disk that contain "Last update"); polite (small concurrency,
// retry w/ backoff). Network → must run with the sandbox OFF.
//   npx tsx ingest/elo-reverse/fetch-wayback.ts            # fetch all four reports
//   npx tsx ingest/elo-reverse/fetch-wayback.ts atp_season_yelo_ratings   # one report only
import { mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { cdxTimestamps, fetchWaybackCapture, pool } from "./wayback";

const OUT = resolve(process.cwd(), "data/wayback/raw-full");
const REPORTS = [
  "atp_elo_ratings",
  "atp_season_yelo_ratings",
  "wta_elo_ratings",
  "wta_season_yelo_ratings",
] as const;

/** Distinct-content capture timestamps for one report, newest-content-first dedup by digest. */
function cdxList(slug: string): Promise<string[]> {
  const url =
    `http://web.archive.org/cdx/search/cdx?url=tennisabstract.com/reports/${slug}.html` +
    `&output=text&fl=timestamp,digest&filter=statuscode:200&collapse=digest`;
  // fl=timestamp,digest → keep field 0; drop non-14-digit lines; 5 attempts (4 retries) w/ 1s*n
  // backoff on every failure (incl. the last) before throwing `CDX failed`.
  return cdxTimestamps(url, {
    retries: 4,
    backoffMs: 1000,
    backoffOnExhaust: true,
    mapLine: (l) => l.split(" ")[0],
    keep: (t) => /^\d{14}$/.test(t),
    onExhausted: () => { throw new Error(`CDX failed for ${slug}`); },
  });
}

function fetchCapture(slug: string, ts: string): Promise<"saved" | "skip" | "fail"> {
  // 4 attempts (3 retries); UA header; honour res.ok (700ms*n backoff on bad status, even last attempt);
  // 900ms*n backoff on every thrown error (incl. the last); {slug}_{14-digit-ts}.html on disk.
  return fetchWaybackCapture(slug, ts, resolve(OUT, `${slug}_${ts}.html`), {
    headers: { "User-Agent": "TennisArc-elo-research/1.0" },
    retries: 3,
    checkOk: true,
    okBackoffMs: 700,
    errBackoffMs: 900,
    errBackoffOnExhaust: true,
  });
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const only = process.argv[2];
  const reports = only ? REPORTS.filter((r) => r === only) : [...REPORTS];
  for (const slug of reports) {
    const list = await cdxList(slug);
    let saved = 0, skip = 0, fail = 0;
    await pool(list, 5, async (ts) => {
      const r = await fetchCapture(slug, ts);
      if (r === "saved") saved++; else if (r === "skip") skip++; else fail++;
      const done = saved + skip + fail;
      if (done % 25 === 0 || done === list.length)
        console.log(`  ${slug}: ${done}/${list.length}  (saved ${saved}, skip ${skip}, fail ${fail})`);
    });
    console.log(`${slug}: DONE — ${list.length} distinct captures → saved ${saved}, skip ${skip}, fail ${fail}`);
  }
  const onDisk = readdirSync(OUT).filter((f) => f.endsWith(".html"));
  const byReport: Record<string, number> = {};
  for (const f of onDisk) { const k = f.replace(/_\d{14}\.html$/, ""); byReport[k] = (byReport[k] ?? 0) + 1; }
  console.log(`\nraw-full on disk: ${onDisk.length} files`);
  for (const [k, n] of Object.entries(byReport)) console.log(`  ${k}: ${n}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
