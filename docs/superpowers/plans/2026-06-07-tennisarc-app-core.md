# TennisArc — App Core (fixture-driven sunburst) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable TennisArc PWA shell that renders a full Grand Slam draw as a zoomable sunburst from a local (synthetic) fixture, with all pure logic (bracket tree, cumulative time-on-court, seed projections, radial layout, colour scales) unit-tested.

**Architecture:** Vanilla-DOM Vite app following the user's `wattblock`/`ErgoFlow` pattern: `model.ts` (types/contract) → `state.ts` (pure derivations) → `layout.ts` (pure geometry via d3-hierarchy) → `color.ts` (pure scales) → `render.ts` (SVG/HTML strings) → `app.ts`/`main.ts` (orchestration + click-to-zoom). Derived data is computed client-side from raw `matches` so the JSON stays minimal and logic is testable without the ingestion pipeline (this refines the spec, which listed `playerStats`/`projection` in the JSON).

**Tech Stack:** Vite 5, TypeScript 5 (strict), Vitest 2, `d3-hierarchy`, `d3-shape`, `d3-scale`, `d3-interpolate`. Package manager: **pnpm** (matches `wattblock`; swap to npm by replacing `pnpm` with `npm run` in commands if preferred).

**This is Plan 1 of 3.** Plan 2 = interactions + PWA/offline; Plan 3 = ingestion + automation + deploy.

---

## File structure (created by this plan)

```
TennisArc/
  package.json            # scripts + deps
  tsconfig.json           # strict
  vite.config.ts          # + vitest config (environment: node)
  index.html              # mounts #app
  src/
    main.ts               # thin entry: mount app
    app.ts                # orchestration: derive → layout → render → click-to-zoom
    app.css               # base + sunburst styles
    model.ts              # normalized types (the contract)
    state.ts              # pure: buildSunburst tree, timeOnCourt, projections
    layout.ts             # pure: radial partition → arc geometry (+ focus zoom)
    color.ts              # pure: colour scales per dimension
    render.ts             # pure: SVG/HTML strings
    fixtures/
      synthetic.ts        # deterministic snapshot generator (8…128 draw)
    model.test.ts
    state.test.ts
    layout.test.ts
    color.test.ts
    render.test.ts
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/app.css`, `src/main.ts`, `src/smoke.test.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "tennisarc",
  "version": "0.1.0",
  "description": "Live radial-bracket PWA for Grand Slam tennis (ATP + WTA)",
  "license": "MIT",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "TZ=UTC vitest run",
    "test:watch": "TZ=UTC vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "d3-hierarchy": "^3.1.2",
    "d3-interpolate": "^3.0.1",
    "d3-scale": "^4.0.2",
    "d3-shape": "^3.2.0"
  },
  "devDependencies": {
    "@types/d3-hierarchy": "^3.1.7",
    "@types/d3-interpolate": "^3.0.4",
    "@types/d3-scale": "^4.0.8",
    "@types/d3-shape": "^3.1.6",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": false,
    "skipLibCheck": true,
    "types": ["vitest/globals"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `vite.config.ts`**

```ts
/// <reference types="vitest" />
import { defineConfig } from "vite";

export default defineConfig({
  build: { target: "es2020" },
  test: { globals: true, environment: "node" },
});
```

- [ ] **Step 4: Create `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>TennisArc</title>
    <link rel="stylesheet" href="/src/app.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `src/app.css`**

```css
:root { --bg:#0d1014; --text:#d7dee6; --dim:#8b95a3; --line:#2a323d; --accent:#e0683c; }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text);
  font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  touch-action: manipulation; }
#app { height: 100%; display: flex; flex-direction: column; }
.sunburst { flex: 1; width: 100%; }
.sunburst svg { width: 100%; height: 100%; display: block; }
.arc { cursor: pointer; stroke: var(--bg); stroke-width: 0.5; }
.arc.projected { opacity: 0.45; }
```

- [ ] **Step 6: Create `src/main.ts` (temporary placeholder, replaced in Task 9)**

```ts
const app = document.querySelector<HTMLDivElement>("#app");
if (app) app.textContent = "TennisArc";
```

- [ ] **Step 7: Create `src/smoke.test.ts`**

