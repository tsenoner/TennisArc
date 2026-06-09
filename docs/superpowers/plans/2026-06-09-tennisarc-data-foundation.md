# TennisArc Data Foundation — Implementation Plan (1 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ingest produce per-`{tour,year,slam}` JSON snapshots (enriched with surface ELO + age from Tennis Abstract) plus a merged `index.json`, support backfilling past years, and publish additively — the data layer the rest of the overhaul consumes.

**Architecture:** Pure, unit-tested helpers (`normalizeName`, `parseEloTable`, `applyElo`, `pickSeasonId`, `snapshotFilename`, `slamStatus`, `mergeIndex`, `backfillTargets`) wired into the existing Playwright ingest (`ingest/index.ts`). ELO is fetched in Node (Tennis Abstract is plain HTTPS, no Cloudflare) and joined to players by normalized name with a fallback to `null`. Output filenames carry tour+year+slam; completed slams persist as committed seed; only the active slam is rewritten each refresh.

**Tech Stack:** TypeScript (strict, ESM), Node 18+ global `fetch`, Playwright (existing), Vitest (`TZ=UTC vitest run`), `tsx` for the ingest entrypoint.

**Spec:** [`../specs/2026-06-09-tennisarc-ux-overhaul-design.md`](../specs/2026-06-09-tennisarc-ux-overhaul-design.md) §6, §9, §10, §13.

---

## File structure

**New**
- `ingest/elo.ts` — `normalizeName`, `EloEntry`, `parseEloTable`, `applyElo`, `fetchElo`, `ELO_URL` (Tennis Abstract fetch + parse + join).
- `ingest/elo.test.ts`
- `ingest/seasons.ts` — `pickSeasonId` (pure season selection).
- `ingest/seasons.test.ts`
- `ingest/manifest.ts` — `slamStatus`, `availableSlamOf`, `mergeIndex`, `backfillTargets`.
- `ingest/manifest.test.ts`
- `ingest/fixtures/elo-sample.html` — trimmed Tennis Abstract table for the parser test.

**Modified**
- `src/model.ts` — `PlayerElo`, `Player.elo`, `SlamStatus`/`AvailableSlam`/`SlamIndex`, `snapshotFilename`; bump `schemaVersion` to 2.
- `src/model.test.ts` — add `snapshotFilename` test.
- `ingest/normalize.ts` — default `elo: null` when constructing players.
- `ingest/sofascore.ts` — `resolveSeasonId` delegates to `pickSeasonId` (selects a season by year).
- `ingest/index.ts` — per-slam filenames + `{tour}.json` alias, ELO enrichment, `index.json` write/merge, backfill mode.
- `scripts/publish-data.sh` — comment/doc for the multi-file data layout (no behavioural code change).

---

## Task 1: Extend the data model

**Files:**
- Modify: `src/model.ts`
- Modify: `ingest/normalize.ts:53-56` (add `elo: null` to the constructed Player)
- Test: `src/model.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/model.test.ts` (create the file with this content if it does not exist):

```ts
import { describe, it, expect } from "vitest";
import { snapshotFilename } from "./model";

describe("snapshotFilename", () => {
  it("encodes tour (lowercased), year and slam", () => {
    expect(snapshotFilename("ATP", 2026, "roland-garros")).toBe("atp-2026-roland-garros.json");
    expect(snapshotFilename("WTA", 2025, "wimbledon")).toBe("wta-2025-wimbledon.json");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/model.test.ts`
Expected: FAIL — `snapshotFilename` is not exported from `./model`.

- [ ] **Step 3: Add types + helper to `src/model.ts`**

Add the ELO type and field:

```ts
export interface PlayerElo {
  overall: number | null;
  hard: number | null;
  clay: number | null;
  grass: number | null;
}
```

In `interface Player`, add after `sofaSlug`:

```ts
  elo: PlayerElo | null;
```

Bump the snapshot version — change `schemaVersion: 1` defaults app-wide; in `Snapshot` it is a field, so nothing to change here, but **update the value written in `ingest/normalize.ts` (Step 5 below) to `2`**.

Append the manifest types + filename helper at the end of `src/model.ts`:

