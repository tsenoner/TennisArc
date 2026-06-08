# TennisArc — Live Ingestion + Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bundled synthetic data with real Grand Slam data ingested from SofaScore via headless Chromium, served as static JSON, consumed offline-first by the PWA, refreshed by a free GitHub Actions cron, and deployed on Vercel.

**Architecture:** A Node `ingest/` pipeline (pure `normalize`/`enrich` + a thin Playwright fetch wrapper) resolves the target Slam, pulls SofaScore's `cuptrees` + per-event detail/stats from a Cloudflare-cleared browser context, and writes our normalized `Snapshot` JSON to `public/data/{tour}.json`. The app gains `store.ts` (idb-keyval cache + memory fallback) and `api.ts` (fetch a snapshot from an external data URL, falling back to the same-origin seed file); `app.ts` becomes an offline-first loop (render cached → fetch → cache → re-render). A GitHub Actions cron runs the ingest and publishes fresh JSON to a `data` branch. **Proven:** SofaScore is 403 to curl/fetch but works from a Playwright browser context (verified live against RG 2026); ESPN works via plain fetch but lacks the bracket/stats, so it's a documented future fallback, not v1.

**Tech Stack:** Existing Vite 5 + TS strict + Vitest + d3 + vite-plugin-pwa; adds `playwright` (chromium) for ingestion and `idb-keyval` for the cache.

**This is Plan 3 of 3.** Tasks 1–9 are autonomous and produce a working app on REAL RG 2026 data, offline-first, with the cron workflow committed. **Task 10 (deploy) needs the user's GitHub + Vercel accounts** and is a guided step.

---

## SofaScore shapes (verified live 2026-06-08, RG 2026 ATP utId 2480 / season 85951)

- `GET /api/v1/unique-tournament/{ut}/seasons` → `{seasons:[{name, year, id}]}` (newest first).
- `GET /api/v1/unique-tournament/{ut}/season/{s}/cuptrees` → `{cupTrees:[{rounds:[{description, blocks:[Block]}]}]}`, rounds ordered outer→inner ("Round of 128"…"Final").
- **Block:** `{finished, eventInProgress, order(1-based in round), result("3:0"), homeTeamScore, awayTeamScore, participants:[P], events:[eventId], blockId}`.
- **Participant P:** `{order(1=home,2=away), winner(bool), teamSeed("1"|"WC"|"Q"|"LL"|"PR"), team:{id, name, slug, ranking, nameCode}}` — **no country here**.
- `GET /api/v1/event/{id}` → `{event:{customId, slug, startTimestamp, status:{code,type,description}, winnerCode(1|2), time:{period1,period2,…(sec)}, homeTeam:{country:{alpha3}}, awayTeam:{country:{alpha3}}, homeScore:{period1,period2,…(games), period1TieBreak?}, awayScore:{…}}}` — country + per-set games + customId + duration live here.
- `GET /api/v1/event/{id}/statistics` → `{statistics:[{period:"ALL", groups:[{groupName, statisticsItems:[{key, name, homeValue, awayValue, home, away}]}]}]}` — keys incl. `aces`, `doubleFaults`, `breakPointsConverted`.
- **Live** events: `status.type:"inprogress"`, `time:{}` empty → derive duration from `now - startTimestamp`.

---

## File structure (this plan)

```
ingest/
  config.ts        # target Slam → {utId per tour}; season auto-resolved
  sofascore.ts     # Playwright: clear Cloudflare, fetch cuptrees + event detail/stats
  normalize.ts     # pure: cuptrees JSON → base Snapshot (players, matches, rounds)
  enrich.ts        # pure: event detail + stats → fill match score/duration/stats/customId + player country
  index.ts         # orchestrator: resolve → fetch → normalize → enrich → write public/data/{tour}.json
  fixtures/        # trimmed REAL RG2026 samples for tests
  *.test.ts
src/
  store.ts         # idb-keyval snapshot cache (+ createMemoryStore)
  api.ts           # fetchSnapshot(tour): external data URL → same-origin /data fallback
  app.ts           # offline-first async loop (replaces synthetic snapshots)
  *.test.ts
public/data/atp.json, wta.json   # real RG2026 seed (generated, committed)
.github/workflows/refresh.yml    # cron: run ingest, publish to data branch
vite.config.ts                   # SW caches /data/*.json
package.json                     # +playwright, +idb-keyval, +ingest script
```

---

### Task 1: `ingest/normalize.ts` — cuptrees → base Snapshot

**Files:** Create `ingest/normalize.ts`, `ingest/fixtures/cuptrees-sample.ts`, `ingest/normalize.test.ts`.