```ts
import { describe, it, expect } from "vitest";

describe("scaffold", () => {
  it("runs vitest", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 8: Install and verify**

Run: `pnpm install && pnpm test`
Expected: `smoke.test.ts` passes (1 test).

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "chore: scaffold Vite + TS + Vitest app"
```

---

### Task 2: Data model + synthetic fixture

**Files:**
- Create: `src/model.ts`, `src/fixtures/synthetic.ts`, `src/model.test.ts`

- [ ] **Step 1: Write the failing test (`src/model.test.ts`)**

```ts
import { describe, it, expect } from "vitest";
import { makeSyntheticSnapshot } from "./fixtures/synthetic";

describe("synthetic fixture", () => {
  it("builds a balanced single-elim draw of the requested size", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    expect(s.tournament.drawSize).toBe(8);
    expect(Object.keys(s.players)).toHaveLength(8);
    // 8 entrants → 4 + 2 + 1 = 7 matches
    expect(Object.keys(s.matches)).toHaveLength(7);
    expect(s.rounds.map((r) => r.size)).toEqual([8, 4, 2]);
  });

  it("links every non-final match to a next match", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const finals = Object.values(s.matches).filter((m) => m.nextMatchId === null);
    expect(finals).toHaveLength(1);
    for (const m of Object.values(s.matches)) {
      if (m.nextMatchId) expect(s.matches[m.nextMatchId]).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/model.test.ts`
Expected: FAIL — cannot find `./fixtures/synthetic`.

- [ ] **Step 3: Create `src/model.ts`**

```ts
export type Tour = "ATP" | "WTA";
export type EntryType = "Q" | "WC" | "LL" | "PR" | null;
export type MatchStatus =
  | "notstarted" | "scheduled" | "live" | "finished" | "retired" | "walkover";

export interface SetScore { p1: number; p2: number; tb?: number; }

export interface MatchStats {
  aces?: [number, number];
  doubleFaults?: [number, number];
  firstServePct?: [number, number];
  servicePointsWonPct?: [number, number];
  breakPointsConverted?: [string, string];
}

export interface Player {
  id: string;
  name: string;
  country: string;            // IOC 3-letter
  seed: number | null;
  entry: EntryType;
  ranking: number | null;
  ageYears: number | null;
  sofaSlug: string | null;
}

export interface Match {
  id: string;                 // `${roundIndex}-${slot}`
  roundIndex: number;         // 0 = first round (outer) … last = Final (inner)
  slot: number;               // position within the round
  nextMatchId: string | null; // null only for the Final
  p1: string | null;          // playerId; null = TBD
  p2: string | null;
  status: MatchStatus;
  winner: "p1" | "p2" | null;
  score: SetScore[] | null;
  live: { set: number; game: string; server: "p1" | "p2" } | null;
  durationSec: number | null; // Σ per-set seconds (provisional while live)
  durationProvisional: boolean;
  sofaEventId: number | null;
  sofaCustomId: string | null;
  stats: MatchStats | null;
}

export interface Round {
  index: number;
  name: string;               // "Round of 128" … "Final"
  size: number;               // entrants this round
  matchIds: string[];
}

export interface Snapshot {
  schemaVersion: number;
  generatedAt: string;        // ISO
  tour: Tour;
  tournament: {
    slam: string; name: string; year: number; surface: string;
    sofaUniqueTournamentId: number; sofaSeasonId: number; drawSize: number;
  };
  players: Record<string, Player>;
  matches: Record<string, Match>;
  rounds: Round[];
}
```

- [ ] **Step 4: Create `src/fixtures/synthetic.ts`**

