// Shared Internet-Archive (Wayback) acquisition helpers for the Elo-board scrapers.
// Both ingest/elo-wayback.ts (monthly fixture) and ingest/elo-reverse/fetch-wayback.ts (dense
// distinct-content captures) build the SAME CDX query + capture-download-with-skip; the only
// per-script differences (CDX fl/collapse, retry counts, concurrency, on-disk filename, headers,
// return value) are passed in as options so each script's prior on-the-wire behavior is preserved
// EXACTLY. Network → these run only with the sandbox OFF; this module makes no calls itself.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch a CDX capture listing and return its lines mapped to timestamps. Shared core = the fetch +
 * `.trim().split(/\r?\n/)` listing parse + the "empty body → []" short-circuit; per-script knobs:
 *   - `url`        full cdx/search/cdx URL the caller built (fl/collapse/filter already baked in).
 *   - `mapLine`    line → timestamp (identity for `fl=timestamp`; `l.split(" ")[0]` for
 *                  `fl=timestamp,digest`); default = the raw line.
 *   - `keep`       per-timestamp predicate (default `Boolean`, i.e. drop only empty lines).
 *   - `retries`    extra attempts on fetch error after the first; `backoffMs*(attempt+1)` backoff.
 *                  retries=0 ⇒ one attempt whose error propagates verbatim (elo-wayback's old behavior).
 *   - `backoffOnExhaust` also sleep after the LAST failed attempt before giving up (fetch-wayback
 *                  slept on every iteration including the final one; elo-wayback never slept).
 *   - `onExhausted` thrown after all attempts fail (fetch-wayback's `CDX failed` error); if omitted,
 *                  the last caught fetch error is re-thrown.
 */
export async function cdxTimestamps(
  url: string,
  opts: {
    mapLine?: (line: string) => string;
    keep?: (ts: string) => boolean;
    retries?: number;
    backoffMs?: number;
    backoffOnExhaust?: boolean;
    onExhausted?: () => never;
  } = {},
): Promise<string[]> {
  const mapLine = opts.mapLine ?? ((l) => l);
  const keep = opts.keep ?? Boolean;
  const retries = opts.retries ?? 0;
  const backoffMs = opts.backoffMs ?? 1000;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const txt = (await (await fetch(url)).text()).trim();
      if (!txt) return [];
      return txt.split(/\r?\n/).map(mapLine).filter(keep);
    } catch (e) {
      lastErr = e;
      if (attempt < retries || opts.backoffOnExhaust) await sleep(backoffMs * (attempt + 1));
    }
  }
  if (opts.onExhausted) opts.onExhausted();
  throw lastErr;
}

/**
 * Download one Wayback capture of `tennisabstract.com/reports/{slug}.html` at timestamp `ts` to
 * `outPath`, skipping when a good copy is already on disk. Shared core: snapshot URL + on-disk skip
 * check + "save only if the page contains 'Last update'". The retry/header policy is supplied so each
 * caller keeps its exact prior behavior:
 *   - `headers`   request headers (fetch-wayback sends a UA; elo-wayback sent none).
 *   - `retries`   attempts after the first on failure; default 0 (single attempt).
 *   - `checkOk`   honour `res.ok` (fetch-wayback) vs ignore status (elo-wayback).
 *   - `okBackoffMs`/`errBackoffMs` per-reason backoff between attempts.
 *   - `errBackoffOnExhaust` also sleep after the LAST caught error (fetch-wayback slept on every
 *                  catch; elo-wayback's single attempt never slept).
 * Returns "skip" (already on disk), "saved", or "fail".
 */
export async function fetchWaybackCapture(
  slug: string,
  ts: string,
  outPath: string,
  opts: {
    headers?: Record<string, string>;
    retries?: number;
    checkOk?: boolean;
    okBackoffMs?: number;
    errBackoffMs?: number;
    errBackoffOnExhaust?: boolean;
  } = {},
): Promise<"saved" | "skip" | "fail"> {
  if (existsSync(outPath) && /last update/i.test(readFileSync(outPath, "utf8"))) return "skip";
  const url = `https://web.archive.org/web/${ts}/https://tennisabstract.com/reports/${slug}.html`;
  const retries = opts.retries ?? 0;
  const checkOk = opts.checkOk ?? false;
  const okBackoffMs = opts.okBackoffMs ?? 700;
  const errBackoffMs = opts.errBackoffMs ?? 900;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, opts.headers ? { headers: opts.headers } : undefined);
      if (checkOk && !res.ok) { await sleep(okBackoffMs * (attempt + 1)); continue; }
      const html = await res.text();
      if (/last update/i.test(html)) { writeFileSync(outPath, html); return "saved"; }
      return "fail"; // 200 but no board (rare placeholder)
    } catch {
      if (attempt < retries || opts.errBackoffOnExhaust) await sleep(errBackoffMs * (attempt + 1));
    }
  }
  return "fail";
}

/** Run `fn` over `items` with bounded concurrency (shared worker pool). */
export async function pool<T>(items: T[], limit: number, fn: (x: T, i: number) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
    }),
  );
}