- [ ] **Step 1: Create the real-shaped fixture `ingest/fixtures/cuptrees-sample.ts`** (a 4-entrant cuptrees in SofaScore's exact shape — 2 rounds: semifinal-equivalent "Round of 4" + "Final"; values mirror the real API)

```ts
// Trimmed to SofaScore's real cuptrees shape (see plan header). 4 entrants → SF round + Final.
export const cuptreesSample = {
  cupTrees: [
    {
      rounds: [
        {
          description: "Semifinal",
          blocks: [
            {
              finished: true, eventInProgress: false, order: 1, result: "2:0",
              homeTeamScore: "2", awayTeamScore: "0", events: [9001], blockId: 1,
              participants: [
                { order: 1, winner: true, teamSeed: "1", team: { id: 100, name: "Aaa Aaa", slug: "aaa-aaa", ranking: 1, nameCode: "AAA" } },
                { order: 2, winner: false, teamSeed: "WC", team: { id: 101, name: "Bbb Bbb", slug: "bbb-bbb", ranking: 80, nameCode: "BBB" } },
              ],
            },
            {
              finished: false, eventInProgress: true, order: 2, result: "1:1",
              homeTeamScore: "1", awayTeamScore: "1", events: [9002], blockId: 2,
              participants: [
                { order: 1, winner: false, teamSeed: "3", team: { id: 102, name: "Ccc Ccc", slug: "ccc-ccc", ranking: 3, nameCode: "CCC" } },
                { order: 2, winner: false, teamSeed: "Q", team: { id: 103, name: "Ddd Ddd", slug: "ddd-ddd", ranking: 120, nameCode: "DDD" } },
              ],
            },
          ],
        },
        {
          description: "Final",
          blocks: [
            {
              finished: false, eventInProgress: false, order: 1, result: "0:0",
              homeTeamScore: "0", awayTeamScore: "0", events: [9003], blockId: 3,
              participants: [
                { order: 1, winner: false, teamSeed: "1", team: { id: 100, name: "Aaa Aaa", slug: "aaa-aaa", ranking: 1, nameCode: "AAA" } },
              ],
            },
          ],
        },
      ],
    },
  ],
};
```

- [ ] **Step 2: Write the failing test (`ingest/normalize.test.ts`)**

```ts
import { describe, it, expect } from "vitest";
import { normalizeCuptrees } from "./normalize";
import { cuptreesSample } from "./fixtures/cuptrees-sample";

const meta = {
  tour: "ATP" as const, slam: "roland-garros", name: "Roland Garros", year: 2026,
  surface: "Clay", sofaUniqueTournamentId: 2480, sofaSeasonId: 85951, drawSize: 4,
};

describe("normalizeCuptrees", () => {
  it("builds players with seeds and entry types from teamSeed", () => {
    const s = normalizeCuptrees(cuptreesSample, meta);
    expect(s.players["100"]).toMatchObject({ name: "Aaa Aaa", seed: 1, entry: null, ranking: 1, country: "" });
    expect(s.players["101"]).toMatchObject({ seed: null, entry: "WC" });
    expect(s.players["103"]).toMatchObject({ seed: null, entry: "Q" });
  });

  it("builds matches keyed by round-slot with winner, status, sofaEventId and nextMatchId", () => {
    const s = normalizeCuptrees(cuptreesSample, meta);
    // SF round = index 0 (outer), Final = index 1 (inner)
    const sf1 = s.matches["0-0"];
    expect(sf1).toMatchObject({ p1: "100", p2: "101", winner: "p1", status: "finished", sofaEventId: 9001, nextMatchId: "1-0" });
    expect(s.matches["0-1"].status).toBe("live"); // eventInProgress
    expect(s.matches["1-0"]).toMatchObject({ nextMatchId: null, sofaEventId: 9003, status: "scheduled", winner: null });
  });

  it("computes round metadata (entrant counts) and tournament block", () => {
    const s = normalizeCuptrees(cuptreesSample, meta);
    expect(s.rounds.map((r) => [r.index, r.name, r.size])).toEqual([[0, "Semifinal", 4], [1, "Final", 2]]);
    expect(s.tournament).toMatchObject({ slam: "roland-garros", drawSize: 4 });
    expect(s.tour).toBe("ATP");
    expect(s.schemaVersion).toBe(1);
  });
});
```

- [ ] **Step 3: Run to verify it fails** — `pnpm vitest run ingest/normalize.test.ts` — Expected: FAIL (cannot find `./normalize`).

- [ ] **Step 4: Create `ingest/normalize.ts`**

```ts
import type { EntryType, Match, MatchStatus, Player, Round, Snapshot, Tour } from "../src/model";

export interface TournamentMeta {
  tour: Tour; slam: string; name: string; year: number; surface: string;
  sofaUniqueTournamentId: number; sofaSeasonId: number; drawSize: number;
}

interface SofaParticipant {
  order: number; winner: boolean; teamSeed?: string;
  team: { id: number; name: string; slug: string; ranking?: number; nameCode?: string };
}
interface SofaBlock {
  finished: boolean; eventInProgress: boolean; order: number;
  participants: SofaParticipant[]; events?: number[];
}
interface SofaCuptrees { cupTrees: { rounds: { description: string; blocks: SofaBlock[] }[] }[] }

const ENTRY_TYPES = new Set(["Q", "WC", "LL", "PR"]);

function parseSeed(teamSeed?: string): { seed: number | null; entry: EntryType } {
  if (!teamSeed) return { seed: null, entry: null };
  if (/^\d+$/.test(teamSeed)) return { seed: Number(teamSeed), entry: null };
  return { seed: null, entry: ENTRY_TYPES.has(teamSeed) ? (teamSeed as EntryType) : null };
}

function blockStatus(b: SofaBlock, bothPresent: boolean): MatchStatus {
  if (b.eventInProgress) return "live";
  if (b.finished) return "finished";
  return bothPresent ? "scheduled" : "notstarted";
}

/** Convert a SofaScore cuptrees payload into our base Snapshot (no per-event detail yet). */
export function normalizeCuptrees(cup: SofaCuptrees, meta: TournamentMeta): Snapshot {
  const rounds = cup.cupTrees[0]?.rounds ?? [];
  const lastRound = rounds.length - 1;
  const players: Record<string, Player> = {};
  const matches: Record<string, Match> = {};
  const roundList: Round[] = [];

  rounds.forEach((round, roundIndex) => {
    const matchIds: string[] = [];
    for (const b of round.blocks) {
      const slot = b.order - 1;
      const id = `${roundIndex}-${slot}`;
      const home = b.participants.find((p) => p.order === 1);
      const away = b.participants.find((p) => p.order === 2);

      for (const p of [home, away]) {
        if (!p) continue;
        const pid = String(p.team.id);
        if (!players[pid]) {
          const { seed, entry } = parseSeed(p.teamSeed);
          players[pid] = {
            id: pid, name: p.team.name, country: "", seed, entry,
            ranking: p.team.ranking ?? null, ageYears: null, sofaSlug: p.team.slug ?? null,
          };
        }
      }

      const winner = home?.winner ? "p1" : away?.winner ? "p2" : null;
      matches[id] = {
        id, roundIndex, slot,
        nextMatchId: roundIndex < lastRound ? `${roundIndex + 1}-${Math.floor(slot / 2)}` : null,
        p1: home ? String(home.team.id) : null,
        p2: away ? String(away.team.id) : null,
        status: blockStatus(b, !!home && !!away),
        winner,
        score: null, live: null, durationSec: null, durationProvisional: false,
        sofaEventId: b.events?.[0] ?? null, sofaCustomId: null, stats: null,
      };
      matchIds.push(id);
    }
    matchIds.sort((a, b) => Number(a.split("-")[1]) - Number(b.split("-")[1]));
    roundList.push({ index: roundIndex, name: round.description, size: round.blocks.length * 2, matchIds });
  });

  return {
    schemaVersion: 1, generatedAt: "", tour: meta.tour,
    tournament: {
      slam: meta.slam, name: meta.name, year: meta.year, surface: meta.surface,
      sofaUniqueTournamentId: meta.sofaUniqueTournamentId, sofaSeasonId: meta.sofaSeasonId, drawSize: meta.drawSize,
    },
    players, matches, rounds: roundList,
  };
}
```

- [ ] **Step 5: Run to verify it passes** — `pnpm vitest run ingest/normalize.test.ts` — Expected: PASS (3 tests).

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(ingest): normalize SofaScore cuptrees to base Snapshot"`

---

### Task 2: `ingest/enrich.ts` — event detail + stats → match fields

**Files:** Create `ingest/enrich.ts`, `ingest/fixtures/event-sample.ts`, `ingest/enrich.test.ts`.

- [ ] **Step 1: Create `ingest/fixtures/event-sample.ts`** (trimmed REAL event + stats from RG2026 event 16214963, Sinner d. Tabur 6-1 6-3 6-4)

```ts
export const eventSample = {
  customId: "vGHbscHHb", slug: "clement-tabur-jannik-sinner", startTimestamp: 1779820200,
  status: { code: 100, description: "Ended", type: "finished" }, winnerCode: 1,
  time: { period1: 1822, period2: 2463, period3: 3450 },
  homeTeam: { country: { alpha3: "ITA" } },
  awayTeam: { country: { alpha3: "FRA" } },
  homeScore: { period1: 6, period2: 6, period3: 6 },
  awayScore: { period1: 1, period2: 3, period3: 4 },
};

export const statsSample = {
  statistics: [
    { period: "ALL", groups: [
      { groupName: "Service", statisticsItems: [
        { key: "aces", name: "Aces", home: "8", away: "2", homeValue: 8, awayValue: 2 },
        { key: "doubleFaults", name: "Double faults", home: "1", away: "2", homeValue: 1, awayValue: 2 },
        { key: "firstServe", name: "First serve", home: "61/96 (64%)", away: "70/110 (64%)", homeValue: 64, awayValue: 64 },
      ] },
      { groupName: "Return", statisticsItems: [
        { key: "breakPointsConverted", name: "Break points converted", home: "4/9", away: "0/1", homeValue: 4, awayValue: 0 },
      ] },
    ] },
  ],
};

// a live event: empty time, in-progress status
export const liveEventSample = {
  customId: "LIVE123", slug: "x-vs-y", startTimestamp: 1780905934,
  status: { code: 8, description: "1st set", type: "inprogress" }, winnerCode: 0,
  time: {},
  homeTeam: { country: { alpha3: "GER" } }, awayTeam: { country: { alpha3: "CZE" } },
  homeScore: { period1: 4 }, awayScore: { period1: 4 },
};
```

- [ ] **Step 2: Write the failing test (`ingest/enrich.test.ts`)**

```ts
import { describe, it, expect } from "vitest";
import { enrichMatch } from "./enrich";
import { eventSample, statsSample, liveEventSample } from "./fixtures/event-sample";
import type { Match, Player } from "../src/model";

const baseMatch = (over: Partial<Match> = {}): Match => ({
  id: "0-0", roundIndex: 0, slot: 0, nextMatchId: "1-0", p1: "100", p2: "101",
  status: "finished", winner: "p1", score: null, live: null,
  durationSec: null, durationProvisional: false, sofaEventId: 16214963, sofaCustomId: null, stats: null, ...over,
});
const players = (): Record<string, Player> => ({
  100: { id: "100", name: "A", country: "", seed: 1, entry: null, ranking: 1, ageYears: null, sofaSlug: "a" },
  101: { id: "101", name: "B", country: "", seed: null, entry: "WC", ranking: 80, ageYears: null, sofaSlug: "b" },
});

describe("enrichMatch", () => {
  it("fills customId, per-set score, finished duration (Σ periods) and stats", () => {
    const pl = players();
    const m = enrichMatch(baseMatch(), eventSample, statsSample, pl, 0);
    expect(m.sofaCustomId).toBe("vGHbscHHb");
    expect(m.score).toEqual([{ p1: 6, p2: 1 }, { p1: 6, p2: 3 }, { p1: 6, p2: 4 }]);
    expect(m.durationSec).toBe(1822 + 2463 + 3450);
    expect(m.durationProvisional).toBe(false);
    expect(m.stats).toMatchObject({ aces: [8, 2], doubleFaults: [1, 2], breakPointsConverted: ["4/9", "0/1"], firstServePct: [64, 64] });
    // player country enriched from the event
    expect(pl["100"].country).toBe("ITA");
    expect(pl["101"].country).toBe("FRA");
  });

  it("for a live event derives provisional duration from now - startTimestamp and sets status live", () => {
    const nowSec = liveEventSample.startTimestamp + 1800;
    const m = enrichMatch(baseMatch({ status: "live", winner: null, sofaEventId: 555 }), liveEventSample, null, players(), nowSec);
    expect(m.status).toBe("live");
    expect(m.durationSec).toBe(1800);
    expect(m.durationProvisional).toBe(true);
    expect(m.stats).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify it fails** — `pnpm vitest run ingest/enrich.test.ts` — Expected: FAIL (cannot find `./enrich`).

- [ ] **Step 4: Create `ingest/enrich.ts`**

```ts
import type { Match, MatchStats, MatchStatus, Player, SetScore } from "../src/model";

interface SofaScoreSide { [k: string]: number | undefined }
interface SofaEvent {
  customId?: string; startTimestamp?: number; winnerCode?: number;
  status?: { type?: string; description?: string };
  time?: Record<string, number>;
  homeTeam?: { country?: { alpha3?: string } };
  awayTeam?: { country?: { alpha3?: string } };
  homeScore?: SofaScoreSide; awayScore?: SofaScoreSide;
}
interface SofaStats {
  statistics?: { period: string; groups: { groupName: string; statisticsItems: StatItem[] }[] }[];
}
interface StatItem { key: string; name: string; home: string; away: string; homeValue?: number; awayValue?: number }

function mapStatus(t?: string, desc?: string): MatchStatus | null {
  if (desc && /retir/i.test(desc)) return "retired";
  if (desc && /walkover/i.test(desc)) return "walkover";
  if (t === "inprogress") return "live";
  if (t === "finished") return "finished";
  if (t === "notstarted") return "scheduled";
  return null;
}

function buildScore(home?: SofaScoreSide, away?: SofaScoreSide): SetScore[] | null {
  if (!home || !away) return null;
  const sets: SetScore[] = [];
  for (let n = 1; n <= 5; n++) {
    const p1 = home[`period${n}`], p2 = away[`period${n}`];
    if (p1 == null || p2 == null) break;
    const tb = home[`period${n}TieBreak`] ?? away[`period${n}TieBreak`];
    sets.push(tb != null ? { p1, p2, tb } : { p1, p2 });
  }
  return sets.length ? sets : null;
}

function allItems(stats: SofaStats): Map<string, StatItem> {
  const all = stats.statistics?.find((s) => s.period === "ALL") ?? stats.statistics?.[0];
  const m = new Map<string, StatItem>();
  for (const g of all?.groups ?? []) for (const it of g.statisticsItems ?? []) m.set(it.key, it);
  return m;
}

function buildStats(stats: SofaStats | null): MatchStats | null {
  if (!stats) return null;
  const items = allItems(stats);
  const out: MatchStats = {};
  const num = (k: string): [number, number] | undefined => {
    const it = items.get(k);
    return it && it.homeValue != null && it.awayValue != null ? [it.homeValue, it.awayValue] : undefined;
  };
  const aces = num("aces"); if (aces) out.aces = aces;
  const df = num("doubleFaults"); if (df) out.doubleFaults = df;
  const fs = num("firstServe"); if (fs) out.firstServePct = fs;       // homeValue is the % for this key
  const sp = num("firstServePointsWon") ?? num("servicePointsWon"); if (sp) out.servicePointsWonPct = sp;
  const bp = items.get("breakPointsConverted"); if (bp) out.breakPointsConverted = [bp.home, bp.away];
  return Object.keys(out).length ? out : null;
}

/**
 * Merge SofaScore event detail (+ optional stats) into a base match, and write each
 * player's country onto the players map. `nowSec` is used for live-match elapsed time.
 */
export function enrichMatch(
  m: Match, ev: SofaEvent, stats: SofaStats | null, players: Record<string, Player>, nowSec: number,
): Match {
  const status = mapStatus(ev.status?.type, ev.status?.description) ?? m.status;
  const live = status === "live";

  let durationSec: number | null = null;
  let provisional = false;
  if (live) {
    durationSec = ev.startTimestamp ? Math.max(0, nowSec - ev.startTimestamp) : null;
    provisional = durationSec != null;
  } else if (status === "finished" || status === "retired") {
    const periods = Object.entries(ev.time ?? {})
      .filter(([k]) => /^period\d+$/.test(k))
      .reduce((sum, [, v]) => sum + (v ?? 0), 0);
    durationSec = periods > 0 ? periods : null;
  }

  // enrich player countries from the event teams
  if (m.p1 && players[m.p1] && ev.homeTeam?.country?.alpha3) players[m.p1].country = ev.homeTeam.country.alpha3;
  if (m.p2 && players[m.p2] && ev.awayTeam?.country?.alpha3) players[m.p2].country = ev.awayTeam.country.alpha3;

  const winner = ev.winnerCode === 1 ? "p1" : ev.winnerCode === 2 ? "p2" : m.winner;

  return {
    ...m, status, winner,
    score: buildScore(ev.homeScore, ev.awayScore),
    durationSec, durationProvisional: provisional,
    sofaCustomId: ev.customId ?? m.sofaCustomId,
    stats: live ? null : buildStats(stats),
  };
}
```

- [ ] **Step 5: Run to verify it passes** — `pnpm vitest run ingest/enrich.test.ts` — Expected: PASS (2 tests).

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(ingest): enrich matches with event detail + stats + country"`

---

### Task 3: `ingest/sofascore.ts` — Playwright fetch wrapper

**Files:** Create `ingest/sofascore.ts`. (Thin I/O — verified by the real run in Task 9, not unit-tested.)

- [ ] **Step 1: Add Playwright** — Run: `pnpm add -D playwright` then `pnpm exec playwright install chromium`. Expected: chromium downloads.

- [ ] **Step 2: Create `ingest/sofascore.ts`**

```ts
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
```

- [ ] **Step 3: Typecheck + commit** — Run `pnpm typecheck` (clean). Note: `playwright` types resolve under `moduleResolution: bundler`; `ingest/` is included by tsconfig (it lives outside `src` — extend `tsconfig.json` `include` to add `"ingest"`). Then:

```bash
git add -A && git commit -m "feat(ingest): Playwright SofaScore fetch wrapper"
```

- [ ] **Step 4: Update `tsconfig.json` include** — change `"include": ["src"]` to `"include": ["src", "ingest"]` so `pnpm typecheck` covers the ingest code. Re-run `pnpm typecheck` (clean) and `pnpm test` (all prior tests still pass). Commit if not already in Step 3.

---

### Task 4: `ingest/config.ts` + `ingest/index.ts` — orchestrator

**Files:** Create `ingest/config.ts`, `ingest/index.ts`; modify `package.json` (add `ingest` script).

- [ ] **Step 1: Create `ingest/config.ts`**

```ts
import type { Tour } from "../src/model";

export interface SlamConfig {
  slam: string; name: string; surface: string; year: number;
  unitournament: Record<Tour, number>; // SofaScore uniqueTournament ids
}

// The target Slam to ingest. Update `current` to switch tournaments (season ids auto-resolve).
export const SLAMS: Record<string, SlamConfig> = {
  "roland-garros": { slam: "roland-garros", name: "Roland Garros", surface: "Clay", year: 2026, unitournament: { ATP: 2480, WTA: 2577 } },
  wimbledon:       { slam: "wimbledon",     name: "Wimbledon",     surface: "Grass", year: 2026, unitournament: { ATP: 2361, WTA: 2600 } },
  "us-open":       { slam: "us-open",       name: "US Open",       surface: "Hard",  year: 2026, unitournament: { ATP: 2449, WTA: 2547 } },
  "australian-open": { slam: "australian-open", name: "Australian Open", surface: "Hard", year: 2026, unitournament: { ATP: 2363, WTA: 2521 } },
};

export const CURRENT_SLAM = "roland-garros";
export const DRAW_SIZE = 128;
```

- [ ] **Step 2: Create `ingest/index.ts`**

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Snapshot, Tour } from "../src/model";
import { CURRENT_SLAM, DRAW_SIZE, SLAMS } from "./config";
import { fetchTournament, resolveSeasonId } from "./sofascore";
import { chromium } from "playwright";
import { normalizeCuptrees } from "./normalize";
import { enrichMatch } from "./enrich";