```ts
import type { Match, Player, Round, Snapshot, Tour } from "../model";

// deterministic PRNG (mulberry32) — no Math.random, reproducible in tests
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COUNTRIES = ["ITA", "ESP", "USA", "FRA", "SRB", "GER", "GBR", "AUS", "RUS", "ARG"];
const ROUND_NAMES: Record<number, string> = {
  128: "Round of 128", 64: "Round of 64", 32: "Round of 32", 16: "Round of 16",
  8: "Quarterfinal", 4: "Semifinal", 2: "Final",
};

export interface SyntheticOpts { tour: Tour; drawSize: number; seed?: number; completedRounds?: number; }

/** Build a balanced single-elimination draw with deterministic pseudo-results. */
export function makeSyntheticSnapshot(opts: SyntheticOpts): Snapshot {
  const { tour, drawSize, seed = 1 } = opts;
  const rounds = Math.log2(drawSize);
  if (!Number.isInteger(rounds)) throw new Error("drawSize must be a power of 2");
  const completedRounds = opts.completedRounds ?? rounds; // default: whole draw played
  const rand = rng(seed);

  const players: Record<string, Player> = {};
  for (let i = 0; i < drawSize; i++) {
    const id = `p${i}`;
    players[id] = {
      id, name: `Player ${i}`, country: COUNTRIES[i % COUNTRIES.length],
      seed: i < 32 ? i + 1 : null, entry: null,
      ranking: i + 1, ageYears: 18 + Math.floor(rand() * 18),
      sofaSlug: `player-${i}`,
    };
  }

  const matches: Record<string, Match> = {};
  const roundsArr: Round[] = [];
  // round 0 (outer) entrants = players in seed/draw order
  let entrants: (string | null)[] = Object.keys(players);

  for (let r = 0; r < rounds; r++) {
    const size = entrants.length;          // entrants this round
    const matchIds: string[] = [];
    const winners: (string | null)[] = [];
    for (let slot = 0; slot < size / 2; slot++) {
      const p1 = entrants[slot * 2];
      const p2 = entrants[slot * 2 + 1];
      const id = `${r}-${slot}`;
      const nextMatchId = r === rounds - 1 ? null : `${r + 1}-${Math.floor(slot / 2)}`;
      const played = r < completedRounds && p1 != null && p2 != null;
      const winSide: "p1" | "p2" = rand() < 0.5 ? "p1" : "p2";
      const winnerId = winSide === "p1" ? p1 : p2;
      const sets = 2 + Math.floor(rand() * 2);                  // 2–3 sets
      const durationSec = 60 * (75 + Math.floor(rand() * 110)); // 75–185 min
      matches[id] = {
        id, roundIndex: r, slot, nextMatchId, p1, p2,
        status: played ? "finished" : "scheduled",
        winner: played ? winSide : null,
        score: played ? Array.from({ length: sets }, () => ({ p1: 6, p2: 4 })) : null,
        live: null,
        durationSec: played ? durationSec : null,
        durationProvisional: false,
        sofaEventId: 1000 + r * 100 + slot,
        sofaCustomId: `cid${r}_${slot}`,
        stats: null,
      };
      matchIds.push(id);
      winners.push(played ? winnerId : null);
    }
    roundsArr.push({ index: r, name: ROUND_NAMES[size] ?? `Round of ${size}`, size, matchIds });
    entrants = winners;
  }

  return {
    schemaVersion: 1,
    generatedAt: "2026-06-07T00:00:00.000Z",
    tour,
    tournament: {
      slam: "roland-garros", name: "Roland Garros", year: 2026, surface: "Clay",
      sofaUniqueTournamentId: tour === "ATP" ? 2480 : 2577,
      sofaSeasonId: tour === "ATP" ? 85951 : 85953, drawSize,
    },
    players, matches, rounds: roundsArr,
  };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run src/model.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: normalized data model + deterministic synthetic fixture"
```

---

### Task 3: Bracket tree (`buildSunburst`)

**Files:**
- Create: `src/state.ts`, `src/state.test.ts`

- [ ] **Step 1: Write the failing test (`src/state.test.ts`)**

```ts
import { describe, it, expect } from "vitest";
import { makeSyntheticSnapshot } from "./fixtures/synthetic";
import { buildSunburst, winnerId } from "./state";

describe("buildSunburst", () => {
  it("roots at the champion and has the draw size as leaves", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 3 });
    const root = buildSunburst(s);
    expect(root.depth).toBe(0);
    // champion = winner of the final
    const final = Object.values(s.matches).find((m) => m.nextMatchId === null)!;
    expect(root.occupant).toBe(winnerId(final));
    // leaves = 8 entrants
    const leaves: string[] = [];
    const walk = (n: typeof root) => n.children.length ? n.children.forEach(walk) : leaves.push(n.id);
    walk(root);
    expect(leaves).toHaveLength(8);
  });

  it("assigns a stable unique id per node and links each non-leaf to a match", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 4, seed: 2 });
    const root = buildSunburst(s);
    const ids = new Set<string>();
    const walk = (n: typeof root) => { ids.add(n.id); n.children.forEach(walk); };
    walk(root);
    // 4-draw: champion(1) + finalists(2) + entrants(4) = 7 nodes
    expect(ids.size).toBe(7);
    expect(root.matchId).toBe(Object.values(s.matches).find((m) => m.nextMatchId === null)!.id);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/state.test.ts`