```ts
export type SlamStatus = "upcoming" | "live" | "complete";

export interface AvailableSlam {
  tour: Tour;
  year: number;
  slam: string;
  name: string;
  surface: string;
  status: SlamStatus;
  generatedAt: string;
  drawSize: number;
}

export interface SlamIndex {
  schemaVersion: number;
  generatedAt: string;
  slams: AvailableSlam[];
}

/** Canonical per-slam snapshot filename, shared by ingest (writer) and app (reader). */
export function snapshotFilename(tour: Tour, year: number, slam: string): string {
  return `${tour.toLowerCase()}-${year}-${slam}.json`;
}
```

- [ ] **Step 4: Add `elo: null` to the Player constructed in `ingest/normalize.ts`**

In `normalizeCuptrees`, the `players[pid] = { … }` object literal (currently lines 53-56) must include `elo`. Change it to:

```ts
          players[pid] = {
            id: pid, name: p.team.name, country: "", seed, entry,
            ranking: p.team.ranking ?? null, ageYears: null, sofaSlug: p.team.slug ?? null,
            elo: null,
          };
```

- [ ] **Step 5: Bump `schemaVersion` to 2 in `ingest/normalize.ts`**

In the returned snapshot object change `schemaVersion: 1,` to `schemaVersion: 2,`.

- [ ] **Step 6: Run test + typecheck**

Run: `pnpm test src/model.test.ts && pnpm typecheck`
Expected: model test PASS; `tsc --noEmit` clean (note: existing `normalize.test.ts` may now expect `schemaVersion` 1 — update its assertion `expect(s.schemaVersion).toBe(1)` to `2`).

- [ ] **Step 7: Commit**

```bash
git add src/model.ts src/model.test.ts ingest/normalize.ts ingest/normalize.test.ts
git commit -m "feat(data): add Player.elo, slam index types, snapshotFilename; schemaVersion 2"
```

---

## Task 2: Normalize player names for ELO joining

**Files:**
- Create: `ingest/elo.ts`
- Test: `ingest/elo.test.ts`

- [ ] **Step 1: Write the failing test** — create `ingest/elo.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeName } from "./elo";

describe("normalizeName", () => {
  it("strips diacritics, case, spaces and punctuation", () => {
    expect(normalizeName("Jannik Sinner")).toBe("janniksinner");
    expect(normalizeName("Juan Manuel Cerúndolo")).toBe("juanmanuelcerundolo");
    expect(normalizeName("Félix Auger-Aliassime")).toBe("felixaugeraliassime");
    expect(normalizeName("Jakub Menšík")).toBe("jakubmensik");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test ingest/elo.test.ts`
Expected: FAIL — cannot import `normalizeName`.

- [ ] **Step 3: Create `ingest/elo.ts` with `normalizeName`**

```ts
/** Lowercase, strip accents and any non-letter, for matching names across data sources. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test ingest/elo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ingest/elo.ts ingest/elo.test.ts
git commit -m "feat(ingest): normalizeName for cross-source player matching"
```

---

## Task 3: Parse the Tennis Abstract ELO table

The real table column order (verified 2026-06-09 against `tennisabstract.com/reports/atp_elo_ratings.html`): cell `0`=Elo Rank, `1`=Player, `2`=Age, `3`=Elo, `6`=hElo, `8`=cElo, `10`=gElo (cells 4/11/14 are spacers).

**Files:**
- Create: `ingest/fixtures/elo-sample.html`
- Modify: `ingest/elo.ts`
- Test: `ingest/elo.test.ts`

- [ ] **Step 1: Create the fixture** — `ingest/fixtures/elo-sample.html` (two body rows; the second has empty surface cells to exercise null handling):

```html
<table><thead><tr>
<th>Elo Rank</th><th>Player</th><th>Age</th><th>Elo</th><th>&nbsp;</th>
<th>hElo Rank</th><th>hElo</th><th>cElo Rank</th><th>cElo</th><th>gElo Rank</th><th>gElo</th>
<th>&nbsp;</th><th>Peak Elo</th><th>Peak Month</th><th>&nbsp;</th><th>ATP Rank</th><th>x</th>
</tr></thead><tbody>
<tr><td>1</td><td><a href="x">Jannik Sinner</a></td><td>24.7</td><td>2319.8</td><td></td><td>1</td><td>2263.2</td><td>1</td><td>2215.7</td><td>1</td><td>2088.3</td><td></td><td>2339.8</td><td>2026-05</td><td></td><td>1</td><td>0</td></tr>
<tr><td>205</td><td><a href="x">Joao Fonseca</a></td><td>19.6</td><td>1854.0</td><td></td><td>180</td><td>1800.0</td><td></td><td></td><td></td><td></td><td></td><td>1860.0</td><td>2026-04</td><td></td><td>18</td><td>0</td></tr>
</tbody></table>
```

