# Data Storage: Build-Time Normalized Store + Split Static JSON — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Sequencing:** Execute AFTER `2026-06-14-elo-ta-reproduction.md` lands (the store re-ports the final Elo engine, so the engine must be stable first). Each phase below keeps the legacy JSON valid until the final flip, so rollback is trivial at any point.

**Goal:** Replace the 113 self-contained per-slam JSON files — which duplicate player identity 12.3× (~1.4 MB of pure repeat) and carry 40 country-inconsistency bugs — with a build-time normalized store of record (`node:sqlite`) that emits a small `players/{tour}.json` identity table once plus slim per-slam draws referencing player ids, hydrated back to the existing `Snapshot` shape at the `api.ts` fetch boundary.

**Architecture:** A build-only SQLite store (`node:sqlite`, built into Node 26 — no native dep, no WASM, no runtime change) becomes the single source of record: it persists the Sackmann↔SofaScore id-map (today recomputed by fuzzy name-join on every backfill), replays Elo once instead of 113× , and resolves the 40 country conflicts to one canonical row. From it, ingest emits deterministic static JSON. The runtime stays plain `fetch` + `idb-keyval`; the only client change is a thin rehydration step that joins the once-fetched identity table onto each slim draw. Offline behavior is preserved (still static JSON, still idb-cacheable; the identity file is added to the precache set). **Runtime DB/WASM options (sql.js-httpvfs, DuckDB-WASM, Turso/D1) were evaluated and rejected** — the app is strictly single-slam with zero runtime data-deps; any engine costs multiples of the ~1.4 MB it would recover.

**Tech Stack:** TypeScript, `node:sqlite` (Node 26, build-time only), `tsx`, Vitest, idb-keyval, vite-plugin-pwa.