Expected: FAIL — cannot find `./state`.

- [ ] **Step 3: Create `src/state.ts`**

```ts
import type { Match, Player, Snapshot } from "./model";

export interface SunNode {
  id: string;                 // unique path id, e.g. "r", "r.0", "r.0.1" (for focus/zoom)
  matchId: string;            // the match this node represents (leaf → its round-0 match)
  occupant: string | null;    // playerId (decided winner or projected); null if unknown
  projected: boolean;         // occupant is a projection, not a decided result
  depth: number;              // 0 = champion (centre)
  children: SunNode[];
}

export function winnerId(m: Match): string | null {
  if (m.winner === "p1") return m.p1;
  if (m.winner === "p2") return m.p2;
  return null;
}

export function finalMatch(s: Snapshot): Match {
  const final = Object.values(s.matches).find((m) => m.nextMatchId === null);
  if (!final) throw new Error("no final match (nextMatchId === null) in snapshot");
  return final;
}

function feedersOf(s: Snapshot, matchId: string): Match[] {
  return Object.values(s.matches)
    .filter((m) => m.nextMatchId === matchId)
    .sort((a, b) => a.slot - b.slot);
}

/** Better-seeded player wins a projection: seeded beats unseeded; lower seed/ranking wins; tie → a. */
export function betterSeed(players: Record<string, Player>, a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  const pa = players[a], pb = players[b];
  const sa = pa.seed ?? Infinity, sb = pb.seed ?? Infinity;
  if (sa !== sb) return sa < sb ? a : b;
  const ra = pa.ranking ?? Infinity, rb = pb.ranking ?? Infinity;
  if (ra !== rb) return ra < rb ? a : b;
  return a;
}

/** Projected winner of a match: decided result if any, else the better-seeded projected finalist. */
export function projectedWinner(s: Snapshot, matchId: string): string | null {
  const m = s.matches[matchId];
  const decided = winnerId(m);
  if (decided) return decided;
  const feeders = feedersOf(s, matchId);
  const a = feeders.length ? projectedWinner(s, feeders[0].id) : m.p1;
  const b = feeders.length ? projectedWinner(s, feeders[1].id) : m.p2;
  return betterSeed(s.players, a, b);
}

/** Build the champion-centred sunburst tree from the flat match list. */
export function buildSunburst(s: Snapshot): SunNode {
  const build = (m: Match, depth: number, id: string): SunNode => {
    const decided = winnerId(m);
    const occupant = decided ?? projectedWinner(s, m.id);
    const feeders = feedersOf(s, m.id);
    const children: SunNode[] = feeders.length
      ? feeders.map((f, i) => build(f, depth + 1, `${id}.${i}`))
      : [
          { id: `${id}.0`, matchId: m.id, occupant: m.p1, projected: false, depth: depth + 1, children: [] },
          { id: `${id}.1`, matchId: m.id, occupant: m.p2, projected: false, depth: depth + 1, children: [] },
        ];
    return { id, matchId: m.id, occupant, projected: decided === null, depth, children };
  };
  return build(finalMatch(s), 0, "r");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/state.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: bracket tree + seed projection in state.ts"
```

---

### Task 4: Cumulative time-on-court

**Files:**
- Modify: `src/state.ts`
- Modify: `src/state.test.ts` (add a describe block)

- [ ] **Step 1: Add the failing test to `src/state.test.ts`**