const OUT_DIR = resolve(process.cwd(), "public/data");

async function ingestTour(tour: Tour, isoNow: string, nowSec: number): Promise<Snapshot> {
  const cfg = SLAMS[CURRENT_SLAM];
  const utId = cfg.unitournament[tour];

  // resolve season via a short-lived context, then fetch everything
  const browser = await chromium.launch({ headless: true });
  let seasonId: number;
  try {
    const page = await browser.newPage();
    await page.goto("https://www.sofascore.com/", { waitUntil: "domcontentloaded", timeout: 60_000 });
    seasonId = await resolveSeasonId(page, utId);
  } finally { await browser.close(); }

  const raw = await fetchTournament(utId, seasonId);
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
  snap.generatedAt = isoNow;
  return snap;
}

async function main(): Promise<void> {
  const isoNow = new Date().toISOString();
  const nowSec = Math.floor(Date.now() / 1000);
  await mkdir(OUT_DIR, { recursive: true });
  for (const tour of ["ATP", "WTA"] as Tour[]) {
    const snap = await ingestTour(tour, isoNow, nowSec);
    const file = resolve(OUT_DIR, `${tour.toLowerCase()}.json`);
    await writeFile(file, JSON.stringify(snap));
    const played = Object.values(snap.matches).filter((m) => m.status !== "scheduled" && m.status !== "notstarted").length;
    console.log(`wrote ${file}: ${Object.keys(snap.matches).length} matches (${played} played), ${Object.keys(snap.players).length} players`);
  }
}

