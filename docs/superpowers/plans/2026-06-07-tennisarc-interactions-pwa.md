# TennisArc — Interactions + Installable PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the fixture-driven sunburst into a real interactive, installable PWA: colour-by selector, ATP/WTA toggle, light/dark theme, a time-on-court leaderboard, a tap-to-open match-detail card with a SofaScore deep-link, and `vite-plugin-pwa` (manifest + service worker) so it installs on phone/desktop and runs offline.

**Architecture:** Builds on the Plan 1 modules (`model`/`state`/`layout`/`color`/`render`/`app`). New pure leaf modules: `deeplink.ts` (SofaScore URL), `theme.ts` (light/dark, persisted). `state.ts` gains `timeLeaderboard`; `render.ts` gains controls/legend/leaderboard/detail string-renderers + `formatDuration`. `app.ts` is rewritten to own the richer state (tour, colour dim, focus, selected match, theme) and full event delegation. Offline works because the synthetic data is bundled and the SW precaches the app shell — the live-data + IndexedDB offline-first loop is **Plan 3**.

**Tech Stack:** Existing Vite 5 + TS strict + Vitest + d3; adds `vite-plugin-pwa` + `@vite-pwa/assets-generator` (icons via `sharp`). Package manager: **pnpm**.

**This is Plan 2 of 3.** Plan 1 (app core) is merged to `main`. Plan 3 = ingestion + IndexedDB offline-first + Vercel deploy.

---

## File structure (this plan)

```
src/
  deeplink.ts        # NEW pure: SofaScore match URL from customId + player slugs
  theme.ts           # NEW: light/dark theme (persisted), testable
  state.ts           # +timeLeaderboard / LeaderRow
  render.ts          # +formatDuration, renderControls, renderLegend, renderLeaderboard, renderMatchDetail (+ escapeHtml)
  fixtures/synthetic.ts  # finished matches gain deterministic `stats` (for the detail card)
  app.ts             # rewritten: tour/colour/theme/focus/selected state + delegation
  app.css            # rewritten: theme vars (light/dark) + controls/stage/leaderboard/detail styles
  *.test.ts          # colocated tests for the new pure modules
vite.config.ts       # +VitePWA plugin
pwa-assets.config.ts # NEW: icon generation config
public/logo.svg      # NEW: source icon
public/pwa-*.png …   # generated icons (committed)
package.json         # +deps, +generate-pwa-assets script
pnpm-workspace.yaml  # allow sharp build
```

---

### Task 1: `deeplink.ts` — SofaScore match URL

**Files:** Create `src/deeplink.ts`, `src/deeplink.test.ts`.

- [ ] **Step 1: Write the failing test (`src/deeplink.test.ts`)**

```ts
import { describe, it, expect } from "vitest";
import { slugify, sofascoreMatchUrl } from "./deeplink";
import type { Match, Player } from "./model";

const player = (id: string, name: string): Player => ({
  id, name, country: "ITA", seed: 1, entry: null, ranking: 1, ageYears: 24, sofaSlug: id,
});
const baseMatch = (over: Partial<Match> = {}): Match => ({
  id: "1-0", roundIndex: 1, slot: 0, nextMatchId: null, p1: "a", p2: "b",
  status: "finished", winner: "p1", score: null, live: null,
  durationSec: 6000, durationProvisional: false, sofaEventId: 5, sofaCustomId: "HXfsvGHb",
  stats: null, ...over,
});

describe("deeplink", () => {
  it("builds a sofascore URL ending in the customId, with a player-name slug", () => {
    const url = sofascoreMatchUrl(baseMatch(), player("a", "Jannik Sinner"), player("b", "Carlos Alcaraz"));
    expect(url).toBe("https://www.sofascore.com/tennis/match/jannik-sinner-carlos-alcaraz/HXfsvGHb");
  });

  it("returns null when there is no customId (cannot deep-link)", () => {
    expect(sofascoreMatchUrl(baseMatch({ sofaCustomId: null }), null, null)).toBeNull();
  });

  it("slugify strips accents, spaces and punctuation", () => {
    expect(slugify("Stéfanos Tsitsipás")).toBe("stefanos-tsitsipas");
    expect(slugify("")).toBe("match");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/deeplink.test.ts`
Expected: FAIL — cannot find `./deeplink`.

- [ ] **Step 3: Create `src/deeplink.ts`**