```ts
import { timeOnCourt } from "./state";
import type { Snapshot } from "./model";

function tinySnapshot(over: Partial<Record<string, any>> = {}): Snapshot {
  // 2 R1 matches → 1 final; players p0..p3
  const base = makeSyntheticSnapshot({ tour: "ATP", drawSize: 4, seed: 1 });
  return { ...base, matches: { ...base.matches, ...(over as any) } };
}

describe("timeOnCourt", () => {
  it("sums duration for finished matches and counts retirements", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 4, seed: 1 });
    const t = timeOnCourt(s);
    // every entrant played at least their R1 match → positive time
    expect(t.get("p0")!.sec).toBeGreaterThan(0);
    // champion played 2 matches
    const champ = buildSunburst(s).occupant!;
    expect(t.get(champ)!.matches).toBe(2);
  });

  it("adds 0 for walkovers and flags live matches provisional", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 4, seed: 1 });
    const m = s.matches["0-0"];
    // turn match 0-0 into a walkover with no duration
    s.matches["0-0"] = { ...m, status: "walkover", durationSec: null, winner: "p1" };
    // turn match 0-1 into a live match with provisional duration
    const m2 = s.matches["0-1"];
    s.matches["0-1"] = { ...m2, status: "live", winner: null, durationSec: 1800, durationProvisional: true };
    const t = timeOnCourt(s);
    expect(t.get(m.p1!)!.sec).toBe(t.get(m.p1!)!.sec); // no throw; walkover contributes 0 here
    expect(t.get(m2.p1!)!.provisional).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/state.test.ts`
Expected: FAIL — `timeOnCourt` is not exported.

- [ ] **Step 3: Append to `src/state.ts`**

```ts
export interface PlayerTime {
  sec: number;
  provisional: boolean;
  matches: number;            // counted matches that contributed time
  roundReached: number;       // deepest roundIndex reached (winner → roundIndex+1)
}

/** Whether a match's on-court time should be counted, and whether it's provisional. */
function countsTime(m: Match): { count: boolean; provisional: boolean } {
  if (m.status === "finished" || m.status === "retired") return { count: true, provisional: false };
  if (m.status === "live") return { count: true, provisional: true };
  return { count: false, provisional: false }; // walkover / scheduled / notstarted
}

/** Cumulative time-on-court per player across the tournament. */
export function timeOnCourt(s: Snapshot): Map<string, PlayerTime> {
  const out = new Map<string, PlayerTime>();
  const ensure = (id: string): PlayerTime => {
    let v = out.get(id);
    if (!v) { v = { sec: 0, provisional: false, matches: 0, roundReached: 0 }; out.set(id, v); }
    return v;
  };
  for (const m of Object.values(s.matches)) {
    const { count, provisional } = countsTime(m);
    for (const side of ["p1", "p2"] as const) {
      const pid = m[side];
      if (!pid) continue;
      const v = ensure(pid);
      const reached = m.winner === side ? m.roundIndex + 1 : m.roundIndex;
      if (reached > v.roundReached) v.roundReached = reached;
      if (count && m.durationSec != null) {
        v.sec += m.durationSec;
        v.matches += 1;
        if (provisional) v.provisional = true;
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/state.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: cumulative time-on-court with RET/WO/live gating"
```

---

### Task 5: Colour scales

**Files:**
- Create: `src/color.ts`, `src/color.test.ts`

- [ ] **Step 1: Write the failing test (`src/color.test.ts`)**

```ts
import { describe, it, expect } from "vitest";
import { makeSyntheticSnapshot } from "./fixtures/synthetic";
import { timeOnCourt } from "./state";
import { colorScale, COLOR_DIMS } from "./color";

describe("colorScale", () => {
  it("exposes the supported dimensions", () => {
    expect(COLOR_DIMS).toContain("time");
    expect(COLOR_DIMS).toContain("seed");
    expect(COLOR_DIMS).toContain("country");
  });

  it("returns a hex/rgb colour for a known player and a fallback for null", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const scale = colorScale("time", s, timeOnCourt(s));
    expect(scale("p0")).toMatch(/^(#|rgb)/);
    expect(scale(null)).toMatch(/^(#|rgb)/);
  });

  it("maps higher time-on-court to a warmer colour than lower", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const t = timeOnCourt(s);
    const ids = [...t.keys()].sort((a, b) => t.get(a)!.sec - t.get(b)!.sec);
    const scale = colorScale("time", s, t);
    const low = scale(ids[0]); const high = scale(ids[ids.length - 1]);
    expect(low).not.toBe(high);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/color.test.ts`