**Measured baseline (issue #25 investigation):** 113 files / 8.8 MB on disk (~1.99 MB sum-of-gzip transferred). 14,468 player rows but **1,178 distinct players** (12.28×). Identity = 1,521 KB repeated vs **123 KB once** (−1.4 MB). `elo` = 17.8% of corpus. **40 ids carry conflicting `country` across years** (data-quality bug). Raw Sackmann CSVs are fetched from GitHub `master` live and unpinned → builds are **not reproducible** today.

---

## File Structure

- **Create** `ingest/db/schema.ts` — `node:sqlite` table DDL (`players`, `player_alias`, `matches`, `entries`).
- **Create** `ingest/db/store.ts` — open/build the store from pinned raw CSVs + the 113 SofaScore snapshots; the single-pass Elo cursor; the persisted id-map.
- **Create** `ingest/vendor-sackmann.ts` — fetch + hash-pin the Sackmann CSVs into `data/raw/sackmann/` (or a checksum lockfile), recording upstream commit SHA + per-file sha256.
- **Create** `ingest/emit-json.ts` — emit `public/data/players/{atp,wta}.json` + slim per-slam draws + `index.json` deterministically from the store.
- **Create** `ingest/extract-identity.ts` — one-shot bootstrap: build the identity table from the existing 113 files (resolves the 40 country conflicts, logs them).
- **Modify** `src/model.ts` — split `Player` into `PlayerIdentity` (the table row) and `PlayerSlam` (the slim snapshot row); bump `schemaVersion` to 3; add `PlayersTable` type + `playersPath()`.
- **Modify** `src/api.ts` — fetch `players/{tour}.json` once (cached), rehydrate each slim draw into the full `Snapshot` shape before returning.
- **Modify** `src/store.ts` — add identity-table get/set to the `Store` interface + both implementations.
- **Modify** `vite.config.ts` (or `pwa-assets`/workbox config) — add `players/*.json` to the runtime-cache/precache set.
- **Modify** `vercel.json` — serve the new paths (no rewrite change needed if layout is preserved; verify).
- **Create** `ingest/golden.test.ts` — hash all emitted artifacts; pin byte-identity through the engine swap, then deep-equal the rehydrated `Snapshot` against the legacy snapshot.

---

### Phase 0 — Pin current behavior (golden-file guard)

**Goal:** Before changing the emitter, lock the current 113-file output so any drift is caught.

### Task 1: Golden hash of current snapshots

**Files:** Create `ingest/golden.test.ts`

- [ ] **Step 1: Write a test that hashes every snapshot + index**

```ts
// ingest/golden.test.ts
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const SLAMS = resolve(process.cwd(), "public/data/slams");
function hashAll(): string {
  const h = createHash("sha256");
  const years = readdirSync(SLAMS).filter((d) => /^\d{4}$/.test(d)).sort();
  for (const y of years) for (const f of readdirSync(resolve(SLAMS, y)).sort())
    h.update(readFileSync(resolve(SLAMS, y, f)));
  return h.digest("hex");
}
const GOLDEN = resolve(process.cwd(), "ingest/fixtures/snapshots.sha256");

test("snapshot corpus matches the golden hash", () => {
  const cur = hashAll();
  if (!existsSync(GOLDEN)) { console.warn(`writing initial golden ${cur}`); return; }
  expect(cur).toBe(readFileSync(GOLDEN, "utf8").trim());
});
```

- [ ] **Step 2: Capture the initial golden hash**

Run: `TZ=UTC npx vitest run ingest/golden.test.ts` then write the printed hash to `ingest/fixtures/snapshots.sha256`.
Expected: subsequent runs PASS until the emitter intentionally changes the bytes (Phase 3).

- [ ] **Step 3: Commit**

```bash
git add ingest/golden.test.ts ingest/fixtures/snapshots.sha256
git commit -m "test(data): golden hash pinning the 113-snapshot corpus"
```

---

### Phase 1 — Vendor + pin the raw Sackmann inputs (raw→derived boundary)

**Goal:** Make builds reproducible: today `backfill-*` fetches GitHub `master` live, so output depends on whatever upstream is that day.

### Task 2: Hash-pinned Sackmann vendor step

**Files:** Create `ingest/vendor-sackmann.ts`, `data/raw/sackmann/manifest.json`

- [ ] **Step 1: Implement the vendor script** — fetch each needed CSV (tour main + qual/challenger, the year range Plan 1 uses), write under `data/raw/sackmann/{tour}/`, and record `{ upstreamCommit, files: { name: sha256 } }` in `manifest.json`. Verify hashes on re-run; fail loudly on mismatch.

- [ ] **Step 2: Decide commit vs lockfile**

Default: commit the CSVs (CC BY-NC-SA 4.0 — preserve attribution in `data/raw/sackmann/LICENSE`). They're ~25 MB/tour; if that's too heavy for git, keep them gitignored but pin to a specific upstream commit SHA and store only `manifest.json` + a verify step in CI. **Decision point — confirm with the user.**

- [ ] **Step 3: Repoint the fetchers at the vendored copy** — `durations.ts` `fetchMatchesCsv`/`fetchQualChallCsv` read `data/raw/sackmann/...` when present, else fetch+cache. (Keeps Plan 1's harness working offline.)

- [ ] **Step 4: Commit**

```bash
git add ingest/vendor-sackmann.ts data/raw/sackmann/manifest.json data/raw/sackmann/LICENSE
git commit -m "feat(ingest): hash-pinned Sackmann vendor step (reproducible raw inputs)"
```

---

### Phase 2 — Build the store of record; emit byte-identical JSON first

**Goal:** Swap the derivation engine to a single-pass store WITHOUT changing the on-disk format yet, validated by the Phase-0 golden hash.

### Task 3: SQLite store schema + loader

**Files:** Create `ingest/db/schema.ts`, `ingest/db/store.ts`

- [ ] **Step 1: Define the schema**

```ts
// ingest/db/schema.ts
export const DDL = `
CREATE TABLE players (sofaId TEXT PRIMARY KEY, name TEXT, country TEXT, birthdate TEXT, sofaSlug TEXT);
CREATE TABLE player_alias (sackmannId TEXT, tour TEXT, sofaId TEXT, PRIMARY KEY (sackmannId, tour));
CREATE TABLE matches (tour TEXT, year INT, tourneyName TEXT, tourneyDate INT, surface TEXT,
                      winnerId TEXT, loserId TEXT, round TEXT, level TEXT);
CREATE TABLE entries (sofaId TEXT, tour TEXT, year INT, slam TEXT, seed INT, entry TEXT, ranking INT,
                      ageYears REAL, eloOverall REAL, eloHard REAL, eloClay REAL, eloGrass REAL,
                      PRIMARY KEY (sofaId, tour, year, slam));
`;
```

- [ ] **Step 2: Build the store from pinned raw + 113 snapshots** — `ingest/db/store.ts` loads matches from the vendored CSVs, identity from the snapshots (canonical country = most-recent snapshot, conflicts logged), and persists the Sackmann↔SofaScore id-map by running the existing `applyHistoricalElo` name-join ONCE and recording the resolved pairs into `player_alias`.

- [ ] **Step 3: Single-pass Elo cursor** — port `computeRatingsAsOfSorted` into a cursor that replays each tour's sorted history once and snapshots Elo at all 113 cutoffs in one pass (kills the 113× full replay), writing `entries.elo*`. Pin against Plan 1's engine with a unit test (same inputs → same numbers).

- [ ] **Step 4: Commit**

```bash
git add ingest/db
git commit -m "feat(ingest): node:sqlite store of record (id-map + single-pass Elo)"
```

### Task 4: Emit the EXISTING format from the store

**Files:** Create `ingest/emit-json.ts` (legacy-shape mode first)

- [ ] **Step 1:** Make `backfill-elo`/`seeds`/`durations`/`finals` (or a new orchestrator) read derived values from the store and re-emit the **current** 113-file shape.
- [ ] **Step 2: Run the golden test** — `TZ=UTC npx vitest run ingest/golden.test.ts`. Iterate on key order + number formatting until **byte-identical** (the existing scripts skip no-op writes to keep diffs tight; match that exactly).
- [ ] **Step 3: Commit** `git commit -m "feat(ingest): emit legacy snapshot shape from the store (byte-identical)"`

---

### Phase 3 — Split emit: identity table + slim draws

**Goal:** Now change the format. This is where the golden hash intentionally changes.

### Task 5: Model split + identity extraction

**Files:** Modify `src/model.ts`; create `ingest/extract-identity.ts`

- [ ] **Step 1: Write failing model tests** then split the type:

```ts
// src/model.ts
export interface PlayerIdentity { id: string; name: string; country: string; birthdate: string | null; sofaSlug: string | null; }
export interface PlayerSlam { id: string; seed: number | null; entry: EntryType; ranking: number | null; ageYears: number | null; elo: PlayerElo | null; }
export type PlayersTable = { schemaVersion: number; tour: Tour; players: Record<string, PlayerIdentity> };
export const playersPath = (tour: Tour): string => `players/${tour.toLowerCase()}.json`;
// Snapshot.players becomes Record<string, PlayerSlam>; schemaVersion -> 3.
// Keep a hydrated `Player = PlayerIdentity & PlayerSlam` alias for the render layer.
```

- [ ] **Step 2:** `extract-identity.ts` emits `public/data/players/{atp,wta}.json` from the store (1,178 rows, canonical country), logging the 40 conflicts.
- [ ] **Step 3:** `emit-json.ts` gains slim mode: each snapshot's `players` map drops the 5 identity fields, keeps `id` + the per-slam derived fields. Bump `schemaVersion`. Update the golden hash deliberately.
- [ ] **Step 4: Commit** `git commit -m "feat(data): split identity table from slim per-slam draws (schemaVersion 3)"`

### Task 6: Runtime rehydration at the fetch boundary

**Files:** Modify `src/api.ts`, `src/store.ts`, `src/model.ts`

- [ ] **Step 1: Write a failing api.test.ts** asserting `fetchSnapshot` returns a fully-hydrated `Player` (identity + slim fields) after joining `players/{tour}.json`.
- [ ] **Step 2:** Add `fetchPlayers(tour)` to `api.ts` (external base first, then same-origin, like `fetchSnapshot`); cache the table in `store.ts` under a stable key; in `fetchSnapshot`, hydrate each `PlayerSlam` by id into a `Player` before returning. `state.ts`/`render.ts` stay untouched (they still see full `Player`s).
- [ ] **Step 3:** Fetch `players/{tour}.json` in parallel with `index.json` at startup (`app.ts:640`) so it's a one-time per-device cost, not per slam.
- [ ] **Step 4: CI guard** — a test that the rehydrated `Snapshot` deep-equals the legacy snapshot for a sample of slams.
- [ ] **Step 5: Commit** `git commit -m "feat(app): rehydrate slim draws from identity table at fetch boundary"`

---

### Phase 4 — Offline/precache + flip

### Task 7: Precache decision + production flip

**Files:** Modify `vite.config.ts` / workbox globs, `vercel.json`; regenerate data

- [ ] **Step 1:** Add `players/*.json` to the PWA cache set (today `globPatterns` excludes JSON, so data is runtime-cached only). **Decision point:** precache the two small identity files (so first-offline works for unvisited players) vs leave runtime-cached. Recommend precache (≈30 KB gz each). Confirm with the user.
- [ ] **Step 2:** Regenerate all data via the store emitter; run `pnpm reindex`; run `TZ=UTC pnpm test` (update any app tests referencing inlined identity).
- [ ] **Step 3:** Verify the live app loads a slam and renders identity correctly (Playwright desktop + iPhone, per the viz-feedback memory).
- [ ] **Step 4: Add the CI reproducibility invariant** — rebuild raw→store→derived from pinned inputs and assert the emitted JSON byte-equals what's committed (the Phase-0/3 golden hash).
- [ ] **Step 5: Commit + delete the fat files** `git commit -m "feat(data): flip to slim draws + identity table; CI reproducibility guard"`

---

## Decisions needing the user (surface during execution)
1. **Vendor CSVs in git** (~25 MB/tour, fully reproducible offline) **vs lockfile-only** (pin SHA, fetch in CI). *(Task 2)*
2. **Precache the identity files** (first-offline works for unvisited players) **vs runtime-cache only** (smaller install). *(Task 7)*
3. **Optional further split** — also lift frozen Elo into a separate `ratings.json` (separation of concerns; not a size win since Elo is genuinely per-slam). Defer unless wanted.

## Self-Review
- **Spec coverage:** normalized identity table (T5 ✓), slim draws + rehydration (T5/T6 ✓), build-time store of record + single-pass Elo + persisted id-map (T3 ✓), raw→derived boundary / pinned vendor (T2 ✓), golden-file guard + reproducibility CI (T1/T7 ✓), country-conflict fix (T3/T5 ✓), offline preserved (T7 ✓), runtime DB/WASM rejected (architecture ✓).
- **Placeholder scan:** Phases 1–4 reference concrete files/commands; the deepest emitter internals (key order, number formatting) are validated by the golden hash rather than hand-specified — that's the correct guard for byte-identity, not a placeholder.
- **Type consistency:** `PlayerIdentity`/`PlayerSlam`/`PlayersTable`/`playersPath` defined in T5 and consumed identically in T6; `schemaVersion` 3 used consistently.
