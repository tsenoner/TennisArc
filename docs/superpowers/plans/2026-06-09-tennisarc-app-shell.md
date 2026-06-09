# TennisArc Multi-Slam App Shell — Implementation Plan (2 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Prerequisite:** Plan 1 (data foundation) must be merged first — this plan consumes `snapshotFilename`, `SlamIndex`, and `AvailableSlam` from `src/model.ts` and the `index.json` + `{tour}-{year}-{slam}.json` files the ingest now produces.

**Goal:** Make the app load any slam from the archive: read `index.json`, let the user switch between AO/RG/Wimbledon/US Open across available years, fetch + cache each slam independently (offline-first), and stop rejecting v2 data.

**Architecture:** A pure selection module (`src/slams.ts`) drives a slam switcher in the controls; `api.ts`/`store.ts` move from tour-keyed to `{tour,year,slam}`-keyed; `app.ts` boots from the manifest and keys its snapshot cache + IndexedDB by the composite. No visual/lens changes here — those are Plans 3-5.

**Tech Stack:** TypeScript (strict, ESM), Vitest (`pnpm test <path>`), `idb-keyval`, Vite env (`import.meta.env.VITE_DATA_BASE_URL`).

**Spec:** [`../specs/2026-06-09-tennisarc-ux-overhaul-design.md`](../specs/2026-06-09-tennisarc-ux-overhaul-design.md) §9.

---

## File structure

**New**
- `src/slams.ts` — `SLAM_ORDER`, `SLAM_ABBR`, `SLAM_SURFACE`, `availableYears`, `slamsForYear`, `pickDefaultSlam` (pure manifest helpers).
- `src/slams.test.ts`

**Modified**
- `src/api.ts` — accept `schemaVersion >= 1`; add `fetchIndex`; `fetchSnapshot(tour, year, slam)`.
- `src/api.test.ts` — new signatures + `fetchIndex` tests.
- `src/store.ts` — key snapshots by `tour:year:slam`; cache the index.
- `src/store.test.ts` — composite-key round-trip.
- `src/render.ts` — slam switcher (year stepper + AO/RG/W/US segments) in `renderControls`.
- `src/render.test.ts` — switcher output assertions (add to existing controls test).
- `src/app.ts` — `AppState` gains `year`/`slam`/`index`; composite-keyed snapshots; index-driven boot; switcher events.

---

## Task 1: Per-slam fetch + index fetch + accept schemaVersion 2

**Files:**
- Modify: `src/api.ts` (full rewrite)
- Test: `src/api.test.ts`

- [ ] **Step 1: Rewrite the failing test** — replace `src/api.test.ts` with:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchSnapshot, fetchIndex } from "./api";
import { makeSyntheticSnapshot } from "./fixtures/synthetic";

afterEach(() => vi.unstubAllGlobals());

describe("fetchSnapshot", () => {
  it("fetches the same-origin per-slam file when no base URL", async () => {
    const snap = makeSyntheticSnapshot({ tour: "WTA", drawSize: 8, seed: 2 });
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => snap } as Response));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchSnapshot("WTA", 2026, "roland-garros", undefined)).toEqual(snap);
    expect(fetchMock).toHaveBeenCalledWith("/data/wta-2026-roland-garros.json", { cache: "no-cache" });
  });

  it("prefers the external base URL (trailing slash trimmed)", async () => {
    const snap = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 3 });
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => snap } as Response));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchSnapshot("ATP", 2025, "wimbledon", "https://cdn.example/")).toEqual(snap);
    expect(fetchMock).toHaveBeenCalledWith("https://cdn.example/atp-2025-wimbledon.json", { cache: "no-cache" });
  });

  it("falls back to the same-origin seed when the external URL fails", async () => {
    const seed = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 9 });
    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith("https://cdn.example")
        ? ({ ok: false, status: 404 } as Response)
        : ({ ok: true, json: async () => seed } as Response));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchSnapshot("ATP", 2026, "us-open", "https://cdn.example")).toEqual(seed);
    expect(fetchMock).toHaveBeenCalledWith("/data/atp-2026-us-open.json", { cache: "no-cache" });
  });

  it("returns null when both fail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 } as Response)));
    expect(await fetchSnapshot("ATP", 2026, "roland-garros", "https://cdn.example")).toBeNull();
  });

  it("accepts schemaVersion 2 (and rejects 0)", async () => {
    const v2 = { ...makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 }), schemaVersion: 2 };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => v2 } as Response)));
    expect(await fetchSnapshot("ATP", 2026, "roland-garros", undefined)).toEqual(v2);
    const bad = { ...v2, schemaVersion: 0 };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => bad } as Response)));
    expect(await fetchSnapshot("ATP", 2026, "roland-garros", undefined)).toBeNull();
  });
});