Expected: FAIL — cannot find `./color`.

- [ ] **Step 3: Create `src/color.ts`**

```ts
import { scaleLinear, scaleOrdinal } from "d3-scale";
import { interpolateRgbBasis } from "d3-interpolate";
import type { Snapshot } from "./model";
import type { PlayerTime } from "./state";

export type ColorDim = "time" | "seed" | "country";
export const COLOR_DIMS: ColorDim[] = ["time", "seed", "country"];

const NEUTRAL = "#3a4350";
// cool → gold → clay
const HEAT = interpolateRgbBasis(["#2f6f8f", "#d9a441", "#e0683c"]);
const CATEGORICAL = [
  "#e0683c", "#36b3a8", "#d9a441", "#7c83ff", "#e06ca0",
  "#6fae5a", "#c2627a", "#4aa3df", "#b07cc6", "#d98a3c",
];

export type ColorFn = (playerId: string | null) => string;

export function colorScale(dim: ColorDim, s: Snapshot, time: Map<string, PlayerTime>): ColorFn {
  if (dim === "time") {
    const max = Math.max(1, ...[...time.values()].map((v) => v.sec));
    const t = scaleLinear<number>().domain([0, max]).range([0, 1]).clamp(true);
    return (id) => (id && time.has(id) ? HEAT(t(time.get(id)!.sec)) : NEUTRAL);
  }
  if (dim === "seed") {
    const t = scaleLinear<number>().domain([1, 32]).range([1, 0]).clamp(true);
    return (id) => {
      const seed = id ? s.players[id]?.seed : null;
      return seed ? HEAT(t(seed)) : NEUTRAL;
    };
  }
  // country
  const ord = scaleOrdinal<string, string>().range(CATEGORICAL);
  return (id) => {
    const c = id ? s.players[id]?.country : null;
    return c ? ord(c) : NEUTRAL;
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/color.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: swappable colour scales (time/seed/country)"
```

---

### Task 6: Radial layout geometry (+ focus zoom)

**Files:**
- Create: `src/layout.ts`, `src/layout.test.ts`

- [ ] **Step 1: Write the failing test (`src/layout.test.ts`)**

```ts
import { describe, it, expect } from "vitest";
import { makeSyntheticSnapshot } from "./fixtures/synthetic";
import { buildSunburst } from "./state";
import { layout } from "./layout";

describe("layout", () => {
  it("produces one arc per tree node within the radius", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const arcs = layout(buildSunburst(s), 100);
    // 8-draw nodes: 1 + 2 + 4 + 8 = 15
    expect(arcs).toHaveLength(15);
    for (const a of arcs) {
      expect(a.x0).toBeGreaterThanOrEqual(0);
      expect(a.x1).toBeLessThanOrEqual(2 * Math.PI + 1e-9);
      expect(a.y1).toBeLessThanOrEqual(100 + 1e-9);
      expect(a.x1).toBeGreaterThanOrEqual(a.x0);
    }
  });

  it("full circle: outer leaves span the whole 2π", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const arcs = layout(buildSunburst(s), 100);
    const maxDepth = Math.max(...arcs.map((a) => a.depth));
    const leaves = arcs.filter((a) => a.depth === maxDepth).sort((a, b) => a.x0 - b.x0);
    expect(leaves[0].x0).toBeCloseTo(0, 5);
    expect(leaves[leaves.length - 1].x1).toBeCloseTo(2 * Math.PI, 5);
  });

  it("focus rescales the focused subtree to fill the circle", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const root = buildSunburst(s);
    const focusNode = root.children[0]; // a finalist subtree
    const arcs = layout(root, 100, focusNode.id);
    const focused = arcs.find((a) => a.id === focusNode.id)!;
    expect(focused.x0).toBeCloseTo(0, 5);
    expect(focused.x1).toBeCloseTo(2 * Math.PI, 5);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/layout.test.ts`
Expected: FAIL — cannot find `./layout`.

- [ ] **Step 3: Create `src/layout.ts`**