- [ ] **Step 2: Write the failing test** — append to `ingest/elo.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEloTable } from "./elo";

describe("parseEloTable", () => {
  const html = readFileSync(resolve(__dirname, "fixtures/elo-sample.html"), "utf8");
  const map = parseEloTable(html);

  it("parses overall + surface ELO and age, keyed by normalized name", () => {
    const sinner = map.get("janniksinner");
    expect(sinner).toMatchObject({
      name: "Jannik Sinner", ageYears: 24.7,
      elo: { overall: 2319.8, hard: 2263.2, clay: 2215.7, grass: 2088.3 },
    });
  });

  it("represents missing surface ratings as null", () => {
    const f = map.get("joaofonseca");
    expect(f?.elo).toEqual({ overall: 1854.0, hard: 1800.0, clay: null, grass: null });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test ingest/elo.test.ts`
Expected: FAIL — `parseEloTable` not exported.

- [ ] **Step 4: Implement `parseEloTable` in `ingest/elo.ts`**

Add (the `PlayerElo` import keeps the entry shape aligned with the model):

```ts
import type { PlayerElo } from "../src/model";

export interface EloEntry {
  name: string;
  ageYears: number | null;
  elo: PlayerElo;
}

const stripTags = (s: string): string => s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
const numOrNull = (s: string): number | null => {
  const v = Number.parseFloat(stripTags(s));
  return Number.isFinite(v) ? v : null;
};

/** Parse a Tennis Abstract Elo ratings HTML table into a name→ratings map. */
export function parseEloTable(html: string): Map<string, EloEntry> {
  const out = new Map<string, EloEntry>();
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (cells.length < 11) continue; // header / malformed rows have no <td>s
    const name = stripTags(cells[1]);
    if (!name) continue;
    out.set(normalizeName(name), {
      name,
      ageYears: numOrNull(cells[2]),
      elo: {
        overall: numOrNull(cells[3]),
        hard: numOrNull(cells[6]),
        clay: numOrNull(cells[8]),
        grass: numOrNull(cells[10]),
      },
    });
  }
  return out;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test ingest/elo.test.ts`
Expected: PASS (both `describe` blocks).

- [ ] **Step 6: Commit**

```bash
git add ingest/elo.ts ingest/elo.test.ts ingest/fixtures/elo-sample.html
git commit -m "feat(ingest): parse Tennis Abstract surface-ELO table"
```

---

## Task 4: Join ELO + age onto players

**Files:**
- Modify: `ingest/elo.ts`
- Test: `ingest/elo.test.ts`

- [ ] **Step 1: Write the failing test** — append to `ingest/elo.test.ts`:

```ts
import { applyElo } from "./elo";
import type { Player } from "../src/model";

function player(name: string): Player {
  return { id: name, name, country: "", seed: null, entry: null, ranking: null, ageYears: null, sofaSlug: null, elo: null };
}

describe("applyElo", () => {
  const elo = new Map([
    ["janniksinner", { name: "Jannik Sinner", ageYears: 24.7, elo: { overall: 2319.8, hard: 2263.2, clay: 2215.7, grass: 2088.3 } }],
  ]);

  it("sets elo + back-fills age on matched players, leaves unmatched null", () => {
    const players: Record<string, Player> = { a: player("Jannik Sinner"), b: player("Nobody Here") };
    const res = applyElo(players, elo);
    expect(players.a.elo).toEqual({ overall: 2319.8, hard: 2263.2, clay: 2215.7, grass: 2088.3 });
    expect(players.a.ageYears).toBe(24.7);
    expect(players.b.elo).toBeNull();
    expect(res).toEqual({ matched: 1, unmatched: ["Nobody Here"] });
  });

  it("honours an alias map for known name mismatches", () => {
    const players: Record<string, Player> = { a: player("J. Sinner") };
    applyElo(players, elo, { jsinner: "janniksinner" });
    expect(players.a.elo?.overall).toBe(2319.8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test ingest/elo.test.ts`
Expected: FAIL — `applyElo` not exported.

- [ ] **Step 3: Implement `applyElo` in `ingest/elo.ts`**

