# Elo: Full Tennis-Abstract Reproduction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make TennisArc's recomputed historical Elo reproduce Tennis Abstract's *published* ATP/WTA Elo board as closely as public data allows (measured target: overall ±20–30, surface ±5–15), by adopting TA's verified methodology — flat 50/50 surface blend, Challenger+qualifying inclusion, and a fitted low-1200s entrant seed — and pinning the result with an empirical calibration harness + regression fixture.

**Architecture:** Extend the existing pure-function engine in `ingest/historical-elo.ts` (don't rewrite it). Three methodology changes (surface blend → 50/50; entrant seed → fittable `seedFor(level,round)`; match scope → add `*_qual_chall_*` / WTA ITF≥$50K). A new build-only `ingest/calibrate-elo.ts` runs the engine to "today", scrapes the live TA board via the existing `ingest/elo.ts`, grid-searches the seed parameters against it, and emits the fitted constants. A new fixture test pins ~30 known TA values (with as-of date) within tolerance. Then re-run `backfill-elo` + `reindex` to regenerate all 113 snapshots.

**Tech Stack:** TypeScript, `tsx`, Vitest (TZ=UTC), Jeff Sackmann CSVs (GitHub raw, CC BY-NC-SA 4.0), live `tennisabstract.com/reports/{atp,wta}_elo_ratings.html`.

**Verified facts driving this plan (issue #25 investigation, 2026-06-14):**
- Byte-exact is *provably impossible* (Sackmann's `tennis_viz/players_weekly_elo.py`: "(historical ratings and code to generate ratings are not public)"). **The ±1–2/"ideally exact" target is retired.**
- Surface Elo = flat `0.5*overall + 0.5*pureSurface`, all surfaces, all sample sizes (TA page + Heavy Topspin 2017/2019, conf 0.92). Measured: fixes grass median error −265→−73.
- No MOV multiplier (conf 0.97) — current binary update is already correct, **do not add MOV**.
- Inclusion = all tour-level + tour-level qualifying + Challenger main draw (ATP); +ITF≥$50K (WTA) (conf 0.95).
- Entrant seed = "low 1200s", level- & gender-dependent, never published (conf 0.93). Empirically fitted ≈1230 (single-seed, ATP, 2000+). Must be fitted, not derived.
- K = `250/(n+5)^0.4` matches best-documented form (conf 0.72) — keep.
- Walkover/RET handling **unverified** (the "TA excludes them" claim was a search hallucination, absent from all primary text). **Keep current behavior (count as wins); do not flip without primary proof.**
- Inclusion + seed are *coupled*: adding Challengers at seed 1500 inflates everyone +263; the low-1200s seed cancels it. They MUST land together.
- The `ingest/elo.ts` HTML parser is byte-correct (no column bug — verified against raw 17-cell rows).

---

## File Structure

- **Modify** `ingest/historical-elo.ts` — add a fittable `EloConfig { seedFor(level, round) }` threaded through `EloEngine` / `computeRatingsAsOf*`; change `resolveSurfaceElo` to flat 50/50; carry `round` on `EloMatchRow`.
- **Modify** `ingest/historical-elo.test.ts` — update surface-blend expectations; add seed-config + 50/50 + level-seed unit tests.
- **Modify** `ingest/durations.ts` — add `fetchQualChallCsv(tour, year)` and (WTA) `fetchQualItfCsv`; export a `WTA_ITF_MIN` filter helper. (These are the canonical CSV fetchers; `backfill-elo` already imports `fetchMatchesCsv` from here.)
- **Modify** `ingest/backfill-elo.ts` — `loadTourRows` also fetches the qual/challenger (and WTA ITF≥$50K) files; pass the fitted `EloConfig`.
- **Create** `ingest/elo-config.ts` — the frozen, fitted seed constants (`ATP_ELO_CONFIG`, `WTA_ELO_CONFIG`) + provenance comment (fit date, TA as-of date, achieved residual).
- **Create** `ingest/calibrate-elo.ts` — build-only harness: run engine to today, scrape live TA, diff, grid-search the seed, print the fit. (Promotes `.scratch/calibrate-elo.ts` + `.scratch/fit-start.ts`.)
- **Create** `ingest/historical-elo.fixture.test.ts` — regression test pinning ~30 captured TA values (with as-of date) within tolerance.
- **Create** `ingest/fixtures/ta-elo-reference.json` — the captured ~30-player TA reference snapshot + `asOf` date.
- **Modify** `RESEARCH.md` / `README.md` — document the methodology, the retired exactness goal, provenance.

---

### Task 1: Carry `round` on EloMatchRow (needed for qualifying-aware seeding)

**Files:**
- Modify: `ingest/historical-elo.ts` (`EloMatchRow` already has `round`; verify and keep)
- Test: `ingest/historical-elo.test.ts`

`EloMatchRow` already includes `round` (line 56) and `parseEloMatchesCsv` already populates it (line 100). **No code change** — this task just confirms the field is present and adds a guard test so later seeding can rely on it.

- [ ] **Step 1: Write the failing test**

```ts
// in ingest/historical-elo.test.ts
import { parseEloMatchesCsv } from "./historical-elo";

test("parseEloMatchesCsv carries round and level for seeding", () => {
  const csv = [
    "tourney_name,surface,tourney_date,winner_id,loser_id,winner_name,loser_name,round,tourney_level",
    "Some Challenger,Hard,20240101,1,2,A B,C D,Q1,C",
  ].join("\n");
  const rows = parseEloMatchesCsv(csv);
  expect(rows[0].round).toBe("Q1");
  expect(rows[0].level).toBe("C");
});
```

- [ ] **Step 2: Run test to verify it passes (field already present)**

Run: `TZ=UTC npx vitest run ingest/historical-elo.test.ts -t "carries round"`
Expected: PASS (this is a characterization test; if it fails, `parseEloMatchesCsv` regressed).

- [ ] **Step 3: Commit**

```bash
git add ingest/historical-elo.test.ts
git commit -m "test(elo): pin round/level on parsed rows for seeding"
```

---

### Task 2: Flat 50/50 surface blend

**Files:**
- Modify: `ingest/historical-elo.ts:33-45` (`resolveSurfaceElo`)
- Test: `ingest/historical-elo.test.ts`

Replace the `surfaceCount/10` ramp-then-pure logic with TA's documented flat blend: `null` if the player has zero matches on the surface, else `0.5*overall + 0.5*pureSurface` regardless of count.

- [ ] **Step 1: Write the failing test**

```ts
// in ingest/historical-elo.test.ts
import { resolveSurfaceElo } from "./historical-elo";

test("resolveSurfaceElo is a flat 50/50 blend (TA methodology)", () => {
  // 0 surface matches -> no signal -> null
  expect(resolveSurfaceElo(1500, 0, 2000)).toBeNull();
  // any count >= 1 -> exactly 0.5*overall + 0.5*pureSurface (no ramp, no pure-beyond-10)
  expect(resolveSurfaceElo(1600, 1, 2000)).toBe(1800);   // 0.5*2000 + 0.5*1600
  expect(resolveSurfaceElo(1600, 50, 2000)).toBe(1800);  // identical at high count (no "pure" regime)
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TZ=UTC npx vitest run ingest/historical-elo.test.ts -t "flat 50/50"`
Expected: FAIL — current code returns the ramped/pure value (e.g. `1600` at count 50), not `1800`.

- [ ] **Step 3: Implement the flat blend**

```ts
// ingest/historical-elo.ts — replace resolveSurfaceElo (lines 25-45)
/**
 * Tennis Abstract's surface Elo is a flat 50/50 blend of overall and a pure single-surface rating
 * (TA report page + Heavy Topspin 2017/2019: "50/50 worked for each surface"), applied at ALL sample
 * sizes. `surfaceCount === 0` means the player has never played the surface -> no signal -> null.
 */
export function resolveSurfaceElo(
  surfaceRating: number,
  surfaceCount: number,
  overall: number,
): number | null {
  if (surfaceCount === 0) return null;
  return 0.5 * overall + 0.5 * surfaceRating;
}
```

(Drop the now-unused `burnIn` parameter. Update the two call sites in `computeRatingsAsOfSorted` lines 247-249 — they already pass `(s.hard, s.hardN, s.overall)` etc., so they keep working with the 3-arg signature.)

- [ ] **Step 4: Run test to verify it passes**

Run: `TZ=UTC npx vitest run ingest/historical-elo.test.ts -t "flat 50/50"`
Expected: PASS.

- [ ] **Step 5: Update other historical-elo.test.ts expectations & run the file**

Run: `TZ=UTC npx vitest run ingest/historical-elo.test.ts`
Expected: Some existing surface assertions fail (they encoded the old ramp). Recompute the expected values by hand from `0.5*overall + 0.5*pureSurface` and update them. Overall-rating assertions are unaffected.

- [ ] **Step 6: Commit**

```bash
git add ingest/historical-elo.ts ingest/historical-elo.test.ts
git commit -m "feat(elo): flat 50/50 surface blend to match Tennis Abstract"
```

---

### Task 3: Fittable entrant seed (`EloConfig.seedFor`)

**Files:**
- Modify: `ingest/historical-elo.ts` (`freshState`, `EloEngine`, `computeRatingsAsOf*`)
- Test: `ingest/historical-elo.test.ts`

Make the entrant seed configurable per (debut level, round) so the calibration harness can fit it; default stays 1500 (so all current snapshots and tests are unchanged until a config is passed).

- [ ] **Step 1: Write the failing test**

```ts
// in ingest/historical-elo.test.ts
import { computeRatingsAsOf, DEFAULT_ELO_CONFIG, type EloConfig } from "./historical-elo";

const row = (o: Partial<any> = {}) => ({
  tourneyName: "T", tourneyDate: 20240101, surface: "Hard" as const,
  winnerId: "1", loserId: "2", winnerName: "Win A", loserName: "Lose B",
  round: "R32", level: "A", ...o,
});

test("seedFor controls the entrant rating; default is 1500", () => {
  // default config: both start 1500, winner ends > 1500, loser < 1500
  const def = computeRatingsAsOf([row()], 20240102);
  expect(def.byId.get("2")!.overall).toBeLessThan(1500);
  expect(def.byId.get("2")!.overall).toBeGreaterThan(1490);

  // custom seed: challenger debut (level C) seeds at 1230, tour debut at 1500
  const cfg: EloConfig = { seedFor: (level) => (level === "C" ? 1230 : 1500) };
  const cust = computeRatingsAsOf([row({ level: "C" })], 20240102, cfg);
  expect(cust.byId.get("2")!.overall).toBeLessThan(1230);
  expect(cust.byId.get("2")!.overall).toBeGreaterThan(1200);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TZ=UTC npx vitest run ingest/historical-elo.test.ts -t "seedFor controls"`
Expected: FAIL — `DEFAULT_ELO_CONFIG`/`EloConfig` don't exist; `computeRatingsAsOf` takes no 3rd arg.

- [ ] **Step 3: Implement the seed config**

```ts
// ingest/historical-elo.ts

/** Entrant seeding policy. seedFor receives the level + round of a player's FIRST observed match
 *  (TA seeds lower for players who debut below tour level). Default seeds everyone at 1500. */
export interface EloConfig {
  seedFor: (level: string, round: string) => number;
}
export const DEFAULT_ELO_CONFIG: EloConfig = { seedFor: () => 1500 };

// freshState now takes the seed:
const freshState = (name: string, seed: number): RatingState => ({
  overall: seed, overallN: 0, hard: seed, hardN: 0, clay: seed, clayN: 0, grass: seed, grassN: 0, name,
});

// EloEngine takes a config; state() seeds on first sight using the row's level+round:
export class EloEngine {
  readonly players = new Map<string, RatingState>();
  constructor(private readonly config: EloConfig = DEFAULT_ELO_CONFIG) {}

  private state(id: string, name: string, level: string, round: string): RatingState {
    let s = this.players.get(id);
    if (!s) {
      s = freshState(name, this.config.seedFor(level, round));
      this.players.set(id, s);
    } else if (name && !s.name) {
      s.name = name;
    }
    return s;
  }

  update(row: EloMatchRow): void {
    const w = this.state(row.winnerId, row.winnerName, row.level, row.round);
    const l = this.state(row.loserId, row.loserName, row.level, row.round);
    // ...rest unchanged (lines 156-169)...
  }
  // surfaceUpdate unchanged
}

// thread the config through compute*:
export function computeRatingsAsOfSorted(
  sortedRows: EloMatchRow[], cutoffDate: number, config: EloConfig = DEFAULT_ELO_CONFIG,
): ComputedRatings {
  const engine = new EloEngine(config);
  // ...rest unchanged...
}
export function computeRatingsAsOf(
  rows: EloMatchRow[], cutoffDate: number, config: EloConfig = DEFAULT_ELO_CONFIG,
): ComputedRatings {
  return computeRatingsAsOfSorted(sortEloRows(rows), cutoffDate, config);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `TZ=UTC npx vitest run ingest/historical-elo.test.ts`
Expected: PASS — including the unchanged-default behavior tests (existing assertions still hold because the default seed is 1500).

- [ ] **Step 5: Commit**

```bash
git add ingest/historical-elo.ts ingest/historical-elo.test.ts
git commit -m "feat(elo): fittable per-level entrant seed (EloConfig), default 1500"
```

---

### Task 4: Fetch Challenger/qualifying (ATP) and ITF≥$50K (WTA)

**Files:**
- Modify: `ingest/durations.ts` (add fetchers near `fetchMatchesCsv`, line 108-113)
- Test: `ingest/durations.test.ts` (URL-construction unit test; no network)

`*_matches_qual_chall_{year}.csv` holds qualifying + Challenger main draw (ATP from 2008/2011). For WTA, the ≥$50K ITF events are in `wta_matches_qual_itf_{year}.csv`; rows must be filtered to prize tier ≥ $50K via `tourney_level` (WTA ITF codes are dollar tiers, e.g. `50`, `75`, `100`).

- [ ] **Step 1: Write the failing test**

```ts
// in ingest/durations.test.ts
import { qualChallUrl } from "./durations";

test("qualChallUrl builds the qual/challenger file URL per tour", () => {
  expect(qualChallUrl("ATP", 2024)).toBe(
    "https://raw.githubusercontent.com/JeffSackmann/tennis_atp/master/atp_matches_qual_chall_2024.csv");
  expect(qualChallUrl("WTA", 2024)).toBe(
    "https://raw.githubusercontent.com/JeffSackmann/tennis_wta/master/wta_matches_qual_itf_2024.csv");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TZ=UTC npx vitest run ingest/durations.test.ts -t "qualChallUrl"`
Expected: FAIL — `qualChallUrl` not exported.

- [ ] **Step 3: Implement the fetchers**

```ts
// ingest/durations.ts — add near MATCHES_URL / fetchMatchesCsv

/** Qualifying + Challenger (ATP) / qualifying + ITF (WTA) file. ATP: 2008+ challengers, 2011+ quallies. */
export const qualChallUrl = (tour: Tour, year: number): string => {
  const t = tour.toLowerCase();
  const stem = tour === "ATP" ? "qual_chall" : "qual_itf";
  return `https://raw.githubusercontent.com/JeffSackmann/tennis_${t}/master/${t}_matches_${stem}_${year}.csv`;
};

/** Fetch the qual/challenger file; returns null on 404 (some early years are absent) rather than throw. */
export async function fetchQualChallCsv(tour: Tour, year: number): Promise<string | null> {
  const res = await fetch(qualChallUrl(tour, year), { headers: { "User-Agent": "Mozilla/5.0 TennisArc/1.0" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`qual_chall CSV HTTP ${res.status} for ${tour} ${year}`);
  return res.text();
}

/** WTA ITF tiers we count (>= $50K). ATP qual_chall needs no prize filter (challengers all count). */
export const WTA_ITF_MIN_TIERS = new Set(["50", "75", "80", "100", "125"]);
```

- [ ] **Step 4: Add a WTA prize-tier filter to `parseEloMatchesCsv` consumers**

The ITF filter is applied in `backfill-elo` (Task 5), not in the parser, so the parser stays generic. Add an exported predicate here for reuse/testing:

```ts
// ingest/durations.ts
/** Keep a WTA ITF row only if its tourney_level is a >= $50K tier (or a non-ITF level like W/P/PM/I/G/M). */
export const keepWtaQualItf = (level: string): boolean =>
  WTA_ITF_MIN_TIERS.has(level) || !/^\d+$/.test(level);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `TZ=UTC npx vitest run ingest/durations.test.ts -t "qualChallUrl"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ingest/durations.ts ingest/durations.test.ts
git commit -m "feat(ingest): fetch ATP qual/challenger + WTA ITF>=50K match files"
```

---

### Task 5: Wire expanded scope + config into `backfill-elo` `loadTourRows`

**Files:**
- Modify: `ingest/backfill-elo.ts:27-37` (`loadTourRows`), `:85` (pass config)
- Modify: `ingest/historical-elo.ts` — `parseEloMatchesCsv` gains an optional row predicate (to drop sub-$50K WTA ITF rows)

- [ ] **Step 1: Add an optional filter to `parseEloMatchesCsv`**

```ts
// ingest/historical-elo.ts — parseEloMatchesCsv signature + the push site
export function parseEloMatchesCsv(csv: string, keepLevel: (level: string) => boolean = () => true): EloMatchRow[] {
  // ...inside the loop, after computing the level, before out.push:
  const level = cols[iLevel] ?? "";
  if (!keepLevel(level)) continue;
  // ...then set level in the pushed object as before...
}
```

- [ ] **Step 2: Expand `loadTourRows` to include qual/challenger + ITF≥$50K**

```ts
// ingest/backfill-elo.ts
import { fetchMatchesCsv, fetchQualChallCsv, keepWtaQualItf } from "./durations";
import { ATP_ELO_CONFIG, WTA_ELO_CONFIG } from "./elo-config"; // created in Task 7

async function loadTourRows(tour: Tour, maxYear: number): Promise<EloMatchRow[]> {
  const rows: EloMatchRow[] = [];
  const itfFilter = tour === "WTA" ? keepWtaQualItf : undefined;
  for (let year = START_YEAR; year <= maxYear; year++) {
    const main = await fetchMatchesCsv(tour, year).catch((e) => (console.warn(`${tour} ${year} main: ${e}`), null));
    if (main) rows.push(...parseEloMatchesCsv(main));
    const qc = await fetchQualChallCsv(tour, year).catch((e) => (console.warn(`${tour} ${year} qual: ${e}`), null));
    if (qc) rows.push(...parseEloMatchesCsv(qc, itfFilter));
  }
  return sortEloRows(rows);
}

const configFor = (tour: Tour) => (tour === "ATP" ? ATP_ELO_CONFIG : WTA_ELO_CONFIG);
```

And at the compute call (line 85): `const { byName } = computeRatingsAsOfSorted(rows, cutoff, configFor(snap.tour));`

- [ ] **Step 3: Typecheck (no unit test — this is wiring; Task 8 fixture validates the numbers)**

Run: `npx tsc --noEmit`
Expected: PASS once `elo-config.ts` exists (Task 7). Until then, temporarily inline `DEFAULT_ELO_CONFIG`.

- [ ] **Step 4: Commit**

```bash
git add ingest/backfill-elo.ts ingest/historical-elo.ts
git commit -m "feat(ingest): include qual/challenger scope + per-tour Elo config in backfill"
```

---

### Task 6: Calibration harness (`ingest/calibrate-elo.ts`)

**Files:**
- Create: `ingest/calibrate-elo.ts` (promote `.scratch/calibrate-elo.ts` + `.scratch/fit-start.ts`)
- Reuse: a local CSV cache dir (`.cache/elo/`, gitignored) so repeated runs don't re-fetch.

Build-only script. Runs the engine forward to today over the expanded scope, scrapes the live TA board via `fetchElo(tour)` from `ingest/elo.ts`, joins by `normalizeName`, grid-searches `seedTour`×`seedSub` per tour to minimize median |overall error|, and prints the fitted config + achieved residual table (overall + per surface). No assertions — it's an analysis tool; Task 7 freezes its output.

- [ ] **Step 1: Implement the harness** (full code; mirrors the validated `.scratch` versions)

```ts
// ingest/calibrate-elo.ts
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Tour } from "../src/model";
import { fetchMatchesCsv, fetchQualChallCsv, keepWtaQualItf } from "./durations";
import { parseEloMatchesCsv, computeRatingsAsOf, type EloConfig, type EloMatchRow } from "./historical-elo";
import { fetchElo, normalizeName } from "./elo";

const CACHE = resolve(process.cwd(), ".cache/elo");
mkdirSync(CACHE, { recursive: true });
const START_YEAR = 2000;

async function cachedCsv(name: string, fetcher: () => Promise<string | null>): Promise<string | null> {
  const p = resolve(CACHE, name);
  if (existsSync(p)) return readFileSync(p, "utf8");
  const csv = await fetcher();
  if (csv) writeFileSync(p, csv);
  return csv;
}

async function loadRows(tour: Tour, maxYear: number): Promise<EloMatchRow[]> {
  const rows: EloMatchRow[] = [];
  const itf = tour === "WTA" ? keepWtaQualItf : undefined;
  for (let y = START_YEAR; y <= maxYear; y++) {
    const main = await cachedCsv(`${tour}_${y}.csv`, () => fetchMatchesCsv(tour, y).catch(() => null));
    if (main) rows.push(...parseEloMatchesCsv(main));
    const qc = await cachedCsv(`${tour}_qc_${y}.csv`, () => fetchQualChallCsv(tour, y).catch(() => null));
    if (qc) rows.push(...parseEloMatchesCsv(qc, itf));
  }
  return rows;
}

const seedConfig = (seedTour: number, seedSub: number): EloConfig => ({
  // sub-tour debut = challenger (level C) or a qualifying round (Q*) -> lower seed.
  seedFor: (level, round) => (level === "C" || /^Q/.test(round) ? seedSub : seedTour),
});

const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const meanAbs = (a: number[]) => (a.length ? a.reduce((p, c) => p + Math.abs(c), 0) / a.length : NaN);

async function calibrate(tour: Tour): Promise<void> {
  const maxYear = new Date().getUTCFullYear();
  const rows = await loadRows(tour, maxYear);
  const ta = await fetchElo(tour);
  const taTop = [...ta.values()].filter((e) => e.elo.overall != null)
    .sort((a, b) => (b.elo.overall! - a.elo.overall!)).slice(0, 50);

  let best = { seedTour: 1500, seedSub: 1230, score: Infinity, ovr: 0, h: 0, c: 0, g: 0 };
  for (const seedTour of [1400, 1450, 1500, 1550]) {
    for (const seedSub of [1180, 1210, 1230, 1250, 1270, 1300]) {
      const { byId } = computeRatingsAsOf(rows, 99999999, seedConfig(seedTour, seedSub));
      const ours = new Map<string, any>();
      for (const c of byId.values()) { const k = normalizeName(c.name); if (k) ours.set(k, c); }
      const d: number[] = [], dh: number[] = [], dc: number[] = [], dg: number[] = [];
      for (const t of taTop) {
        const o = ours.get(normalizeName(t.name)); if (!o) continue;
        d.push(o.overall - t.elo.overall!);
        if (t.elo.hard != null && o.hard != null) dh.push(o.hard - t.elo.hard);
        if (t.elo.clay != null && o.clay != null) dc.push(o.clay - t.elo.clay);
        if (t.elo.grass != null && o.grass != null) dg.push(o.grass - t.elo.grass);
      }
      const score = meanAbs(d) + meanAbs(dh) + meanAbs(dc) + meanAbs(dg);
      if (score < best.score) best = { seedTour, seedSub, score, ovr: meanAbs(d), h: meanAbs(dh), c: meanAbs(dc), g: meanAbs(dg) };
    }
  }
  console.log(`${tour} best:`, best);
}

(async () => { await calibrate("ATP"); await calibrate("WTA"); })();
```

- [ ] **Step 2: Run it (network; sandbox off)**

Run: `npx tsx ingest/calibrate-elo.ts`
Expected: prints `ATP best: { seedTour, seedSub, score, ovr, h, c, g }` and the same for WTA. Sanity: `ovr` (overall meanAbs) should land roughly 20–40; `seedSub` in the low 1200s.

- [ ] **Step 3: Add `.cache/` to `.gitignore` and commit the harness**

```bash
grep -q '^.cache/' .gitignore || echo ".cache/" >> .gitignore
git add ingest/calibrate-elo.ts .gitignore
git commit -m "feat(ingest): Elo calibration harness (fit entrant seed vs live TA)"
```

---

### Task 7: Freeze the fitted config (`ingest/elo-config.ts`)

**Files:**
- Create: `ingest/elo-config.ts`

Transcribe the harness's chosen `seedTour`/`seedSub` per tour into frozen constants, with a provenance comment (fit date, TA as-of date, achieved residual). This is the single place the production backfill reads its seed from.

- [ ] **Step 1: Write the config from the Task 6 output**

```ts
// ingest/elo-config.ts
import type { EloConfig } from "./historical-elo";

// Fitted 2026-06-14 against live Tennis Abstract (as-of 2026-06-08) over Sackmann tour + qual/challenger
// (ATP) / ITF>=$50K (WTA), 2000+. Byte-exact is impossible (TA's seed/penalty/code are unpublished);
// these minimize median |overall error| on the top-50 TA players. Achieved residual recorded below.
//   ATP: ovr meanAbs ~<FILL>, surfaces ~<FILL>   WTA: ovr meanAbs ~<FILL>, surfaces ~<FILL>
const seedConfig = (seedTour: number, seedSub: number): EloConfig => ({
  seedFor: (level, round) => (level === "C" || /^Q/.test(round) ? seedSub : seedTour),
});

export const ATP_ELO_CONFIG: EloConfig = seedConfig(/*seedTour*/ 1500, /*seedSub*/ 1230); // <- from harness
export const WTA_ELO_CONFIG: EloConfig = seedConfig(/*seedTour*/ 1500, /*seedSub*/ 1230); // <- from harness
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (backfill-elo's Task 5 import now resolves).

- [ ] **Step 3: Commit**

```bash
git add ingest/elo-config.ts
git commit -m "feat(elo): freeze fitted per-tour entrant seed config"
```

---

### Task 8: Regression fixture (pin ~30 TA values within tolerance)

**Files:**
- Create: `ingest/fixtures/ta-elo-reference.json`
- Create: `ingest/historical-elo.fixture.test.ts`

Capture ~30 well-known TA players (overall + hElo/cElo/gElo) with the board's as-of date, and assert our "today" recompute lands within a tolerance band. This is the guardrail that catches regressions when CSVs or parameters change. Because TA updates weekly, the reference is captured *deliberately* with its date; the test compares our engine run to the *same* as-of cutoff.

- [ ] **Step 1: Capture the reference** (one-off, from the harness data already fetched)

```jsonc
// ingest/fixtures/ta-elo-reference.json  (example shape; fill ~30 rows from the live board)
{
  "asOf": "2026-06-08",
  "atp": [
    { "name": "Jannik Sinner",  "overall": 2319.8, "hard": 2263.2, "clay": 2215.7, "grass": 2088.3 },
    { "name": "Carlos Alcaraz", "overall": 2166.8, "hard": 2093.3, "clay": 2106.6, "grass": 2034.2 },
    { "name": "Alexander Zverev","overall": 2104.3, "hard": 2043.8, "clay": 2053.4, "grass": 1907.1 }
    /* ...~12 more ATP... */
  ],
  "wta": [ /* ...~15 WTA rows captured the same way... */ ]
}
```

- [ ] **Step 2: Write the fixture test**

```ts
// ingest/historical-elo.fixture.test.ts
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Tour } from "../src/model";
import ref from "./fixtures/ta-elo-reference.json";
import { fetchMatchesCsv, fetchQualChallCsv, keepWtaQualItf } from "./durations";
import { parseEloMatchesCsv, computeRatingsAsOf, type EloMatchRow } from "./historical-elo";
import { normalizeName } from "./elo";
import { ATP_ELO_CONFIG, WTA_ELO_CONFIG } from "./elo-config";

const TOL = { overall: 45, surface: 60 }; // measured ceiling after inclusion+seed+blend; tighten as fit improves
const asOfCutoff = Number(ref.asOf.replace(/-/g, "")); // YYYYMMDD

async function ours(tour: Tour) {
  const itf = tour === "WTA" ? keepWtaQualItf : undefined;
  const rows: EloMatchRow[] = [];
  for (let y = 2000; y <= Number(ref.asOf.slice(0, 4)); y++) {
    const m = await fetchMatchesCsv(tour, y).catch(() => null); if (m) rows.push(...parseEloMatchesCsv(m));
    const q = await fetchQualChallCsv(tour, y).catch(() => null); if (q) rows.push(...parseEloMatchesCsv(q, itf));
  }
  const { byId } = computeRatingsAsOf(rows, asOfCutoff, tour === "ATP" ? ATP_ELO_CONFIG : WTA_ELO_CONFIG);
  const map = new Map<string, any>();
  for (const c of byId.values()) { const k = normalizeName(c.name); if (k) map.set(k, c); }
  return map;
}

// Network test — opt-in (CI runs it on a schedule, not on every PR, since TA data drifts weekly).
const live = process.env.ELO_FIXTURE === "1" ? describe : describe.skip;
live("Elo reproduces TA within tolerance (as-of " + ref.asOf + ")", () => {
  for (const tour of ["atp", "wta"] as const) {
    test(`${tour} sample within band`, async () => {
      const map = await ours(tour.toUpperCase() as Tour);
      for (const r of (ref as any)[tour]) {
        const o = map.get(normalizeName(r.name));
        expect(o, `${r.name} must join`).toBeTruthy();
        expect(Math.abs(o.overall - r.overall), `${r.name} overall`).toBeLessThanOrEqual(TOL.overall);
        for (const s of ["hard", "clay", "grass"] as const) {
          if (r[s] != null && o[s] != null) expect(Math.abs(o[s] - r[s]), `${r.name} ${s}`).toBeLessThanOrEqual(TOL.surface);
        }
      }
    }, 120_000);
  }
});
```

- [ ] **Step 3: Run the fixture test (opt-in)**

Run: `ELO_FIXTURE=1 TZ=UTC npx vitest run ingest/historical-elo.fixture.test.ts`
Expected: PASS within tolerance. If overall errors exceed `TOL.overall`, revisit the Task 6 fit before loosening tolerance.

- [ ] **Step 4: Commit**

```bash
git add ingest/fixtures/ta-elo-reference.json ingest/historical-elo.fixture.test.ts
git commit -m "test(elo): regression fixture pinning TA values within tolerance"
```

---

### Task 9: Regenerate all snapshots + reindex

**Files:**
- Modify (generated): `public/data/slams/**/*.json`, `public/data/index.json`

- [ ] **Step 1: Re-run the backfill (network; sandbox off) and reindex**

Run: `pnpm backfill-elo && pnpm reindex`
Expected: many snapshots rewritten (the 50/50 blend + scope + seed shift every surface and overall value). Watch the per-file `matched=N/M` logs for join-rate regressions (should stay ~98% ATP / ~96% WTA).

- [ ] **Step 2: Sanity-check the historical acceptance criteria from #20**

Run: `npx tsx -e "import('./scripts/check-rg2016.ts')"` *(or inspect manually)*: RG 2016 → Djokovic #1 overall + #1 clay, Nadal #2 clay.
Expected: still holds (these are ordering checks, robust to the rescale).

- [ ] **Step 3: Full test suite**

Run: `TZ=UTC pnpm test`
Expected: PASS (some app-level snapshot expectations referencing specific Elo numbers may need updating — update them to the new values).

- [ ] **Step 4: Commit the regenerated data**

```bash
git add public/data
git commit -m "data(elo): regenerate all snapshots with TA-calibrated engine (50/50 blend, qual/challenger scope, fitted seed)"
```

---

### Task 10: Document the methodology + retire the exactness goal

**Files:**
- Modify: `RESEARCH.md` (or a new `docs/elo-methodology.md`), `README.md`

- [ ] **Step 1: Write the methodology note**

Document: the verified TA parameters, the *provably-impossible* byte-exact finding (cite Sackmann's repo comment), the achieved residual band, the fitted seed provenance, and that the live-board scrape (`ingest/elo.ts`) remains the source for *current* slams while the calibrated engine serves *historical* freezes.

- [ ] **Step 2: Commit + close**

```bash
git add RESEARCH.md README.md
git commit -m "docs(elo): document TA-calibrated methodology and retired exactness target"
```

---

## Self-Review

- **Spec coverage:** 50/50 blend (T2 ✓), inclusion of qual/challenger+ITF (T4/T5 ✓), fitted low-1200s seed (T3/T6/T7 ✓), calibration harness (T6 ✓), regression fixture (T8 ✓), MOV unchanged (noted, no task — correct ✓), W/O-RET unchanged (noted, no task — correct ✓), regenerate snapshots (T9 ✓), retire ±1-2 (T10 ✓), no parser change (noted — verified correct ✓).
- **Placeholder scan:** `elo-config.ts` and `ta-elo-reference.json` carry intentional `<FILL>`/example rows filled from the live harness run in T6/T8 — these are data-capture steps, not code placeholders.
- **Type consistency:** `EloConfig.seedFor(level, round)` used identically in T3/T6/T7; `computeRatingsAsOf(rows, cutoff, config?)` and `parseEloMatchesCsv(csv, keepLevel?)` signatures consistent across T3/T5/T6/T8.