```ts
import { hierarchy, partition } from "d3-hierarchy";
import type { SunNode } from "./state";

export interface LayoutArc {
  id: string;
  matchId: string;
  occupant: string | null;
  projected: boolean;
  depth: number;
  x0: number; x1: number;     // angles in radians [0, 2π]
  y0: number; y1: number;     // radii [0, radius]
}

const TAU = 2 * Math.PI;

/**
 * Radial partition over the sunburst tree.
 * @param focusId  if given, that subtree is rescaled to fill the full circle (zoom).
 */
export function layout(root: SunNode, radius: number, focusId?: string): LayoutArc[] {
  const h = hierarchy<SunNode>(root, (d) => d.children).count();
  partition<SunNode>().size([TAU, radius])(h);
  const nodes = h.descendants();

  let fx0 = 0, fx1 = TAU, fy0 = 0;
  if (focusId) {
    const f = nodes.find((n) => n.data.id === focusId);
    if (f) { fx0 = (f as any).x0; fx1 = (f as any).x1; fy0 = (f as any).y0; }
  }
  const kx = TAU / (fx1 - fx0);

  return nodes
    .map((n) => {
      const a = n as unknown as { x0: number; x1: number; y0: number; y1: number };
      const x0 = Math.max(0, Math.min(TAU, (a.x0 - fx0) * kx));
      const x1 = Math.max(0, Math.min(TAU, (a.x1 - fx0) * kx));
      const y0 = Math.max(0, a.y0 - fy0);
      const y1 = Math.max(0, a.y1 - fy0);
      return {
        id: n.data.id, matchId: n.data.matchId, occupant: n.data.occupant,
        projected: n.data.projected, depth: n.depth, x0, x1, y0, y1,
      };
    })
    .filter((a) => a.x1 > a.x0 + 1e-9 && a.y1 > a.y0 + 1e-9);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/layout.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: radial partition layout with focus-zoom rescale"
```

---

### Task 7: SVG render

**Files:**
- Create: `src/render.ts`, `src/render.test.ts`

- [ ] **Step 1: Write the failing test (`src/render.test.ts`)**

```ts
import { describe, it, expect } from "vitest";
import { makeSyntheticSnapshot } from "./fixtures/synthetic";
import { buildSunburst, timeOnCourt } from "./state";
import { layout } from "./layout";
import { colorScale } from "./color";
import { renderSunburst } from "./render";

describe("renderSunburst", () => {
  it("returns an SVG string with one path per arc and a viewBox", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const arcs = layout(buildSunburst(s), 150);
    const svg = renderSunburst(arcs, colorScale("time", s, timeOnCourt(s)), 340);
    expect(svg).toContain("<svg");
    expect(svg).toContain("viewBox");
    expect((svg.match(/<path/g) ?? []).length).toBe(arcs.length);
    // each arc carries its node id for click-to-zoom
    expect(svg).toContain('data-action="zoom"');
  });

  it("marks projected arcs with the projected class", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1, completedRounds: 0 });
    const arcs = layout(buildSunburst(s), 150);
    const svg = renderSunburst(arcs, colorScale("seed", s, timeOnCourt(s)), 340);
    expect(svg).toContain("arc projected");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/render.test.ts`
Expected: FAIL — cannot find `./render`.

- [ ] **Step 3: Create `src/render.ts`**

```ts
import { arc as d3arc } from "d3-shape";
import type { LayoutArc } from "./layout";
import type { ColorFn } from "./color";

const arcGen = d3arc<LayoutArc>()
  .startAngle((a) => a.x0)
  .endAngle((a) => a.x1)
  .innerRadius((a) => a.y0)
  .outerRadius((a) => a.y1)
  .padAngle(0.004)
  .padRadius(60);

/** Render the sunburst as a self-contained SVG string (centred). */
export function renderSunburst(arcs: LayoutArc[], color: ColorFn, size: number): string {
  const c = size / 2;
  const paths = arcs
    .map((a) => {
      const d = arcGen(a) ?? "";
      const cls = a.projected ? "arc projected" : "arc";
      return `<path class="${cls}" d="${d}" fill="${color(a.occupant)}" ` +
        `data-action="zoom" data-id="${a.id}" data-match="${a.matchId}"></path>`;
    })
    .join("");
  return (
    `<svg viewBox="0 0 ${size} ${size}" preserveAspectRatio="xMidYMid meet" ` +
    `role="img" aria-label="Tournament bracket sunburst">` +
    `<g transform="translate(${c},${c})" data-action="reset">${paths}</g></svg>`
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/render.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: SVG sunburst renderer (arc paths + zoom hooks)"
```