main().catch((err) => { console.error("ingest failed:", err); process.exitCode = 1; });
```

- [ ] **Step 3: Add the `ingest` script to `package.json`** scripts: `"ingest": "tsx ingest/index.ts"`. Add `tsx` as a dev dependency: `pnpm add -D tsx`.

- [ ] **Step 4: Typecheck + commit** — `pnpm typecheck` (clean), `pnpm test` (prior tests pass). Then:

```bash
git add -A && git commit -m "feat(ingest): orchestrator writing public/data/{tour}.json"
```

(The real run happens in Task 9 — do NOT run `pnpm ingest` yet; first build the app's data layer.)

---

### Task 5: `src/store.ts` — IndexedDB snapshot cache

**Files:** Create `src/store.ts`, `src/store.test.ts`; add `idb-keyval` dependency.

- [ ] **Step 1: Add dependency** — Run: `pnpm add idb-keyval`.

- [ ] **Step 2: Write the failing test (`src/store.test.ts`)**

```ts
import { describe, it, expect } from "vitest";
import { createMemoryStore } from "./store";
import { makeSyntheticSnapshot } from "./fixtures/synthetic";

describe("createMemoryStore", () => {
  it("round-trips a snapshot per tour and returns null when absent", async () => {
    const store = createMemoryStore();
    expect(await store.getSnapshot("ATP")).toBeNull();
    const snap = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    await store.setSnapshot("ATP", snap);
    expect(await store.getSnapshot("ATP")).toEqual(snap);
    expect(await store.getSnapshot("WTA")).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify it fails** — `pnpm vitest run src/store.test.ts` — Expected: FAIL (cannot find `./store`).

- [ ] **Step 4: Create `src/store.ts`**

```ts
import { get, set } from "idb-keyval";
import type { Snapshot, Tour } from "./model";

export interface Store {
  getSnapshot(tour: Tour): Promise<Snapshot | null>;
  setSnapshot(tour: Tour, snap: Snapshot): Promise<void>;
}

const key = (tour: Tour) => `snapshot:${tour}`;

/** IndexedDB-backed snapshot cache (offline-first). */
export function createIdbStore(): Store {
  return {
    async getSnapshot(tour) { return (await get<Snapshot>(key(tour))) ?? null; },
    async setSnapshot(tour, snap) { await set(key(tour), snap); },
  };
}

/** In-memory fallback (private mode / tests). */
export function createMemoryStore(): Store {
  const m = new Map<Tour, Snapshot>();
  return {
    async getSnapshot(tour) { return m.get(tour) ?? null; },
    async setSnapshot(tour, snap) { m.set(tour, snap); },
  };
}

/** Probe IndexedDB; fall back to memory if unavailable (e.g. private browsing). */
export async function createStore(): Promise<Store> {
  try {
    const probe = createIdbStore();
    await probe.getSnapshot("ATP"); // throws if IDB is blocked
    return probe;
  } catch {
    return createMemoryStore();
  }
}
```

- [ ] **Step 5: Run to verify it passes** — `pnpm vitest run src/store.test.ts` — Expected: PASS.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: idb-keyval snapshot store with memory fallback"`

---

### Task 6: `src/api.ts` — fetch a published snapshot

**Files:** Create `src/api.ts`, `src/api.test.ts`.

- [ ] **Step 1: Write the failing test (`src/api.test.ts`)**

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchSnapshot } from "./api";
import { makeSyntheticSnapshot } from "./fixtures/synthetic";

afterEach(() => vi.unstubAllGlobals());

describe("fetchSnapshot", () => {
  it("fetches and returns a snapshot for the tour from the same-origin data file", async () => {
    const snap = makeSyntheticSnapshot({ tour: "WTA", drawSize: 8, seed: 2 });
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("/data/wta.json");
      return { ok: true, json: async () => snap } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchSnapshot("WTA")).toEqual(snap);
  });

  it("prefers the external base URL when configured", async () => {
    const snap = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 3 });
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("https://cdn.example/atp.json");
      return { ok: true, json: async () => snap } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchSnapshot("ATP", "https://cdn.example")).toEqual(snap);
  });

  it("returns null on a failed response instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 } as Response)));
    expect(await fetchSnapshot("ATP")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm vitest run src/api.test.ts` — Expected: FAIL (cannot find `./api`).

- [ ] **Step 3: Create `src/api.ts`**

```ts
import type { Snapshot, Tour } from "./model";

/**
 * Fetch the published snapshot for a tour. Uses the external data base URL when given
 * (the GitHub `data` branch via env `VITE_DATA_BASE_URL`), else the same-origin seed
 * file in `public/data/`. Returns null on any failure (the caller falls back to cache).
 */
export async function fetchSnapshot(
  tour: Tour,
  baseUrl: string | undefined = (import.meta as any).env?.VITE_DATA_BASE_URL,
): Promise<Snapshot | null> {
  const file = `${tour.toLowerCase()}.json`;
  const url = baseUrl ? `${baseUrl.replace(/\/$/, "")}/${file}` : `/data/${file}`;
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) return null;
    return (await res.json()) as Snapshot;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run to verify it passes** — `pnpm vitest run src/api.test.ts` — Expected: PASS (3 tests).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: api.ts fetch published snapshot (external URL or same-origin)"`

---

### Task 7: `app.ts` — offline-first async loop

**Files:** Modify `src/app.ts`; modify `src/app.css` (add a small status line).

- [ ] **Step 1: Replace `src/app.ts` with**

```ts
import { buildSunburst, timeOnCourt, timeLeaderboard } from "./state";
import { layout } from "./layout";
import { colorScale, type ColorDim } from "./color";
import {
  renderSunburst, renderControls, renderLegend, renderLeaderboard, renderMatchDetail,
} from "./render";
import { sofascoreMatchUrl } from "./deeplink";
import { loadTheme, saveTheme, applyTheme, nextTheme, type Theme } from "./theme";
import { createStore, type Store } from "./store";
import { fetchSnapshot } from "./api";
import type { Snapshot, Tour } from "./model";

const SIZE = 700;

interface AppState {
  tour: Tour;
  snapshots: Partial<Record<Tour, Snapshot>>;
  colorDim: ColorDim;
  focusId: string | undefined;
  selectedMatchId: string | undefined;
  theme: Theme;
}

function staleLabel(generatedAt: string | undefined, nowMs: number): string {
  if (!generatedAt) return "";
  const ageMin = Math.round((nowMs - Date.parse(generatedAt)) / 60000);
  if (!Number.isFinite(ageMin) || ageMin < 0) return "";
  if (ageMin < 1) return "updated just now";
  if (ageMin < 60) return `updated ${ageMin} min ago`;
  return `updated ${Math.round(ageMin / 60)}h ago`;
}

export function createApp(root: HTMLElement): void {
  const theme = loadTheme();
  applyTheme(theme);
  const state: AppState = {
    tour: "ATP", snapshots: {}, colorDim: "time",
    focusId: undefined, selectedMatchId: undefined, theme,
  };
  let store: Store | undefined;

  const draw = () => {
    const snap = state.snapshots[state.tour];
    if (!snap) {
      root.innerHTML =
        renderControls({ tour: state.tour, colorDim: state.colorDim, theme: state.theme }) +
        `<div class="stage"><div class="loading">Loading ${state.tour} draw…</div></div>`;
      return;
    }
    const time = timeOnCourt(snap);
    const arcs = layout(buildSunburst(snap), SIZE / 2 - 8, state.focusId);
    const color = colorScale(state.colorDim, snap, time);
    const lb = timeLeaderboard(snap, time);

    let detail = "";
    const m = state.selectedMatchId ? snap.matches[state.selectedMatchId] : undefined;
    if (m) {
      const p1 = m.p1 ? snap.players[m.p1] ?? null : null;
      const p2 = m.p2 ? snap.players[m.p2] ?? null : null;
      const roundName = snap.rounds[m.roundIndex]?.name ?? "";
      detail = renderMatchDetail(m, p1, p2, sofascoreMatchUrl(m, p1, p2), roundName);
    }

    root.innerHTML =
      renderControls({ tour: state.tour, colorDim: state.colorDim, theme: state.theme }) +
      `<div class="stage">` +
        `<div class="sunburst">${renderSunburst(arcs, color, SIZE)}</div>` +
        renderLeaderboard(lb, color) +
      `</div>` +
      renderLegend(state.colorDim) +
      `<div class="status">${snap.tournament.name} · ${staleLabel(snap.generatedAt, Date.now())}</div>` +
      detail;
  };

  // Load a tour: render cached immediately (offline-first), then revalidate from the network.
  const load = async (tour: Tour) => {
    if (store && !state.snapshots[tour]) {
      const cached = await store.getSnapshot(tour);
      if (cached) { state.snapshots[tour] = cached; if (state.tour === tour) draw(); }
    }
    const fresh = await fetchSnapshot(tour);
    if (fresh) {
      state.snapshots[tour] = fresh;
      void store?.setSnapshot(tour, fresh);
      if (state.tour === tour) draw();
    }
  };

  root.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!el) return;
    const a = el.dataset.action;
    const id = el.dataset.id;
    if (a === "tour" && el.dataset.tour) {
      state.tour = el.dataset.tour as Tour;
      state.focusId = undefined; state.selectedMatchId = undefined;
      draw(); void load(state.tour);
    } else if (a === "colordim" && el.dataset.dim) {
      state.colorDim = el.dataset.dim as ColorDim; draw();
    } else if (a === "theme") {
      state.theme = nextTheme(state.theme); applyTheme(state.theme); saveTheme(state.theme); draw();
    } else if (a === "close-detail") {
      state.selectedMatchId = undefined; draw();
    } else if (a === "reset" || id === "r" || (id && id === state.focusId)) {
      state.focusId = undefined; state.selectedMatchId = undefined; draw();
    } else if (a === "zoom" && id) {
      state.focusId = id; state.selectedMatchId = el.dataset.match; draw();
    }
  });

  draw(); // initial loading state
  void (async () => {
    store = await createStore();
    await load("ATP");
    void load("WTA"); // warm the other tour in the background
  })();
}
```

- [ ] **Step 2: Add status/loading CSS to `src/app.css`** (append):

```css
.loading { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--dim); }
.status { padding: 4px 14px 12px; color: var(--dim); font-size: 12px; }
```

- [ ] **Step 3: Typecheck** — `pnpm typecheck` — Expected: clean. (`makeSyntheticSnapshot` import is gone from app.ts; the synthetic fixture stays for tests.)

- [ ] **Step 4: Full test run** — `pnpm test` — Expected: all prior tests still pass (app.ts has no unit tests).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: offline-first app loop (store cache + api revalidate)"`

(The app now needs `public/data/*.json` to show data — generated in Task 9. Until then it shows the loading state, which is expected.)

---

### Task 8: Service worker caches the data files

**Files:** Modify `vite.config.ts`.

- [ ] **Step 1: Add a runtime cache for the data JSON** — in `vite.config.ts`, extend the `VitePWA({ workbox: {...} })` block to add a `runtimeCaching` rule so same-origin `/data/*.json` is served stale-while-revalidate offline. Replace the `workbox` value with:

```ts
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest}"],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/data/"),
            handler: "StaleWhileRevalidate",
            options: { cacheName: "tennisarc-data", expiration: { maxEntries: 8, maxAgeSeconds: 86400 } },
          },
        ],
      },
```

- [ ] **Step 2: Build + verify** — `pnpm build` (succeeds); confirm `dist/sw.js` exists and `find src -name '*.js'` is empty; `pnpm test` still passes.

- [ ] **Step 3: Commit** — `git add -A && git commit -m "feat(pwa): runtime-cache /data JSON for offline"`

---

### Task 9: Generate real RG 2026 data + cron workflow

**Files:** Create `public/data/atp.json`, `public/data/wta.json` (generated, committed); create `.github/workflows/refresh.yml`.

- [ ] **Step 1: Run the real ingest** — Run: `pnpm ingest`. Expected: console logs `wrote .../public/data/atp.json: 127 matches (127 played) …` and the same for WTA (RG 2026 is complete). This launches headless Chromium, clears Cloudflare on sofascore.com, and pulls the real bracket + per-match detail/stats. If it fails with a Cloudflare 403 or Playwright launch error, STOP and report BLOCKED with the error (do not fabricate data).

- [ ] **Step 2: Sanity-check the output** — Run:

```bash
node -e "const s=require('./public/data/atp.json'); console.log('players',Object.keys(s.players).length,'matches',Object.keys(s.matches).length,'final',s.matches['6-0'], 'champ', s.players[Object.values(s.matches).find(m=>m.nextMatchId===null).winner==='p1'?s.matches['6-0'].p1:s.matches['6-0'].p2]?.name)"
```
Expected: ~128 players, 127 matches, and the champion resolves to **Carlos Alcaraz or the actual RG 2026 men's winner** (the final `6-0` has a real winner). Spot-check a player has a non-empty `country`.

- [ ] **Step 3: Verify the app renders real data** — `pnpm build && pnpm preview` (controller will visually confirm via browser: real player names in the leaderboard + detail cards, real scores). Do not block on `preview` in a subagent; report that the build succeeded and the JSON is valid.

- [ ] **Step 4: Create `.github/workflows/refresh.yml`**

```yaml
name: Refresh tennis data
on:
  schedule:
    - cron: "*/30 * * * *"   # every 30 min (GitHub's practical floor; tighten on a self-hosted runner)
  workflow_dispatch: {}
permissions:
  contents: write
concurrency:
  group: refresh-data
  cancel-in-progress: true
jobs:
  ingest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 11 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm ingest
      - name: Publish to data branch
        run: |
          set -e
          mkdir -p /tmp/data && cp public/data/*.json /tmp/data/
          git config user.name "tennisarc-bot"
          git config user.email "bot@users.noreply.github.com"
          git fetch origin data || true
          git checkout -B data
          rm -rf data && mkdir -p data && cp /tmp/data/*.json data/
          git add data
          git commit -m "data: refresh $(date -u +%FT%TZ)" || { echo "no changes"; exit 0; }
          git push -f origin data
```

- [ ] **Step 5: Commit** — Run:

```bash
git add -A && git commit -m "feat: real RG2026 seed data + GitHub Actions refresh cron"
```

(Note: the cron is dormant until the repo is pushed to GitHub in Task 10. The `data` branch publish path pairs with `VITE_DATA_BASE_URL` = the raw data-branch URL, set in Task 10.)

---

### Task 10: Deploy — GitHub + Vercel (GUIDED, needs the user's accounts)

**This task is not autonomous.** The controller prepares everything and confirms each outward-facing action with the user. Do NOT create remotes, push, or deploy without explicit user confirmation.

- [ ] **Step 1: Create `vercel.json`** (SPA + correct headers; static `public/data` is served as-is):

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "cleanUrls": true,
  "headers": [
    { "source": "/data/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" }] }
  ]
}
```
Commit: `git add -A && git commit -m "chore: vercel config"`.

- [ ] **Step 2: Create the GitHub repo + push** (with user confirmation; uses `gh`):

```bash
gh repo create TennisArc --public --source=. --remote=origin --push
```
After push, the `data` branch will be created on the first cron run (or trigger it manually via the Actions tab → "Refresh tennis data" → Run workflow).

- [ ] **Step 3: Connect Vercel** (with user confirmation; Vercel auto-detects Vite). Either via the Vercel dashboard (Import Git Repo → TennisArc) or `vercel` CLI. Set the project's environment variable:
  - `VITE_DATA_BASE_URL` = `https://raw.githubusercontent.com/<user>/TennisArc/data` (the raw data-branch URL).