```ts
import type { Match, Player } from "./model";

/** Lowercase, accent-stripped, hyphenated slug (cosmetic — SofaScore resolves by customId). */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // combining diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return s || "match";
}

/**
 * Deep link to a match on SofaScore. The trailing customId is the real key; the
 * slug is cosmetic (a wrong slug still resolves). Opens the native app via
 * Universal/App Links when installed, else the web page. Null if we have no id.
 */
export function sofascoreMatchUrl(match: Match, p1: Player | null, p2: Player | null): string | null {
  if (!match.sofaCustomId) return null;
  const slug = p1 && p2 ? `${slugify(p1.name)}-${slugify(p2.name)}` : "match";
  return `https://www.sofascore.com/tennis/match/${slug}/${match.sofaCustomId}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/deeplink.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: SofaScore match deep-link builder"
```

---

### Task 2: `state.ts` — time-on-court leaderboard

**Files:** Modify `src/state.ts` (append); modify `src/state.test.ts` (add a describe block).

- [ ] **Step 1: Add the failing test to `src/state.test.ts`**

```ts
import { timeLeaderboard } from "./state";

describe("timeLeaderboard", () => {
  it("ranks players by descending time, caps at the limit, excludes zero-time", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 32, seed: 4 });
    const rows = timeLeaderboard(s, timeOnCourt(s), 5);
    expect(rows).toHaveLength(5);
    // strictly non-increasing
    for (let i = 1; i < rows.length; i++) expect(rows[i].sec).toBeLessThanOrEqual(rows[i - 1].sec);
    // every row carries a positive time and a resolvable name
    for (const r of rows) {
      expect(r.sec).toBeGreaterThan(0);
      expect(r.name).toBe(s.players[r.playerId].name);
    }
  });

  it("carries the provisional flag through from live matches", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const m = s.matches["0-0"];
    s.matches["0-0"] = { ...m, status: "live", winner: null, durationSec: 9999, durationProvisional: true };
    const rows = timeLeaderboard(s, timeOnCourt(s), 20);
    const liveRow = rows.find((r) => r.playerId === m.p1);
    expect(liveRow?.provisional).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/state.test.ts`
Expected: FAIL — `timeLeaderboard` is not exported.

- [ ] **Step 3: Append to `src/state.ts`**

```ts
export interface LeaderRow {
  playerId: string;
  name: string;
  country: string;
  sec: number;
  provisional: boolean;
  roundReached: number;
}

/** Players ranked by cumulative time on court (descending), zero-time excluded. */
export function timeLeaderboard(s: Snapshot, time: Map<string, PlayerTime>, limit = 10): LeaderRow[] {
  return [...time.entries()]
    .filter(([, v]) => v.sec > 0)
    .map(([id, v]) => {
      const p = s.players[id];
      return {
        playerId: id,
        name: p?.name ?? id,
        country: p?.country ?? "",
        sec: v.sec,
        provisional: v.provisional,
        roundReached: v.roundReached,
      };
    })
    .sort((a, b) => b.sec - a.sec)
    .slice(0, limit);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: time-on-court leaderboard ranking"
```

---

### Task 3: `theme.ts` — light/dark theme (persisted)

**Files:** Create `src/theme.ts`, `src/theme.test.ts`.

- [ ] **Step 1: Write the failing test (`src/theme.test.ts`)**

```ts
import { describe, it, expect } from "vitest";
import { nextTheme, loadTheme, saveTheme, applyTheme } from "./theme";

function fakeStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

describe("theme", () => {
  it("toggles between dark and light", () => {
    expect(nextTheme("dark")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
  });

  it("defaults to dark and round-trips through storage", () => {
    expect(loadTheme(fakeStorage())).toBe("dark");
    const s = fakeStorage();
    saveTheme("light", s);
    expect(loadTheme(s)).toBe("light");
  });

  it("applies the theme as a data attribute on the given element", () => {
    const el = { dataset: {} as Record<string, string> } as unknown as HTMLElement;
    applyTheme("light", el);
    expect(el.dataset.theme).toBe("light");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/theme.test.ts`
Expected: FAIL — cannot find `./theme`.

- [ ] **Step 3: Create `src/theme.ts`**

```ts
export type Theme = "dark" | "light";

const KEY = "tennisarc-theme";

type Getter = Pick<Storage, "getItem">;
type Setter = Pick<Storage, "setItem">;

export function nextTheme(t: Theme): Theme {
  return t === "dark" ? "light" : "dark";
}

export function loadTheme(storage: Getter = localStorage): Theme {
  return storage.getItem(KEY) === "light" ? "light" : "dark"; // default dark
}

export function saveTheme(t: Theme, storage: Setter = localStorage): void {
  storage.setItem(KEY, t);
}

export function applyTheme(t: Theme, el: HTMLElement = document.documentElement): void {
  el.dataset.theme = t;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/theme.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: persisted light/dark theme module"
```

---

### Task 4: `render.ts` — formatDuration + controls + legend

**Files:** Modify `src/render.ts`; create `src/render-controls.test.ts`.

- [ ] **Step 1: Write the failing test (`src/render-controls.test.ts`)**

```ts
import { describe, it, expect } from "vitest";
import { formatDuration, renderControls, renderLegend } from "./render";

describe("formatDuration", () => {
  it("formats minutes under an hour and hours+minutes above", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(45 * 60)).toBe("45m");
    expect(formatDuration(161 * 60)).toBe("2h41");
    expect(formatDuration(120 * 60)).toBe("2h00");
  });
});

describe("renderControls", () => {
  it("renders ATP/WTA, colour-dim and theme controls and marks the active ones", () => {
    const html = renderControls({ tour: "WTA", colorDim: "seed", theme: "dark" });
    expect(html).toContain('data-action="tour"');
    expect(html).toContain('data-tour="ATP"');
    expect(html).toContain('data-action="colordim"');
    expect(html).toContain('data-dim="time"');
    expect(html).toContain('data-action="theme"');
    // active markers on the current tour + dim
    expect(html).toMatch(/class="ctrl active"[^>]*data-tour="WTA"/);
    expect(html).toMatch(/class="ctrl active"[^>]*data-dim="seed"/);
  });
});

describe("renderLegend", () => {
  it("returns a legend string for every dimension", () => {
    for (const dim of ["time", "seed", "country"] as const) {
      expect(renderLegend(dim)).toContain("legend");
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/render-controls.test.ts`
Expected: FAIL — `formatDuration`/`renderControls`/`renderLegend` not exported.

- [ ] **Step 3: Append to `src/render.ts`** (after the existing `renderSunburst`)

```ts
import { COLOR_DIMS, type ColorDim } from "./color";
import type { Tour } from "./model";
import type { Theme } from "./theme";

/** Escape text that may contain user/player data before embedding in HTML. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );
}

/** Seconds → "45m" or "2h41" (hours + zero-padded minutes). */
export function formatDuration(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

const DIM_LABELS: Record<ColorDim, string> = { time: "Time", seed: "Seed", country: "Country" };

export function renderControls(opts: { tour: Tour; colorDim: ColorDim; theme: Theme }): string {
  const tours: Tour[] = ["ATP", "WTA"];
  const tourBtn = (t: Tour) =>
    `<button class="ctrl${opts.tour === t ? " active" : ""}" data-action="tour" data-tour="${t}">${t}</button>`;
  const dimBtn = (d: ColorDim) =>
    `<button class="ctrl${opts.colorDim === d ? " active" : ""}" data-action="colordim" data-dim="${d}">${DIM_LABELS[d]}</button>`;
  return (
    `<header class="controls">` +
    `<div class="seg" role="group" aria-label="Tour">${tours.map(tourBtn).join("")}</div>` +
    `<div class="seg" role="group" aria-label="Colour by">${COLOR_DIMS.map(dimBtn).join("")}</div>` +
    `<button class="ctrl theme" data-action="theme" aria-label="Toggle theme">${opts.theme === "dark" ? "☀" : "☾"}</button>` +
    `</header>`
  );
}

export function renderLegend(dim: ColorDim): string {
  if (dim === "country") return `<div class="legend">Colour: nationality</div>`;
  const label = dim === "time" ? "fresh → most court time" : "lower seed → top seed";
  return `<div class="legend"><span class="legend-grad" aria-hidden="true"></span><span>${label}</span></div>`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/render-controls.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: controls bar, legend, duration formatter"
```

---

### Task 5: `render.ts` — leaderboard panel

**Files:** Modify `src/render.ts`; create `src/render-leaderboard.test.ts`.

- [ ] **Step 1: Write the failing test (`src/render-leaderboard.test.ts`)**

```ts
import { describe, it, expect } from "vitest";
import { renderLeaderboard } from "./render";
import type { LeaderRow } from "./state";

const rows: LeaderRow[] = [
  { playerId: "a", name: "Carlos Alcaraz", country: "ESP", sec: 12000, provisional: false, roundReached: 5 },
  { playerId: "b", name: "Jannik <Sinner>", country: "ITA", sec: 6000, provisional: true, roundReached: 4 },
];

describe("renderLeaderboard", () => {
  it("renders one row per leader with rank, escaped name, bar and formatted time", () => {
    const html = renderLeaderboard(rows, () => "#e0683c");
    expect((html.match(/class="lb-row"/g) ?? []).length).toBe(2);
    expect(html).toContain("Carlos Alcaraz");
    expect(html).toContain("Jannik &lt;Sinner&gt;"); // escaped, no raw <
    expect(html).not.toContain("Jannik <Sinner>");
    expect(html).toContain("3h20"); // 12000s = 200m = 3h20
    expect(html).toContain("*"); // provisional marker on the live leader
  });

  it("renders an empty list without throwing", () => {
    expect(renderLeaderboard([], () => "#000")).toContain("leaderboard");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/render-leaderboard.test.ts`
Expected: FAIL — `renderLeaderboard` not exported.

- [ ] **Step 3: Append to `src/render.ts`**

```ts
import type { LeaderRow } from "./state";

export function renderLeaderboard(rows: LeaderRow[], color: ColorFn): string {
  const max = Math.max(1, ...rows.map((r) => r.sec));
  const items = rows
    .map((r, i) => {
      const w = Math.round((r.sec / max) * 100);
      return (
        `<li class="lb-row">` +
        `<span class="lb-rank">${i + 1}</span>` +
        `<span class="lb-name">${escapeHtml(r.name)} <span class="lb-ctry">${escapeHtml(r.country)}</span></span>` +
        `<span class="lb-bar"><span style="width:${w}%;background:${color(r.playerId)}"></span></span>` +
        `<span class="lb-time">${formatDuration(r.sec)}${r.provisional ? "*" : ""}</span>` +
        `</li>`
      );
    })
    .join("");
  return `<aside class="leaderboard"><h2>Most time on court</h2><ol class="lb-list">${items}</ol></aside>`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/render-leaderboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: time-on-court leaderboard panel"
```

---

### Task 6: match-detail card + fixture stats

**Files:** Modify `src/render.ts`; modify `src/fixtures/synthetic.ts` (populate `stats` on finished matches); create `src/render-detail.test.ts`.

- [ ] **Step 1: Write the failing test (`src/render-detail.test.ts`)**

```ts
import { describe, it, expect } from "vitest";
import { renderMatchDetail } from "./render";
import type { Match, Player } from "./model";

const player = (id: string, name: string, seed: number | null): Player => ({
  id, name, country: "ESP", seed, entry: null, ranking: 3, ageYears: 22, sofaSlug: id,
});
const match = (over: Partial<Match> = {}): Match => ({
  id: "5-0", roundIndex: 5, slot: 0, nextMatchId: null, p1: "a", p2: "b",
  status: "finished", winner: "p1",
  score: [{ p1: 6, p2: 4 }, { p1: 7, p2: 6, tb: 5 }],
  live: null, durationSec: 9660, durationProvisional: false,
  sofaEventId: 1, sofaCustomId: "abc123",
  stats: { aces: [12, 5], doubleFaults: [2, 4], firstServePct: [71, 60] }, ...over,
});

describe("renderMatchDetail", () => {
  it("shows both players, score, duration, stats and a deep-link", () => {
    const html = renderMatchDetail(
      match(), player("a", "Carlos Alcaraz", 2), player("b", "Jannik Sinner", 1),
      "https://www.sofascore.com/tennis/match/x/abc123", "Final",
    );
    expect(html).toContain("Carlos Alcaraz");
    expect(html).toContain("Jannik Sinner");
    expect(html).toContain("Final");
    expect(html).toContain("6-4");
    expect(html).toContain("2h41"); // 9660s
    expect(html).toContain("12"); // aces
    expect(html).toContain('href="https://www.sofascore.com/tennis/match/x/abc123"');
    expect(html).toContain('data-action="close-detail"');
  });

  it("omits the link when there is no url and tolerates null players/stats", () => {
    const html = renderMatchDetail(
      match({ sofaCustomId: null, stats: null, p2: null }), player("a", "X", null), null, null, "Semifinal",
    );
    expect(html).not.toContain("Open in SofaScore");
    expect(html).toContain("TBD");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/render-detail.test.ts`
Expected: FAIL — `renderMatchDetail` not exported.

- [ ] **Step 3: Append to `src/render.ts`**

```ts
import type { Match, MatchStats, Player } from "./model";

const STATUS_LABEL: Record<Match["status"], string> = {
  notstarted: "Not started", scheduled: "Scheduled", live: "Live",
  finished: "", retired: "Retired", walkover: "Walkover",
};

function renderScore(m: Match): string {
  if (m.score && m.score.length) {
    return m.score
      .map((s) => `${s.p1}${s.tb != null ? `<sup>${s.tb}</sup>` : ""}-${s.p2}`)
      .join(" ");
  }
  return STATUS_LABEL[m.status] || "";
}

function renderStats(stats: MatchStats | null): string {
  if (!stats) return "";
  const row = (label: string, v?: [number | string, number | string]) =>
    v ? `<tr><td>${v[0]}</td><th>${label}</th><td>${v[1]}</td></tr>` : "";
  const body =
    row("Aces", stats.aces) +
    row("Double faults", stats.doubleFaults) +
    row("1st serve %", stats.firstServePct) +
    row("Service pts won %", stats.servicePointsWonPct) +
    row("Break pts won", stats.breakPointsConverted);
  return body ? `<table class="md-stats">${body}</table>` : "";
}

function renderPlayerLine(m: Match, p: Player | null, side: "p1" | "p2"): string {
  if (!p) return `<div class="md-player"><span class="md-tbd">TBD</span></div>`;
  const tag = p.seed != null ? `(${p.seed})` : p.entry ? `(${p.entry})` : "";
  const win = m.winner === side ? " md-win" : "";
  return (
    `<div class="md-player${win}">` +
    `<span class="md-name">${escapeHtml(p.name)}</span> ` +
    `<span class="md-ctry">${escapeHtml(p.country)}</span>` +
    (tag ? ` <span class="md-seed">${tag}</span>` : "") +
    `</div>`
  );
}

export function renderMatchDetail(
  m: Match, p1: Player | null, p2: Player | null, url: string | null, roundName: string,
): string {
  const dur =
    m.durationSec != null
      ? `<div class="md-dur">⏱ ${formatDuration(m.durationSec)}${m.durationProvisional ? " (live)" : ""}</div>`
      : "";
  const link = url
    ? `<a class="md-link" href="${url}" target="_blank" rel="noopener noreferrer">Open in SofaScore ↗</a>`
    : "";
  return (
    `<div class="detail" role="dialog" aria-label="Match detail">` +
    `<button class="detail-close" data-action="close-detail" aria-label="Close">✕</button>` +
    `<div class="md-round">${escapeHtml(roundName)}</div>` +
    `<div class="md-matchup">${renderPlayerLine(m, p1, "p1")}<div class="md-score">${renderScore(m)}</div>${renderPlayerLine(m, p2, "p2")}</div>` +
    dur + renderStats(m.stats) + link +
    `</div>`
  );
}
```

- [ ] **Step 4: Populate fixture `stats` so the card has data — edit `src/fixtures/synthetic.ts`**

In the `if (played) { ... }` branch (the finished match), change `stats: null,` to a deterministic stats object. Replace the line `stats: null,` (inside the `played` branch only) with:

```ts
          stats: {
            aces: [3 + ((r * 7 + slot) % 18), 2 + ((r * 5 + slot + 3) % 15)],
            doubleFaults: [1 + ((slot + r) % 5), 1 + ((slot + r + 2) % 6)],
            firstServePct: [58 + ((r * 3 + slot) % 22), 55 + ((r * 4 + slot + 1) % 22)],
          },
```

(Leave the scheduled/`else` branch's `stats: null` as-is.)

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run src/render-detail.test.ts src/model.test.ts`
Expected: PASS (detail tests pass; the existing fixture tests still pass — none assert `stats === null`).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: match-detail card with deep-link + fixture stats"
```

---

### Task 7: `app.ts` rewrite + theme-aware CSS

**Files:** Modify `src/app.ts` (rewrite); modify `src/app.css` (rewrite).

- [ ] **Step 1: Replace `src/app.ts` with**

```ts
import { makeSyntheticSnapshot } from "./fixtures/synthetic";
import { buildSunburst, timeOnCourt, timeLeaderboard } from "./state";
import { layout } from "./layout";
import { colorScale, type ColorDim } from "./color";
import {
  renderSunburst, renderControls, renderLegend, renderLeaderboard, renderMatchDetail,
} from "./render";
import { sofascoreMatchUrl } from "./deeplink";
import { loadTheme, saveTheme, applyTheme, nextTheme, type Theme } from "./theme";
import type { Snapshot, Tour } from "./model";

const SIZE = 700; // SVG viewBox units; CSS scales to container

interface AppState {
  tour: Tour;
  snapshots: Record<Tour, Snapshot>;
  colorDim: ColorDim;
  focusId: string | undefined;
  selectedMatchId: string | undefined;
  theme: Theme;
}

export function createApp(root: HTMLElement): void {
  const theme = loadTheme();
  applyTheme(theme);
  const state: AppState = {
    tour: "ATP",
    // Plan 3 swaps these synthetic snapshots for live data via api.ts.
    snapshots: {
      ATP: makeSyntheticSnapshot({ tour: "ATP", drawSize: 128, seed: 7, completedRounds: 4 }),
      WTA: makeSyntheticSnapshot({ tour: "WTA", drawSize: 128, seed: 11, completedRounds: 4 }),
    },
    colorDim: "time",
    focusId: undefined,
    selectedMatchId: undefined,
    theme,
  };

  const draw = () => {
    const snap = state.snapshots[state.tour];
    const time = timeOnCourt(snap);
    const arcs = layout(buildSunburst(snap), SIZE / 2 - 8, state.focusId);
    const color = colorScale(state.colorDim, snap, time);
    const lb = timeLeaderboard(snap, time, 10);

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
      detail;
  };

  root.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!el) return; // e.g. the SofaScore <a> link → let the browser handle it
    const a = el.dataset.action;
    const id = el.dataset.id;
    if (a === "tour" && el.dataset.tour) {
      state.tour = el.dataset.tour as Tour;
      state.focusId = undefined;
      state.selectedMatchId = undefined;
      draw();
    } else if (a === "colordim" && el.dataset.dim) {
      state.colorDim = el.dataset.dim as ColorDim;
      draw();
    } else if (a === "theme") {
      state.theme = nextTheme(state.theme);
      applyTheme(state.theme);
      saveTheme(state.theme);
      draw();
    } else if (a === "close-detail") {
      state.selectedMatchId = undefined;
      draw();
    } else if (a === "reset" || id === "r" || (id && id === state.focusId)) {
      // centre / background / re-click focused node → zoom out + clear detail
      state.focusId = undefined;
      state.selectedMatchId = undefined;
      draw();
    } else if (a === "zoom" && id) {
      state.focusId = id;
      state.selectedMatchId = el.dataset.match;
      draw();
    }
  });

  draw();
}
```

- [ ] **Step 2: Replace `src/app.css` with**

```css
:root {
  --bg: #0d1014; --panel: #161b23; --text: #d7dee6; --dim: #8b95a3;
  --line: #2a323d; --accent: #e0683c; --teal: #36b3a8;
}
:root[data-theme="light"] {
  --bg: #f6f4ef; --panel: #ffffff; --text: #21262d; --dim: #5b6470;
  --line: #d8dce2; --accent: #c9542b; --teal: #2a8f86;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text);
  font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  touch-action: manipulation; }
#app { height: 100%; display: flex; flex-direction: column; }

.controls { display: flex; gap: 10px; align-items: center; padding: 10px 14px;
  border-bottom: 1px solid var(--line); flex-wrap: wrap; }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 9px; overflow: hidden; }
.ctrl { background: transparent; color: var(--dim); border: 0; padding: 7px 12px;
  font: inherit; font-size: 13px; cursor: pointer; }
.seg .ctrl + .ctrl { border-left: 1px solid var(--line); }
.ctrl.active { background: var(--accent); color: #fff; }
.ctrl.theme { margin-left: auto; border: 1px solid var(--line); border-radius: 9px; }

.stage { flex: 1; display: flex; gap: 12px; min-height: 0; padding: 10px 14px; }
.sunburst { flex: 1; min-width: 0; }
.sunburst svg { width: 100%; height: 100%; display: block; }
.arc { cursor: pointer; stroke: var(--bg); stroke-width: 0.5; }
.arc.projected { opacity: 0.45; }

.leaderboard { width: 280px; max-width: 38vw; overflow-y: auto; background: var(--panel);
  border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; }
.leaderboard h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--dim); margin: 0 0 10px; }
.lb-list { list-style: none; margin: 0; padding: 0; }
.lb-row { display: grid; grid-template-columns: 18px 1fr 60px auto; gap: 8px;
  align-items: center; padding: 4px 0; font-size: 13px; }
.lb-rank { color: var(--dim); text-align: right; }
.lb-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lb-ctry { color: var(--dim); font-size: 11px; }
.lb-bar { background: var(--line); border-radius: 4px; height: 8px; overflow: hidden; }
.lb-bar > span { display: block; height: 100%; }
.lb-time { color: var(--dim); font-variant-numeric: tabular-nums; text-align: right; }

.legend { display: flex; align-items: center; gap: 8px; padding: 6px 14px 12px;
  color: var(--dim); font-size: 12px; }
.legend-grad { width: 120px; height: 8px; border-radius: 4px;
  background: linear-gradient(90deg, #2f6f8f, #d9a441, #e0683c); }

.detail { position: fixed; right: 14px; bottom: 14px; width: min(360px, calc(100vw - 28px));
  background: var(--panel); border: 1px solid var(--line); border-radius: 14px;
  padding: 16px; box-shadow: 0 12px 40px rgba(0,0,0,.4); }
.detail-close { position: absolute; top: 10px; right: 10px; background: transparent;
  border: 0; color: var(--dim); font-size: 15px; cursor: pointer; }
.md-round { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--dim); }
.md-matchup { margin: 8px 0; }
.md-player { font-size: 15px; }
.md-player.md-win { font-weight: 700; }
.md-player.md-win .md-name::after { content: " ✓"; color: var(--teal); }
.md-ctry { color: var(--dim); font-size: 12px; }
.md-seed { color: var(--dim); }
.md-tbd { color: var(--dim); font-style: italic; }
.md-score { color: var(--accent); font-variant-numeric: tabular-nums; margin: 4px 0; }
.md-dur { color: var(--dim); font-size: 13px; margin-top: 4px; }
.md-stats { width: 100%; margin: 10px 0 4px; border-collapse: collapse; font-size: 13px; }
.md-stats th { color: var(--dim); font-weight: 400; text-align: center; padding: 2px 6px; }
.md-stats td { text-align: center; font-variant-numeric: tabular-nums; width: 32%; }
.md-link { display: inline-block; margin-top: 10px; color: var(--accent); text-decoration: none; font-size: 14px; }

@media (max-width: 720px) {
  .stage { flex-direction: column; }
  .leaderboard { width: 100%; max-width: none; max-height: 32vh; }
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Full test run**

Run: `pnpm test`
Expected: all prior tests still pass (no app.ts unit tests; behaviour verified visually next).

- [ ] **Step 5: Manual/visual smoke**

Run `pnpm dev` and open the URL. Verify: controls bar (ATP/WTA, Time/Seed/Country, theme); the sunburst renders beside a "Most time on court" leaderboard; clicking an arc opens a **match-detail card** (names, score, duration, stats, "Open in SofaScore ↗") and zooms in; clicking the centre closes the card and zooms out; switching **WTA** changes the draw; switching **Seed/Country** recolours; the **theme** button flips light/dark and persists across reload; layout stacks on a narrow viewport.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: interactive app shell (tour/colour/theme/detail) + themed CSS"
```

---

### Task 8: Installable PWA (`vite-plugin-pwa`)

**Files:** Modify `package.json`, `pnpm-workspace.yaml`, `vite.config.ts`; create `pwa-assets.config.ts`, `public/logo.svg`; generate `public/*.png` + `public/favicon.ico`.

- [ ] **Step 1: Add dependencies**

Run:
```bash
pnpm add -D vite-plugin-pwa@^0.20.0 @vite-pwa/assets-generator@^0.2.6
```

- [ ] **Step 2: Allow the `sharp` build (pnpm 11)**

Edit `pnpm-workspace.yaml` so its `onlyBuiltDependencies` (and `allowBuilds` if present) include `sharp` alongside `esbuild`. The file should contain (merge with existing keys, don't drop esbuild):

```yaml
onlyBuiltDependencies:
  - esbuild
  - sharp
```

Then run `pnpm install` to apply.

- [ ] **Step 3: Create the source icon `public/logo.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="96" fill="#0d1014"/>
  <g transform="translate(256,256)" stroke="#0d1014" stroke-width="6">
    <circle r="190" fill="#2f6f8f"/>
    <circle r="150" fill="#3f86a0"/>
    <circle r="110" fill="#d9a441"/>
    <circle r="70" fill="#e0683c"/>
    <circle r="30" fill="#f0c14b"/>
    <line x1="0" y1="-200" x2="0" y2="200" stroke="#0d1014" stroke-width="10"/>
    <line x1="-200" y1="0" x2="200" y2="0" stroke="#0d1014" stroke-width="10"/>
  </g>
</svg>
```

- [ ] **Step 4: Create `pwa-assets.config.ts`**

```ts
import { defineConfig, minimal2023Preset } from "@vite-pwa/assets-generator/config";

export default defineConfig({
  preset: minimal2023Preset,
  images: ["public/logo.svg"],
});
```

- [ ] **Step 5: Add the generate script to `package.json`**

Add to `scripts`: `"generate-pwa-assets": "pwa-assets-generator"`.

- [ ] **Step 6: Generate icons**

Run:
```bash
pnpm generate-pwa-assets
```
Expected: creates `public/pwa-64x64.png`, `public/pwa-192x192.png`, `public/pwa-512x512.png`, `public/maskable-icon-512x512.png`, `public/apple-touch-icon-180x180.png`, `public/favicon.ico`. If this step errors (e.g. sharp failed to build), STOP and report BLOCKED with the error — do not hand-fake icons.

- [ ] **Step 7: Configure `vite-plugin-pwa` in `vite.config.ts`**

Replace `vite.config.ts` with:

```ts
/// <reference types="vitest" />
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  build: { target: "es2020" },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "apple-touch-icon-180x180.png", "logo.svg"],
      manifest: {
        name: "TennisArc",
        short_name: "TennisArc",
        description: "Live radial bracket for Grand Slam tennis (ATP + WTA).",
        theme_color: "#0d1014",
        background_color: "#0d1014",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: { globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest}"] },
    }),
  ],
  test: { globals: true, environment: "node" },
});
```

- [ ] **Step 8: Build and verify PWA output**

Run:
```bash
pnpm build && ls dist
```
Expected: `dist/` contains `sw.js`, `manifest.webmanifest`, the icon PNGs, and `registerSW.js`. `find src -name '*.js'` is still EMPTY (build doesn't pollute src). `pnpm test` still passes.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: installable PWA (manifest, icons, service worker)"
```

---

### Task 9: Final verification + visual checkpoint

**Files:** none (verification).

- [ ] **Step 1: Green gate**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: all tests pass, no type errors, build succeeds with `dist/sw.js` + `dist/manifest.webmanifest`, and `find src -name '*.js'` prints nothing.

- [ ] **Step 2: Manual PWA + interactions check**

Run `pnpm preview` (serves the production build incl. the service worker). In the browser: confirm the manifest is detected (DevTools → Application → Manifest shows TennisArc + icons), the service worker registers (Application → Service Workers), and an install affordance is available. Toggle offline (DevTools → Network → Offline) and reload — the app still renders. Re-verify all interactions from Task 7 Step 5 on the production build.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A && git commit -m "chore: green build for interactions+PWA milestone" || echo "nothing to commit"
```

---

## Self-review (against the spec)

- **Colour-by swappable dimension + selector** → Task 4 (`renderControls`) + Task 7 (wiring). ✔
- **Leaderboard (time-on-court)** → Task 2 (`timeLeaderboard`) + Task 5 (`renderLeaderboard`). ✔
- **Tap a match → detail card + SofaScore deep-link** → Task 1 (`sofascoreMatchUrl`) + Task 6 (`renderMatchDetail`) + Task 7 (delegation: zoom click sets `selectedMatchId`). ✔
- **Zoom reveals score/stats** → Task 7 (clicking an arc both focuses AND opens its detail). ✔
- **ATP/WTA toggle** → Task 4 + Task 7 (two snapshots). ✔
- **Light/dark theme, persisted** → Task 3 (`theme.ts`) + Task 7 (CSS vars, toggle wiring). ✔
- **Installable PWA + offline** → Task 8 (`vite-plugin-pwa`, manifest, icons, SW precache) + Task 9 (offline verify). ✔
- **HTML-escaping of player names** (real data will have accents/punctuation) → `escapeHtml` in render, used in leaderboard + detail. ✔
- **Deferred to Plan 3 (not built here):** `api.ts`, `store.ts`/IndexedDB offline-first revalidation loop, live data, deploy. ✔ (intentional — bundled data + SW precache covers offline for this milestone)
- **Type consistency:** `Tour`/`Match`/`Player`/`Snapshot` (model), `ColorDim`/`ColorFn`/`COLOR_DIMS` (color), `LeaderRow`/`timeLeaderboard`/`timeOnCourt` (state), `Theme`/`nextTheme`/`loadTheme`/`saveTheme`/`applyTheme` (theme), `slugify`/`sofascoreMatchUrl` (deeplink), `formatDuration`/`renderControls`/`renderLegend`/`renderLeaderboard`/`renderMatchDetail`/`escapeHtml` (render) — names used verbatim across tasks. ✔
- **No placeholders:** every code step is complete and runnable. ✔