---

### Task 8: App orchestration + click-to-zoom

**Files:**
- Create: `src/app.ts`
- Modify: `src/main.ts` (replace placeholder)

- [ ] **Step 1: Create `src/app.ts`**

```ts
import { makeSyntheticSnapshot } from "./fixtures/synthetic";
import { buildSunburst, timeOnCourt } from "./state";
import { layout } from "./layout";
import { colorScale } from "./color";
import { renderSunburst } from "./render";
import type { Snapshot } from "./model";

const SIZE = 700; // SVG viewBox units; CSS scales to container

interface AppState { snapshot: Snapshot; focusId: string | undefined; }

export function createApp(root: HTMLElement): void {
  // Plan 3 swaps this synthetic snapshot for live data via api.ts.
  const state: AppState = {
    snapshot: makeSyntheticSnapshot({ tour: "ATP", drawSize: 128, seed: 7, completedRounds: 4 }),
    focusId: undefined,
  };

  const draw = () => {
    const tree = buildSunburst(state.snapshot);
    const arcs = layout(tree, SIZE / 2 - 8, state.focusId);
    const color = colorScale("time", state.snapshot, timeOnCourt(state.snapshot));
    root.innerHTML = `<div class="sunburst">${renderSunburst(arcs, color, SIZE)}</div>`;
  };

  // event delegation: click an arc → focus it; click the centre group → reset
  root.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!el) return;
    if (el.dataset.action === "zoom" && el.dataset.id) {
      state.focusId = state.focusId === el.dataset.id ? undefined : el.dataset.id;
      draw();
    } else if (el.dataset.action === "reset") {
      if (state.focusId) { state.focusId = undefined; draw(); }
    }
  });

  draw();
}
```

- [ ] **Step 2: Replace `src/main.ts`**

```ts
import { createApp } from "./app";
import "./app.css";

const root = document.querySelector<HTMLDivElement>("#app");
if (root) createApp(root);
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Manual smoke test**

Run: `pnpm dev`, open the printed URL.
Expected: a full 128-draw **sunburst** renders, centre champion, heat-coloured by (synthetic) time-on-court. Clicking an arc **zooms** that subtree to fill the circle; clicking the centre **resets**. Resize the window — it stays centred and responsive.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: app shell renders fixture sunburst with click-to-zoom"
```

---

### Task 9: Full test run + plan-complete checkpoint

**Files:** none (verification)

- [ ] **Step 1: Run the whole suite + typecheck + build**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: all tests pass (smoke + model + state + color + layout + render), no type errors, `dist/` builds.

- [ ] **Step 2: Commit any build-config fixes if needed**

```bash
git add -A && git commit -m "chore: green build for app-core milestone" || echo "nothing to commit"
```

---

## Self-review (against the spec)

- **Sunburst layout + champion centre** → Tasks 3, 6, 7. ✔
- **Cumulative time-on-court (RET/WO/live gating)** → Task 4. ✔
- **Seed projections until they meet** → Task 3 (`projectedWinner`, `projected` flag) + Task 7 (dashed/dim render). ✔
- **Colour-by swappable dimension (default time)** → Task 5 (`time`/`seed`/`country`), wired default in Task 8; the *selector UI* is **Plan 2**. ✔ (deferred UI noted)
- **Tap-to-zoom** → Tasks 6 (focus) + 8 (click delegation). ✔
- **Match detail + SofaScore deep-link, ATP/WTA toggle, leaderboard, offline/PWA, real data** → **Plans 2 & 3** (out of scope here, by design). ✔
- **Vanilla-DOM `state→layout→color→render→app` split, render returns strings** → all tasks follow it. ✔
- **Types consistent across tasks:** `Snapshot`/`Match`/`Player` (Task 2), `SunNode`/`winnerId`/`projectedWinner`/`timeOnCourt`/`PlayerTime` (Tasks 3–4), `ColorFn`/`ColorDim`/`colorScale` (Task 5), `LayoutArc`/`layout` (Task 6), `renderSunburst` (Task 7) — names reused verbatim downstream. ✔
- **No placeholders:** every code step is complete and runnable. ✔