- [ ] **Step 4: Verify the deployment** — open the Vercel URL: real data loads, installable (manifest + SW), offline works, and after a cron run the "updated N min ago" reflects the data branch. Confirm the GitHub Actions run succeeded and pushed the `data` branch.

- [ ] **Step 5: Update README** with the deployed URL, the data-refresh design, and a note that `ingest/config.ts:CURRENT_SLAM` switches the tracked tournament. Commit.

---

### Task 11: Final verification

**Files:** none (verification).

- [ ] **Step 1: Green gate** — `pnpm test && pnpm typecheck && pnpm build`. Expected: all tests pass, no type errors, build succeeds with `dist/sw.js` + `dist/manifest.webmanifest`, `find src -name '*.js'` empty.

- [ ] **Step 2: Confirm the data layer end-to-end** — with `public/data/*.json` present, `pnpm preview` shows real RG 2026 names/scores; toggling DevTools offline + reload still renders (idb + SW). (Controller verifies via browser.)

---

## Self-review (against the spec)

- **Ingestion from SofaScore (server-side, Cloudflare-proof)** → Tasks 1–4 (normalize/enrich pure + Playwright wrapper + orchestrator). ✔
- **Normalized JSON contract (our `Snapshot`)** → reused from `src/model.ts`; ingest writes it. ✔
- **Keep updated / auto-refresh (free, no Vercel Pro)** → Task 9 GitHub Actions cron → `data` branch. ✔
- **Offline-first PWA reads cached JSON** → Task 5 (`store.ts` idb), Task 6 (`api.ts`), Task 7 (app loop), Task 8 (SW data cache). ✔
- **Real data, both tours, singles** → Task 9 real RG2026 ingest, ATP + WTA. ✔
- **Deploy on Vercel** → Task 10 (guided). ✔
- **Seed projections / time-on-court / colour / detail / deep-link** → already in Plans 1–2; now driven by real data (the model contract is unchanged, so they work as-is). ✔
- **ESPN fallback** → documented as a future enhancement, intentionally not built in v1 (SofaScore-via-Playwright proven reliable; ESPN lacks bracket/stats). Noted, not silently dropped. ✔
- **Type consistency:** `Snapshot`/`Match`/`Player`/`Tour` (model) reused by ingest + store + api; `normalizeCuptrees`/`TournamentMeta` (Task 1) → `enrichMatch` (Task 2) → `fetchTournament`/`resolveSeasonId` (Task 3) → `ingest/index` (Task 4); `Store`/`createStore`/`createMemoryStore` (Task 5) + `fetchSnapshot` (Task 6) consumed by app.ts (Task 7). Names used verbatim. ✔
- **No placeholders:** every code step is complete and runnable; the only deferred-by-design items (live ESPN merge, Vercel account actions) are explicitly flagged. ✔
- **Risk:** ingestion depends on SofaScore's undocumented API + Cloudflare; Task 9 Step 1 instructs BLOCKED-on-failure rather than fabrication; `ingest/index.ts` skips unreachable events and the cron preserves the last-good `data` branch on a no-op. ✔