```ts
import type { Player } from "../src/model";

/**
 * Mutate `players`: attach ELO and back-fill age from `elo` by normalized name.
 * `aliases` maps a normalized player name → the normalized ELO-table key for known mismatches.
 * Unmatched players get `elo: null`. Returns match stats for logging/curation.
 */
export function applyElo(
  players: Record<string, Player>,
  elo: Map<string, EloEntry>,
  aliases: Record<string, string> = {},
): { matched: number; unmatched: string[] } {
  let matched = 0;
  const unmatched: string[] = [];
  for (const p of Object.values(players)) {
    const norm = normalizeName(p.name);
    const entry = elo.get(aliases[norm] ?? norm);
    if (entry) {
      p.elo = entry.elo;
      if (p.ageYears == null && entry.ageYears != null) p.ageYears = entry.ageYears;
      matched++;
    } else {
      p.elo = null;
      unmatched.push(p.name);
    }
  }
  return { matched, unmatched };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test ingest/elo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ingest/elo.ts ingest/elo.test.ts
git commit -m "feat(ingest): join ELO + age onto players with alias fallback"
```

---

## Task 5: Fetch ELO and wire enrichment into the ingest

`fetch` is a network call (not unit-tested); it is wrapped in try/catch so an ELO outage degrades to `elo: null` rather than failing the ingest.

**Files:**
- Modify: `ingest/elo.ts`
- Modify: `ingest/index.ts`

- [ ] **Step 1: Add `ELO_URL` + `fetchElo` to `ingest/elo.ts`**

```ts
import type { Tour } from "../src/model";

const ELO_URL: Record<Tour, string> = {
  ATP: "https://tennisabstract.com/reports/atp_elo_ratings.html",
  WTA: "https://tennisabstract.com/reports/wta_elo_ratings.html",
};

/** Fetch + parse the current Tennis Abstract Elo table for a tour (plain HTTPS, no Cloudflare). */
export async function fetchElo(tour: Tour): Promise<Map<string, EloEntry>> {
  const res = await fetch(ELO_URL[tour], { headers: { "User-Agent": "Mozilla/5.0 TennisArc/1.0" } });
  if (!res.ok) throw new Error(`elo HTTP ${res.status} for ${tour}`);
  return parseEloTable(await res.text());
}
```

- [ ] **Step 2: Wire it into `ingestTour` in `ingest/index.ts`**

Add the import at the top (extend the existing `./enrich` import line region):

```ts
import { fetchElo, applyElo } from "./elo";
```

In `ingestTour`, after the `enrichMatch` loop and **before** `const matchCount = …`, insert:

```ts
    try {
      const elo = await fetchElo(tour);
      const { matched, unmatched } = applyElo(snap.players, elo);
      console.log(`${cfg.slam} ${tour}: ELO matched ${matched}/${Object.keys(snap.players).length} (${unmatched.length} unmatched)`);
    } catch (err) {
      console.warn(`${cfg.slam} ${tour}: ELO enrichment skipped (keeping elo=null):`, err);
    }
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add ingest/elo.ts ingest/index.ts
git commit -m "feat(ingest): fetch + apply surface ELO during tour ingest"
```

---

## Task 6: Select a SofaScore season by year (enables backfill)

**Files:**
- Create: `ingest/seasons.ts`
- Modify: `ingest/sofascore.ts:35-45`
- Test: `ingest/seasons.test.ts`

- [ ] **Step 1: Write the failing test** — create `ingest/seasons.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pickSeasonId } from "./seasons";

const seasons = [
  { id: 90000, year: "2026" },
  { id: 85951, year: "2025" },
  { id: 70000, year: "2024" },
];

describe("pickSeasonId", () => {
  it("returns the newest (first) season when no year is given", () => {
    expect(pickSeasonId(seasons)).toBe(90000);
  });
  it("returns the season matching a requested year", () => {
    expect(pickSeasonId(seasons, 2024)).toBe(70000);
  });
  it("throws when the requested year has no season", () => {
    expect(() => pickSeasonId(seasons, 2019)).toThrow(/no season for year 2019/);
  });
  it("throws when there are no seasons", () => {
    expect(() => pickSeasonId([])).toThrow(/no seasons/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test ingest/seasons.test.ts`
Expected: FAIL — `pickSeasonId` not found.

- [ ] **Step 3: Create `ingest/seasons.ts`**