describe("fetchIndex", () => {
  const index = { schemaVersion: 2, generatedAt: "t", slams: [{ tour: "ATP", year: 2026, slam: "roland-garros", name: "Roland Garros", surface: "Clay", status: "complete", generatedAt: "t", drawSize: 128 }] };

  it("fetches index.json same-origin and validates shape", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => index } as Response));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchIndex(undefined)).toEqual(index);
    expect(fetchMock).toHaveBeenCalledWith("/data/index.json", { cache: "no-cache" });
  });

  it("rejects a malformed index (no slams array)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ schemaVersion: 2 }) } as Response)));
    expect(await fetchIndex(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/api.test.ts`
Expected: FAIL — `fetchIndex` not exported / `fetchSnapshot` arity wrong.

- [ ] **Step 3: Rewrite `src/api.ts`**

```ts
import { type Snapshot, type SlamIndex, type Tour, snapshotFilename } from "./model";

const BASE = (import.meta as any).env?.VITE_DATA_BASE_URL as string | undefined;
const trim = (u: string): string => u.replace(/\/+$/, "");

async function tryFetch<T>(url: string, valid: (x: any) => boolean): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) return null;
    const data = await res.json();
    return valid(data) ? (data as T) : null;
  } catch {
    return null;
  }
}

const validSnapshot = (s: any): boolean => typeof s?.schemaVersion === "number" && s.schemaVersion >= 1;
const validIndex = (i: any): boolean => typeof i?.schemaVersion === "number" && Array.isArray(i?.slams);

async function fetchData<T>(file: string, valid: (x: any) => boolean, baseUrl: string | undefined): Promise<T | null> {
  if (baseUrl) {
    const ext = await tryFetch<T>(`${trim(baseUrl)}/${file}`, valid);
    if (ext) return ext;
  }
  return tryFetch<T>(`/data/${file}`, valid);
}

/** Fetch the slam manifest (external base URL first, then same-origin seed). */
export function fetchIndex(baseUrl: string | undefined = BASE): Promise<SlamIndex | null> {
  return fetchData<SlamIndex>("index.json", validIndex, baseUrl);
}

