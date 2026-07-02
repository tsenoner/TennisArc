import { chromium, type Browser, type Page } from "playwright";
import { pickSeasonId, type SofaSeason } from "./seasons";
import { alpha3Of } from "./sofa-country";
import { collectEventIds } from "./normalize";

export interface RawTournament {
  cuptrees: unknown;
  events: Map<number, { detail: unknown; stats: unknown }>;
}

// Same-origin API path. The api.sofascore.com host answers 403 "challenge" for sessions without
// recent Cloudflare clearance; the path the site itself uses — www.sofascore.com/api/v1 plus the
// x-requested-with token its own requests carry — passes reliably (observed 2026-06-11).
const SOFA = "https://www.sofascore.com/api/v1";
const HOME = "https://www.sofascore.com/";
const TOKEN_WAIT_MS = 15_000;

// Anti-bot token per page, captured from the page's OWN data-API requests. It's a site build
// constant (e.g. "9807f3"), so never hardcode it — sniff it fresh each session.
const pageToken = new WeakMap<Page, string>();

/** Open a Cloudflare-cleared SofaScore page context for issuing API fetches. */
export async function openContext(): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  });
  page.on("request", (r) => {
    const u = r.url();
    if (!pageToken.has(page) && u.includes("sofascore.com/api/v1/") && !u.includes("img.sofascore")) {
      const t = r.headers()["x-requested-with"];
      if (t) pageToken.set(page, t);
    }
  });
  await page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await waitForToken(page);
  return { browser, page };
}

/** Wait for the page's own first data-API call: it carries the token we must echo, and its
 *  success clears the Cloudflare challenge for the session. */
async function waitForToken(page: Page): Promise<void> {
  const t0 = Date.now();
  while (!pageToken.has(page) && Date.now() - t0 < TOKEN_WAIT_MS) await page.waitForTimeout(250);
  if (!pageToken.has(page)) {
    console.warn(`sofascore: x-requested-with token not seen within ${TOKEN_WAIT_MS}ms — requests will omit it and likely 403`);
  }
}

/** GET a SofaScore API path from inside the page. Retries 403/429 (Cloudflare challenge /
 *  rate-limit) with backoff and a session re-warm; other HTTP errors throw immediately —
 *  a 404 is a real answer (e.g. no statistics for a scheduled match), not flakiness. */
export async function apiGet(page: Page, path: string): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await page.waitForTimeout(1500 * 2 ** attempt);
      await page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
      await waitForToken(page);
    }
    try {
      return await page.evaluate(
        async ({ url, token }) => {
          const headers: Record<string, string> = { Accept: "application/json" };
          if (token) headers["x-requested-with"] = token;
          const r = await fetch(url, { headers });
          if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
          return r.json();
        },
        { url: `${SOFA}${path}`, token: pageToken.get(page) ?? null },
      );
    } catch (err) {
      lastErr = err;
      if (!/HTTP (403|429)/.test(String(err))) throw err;
    }
  }
  throw lastErr;
}

export async function resolveSeasonId(page: Page, utId: number, year?: number): Promise<number> {
  const j = (await apiGet(page, `/unique-tournament/${utId}/seasons`)) as { seasons?: SofaSeason[] };
  return pickSeasonId(j.seasons ?? [], year);
}

/** A team's country alpha-3 (e.g. "USA"), or null. The per-event detail only reaches us for
 *  finished/live matches, so this is how a not-yet-played entrant gets a country (→ a flag).
 *  A failed/missing lookup returns null rather than throwing — one absent flag, not a dead run. */
export async function fetchTeamCountry(page: Page, teamId: number): Promise<string | null> {
  try {
    const j = (await apiGet(page, `/team/${teamId}`)) as { team?: { country?: { alpha3?: string } }; country?: { alpha3?: string } };
    return alpha3Of(j.team ?? j);
  } catch {
    return null;
  }
}

/** Fetch the full cuptrees + per-event detail/stats for a tournament season (caller owns the page/browser). */
export async function fetchTournament(page: Page, utId: number, seasonId: number): Promise<RawTournament> {
  const cuptrees = await apiGet(page, `/unique-tournament/${utId}/season/${seasonId}/cuptrees`);
  const eventIds = collectEventIds(cuptrees as Parameters<typeof collectEventIds>[0]);
  const events = new Map<number, { detail: unknown; stats: unknown }>();
  for (const id of eventIds) {
    try {
      const detail = await apiGet(page, `/event/${id}`).then((d: any) => d.event ?? d);
      let stats: unknown = null;
      try { stats = await apiGet(page, `/event/${id}/statistics`); } catch { /* no stats (e.g. scheduled) */ }
      events.set(id, { detail, stats });
    } catch { /* skip an unreachable event, keep going */ }
    await page.waitForTimeout(60);
  }
  return { cuptrees, events };
}