```ts
export interface SofaSeason { id: number; year?: string }

/** Choose a SofaScore seasonId: the season for `year` if given, else the newest (first) season. */
export function pickSeasonId(seasons: SofaSeason[], year?: number): number {
  if (!seasons.length) throw new Error("no seasons");
  if (year == null) {
    const newest = seasons[0];
    if (!newest?.id) throw new Error("no season id");
    return newest.id;
  }
  const match = seasons.find((s) => Number(s.year) === year);
  if (!match?.id) throw new Error(`no season for year ${year}`);
  return match.id;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test ingest/seasons.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor `resolveSeasonId` in `ingest/sofascore.ts` to use it**

Add import near the top:

```ts
import { pickSeasonId, type SofaSeason } from "./seasons";
```

Replace the body of `resolveSeasonId` (lines 35-45) with:

```ts
export async function resolveSeasonId(page: Page, utId: number, year?: number): Promise<number> {
  const j = (await apiGet(page, `/unique-tournament/${utId}/seasons`)) as { seasons?: SofaSeason[] };
  return pickSeasonId(j.seasons ?? [], year);
}
```

(This preserves the active-slam guard: passing the current `cfg.year` still throws if that year's season isn't on SofaScore yet, and now also lets backfill request a past year.)

- [ ] **Step 6: Typecheck + season test**

Run: `pnpm typecheck && pnpm test ingest/seasons.test.ts`
Expected: clean + PASS.

- [ ] **Step 7: Commit**

```bash
git add ingest/seasons.ts ingest/seasons.test.ts ingest/sofascore.ts
git commit -m "feat(ingest): pickSeasonId selects a SofaScore season by year"
```

---

## Task 7: Slam status + manifest entry

**Files:**
- Create: `ingest/manifest.ts`
- Test: `ingest/manifest.test.ts`

- [ ] **Step 1: Write the failing test** — create `ingest/manifest.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { slamStatus, availableSlamOf } from "./manifest";
import type { Match, Snapshot } from "../src/model";

function snap(matches: Partial<Match>[]): Snapshot {
  const m: Record<string, Match> = {};
  matches.forEach((p, i) => {
    m[String(i)] = {
      id: String(i), roundIndex: 0, slot: i, nextMatchId: null, p1: "a", p2: "b",
      status: "scheduled", winner: null, score: null, live: null, durationSec: null,
      durationProvisional: false, sofaEventId: null, sofaCustomId: null, stats: null, ...p,
    };
  });
  return {
    schemaVersion: 2, generatedAt: "2026-06-09T00:00:00.000Z", tour: "ATP",
    tournament: { slam: "roland-garros", name: "Roland Garros", year: 2026, surface: "Clay",
      sofaUniqueTournamentId: 2480, sofaSeasonId: 85951, drawSize: 128 },
    players: {}, matches: m, rounds: [],
  };
}

describe("slamStatus", () => {
  it("is live when any match is live", () => {
    expect(slamStatus(snap([{ nextMatchId: null, status: "finished", winner: "p1" }, { id: "1", nextMatchId: "x", status: "live" }]))).toBe("live");
  });
  it("is complete when the final (nextMatchId null) is finished and nothing is live", () => {
    expect(slamStatus(snap([{ nextMatchId: null, status: "finished", winner: "p1" }]))).toBe("complete");
  });
  it("is live when the final is not yet finished", () => {
    expect(slamStatus(snap([{ nextMatchId: null, status: "scheduled" }]))).toBe("live");
  });
});

