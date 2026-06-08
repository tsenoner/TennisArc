import { chromium, type Browser, type Page } from "playwright";

export interface RawTournament {
  cuptrees: unknown;
  events: Map<number, { detail: unknown; stats: unknown }>;
}

const SOFA = "https://api.sofascore.com/api/v1";

/** Open a Cloudflare-cleared SofaScore page context for issuing API fetches. */
async function openContext(): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  });
  await page.goto("https://www.sofascore.com/", { waitUntil: "domcontentloaded", timeout: 60_000 });
  return { browser, page };
}

async function apiGet(page: Page, path: string): Promise<unknown> {
  return page.evaluate(async (url) => {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return r.json();
  }, `${SOFA}${path}`);
}

/** Resolve the newest season id for a unique tournament (e.g. the current year's draw). */
export async function resolveSeasonId(page: Page, utId: number): Promise<number> {
  const j = (await apiGet(page, `/unique-tournament/${utId}/seasons`)) as { seasons?: { id: number }[] };
  const id = j.seasons?.[0]?.id;
  if (!id) throw new Error(`no seasons for unique-tournament ${utId}`);
  return id;
}

/** Fetch the full cuptrees + per-event detail/stats for the played matches of a tournament season. */
export async function fetchTournament(utId: number, seasonId: number): Promise<RawTournament> {
  const { browser, page } = await openContext();
  try {
    const cuptrees = await apiGet(page, `/unique-tournament/${utId}/season/${seasonId}/cuptrees`);
    const eventIds = collectEventIds(cuptrees);
    const events = new Map<number, { detail: unknown; stats: unknown }>();
    for (const id of eventIds) {
      try {
        const detail = await apiGet(page, `/event/${id}`).then((d: any) => d.event ?? d);
        let stats: unknown = null;
        try { stats = await apiGet(page, `/event/${id}/statistics`); } catch { /* no stats (e.g. scheduled) */ }
        events.set(id, { detail, stats });
      } catch { /* skip an unreachable event, keep going */ }
      await page.waitForTimeout(60); // polite pacing
    }
    return { cuptrees, events };
  } finally {
    await browser.close();
  }
}

function collectEventIds(cuptrees: any): number[] {
  const ids: number[] = [];
  for (const tree of cuptrees?.cupTrees ?? [])
    for (const round of tree.rounds ?? [])
      for (const block of round.blocks ?? [])
        if ((block.finished || block.eventInProgress) && Array.isArray(block.events))
          ids.push(...block.events);
  return [...new Set(ids)];
}