/** Fetch one slam snapshot by tour/year/slam (external base URL first, then same-origin seed). */
export function fetchSnapshot(
  tour: Tour, year: number, slam: string, baseUrl: string | undefined = BASE,
): Promise<Snapshot | null> {
  return fetchData<Snapshot>(snapshotFilename(tour, year, slam), validSnapshot, baseUrl);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api.ts src/api.test.ts
git commit -m "feat(app): per-slam + index fetch; accept schemaVersion >= 1"
```

---

## Task 2: Key the store by tour+year+slam and cache the index

**Files:**
- Modify: `src/store.ts`
- Test: `src/store.test.ts`

- [ ] **Step 1: Rewrite the failing test** — replace `src/store.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import { createMemoryStore } from "./store";
import { makeSyntheticSnapshot } from "./fixtures/synthetic";

describe("createMemoryStore", () => {
  it("round-trips a snapshot per tour+year+slam and isolates keys", async () => {
    const store = createMemoryStore();
    expect(await store.getSnapshot("ATP", 2026, "roland-garros")).toBeNull();
    const snap = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    await store.setSnapshot("ATP", 2026, "roland-garros", snap);
    expect(await store.getSnapshot("ATP", 2026, "roland-garros")).toEqual(snap);
    expect(await store.getSnapshot("ATP", 2025, "roland-garros")).toBeNull();
    expect(await store.getSnapshot("WTA", 2026, "roland-garros")).toBeNull();
  });

  it("round-trips the slam index", async () => {
    const store = createMemoryStore();
    expect(await store.getIndex()).toBeNull();
    const idx = { schemaVersion: 2, generatedAt: "t", slams: [] };
    await store.setIndex(idx);
    expect(await store.getIndex()).toEqual(idx);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/store.test.ts`
Expected: FAIL — `setSnapshot` arity / `getIndex` missing.

- [ ] **Step 3: Rewrite `src/store.ts`**

```ts
import { get, set } from "idb-keyval";
import type { SlamIndex, Snapshot, Tour } from "./model";

export interface Store {
  getSnapshot(tour: Tour, year: number, slam: string): Promise<Snapshot | null>;
  setSnapshot(tour: Tour, year: number, slam: string, snap: Snapshot): Promise<void>;
  getIndex(): Promise<SlamIndex | null>;
  setIndex(index: SlamIndex): Promise<void>;
}

const snapKey = (tour: Tour, year: number, slam: string) => `snapshot:${tour}:${year}:${slam}`;
const INDEX_KEY = "slam-index";

/** IndexedDB-backed cache (offline-first). */
export function createIdbStore(): Store {
  return {
    async getSnapshot(tour, year, slam) { return (await get<Snapshot>(snapKey(tour, year, slam))) ?? null; },
    async setSnapshot(tour, year, slam, snap) { await set(snapKey(tour, year, slam), snap); },
    async getIndex() { return (await get<SlamIndex>(INDEX_KEY)) ?? null; },
    async setIndex(index) { await set(INDEX_KEY, index); },
  };
}

/** In-memory fallback (private mode / tests). */
export function createMemoryStore(): Store {
  const snaps = new Map<string, Snapshot>();
  let index: SlamIndex | null = null;
  return {
    async getSnapshot(tour, year, slam) { return snaps.get(snapKey(tour, year, slam)) ?? null; },
    async setSnapshot(tour, year, slam, snap) { snaps.set(snapKey(tour, year, slam), snap); },
    async getIndex() { return index; },
    async setIndex(i) { index = i; },
  };
}

/** Probe IndexedDB; fall back to memory if unavailable (e.g. private browsing). */
export async function createStore(): Promise<Store> {
  try {
    const probe = createIdbStore();
    await probe.getIndex(); // throws if IDB is blocked
    return probe;
  } catch {
    return createMemoryStore();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store.ts src/store.test.ts
git commit -m "feat(app): key snapshot cache by tour+year+slam; cache index"
```

---

## Task 3: Pure manifest selection helpers

**Files:**
- Create: `src/slams.ts`
- Test: `src/slams.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/slams.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { availableYears, slamsForYear, pickDefaultSlam, SLAM_ORDER } from "./slams";
import type { AvailableSlam, SlamIndex } from "./model";

const slam = (o: Partial<AvailableSlam>): AvailableSlam => ({
  tour: "ATP", year: 2026, slam: "roland-garros", name: "Roland Garros", surface: "Clay",
  status: "complete", generatedAt: "t", drawSize: 128, ...o,
});
const index = (slams: AvailableSlam[]): SlamIndex => ({ schemaVersion: 2, generatedAt: "t", slams });

describe("SLAM_ORDER", () => {
  it("is the calendar order", () => {
    expect(SLAM_ORDER).toEqual(["australian-open", "roland-garros", "wimbledon", "us-open"]);
  });
});

describe("availableYears", () => {
  it("returns distinct years descending for a tour", () => {
    const idx = index([slam({ year: 2024 }), slam({ year: 2026 }), slam({ year: 2026, slam: "wimbledon" }), slam({ tour: "WTA", year: 2025 })]);
    expect(availableYears(idx, "ATP")).toEqual([2026, 2024]);
  });
});

describe("slamsForYear", () => {
  it("returns all four slots in calendar order, marking which exist", () => {
    const idx = index([slam({ year: 2026, slam: "roland-garros" }), slam({ year: 2026, slam: "wimbledon", status: "live" })]);
    const slots = slamsForYear(idx, 2026, "ATP");
    expect(slots.map((s) => s.slam)).toEqual(SLAM_ORDER);
    expect(slots.find((s) => s.slam === "roland-garros")!.entry).not.toBeNull();
    expect(slots.find((s) => s.slam === "australian-open")!.entry).toBeNull();
    expect(slots.find((s) => s.slam === "wimbledon")!.entry!.status).toBe("live");
  });
});

describe("pickDefaultSlam", () => {
  it("prefers the most recent live slam for the tour", () => {
    const idx = index([slam({ year: 2026, slam: "roland-garros", status: "complete" }), slam({ year: 2026, slam: "wimbledon", status: "live" })]);
    expect(pickDefaultSlam(idx, "ATP")).toEqual({ year: 2026, slam: "wimbledon" });
  });
  it("falls back to the most recent complete slam", () => {
    const idx = index([slam({ year: 2024, slam: "us-open", status: "complete" }), slam({ year: 2026, slam: "roland-garros", status: "complete" })]);
    expect(pickDefaultSlam(idx, "ATP")).toEqual({ year: 2026, slam: "roland-garros" });
  });
  it("returns null when the tour has no slams", () => {
    expect(pickDefaultSlam(index([slam({ tour: "WTA" })]), "ATP")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/slams.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/slams.ts`**

```ts
import type { AvailableSlam, SlamIndex, Tour } from "./model";

export const SLAM_ORDER = ["australian-open", "roland-garros", "wimbledon", "us-open"] as const;
export const SLAM_ABBR: Record<string, string> = {
  "australian-open": "AO", "roland-garros": "RG", wimbledon: "W", "us-open": "US",
};
export const SLAM_SURFACE: Record<string, string> = {
  "australian-open": "Hard", "roland-garros": "Clay", wimbledon: "Grass", "us-open": "Hard",
};

export interface SlamSlot { slam: string; abbr: string; surface: string; entry: AvailableSlam | null; }

const orderIdx = (slam: string): number => {
  const i = (SLAM_ORDER as readonly string[]).indexOf(slam);
  return i < 0 ? SLAM_ORDER.length : i;
};
const byRecency = (a: AvailableSlam, b: AvailableSlam): number =>
  b.year - a.year || orderIdx(b.slam) - orderIdx(a.slam);

/** Distinct years (descending) that have at least one slam for the tour. */
export function availableYears(index: SlamIndex, tour: Tour): number[] {
  const years = new Set(index.slams.filter((s) => s.tour === tour).map((s) => s.year));
  return [...years].sort((a, b) => b - a);
}

/** The four slam slots for a year (calendar order), each with its manifest entry or null. */
export function slamsForYear(index: SlamIndex, year: number, tour: Tour): SlamSlot[] {
  return SLAM_ORDER.map((slam) => ({
    slam,
    abbr: SLAM_ABBR[slam],
    surface: SLAM_SURFACE[slam],
    entry: index.slams.find((s) => s.tour === tour && s.year === year && s.slam === slam) ?? null,
  }));
}

/** Default selection for a tour: most recent live, else most recent complete, else most recent of any. */
export function pickDefaultSlam(index: SlamIndex, tour: Tour): { year: number; slam: string } | null {
  const mine = index.slams.filter((s) => s.tour === tour);
  const pick = (list: AvailableSlam[]) => (list.length ? { year: list[0].year, slam: list[0].slam } : null);
  return (
    pick(mine.filter((s) => s.status === "live").sort(byRecency)) ??
    pick(mine.filter((s) => s.status === "complete").sort(byRecency)) ??
    pick([...mine].sort(byRecency))
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/slams.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/slams.ts src/slams.test.ts
git commit -m "feat(app): pure manifest helpers (years, slam slots, default pick)"
```

---

## Task 4: Render the slam switcher in the controls

**Files:**
- Modify: `src/render.ts` (`renderControls`)
- Test: `src/render.test.ts` (add a describe block)

- [ ] **Step 1: Write the failing test** — append to `src/render.test.ts`:

```ts
import { renderControls } from "./render";
import type { SlamIndex } from "./model";

describe("renderControls slam switcher", () => {
  const index: SlamIndex = {
    schemaVersion: 2, generatedAt: "t",
    slams: [
      { tour: "ATP", year: 2026, slam: "roland-garros", name: "Roland Garros", surface: "Clay", status: "complete", generatedAt: "t", drawSize: 128 },
      { tour: "ATP", year: 2026, slam: "wimbledon", name: "Wimbledon", surface: "Grass", status: "live", generatedAt: "t", drawSize: 128 },
    ],
  };
  const html = renderControls({ tour: "ATP", colorDim: "time", theme: "dark", index, year: 2026, slam: "wimbledon" });

  it("renders a slam segment per slot with the active one marked", () => {
    expect(html).toContain('data-action="slam"');
    expect(html).toContain('data-slam="wimbledon"');
    expect(html).toMatch(/data-slam="wimbledon"[^>]*class="[^"]*active/);
  });
  it("disables a slot with no data for the year", () => {
    expect(html).toMatch(/data-slam="australian-open"[^>]*disabled/);
  });
  it("renders a year stepper", () => {
    expect(html).toContain('data-action="year"');
    expect(html).toContain("2026");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/render.test.ts`
Expected: FAIL — `renderControls` does not accept `index`/`year`/`slam`.

- [ ] **Step 3: Update `renderControls` in `src/render.ts`**

Add imports at the top of `render.ts`:

```ts
import type { SlamIndex } from "./model";
import { availableYears, slamsForYear } from "./slams";
```

Replace the existing `renderControls` function with:

```ts
export function renderControls(opts: {
  tour: Tour; colorDim: ColorDim; theme: Theme;
  index?: SlamIndex; year?: number; slam?: string;
}): string {
  const tours: Tour[] = ["ATP", "WTA"];
  const tourBtn = (t: Tour) =>
    `<button class="ctrl${opts.tour === t ? " active" : ""}" data-action="tour" data-tour="${t}">${t}</button>`;
  const dimBtn = (d: ColorDim) =>
    `<button class="ctrl${opts.colorDim === d ? " active" : ""}" data-action="colordim" data-dim="${d}">${DIM_LABELS[d]}</button>`;

  let switcher = "";
  if (opts.index && opts.year != null) {
    const years = availableYears(opts.index, opts.tour);
    const i = years.indexOf(opts.year);
    const prevY = i >= 0 && i + 1 < years.length ? years[i + 1] : "";
    const nextY = i > 0 ? years[i - 1] : "";
    const yearStep = (delta: number, target: number | "") =>
      `<button class="ctrl yr-step" data-action="year" data-year="${target}"${target === "" ? " disabled" : ""} aria-label="${delta < 0 ? "Previous" : "Next"} year">${delta < 0 ? "◀" : "▶"}</button>`;
    const slots = slamsForYear(opts.index, opts.year, opts.tour)
      .map((s) => {
        const on = opts.slam === s.slam ? " active" : "";
        const off = s.entry ? "" : " disabled";
        const live = s.entry?.status === "live" ? " live" : "";
        return `<button class="ctrl slam${on}${live}" data-action="slam" data-slam="${s.slam}"${off ? " disabled" : ""} data-surface="${s.surface}" title="${s.entry ? escapeHtml(s.entry.name) : s.slam + " — not available"}">${s.abbr}</button>`;
      })
      .join("");
    switcher =
      `<div class="seg slam-switch" role="group" aria-label="Grand Slam">` +
      yearStep(-1, prevY) + `<span class="yr">${opts.year}</span>` + yearStep(1, nextY) +
      slots + `</div>`;
  }

  return (
    `<header class="controls">` +
    `<a class="brand" href="/" aria-label="TennisArc home">` +
    `<img class="brand-mark" src="/logo.svg" width="28" height="28" alt="" />` +
    `<span class="brand-name">Tennis<span>Arc</span></span></a>` +
    `<div class="seg" role="group" aria-label="Tour">${tours.map(tourBtn).join("")}</div>` +
    switcher +
    `<div class="seg" role="group" aria-label="Colour by">${COLOR_DIMS.map(dimBtn).join("")}</div>` +
    `<button class="ctrl theme" data-action="theme" aria-label="Toggle theme">${opts.theme === "dark" ? "☀" : "☾"}</button>` +
    `</header>`
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/render.test.ts`
Expected: PASS (existing render tests still pass — `index`/`year`/`slam` are optional, so the old call shape still compiles).

- [ ] **Step 5: Add minimal switcher styles** — append to `src/app.css`:

```css
.slam-switch { gap: 2px; }
.slam-switch .yr { padding: 0 6px; font-variant-numeric: tabular-nums; font-size: 13px; align-self: center; }
.slam-switch .ctrl.slam { min-width: 30px; }
.slam-switch .ctrl.slam[disabled] { opacity: .35; cursor: default; }
.slam-switch .ctrl.slam.live::after { content: "●"; color: var(--teal); font-size: 8px; vertical-align: super; margin-left: 1px; }
```

- [ ] **Step 6: Commit**

```bash
git add src/render.ts src/render.test.ts src/app.css
git commit -m "feat(app): slam switcher (year stepper + AO/RG/W/US segments) in controls"
```

---

## Task 5: Wire the multi-slam shell into the app

This is integration glue (verified by `pnpm typecheck` + the pure tests above + manual smoke). It changes `AppState`, the snapshot cache keying, the boot sequence (index → default slam → load), and adds slam/year switch handlers.

**Files:**
- Modify: `src/app.ts` (full rewrite)

- [ ] **Step 1: Replace `src/app.ts`** with:

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
import { fetchSnapshot, fetchIndex } from "./api";
import { pickDefaultSlam, availableYears, slamsForYear } from "./slams";
import type { SlamIndex, Snapshot, Tour } from "./model";

const SIZE = 700;
const snapKey = (tour: Tour, year: number, slam: string) => `${tour}:${year}:${slam}`;

interface AppState {
  tour: Tour;
  year: number;
  slam: string;
  index: SlamIndex | undefined;
  snapshots: Record<string, Snapshot>;
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
    tour: "ATP", year: 0, slam: "", index: undefined, snapshots: {},
    colorDim: "time", focusId: undefined, selectedMatchId: undefined, theme,
  };
  let store: Store | undefined;

  const controlsOpts = () => ({
    tour: state.tour, colorDim: state.colorDim, theme: state.theme,
    index: state.index, year: state.year || undefined, slam: state.slam || undefined,
  });

  const draw = () => {
    const snap = state.year ? state.snapshots[snapKey(state.tour, state.year, state.slam)] : undefined;
    if (!snap) {
      root.innerHTML =
        renderControls(controlsOpts()) +
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
      renderControls(controlsOpts()) +
      `<div class="stage">` +
        `<div class="sunburst">${renderSunburst(arcs, color, SIZE)}</div>` +
        renderLeaderboard(lb, color) +
      `</div>` +
      renderLegend(state.colorDim) +
      `<div class="status">${snap.tournament.name}${(() => { const s = staleLabel(snap.generatedAt, Date.now()); return s ? ` · ${s}` : ""; })()}</div>` +
      detail;
  };

  const load = async (tour: Tour, year: number, slam: string) => {
    const k = snapKey(tour, year, slam);
    if (store && !state.snapshots[k]) {
      const cached = await store.getSnapshot(tour, year, slam);
      if (cached) { state.snapshots[k] = cached; if (snapKey(state.tour, state.year, state.slam) === k) draw(); }
    }
    const fresh = await fetchSnapshot(tour, year, slam);
    if (fresh) {
      state.snapshots[k] = fresh;
      void store?.setSnapshot(tour, year, slam, fresh);
      if (snapKey(state.tour, state.year, state.slam) === k) draw();
    }
  };

  // Switch to the best available slam for a tour, keeping the current year if that tour has it.
  const selectForTour = (tour: Tour) => {
    if (!state.index) return;
    const slots = state.year ? slamsForYear(state.index, state.year, tour) : [];
    const keepYear = slots.some((s) => s.entry && s.slam === state.slam);
    if (!keepYear) {
      const def = pickDefaultSlam(state.index, tour);
      if (def) { state.year = def.year; state.slam = def.slam; }
    }
    state.tour = tour;
    state.focusId = undefined; state.selectedMatchId = undefined;
    draw(); void load(state.tour, state.year, state.slam);
  };

  root.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!el || el.hasAttribute("disabled")) return;
    const a = el.dataset.action;
    const id = el.dataset.id;
    if (a === "tour" && el.dataset.tour) {
      selectForTour(el.dataset.tour as Tour);
    } else if (a === "slam" && el.dataset.slam) {
      state.slam = el.dataset.slam;
      state.focusId = undefined; state.selectedMatchId = undefined;
      draw(); void load(state.tour, state.year, state.slam);
    } else if (a === "year" && el.dataset.year) {
      const y = Number(el.dataset.year);
      if (Number.isFinite(y) && state.index) {
        const slots = slamsForYear(state.index, y, state.tour);
        const keep = slots.find((s) => s.entry && s.slam === state.slam);
        state.year = y;
        state.slam = (keep ?? slots.find((s) => s.entry))?.slam ?? state.slam;
        state.focusId = undefined; state.selectedMatchId = undefined;
        draw(); void load(state.tour, state.year, state.slam);
      }
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
    state.index = (await fetchIndex()) ?? (await store.getIndex()) ?? undefined;
    if (state.index) void store.setIndex(state.index);
    if (state.index) {
      const def = pickDefaultSlam(state.index, state.tour);
      if (def) { state.year = def.year; state.slam = def.slam; }
    }
    if (!state.year) return; // no manifest yet → stay on loading state
    await load(state.tour, state.year, state.slam);
    // Warm the other tour's same-or-default slam in the background.
    const other: Tour = state.tour === "ATP" ? "WTA" : "ATP";
    if (state.index) {
      const slots = availableYears(state.index, other).length ? slamsForYear(state.index, state.year, other) : [];
      const otherSel = slots.find((s) => s.entry && s.slam === state.slam)
        ? { year: state.year, slam: state.slam }
        : pickDefaultSlam(state.index, other);
      if (otherSel) void load(other, otherSel.year, otherSel.slam);
    }
  })();
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Full suite**

Run: `pnpm test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app.ts
git commit -m "feat(app): index-driven boot + slam/year switching, composite snapshot cache"
```

---

## Task 6: Verify end-to-end (manual smoke)

**Files:** none (verification only).

- [ ] **Step 1: Build**

Run: `pnpm build`
Expected: `tsc --noEmit` clean + `vite build` succeeds.

- [ ] **Step 2: Smoke checklist** (requires `public/data/index.json` + per-slam files from Plan 1's ingest, or hand-place a couple for local dev)

Run: `pnpm dev`, then verify:
- The slam switcher shows the year + AO/RG/W/US, with unavailable slots greyed and live slots dotted.
- Clicking a slam loads that draw; clicking a different one swaps it.
- Year ◀/▶ steps between available years and keeps the same slam when present.
- ATP/WTA toggle preserves year/slam when both tours have it, else picks that tour's default.
- Reload offline (DevTools → Offline): the last-viewed slam still renders from IndexedDB.

- [ ] **Step 3: Commit (if any styling tweaks were needed during smoke)**

```bash
git add -A
git commit -m "chore(app): multi-slam smoke fixes"
```

(Skip if nothing changed.)

---

## Self-review

**Spec coverage** (spec §9):
- Per-`{tour,year,slam}` fetch + `index.json` → Task 1.
- IndexedDB keyed per slam + index cache → Task 2.
- Slam switcher (year + AO/RG/W/US), index-driven, default = most recent live/complete → Tasks 3-5.
- Tour switch preserves year/slam when available → Task 5 (`selectForTour`).
- Offline per-slam render → Tasks 2, 5 (cache read before fetch).
- Accept schemaVersion 2 (unblocks Plan 1 data) → Task 1.

**Placeholder scan:** none — full code/commands throughout.

**Type consistency:** `fetchSnapshot(tour, year, slam, baseUrl?)` and `fetchIndex(baseUrl?)` (Task 1) match their call sites in Task 5; `Store.getSnapshot/setSnapshot(tour, year, slam[, snap])` + `getIndex/setIndex` (Task 2) match Task 5 usage; `pickDefaultSlam`/`availableYears`/`slamsForYear`/`SlamSlot.entry` (Task 3) match Tasks 4-5; `renderControls` optional `index`/`year`/`slam` (Task 4) match Task 5's `controlsOpts()`. All consume `snapshotFilename`/`SlamIndex`/`AvailableSlam` from Plan 1 — no new model changes here.

**Notes for the executor:**
- Plan 1 must be merged first (provides `snapshotFilename`, `SlamIndex`, `AvailableSlam`).
- `makeSyntheticSnapshot` (in `src/fixtures/synthetic.ts`) already sets a valid `schemaVersion`; the v2/v0 test in Task 1 overrides it explicitly.
- This plan makes no lens/label/match-insight changes — `colorDim`, the leaderboard, and the existing match card are carried over untouched and are reworked in Plans 3-5.