describe("availableSlamOf", () => {
  it("derives a manifest entry from a snapshot", () => {
    expect(availableSlamOf(snap([{ nextMatchId: null, status: "finished", winner: "p1" }]))).toEqual({
      tour: "ATP", year: 2026, slam: "roland-garros", name: "Roland Garros", surface: "Clay",
      status: "complete", generatedAt: "2026-06-09T00:00:00.000Z", drawSize: 128,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test ingest/manifest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `ingest/manifest.ts`**

```ts
import type { AvailableSlam, SlamStatus, Snapshot } from "../src/model";

/** live if any match is in play; complete once the final is decided; otherwise still live. */
export function slamStatus(snap: Snapshot): SlamStatus {
  const matches = Object.values(snap.matches);
  if (matches.some((m) => m.status === "live")) return "live";
  const final = matches.find((m) => m.nextMatchId === null);
  if (final && (final.status === "finished" || final.status === "retired" || final.status === "walkover")) {
    return "complete";
  }
  return "live";
}

/** Build the index.json entry describing a snapshot. */
export function availableSlamOf(snap: Snapshot): AvailableSlam {
  return {
    tour: snap.tour,
    year: snap.tournament.year,
    slam: snap.tournament.slam,
    name: snap.tournament.name,
    surface: snap.tournament.surface,
    status: slamStatus(snap),
    generatedAt: snap.generatedAt,
    drawSize: snap.tournament.drawSize,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test ingest/manifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ingest/manifest.ts ingest/manifest.test.ts
git commit -m "feat(ingest): slamStatus + availableSlamOf manifest entry"
```

---

## Task 8: Merge manifest entries

**Files:**
- Modify: `ingest/manifest.ts`
- Test: `ingest/manifest.test.ts`

- [ ] **Step 1: Write the failing test** — append to `ingest/manifest.test.ts`:

```ts
import { mergeIndex } from "./manifest";
import type { AvailableSlam } from "../src/model";

const entry = (over: Partial<AvailableSlam>): AvailableSlam => ({
  tour: "ATP", year: 2026, slam: "roland-garros", name: "Roland Garros", surface: "Clay",
  status: "live", generatedAt: "t0", drawSize: 128, ...over,
});

describe("mergeIndex", () => {
  it("updates an existing slam in place (by tour+year+slam) and preserves others", () => {
    const existing = [entry({ status: "live", generatedAt: "t0" }), entry({ slam: "australian-open", name: "Australian Open", surface: "Hard", status: "complete" })];
    const merged = mergeIndex(existing, [entry({ status: "complete", generatedAt: "t1" })]);
    expect(merged).toHaveLength(2);
    const rg = merged.find((s) => s.slam === "roland-garros")!;
    expect(rg).toMatchObject({ status: "complete", generatedAt: "t1" });
    expect(merged.find((s) => s.slam === "australian-open")!.status).toBe("complete");
  });
  it("adds new slams and sorts newest year first", () => {
    const merged = mergeIndex([entry({ year: 2024 })], [entry({ year: 2026 })]);
    expect(merged.map((s) => s.year)).toEqual([2026, 2024]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test ingest/manifest.test.ts`
Expected: FAIL — `mergeIndex` not exported.

- [ ] **Step 3: Add `mergeIndex` to `ingest/manifest.ts`**

```ts
/** Merge fresh entries into an existing manifest list, keyed by tour+year+slam; newest year first. */
export function mergeIndex(existing: AvailableSlam[], entries: AvailableSlam[]): AvailableSlam[] {
  const key = (a: AvailableSlam) => `${a.tour}:${a.year}:${a.slam}`;
  const byKey = new Map(existing.map((s) => [key(s), s]));
  for (const e of entries) byKey.set(key(e), e);
  return [...byKey.values()].sort(
    (a, b) => b.year - a.year || a.slam.localeCompare(b.slam) || a.tour.localeCompare(b.tour),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test ingest/manifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ingest/manifest.ts ingest/manifest.test.ts
git commit -m "feat(ingest): mergeIndex for the slam manifest"
```

---

## Task 9: Write per-slam files + index.json from the ingest

This restructures `ingest/index.ts` so a single `publishSlam` helper ingests both tours for one slam config, writes `{tour}-{year}-{slam}.json` (plus a `{tour}.json` alias for the active slam, so the *current* app keeps working until Plan 2 ships), and merges `index.json`.

**Files:**
- Modify: `ingest/index.ts`

- [ ] **Step 1: Replace the contents of `ingest/index.ts`** with:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type AvailableSlam, type SlamIndex, type Snapshot, type Tour, snapshotFilename } from "../src/model";
import { DRAW_SIZE, SLAMS, activeSlam, type SlamConfig } from "./config";
import { openContext, fetchTournament, resolveSeasonId } from "./sofascore";
import { normalizeCuptrees } from "./normalize";
import { enrichMatch } from "./enrich";
import { fetchElo, applyElo } from "./elo";
import { availableSlamOf, mergeIndex } from "./manifest";

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
    try {
      const elo = await fetchElo(tour);
      const { matched, unmatched } = applyElo(snap.players, elo);
      console.log(`${cfg.slam} ${tour}: ELO matched ${matched}/${Object.keys(snap.players).length} (${unmatched.length} unmatched)`);
    } catch (err) {
      console.warn(`${cfg.slam} ${tour}: ELO enrichment skipped (keeping elo=null):`, err);
    }
    const matchCount = Object.keys(snap.matches).length;
    if (matchCount < DRAW_SIZE - 1) {
      throw new Error(`${cfg.slam} ${tour}: draw not fully available yet (${matchCount}/${DRAW_SIZE - 1} matches) — keeping last-good`);
    }
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

/** Ingest both tours for one slam config; write per-slam files (+ active alias); return manifest entries. */
async function publishSlam(cfg: SlamConfig, isoNow: string, nowSec: number, writeAlias: boolean): Promise<AvailableSlam[]> {
  const entries: AvailableSlam[] = [];
  for (const tour of ["ATP", "WTA"] as Tour[]) {
    try {
      const snap = await ingestTour(cfg, tour, isoNow, nowSec);
      await writeFile(resolve(OUT_DIR, snapshotFilename(tour, cfg.year, cfg.slam)), JSON.stringify(snap));
      if (writeAlias) await writeFile(resolve(OUT_DIR, `${tour.toLowerCase()}.json`), JSON.stringify(snap));
      const played = Object.values(snap.matches).filter((m) => m.status !== "scheduled" && m.status !== "notstarted").length;
      console.log(`wrote ${snapshotFilename(tour, cfg.year, cfg.slam)}: ${Object.keys(snap.matches).length} matches (${played} played)`);
      entries.push(availableSlamOf(snap));
    } catch (err) {
      console.error(`ingest ${cfg.slam} ${tour} failed (keeping last-good):`, err);
    }
  }
  return entries;
}

async function main(): Promise<void> {
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

  const entries = await publishSlam(cfg, isoNow, nowSec, true);
  if (entries.length === 0) { console.error("ingest failed for all tours"); process.exitCode = 1; return; }

  const idx = await loadIndex();
  const merged: SlamIndex = { schemaVersion: 2, generatedAt: isoNow, slams: mergeIndex(idx.slams, entries) };
  await writeFile(resolve(OUT_DIR, "index.json"), JSON.stringify(merged));
  console.log(`index.json: ${merged.slams.length} slams`);
}

main().catch((err) => { console.error("ingest failed:", err); process.exitCode = 1; });
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Run the full unit suite (no regressions)**

Run: `pnpm test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add ingest/index.ts
git commit -m "feat(ingest): write per-slam snapshots + merged index.json"
```

---

## Task 10: Backfill mode for past years

**Files:**
- Modify: `ingest/manifest.ts`
- Modify: `ingest/index.ts`
- Test: `ingest/manifest.test.ts`

- [ ] **Step 1: Write the failing test** — append to `ingest/manifest.test.ts`:

```ts
import { backfillTargets } from "./manifest";

describe("backfillTargets", () => {
  it("returns empty for no input", () => {
    expect(backfillTargets(undefined)).toEqual([]);
    expect(backfillTargets("")).toEqual([]);
  });
  it("expands a comma list of years across all four slams", () => {
    const t = backfillTargets("2024,2025");
    expect(t).toHaveLength(8);
    expect(t).toContainEqual({ year: 2024, slam: "roland-garros" });
    expect(t).toContainEqual({ year: 2025, slam: "wimbledon" });
  });
  it("ignores non-numeric years", () => {
    expect(backfillTargets("2024,foo")).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test ingest/manifest.test.ts`
Expected: FAIL — `backfillTargets` not exported.

- [ ] **Step 3: Add `backfillTargets` to `ingest/manifest.ts`**

Add the import at the top of the file:

```ts
import { SLAMS } from "./config";
```

Add the function:

```ts
/** Expand a "2024,2025" env string into {year, slam} targets across all four slams. */
export function backfillTargets(yearsCsv: string | undefined): { year: number; slam: string }[] {
  if (!yearsCsv) return [];
  const years = yearsCsv.split(",").map((y) => Number(y.trim())).filter((y) => Number.isInteger(y));
  const out: { year: number; slam: string }[] = [];
  for (const year of years) for (const slam of Object.keys(SLAMS)) out.push({ year, slam });
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test ingest/manifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire backfill into `main()` in `ingest/index.ts`**

Add the import:

```ts
import { availableSlamOf, mergeIndex, backfillTargets } from "./manifest";
```

At the very start of `main()`, before the `activeSlam()` block, insert the backfill branch:

```ts
  const backfill = backfillTargets(process.env.BACKFILL_YEARS);
  if (backfill.length) {
    const isoNow = new Date().toISOString();
    const nowSec = Math.floor(Date.now() / 1000);
    await mkdir(OUT_DIR, { recursive: true });
    let entries: AvailableSlam[] = [];
    for (const { year, slam } of backfill) {
      const cfg = { ...SLAMS[slam], year };
      console.log(`backfill: ${slam} (${year})`);
      entries = entries.concat(await publishSlam(cfg, isoNow, nowSec, false));
    }
    const idx = await loadIndex();
    const merged: SlamIndex = { schemaVersion: 2, generatedAt: isoNow, slams: mergeIndex(idx.slams, entries) };
    await writeFile(resolve(OUT_DIR, "index.json"), JSON.stringify(merged));
    console.log(`backfill done — index.json: ${merged.slams.length} slams`);
    return;
  }
```

- [ ] **Step 6: Typecheck + full suite**

Run: `pnpm typecheck && pnpm test`
Expected: clean + all PASS.

- [ ] **Step 7: Commit**

```bash
git add ingest/manifest.ts ingest/manifest.test.ts ingest/index.ts
git commit -m "feat(ingest): BACKFILL_YEARS mode ingests past-year slams"
```

---

## Task 11: Document the multi-file data layout in the publish script

`scripts/publish-data.sh` already copies `public/data/*.json` (now including per-slam files + `index.json`), so it needs no behavioural change. Document the new contract and the "freeze a completed slam" workflow so a future maintainer understands persistence.

**Files:**
- Modify: `scripts/publish-data.sh`

- [ ] **Step 1: Update the header comment** — replace the top comment block (lines 2-6) with:

```bash
# Refresh tennis data from a residential IP and publish to the `data` branch.
# GitHub-hosted runners are Cloudflare-blocked, so run this locally (or via launchd/cron).
#
# Data layout (public/data/, all copied to the orphan `data` branch each run):
#   index.json                          — manifest of available slams (merged each ingest)
#   {tour}-{year}-{slam}.json           — one snapshot per slam (e.g. atp-2026-roland-garros.json)
#   {atp,wta}.json                      — alias of the *active* slam (legacy; current app fallback)
# Only the active slam is rewritten each run; completed slams persist because their JSON is
# committed to the repo seed (public/data/). To FREEZE a finished slam, commit its final
# {tour}-{year}-{slam}.json + the updated index.json to main once the final is played.
# Backfill past years with: BACKFILL_YEARS=2024,2025 pnpm ingest
#
# Approach: uses a throwaway git worktree to build the clean data-only branch, so the
# main working tree is never touched by the branch-switching logic and cannot be corrupted.
```

- [ ] **Step 2: Verify the script still parses**

Run: `bash -n scripts/publish-data.sh`
Expected: no output (syntax OK).

- [ ] **Step 3: Commit**

```bash
git add scripts/publish-data.sh
git commit -m "docs(ingest): document multi-slam data layout in publish script"
```

---

## Self-review

**Spec coverage** (spec §6, §9, §10, §13):
- §6 surface-ELO data → Tasks 2-5 (fetch/parse/join, age back-fill). *Projection logic itself is Plan 3.*
- §9 per-`{tour,year,slam}` files + `index.json` + active-only overwrite → Tasks 1, 7-9.
- §9 backfill recent years + per-year season resolution → Tasks 6, 10.
- §10 ingest writes per-slam + index, don't-clobber-complete (completed slams committed as seed; active aliased) → Tasks 9, 11.
- §10/§13 ELO outage degrades gracefully → Task 5 try/catch + Task 4 null path.
- §13 schemaVersion guard → Task 1 bump to 2.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `EloEntry.elo: PlayerElo` (Task 3) matches `Player.elo: PlayerElo | null` (Task 1); `applyElo` signature (Task 4) matches its call site (Task 5/9); `availableSlamOf`→`AvailableSlam` (Task 7) matches `mergeIndex` element type (Task 8) and `SlamIndex.slams` (Task 1); `snapshotFilename(tour, year, slam)` used identically in Task 1 (def) and Task 9 (call); `pickSeasonId`/`resolveSeasonId(year?)` consistent (Task 6).

**Notes for the executor:**
- `pnpm test <path>` runs `TZ=UTC vitest run <path>` (single-file filter).
- Updating `ingest/normalize.test.ts`'s `schemaVersion` assertion to `2` (Task 1 Step 6) is required or the suite fails.
- Full end-to-end verification (`pnpm ingest` against live SofaScore + Tennis Abstract) needs a residential IP and is a manual smoke, not a unit test.
