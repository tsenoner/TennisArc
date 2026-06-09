# TennisArc Projection Engine + Write-Once Labels + Centre Readout — Implementation Plan (3 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Prerequisite:** Plans 1 + 2 merged. This plan consumes `Player.elo` (Plan 1) and builds on the post-Plan-2 `app.ts`/`render.ts`.

**Goal:** Replace seed-based projections with a **surface-specific ELO** engine; label each player **exactly once** on their furthest-reached ring with true curved text; show a **centre readout** (name, rank, seed, country, surface-ELO, round, time-on-court) for the hovered/focused player; and render unplayed arcs **faded + dashed**.

**Architecture:** Pure additions to `state.ts` (`surfaceElo`, `projectFavorite`, `winProbability`, `labelAnchors`); `render.ts` grows curved `<textPath>` labels (gated, write-once) inside `renderSunburst` and a new `renderReadout`; `app.ts` computes the anchor set + readout subject and updates the readout on hover without a full re-render. No data-model or layout changes.

**Tech Stack:** TypeScript (strict, ESM), Vitest (`pnpm test <path>`), SVG `<textPath>`, d3-shape (existing).

**Spec:** [`../specs/2026-06-09-tennisarc-ux-overhaul-design.md`](../specs/2026-06-09-tennisarc-ux-overhaul-design.md) §4, §5, §6.

---

## File structure

**Modified**
- `src/state.ts` — `surfaceElo`, `projectFavorite` (replaces `betterSeed`), `winProbability`, `labelAnchors`; `projectedWinner` threads the slam surface.
- `src/state.test.ts` — tests for the four new/changed pure functions.
- `src/render.ts` — curved write-once labels + `data-occupant` in `renderSunburst`; new `renderReadout` + `ReadoutInfo`.
- `src/render.test.ts` — label + readout string assertions.
- `src/app.ts` — anchor set + label text into the sunburst; centre readout (default champion/focus); hover (`pointermove`) updates only the readout.
- `src/app.css` — `.arc-label`, `.readout`, dashed `.arc.projected`.

---

## Task 1: Surface-ELO projection engine

Replaces the seed-first `betterSeed` with `projectFavorite` (surface ELO → ranking → seed) and threads the slam surface through projections.

**Files:**
- Modify: `src/state.ts` (lines 30-53: `betterSeed` + `projectedWinner`)
- Test: `src/state.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/state.test.ts`:

```ts
import { surfaceElo, projectFavorite, winProbability } from "./state";
import type { Player } from "./model";

const mkPlayer = (o: Partial<Player>): Player => ({
  id: "x", name: "X", country: "", seed: null, entry: null, ranking: null, ageYears: null, sofaSlug: null, elo: null, ...o,
});

describe("surfaceElo", () => {
  it("picks the slam surface, falling back to overall then null", () => {
    const p = mkPlayer({ elo: { overall: 2000, hard: 2100, clay: 1900, grass: 1800 } });
    expect(surfaceElo(p, "Clay")).toBe(1900);
    expect(surfaceElo(p, "Grass")).toBe(1800);
    expect(surfaceElo(p, "Hard")).toBe(2100);
    expect(surfaceElo(mkPlayer({ elo: { overall: 2000, hard: null, clay: null, grass: null } }), "Clay")).toBe(2000);
    expect(surfaceElo(mkPlayer({ elo: null }), "Clay")).toBeNull();
  });
});

describe("projectFavorite", () => {
  const players: Record<string, Player> = {
    a: mkPlayer({ id: "a", seed: 5, ranking: 20, elo: { overall: 1900, hard: 1900, clay: 2200, grass: 1900 } }),
    b: mkPlayer({ id: "b", seed: 1, ranking: 2, elo: { overall: 2100, hard: 2100, clay: 2000, grass: 2100 } }),
    c: mkPlayer({ id: "c", seed: null, ranking: 50, elo: null }),
    d: mkPlayer({ id: "d", seed: null, ranking: 80, elo: null }),
  };
  it("favours higher SURFACE elo (clay specialist beats higher overall seed)", () => {
    expect(projectFavorite(players, "a", "b", "Clay")).toBe("a"); // a clay 2200 > b clay 2000
    expect(projectFavorite(players, "a", "b", "Hard")).toBe("b"); // b hard 2100 > a hard 1900
  });
  it("falls back to ranking then seed when elo is missing", () => {
    expect(projectFavorite(players, "c", "d", "Clay")).toBe("c"); // c rank 50 < d rank 80
  });
  it("handles null participants (TBD)", () => {
    expect(projectFavorite(players, null, "b", "Clay")).toBe("b");
    expect(projectFavorite(players, "a", null, "Clay")).toBe("a");
    expect(projectFavorite(players, null, null, "Clay")).toBeNull();
  });
});

describe("winProbability", () => {
  it("is 0.5 for equal elo and rises with the gap", () => {
    expect(winProbability(2000, 2000)).toBeCloseTo(0.5, 5);
    expect(winProbability(2200, 2000)).toBeCloseTo(0.7597, 3);
    expect(winProbability(2000, 2200)).toBeCloseTo(0.2403, 3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/state.test.ts`
Expected: FAIL — `surfaceElo`/`projectFavorite`/`winProbability` not exported.

- [ ] **Step 3: Replace `betterSeed` + `projectedWinner` in `src/state.ts`**

Replace lines 30-53 (the `betterSeed` doc-comment through the end of `projectedWinner`) with:

```ts
const surfaceKey = (surface: string): "hard" | "clay" | "grass" => {
  const s = surface.toLowerCase();
  if (s.includes("clay")) return "clay";
  if (s.includes("grass")) return "grass";
  return "hard";
};

/** A player's ELO for the slam surface, falling back to overall, then null. */
export function surfaceElo(p: Player, surface: string): number | null {
  if (!p.elo) return null;
  return p.elo[surfaceKey(surface)] ?? p.elo.overall ?? null;
}

/** ELO win-probability of A over B (standard logistic, base 10 / 400). */
export function winProbability(eloA: number, eloB: number): number {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
}

/**
 * The projected winner of a matchup: higher surface-ELO wins; falls back to
 * lower ranking, then lower seed, then A. Used for unplayed (TBD) matches.
 */
export function projectFavorite(
  players: Record<string, Player>, a: string | null, b: string | null, surface: string,
): string | null {
  if (!a) return b;
  if (!b) return a;
  const pa = players[a], pb = players[b];
  if (!pa) return pb ? b : null;
  if (!pb) return a;
  const ea = surfaceElo(pa, surface), eb = surfaceElo(pb, surface);
  if (ea != null && eb != null && ea !== eb) return ea > eb ? a : b;
  const ra = pa.ranking ?? Infinity, rb = pb.ranking ?? Infinity;
  if (ra !== rb) return ra < rb ? a : b;
  const sa = pa.seed ?? Infinity, sb = pb.seed ?? Infinity;
  if (sa !== sb) return sa < sb ? a : b;
  return a;
}

/** Projected winner of a match: decided result if any, else the projected favourite (by surface ELO). */
export function projectedWinner(s: Snapshot, matchId: string): string | null {
  const m = s.matches[matchId];
  const decided = winnerId(m);
  if (decided) return decided;
  const feeders = feedersOf(s, matchId);
  const a = feeders[0] ? projectedWinner(s, feeders[0].id) : m.p1;
  const b = feeders[1] ? projectedWinner(s, feeders[1].id) : m.p2;
  return projectFavorite(s.players, a, b, s.tournament.surface);
}
```

- [ ] **Step 4: Update any remaining `betterSeed` references**

Run: `grep -rn "betterSeed" src ingest`
Expected: no matches (only `projectedWinner` used it, and it is replaced). If any remain (e.g. an import in a test), update them to `projectFavorite` with the surface argument or delete the obsolete assertion.

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm test src/state.test.ts && pnpm typecheck`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add src/state.ts src/state.test.ts
git commit -m "feat(state): surface-ELO projection engine (projectFavorite, winProbability)"
```

---

## Task 2: Write-once label anchors

**Files:**
- Modify: `src/state.ts`
- Test: `src/state.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/state.test.ts`:

```ts
import { labelAnchors, buildSunburst as buildSun2 } from "./state";

describe("labelAnchors", () => {
  it("labels the champion once at the root and never repeats a player", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 2 });
    const root = buildSun2(s);
    const anchors = labelAnchors(root);
    expect(anchors.has(root.id)).toBe(true); // champion labelled at centre
    // a player advancing into the next decided round is NOT anchored on the outer arc
    const advancing = root.children.find((c) => c.occupant === root.occupant)!;
    expect(anchors.has(advancing.id)).toBe(false);
    // every decided occupant appears exactly once across the anchor set
    const seen = new Map<string, number>();
    const walk = (n: typeof root) => {
      if (anchors.has(n.id) && n.occupant) seen.set(n.occupant, (seen.get(n.occupant) ?? 0) + 1);
      n.children.forEach(walk);
    };
    walk(root);
    for (const count of seen.values()) expect(count).toBe(1);
  });

  it("does not anchor projected (undecided) arcs", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 5, completedRounds: 0 });
    const root = buildSun2(s);
    expect(labelAnchors(root).has(root.id)).toBe(false); // champion is projected → no anchor
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/state.test.ts`
Expected: FAIL — `labelAnchors` not exported.

- [ ] **Step 3: Add `labelAnchors` to `src/state.ts`** (after `buildSunburst`):

```ts
/**
 * The set of node ids that should carry their occupant's single label: a node is an
 * anchor when its occupant is decided here and did not also win the next round —
 * i.e. the parent is the root, is projected, or is won by someone else. This labels
 * each player exactly once, on the furthest ring they actually reached.
 */
export function labelAnchors(root: SunNode): Set<string> {
  const out = new Set<string>();
  const walk = (n: SunNode, parent: SunNode | null) => {
    if (!n.projected && n.occupant && (!parent || parent.projected || parent.occupant !== n.occupant)) {
      out.add(n.id);
    }
    for (const c of n.children) walk(c, n);
  };
  walk(root, null);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state.ts src/state.test.ts
git commit -m "feat(state): labelAnchors — one label per player at their furthest ring"
```

---

## Task 3: Curved write-once labels in the sunburst

Adds true curved `<textPath>` labels (gated by arc width, only on anchored decided arcs) and a `data-occupant` attribute (for hover) to `renderSunburst`.

**Files:**
- Modify: `src/render.ts` (`renderSunburst`, lines 20-36)
- Test: `src/render.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/render.test.ts`:

```ts
import { renderSunburst } from "./render";
import type { LayoutArc } from "./layout";

describe("renderSunburst labels", () => {
  const bigArc: LayoutArc = { id: "r", matchId: "1-0", occupant: "p0", projected: false, depth: 0, x0: 0, x1: Math.PI, y0: 40, y1: 120 };
  const color = () => "#fff";
  const labels = { anchors: new Set(["r"]), text: (id: string) => (id === "p0" ? "Sinner" : id) };

  it("emits a curved textPath label for an anchored, wide-enough arc", () => {
    const svg = renderSunburst([bigArc], color, 700, labels);
    expect(svg).toContain("<textPath");
    expect(svg).toContain("Sinner");
    expect(svg).toContain('data-occupant="p0"');
  });

  it("omits the label when the arc is not an anchor", () => {
    const svg = renderSunburst([bigArc], color, 700, { anchors: new Set<string>(), text: () => "Sinner" });
    expect(svg).not.toContain("<textPath");
  });

  it("omits the label on a projected arc", () => {
    const proj = { ...bigArc, projected: true };
    expect(renderSunburst([proj], color, 700, labels)).not.toContain("<textPath");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/render.test.ts`
Expected: FAIL — `renderSunburst` ignores the 4th arg / no `<textPath>`.

- [ ] **Step 3: Replace `renderSunburst` in `src/render.ts`** with:

```ts
export interface SunburstLabels { anchors: Set<string>; text: (occupant: string) => string; }

/** Render the sunburst as a self-contained SVG string (centred), with optional write-once curved labels. */
export function renderSunburst(arcs: LayoutArc[], color: ColorFn, size: number, labels?: SunburstLabels): string {
  const c = size / 2;
  const defs: string[] = [];
  const texts: string[] = [];
  const pt = (r: number, ang: number) => `${(r * Math.sin(ang)).toFixed(2)},${(-r * Math.cos(ang)).toFixed(2)}`;

  const paths = arcs
    .map((a) => {
      const d = arcGen(a) ?? "";
      const cls = a.projected ? "arc projected" : "arc";
      if (labels && !a.projected && a.occupant && labels.anchors.has(a.id)) {
        const label = labels.text(a.occupant);
        const rc = (a.y0 + a.y1) / 2;
        const span = a.x1 - a.x0;
        const fs = Math.min(13, Math.max(8, (a.y1 - a.y0) * 0.42));
        // gate: only label when the arc's chord can hold the text
        if (label && rc * span >= label.length * fs * 0.55) {
          const mid = (a.x0 + a.x1) / 2;
          const rev = mid > Math.PI / 2 && mid < 3 * Math.PI / 2;
          const big = span > Math.PI ? 1 : 0;
          const pad = Math.min(0.03, span * 0.12);
          const s0 = a.x0 + pad, s1 = a.x1 - pad;
          const pid = `lp${a.id.replace(/[^a-z0-9]/gi, "")}`;
          const dPath = rev
            ? `M${pt(rc, s1)} A${rc},${rc} 0 ${big} 0 ${pt(rc, s0)}`
            : `M${pt(rc, s0)} A${rc},${rc} 0 ${big} 1 ${pt(rc, s1)}`;
          defs.push(`<path id="${pid}" d="${dPath}"></path>`);
          texts.push(
            `<text class="arc-label" font-size="${fs.toFixed(1)}">` +
            `<textPath href="#${pid}" startOffset="50%" text-anchor="middle">${escapeHtml(label)}</textPath></text>`,
          );
        }
      }
      return `<path class="${cls}" d="${d}" fill="${color(a.occupant)}" ` +
        `data-action="zoom" data-id="${a.id}" data-match="${a.matchId}" data-occupant="${escapeHtml(a.occupant ?? "")}"></path>`;
    })
    .join("");

  return (
    `<svg viewBox="0 0 ${size} ${size}" preserveAspectRatio="xMidYMid meet" ` +
    `role="img" aria-label="Tournament bracket sunburst">` +
    `<g transform="translate(${c},${c})" data-action="reset">` +
    `<defs>${defs.join("")}</defs>${paths}${texts.join("")}</g></svg>`
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/render.test.ts`
Expected: PASS (existing `renderSunburst` tests still pass — `labels` is optional).

- [ ] **Step 5: Commit**

```bash
git add src/render.ts src/render.test.ts
git commit -m "feat(render): curved write-once labels + data-occupant in sunburst"
```

---

## Task 4: Centre readout

**Files:**
- Modify: `src/render.ts`
- Test: `src/render.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/render.test.ts`:

```ts
import { renderReadout, type ReadoutInfo } from "./render";

describe("renderReadout", () => {
  const info: ReadoutInfo = {
    name: "Carlos Alcaraz", country: "ESP", ranking: 2, seed: 2,
    eloLabel: "Clay ELO 2107", roundLabel: "4th round", sec: 22320, provisional: false, projected: false,
  };

  it("renders name, rank/seed, country, elo and time", () => {
    const html = renderReadout(info);
    expect(html).toContain("Carlos Alcaraz");
    expect(html).toContain("ESP");
    expect(html).toContain("#2");
    expect(html).toContain("Clay ELO 2107");
    expect(html).toContain("6h12"); // 22320s
  });

  it("renders an empty container for null (no subject)", () => {
    expect(renderReadout(null)).toContain('class="readout"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/render.test.ts`
Expected: FAIL — `renderReadout` not exported.

- [ ] **Step 3: Add `ReadoutInfo` + `renderReadout` to `src/render.ts`**

```ts
export interface ReadoutInfo {
  name: string;
  country: string;
  ranking: number | null;
  seed: number | null;
  eloLabel: string;        // e.g. "Clay ELO 2107" or "" when unknown
  roundLabel: string;      // e.g. "Quarter-final" / "out · R32" / "champion"
  sec: number;             // cumulative on-court seconds (0 if none)
  provisional: boolean;
  projected: boolean;      // subject is a projection (e.g. projected champion)
}

/** The always-legible centre card naming the hovered/focused player. */
export function renderReadout(info: ReadoutInfo | null): string {
  if (!info) return `<div class="readout" aria-hidden="true"></div>`;
  const rank = info.ranking != null ? `#${info.ranking}` : "";
  const seed = info.seed != null ? `seed ${info.seed}` : "";
  const meta1 = [rank, seed].filter(Boolean).join(" · ");
  const time = info.sec > 0 ? `${formatDuration(info.sec)}${info.provisional ? " (live)" : ""} on court` : "";
  const meta2 = [info.roundLabel, time].filter(Boolean).join(" · ");
  return (
    `<div class="readout${info.projected ? " projected" : ""}">` +
    `<div class="ro-ctry">${escapeHtml(info.country)}</div>` +
    `<div class="ro-name">${escapeHtml(info.name)}</div>` +
    (meta1 ? `<div class="ro-meta">${escapeHtml(meta1)}</div>` : "") +
    (info.eloLabel ? `<div class="ro-elo">${escapeHtml(info.eloLabel)}</div>` : "") +
    (meta2 ? `<div class="ro-meta">${escapeHtml(meta2)}</div>` : "") +
    `</div>`
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/render.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render.ts src/render.test.ts
git commit -m "feat(render): centre readout (name, rank, seed, surface-ELO, round, time)"
```

---

## Task 5: Wire labels + readout + hover into the app

Integration (verified by `pnpm typecheck` + the pure tests + manual smoke). Computes the anchor set and label text, renders the readout over the sunburst centre (default = focused arc's occupant, else champion), and updates only the readout on hover (no full re-render).

**Files:**
- Modify: `src/app.ts`

- [ ] **Step 1: Update imports** in `src/app.ts`

Change the `./state` import line to add the new functions:

```ts
import { buildSunburst, timeOnCourt, timeLeaderboard, labelAnchors, surfaceElo, type PlayerTime, type SunNode } from "./state";
```

Add `renderReadout` and the `ReadoutInfo` type to the `./render` import, and `renderSunburst` already imported:

```ts
import {
  renderSunburst, renderControls, renderLegend, renderLeaderboard, renderMatchDetail, renderReadout, type ReadoutInfo,
} from "./render";
```

Add `Player` to the model import:

```ts
import type { Player, SlamIndex, Snapshot, Tour } from "./model";
```

- [ ] **Step 2: Add a draw context + readout helpers** — inside `createApp`, after `let store: Store | undefined;` add:

```ts
  // Updated each draw so the (frequent) hover handler can build a readout without a full re-render.
  let ctx: { snap: Snapshot; time: Map<string, PlayerTime>; defaultId: string | null } | undefined;

  const surname = (name: string) => name.split(" ").slice(-1)[0] || name;

  const buildReadout = (snap: Snapshot, time: Map<string, PlayerTime>, playerId: string | null): ReadoutInfo | null => {
    if (!playerId) return null;
    const p: Player | undefined = snap.players[playerId];
    if (!p) return null;
    const t = time.get(playerId);
    const elo = surfaceElo(p, snap.tournament.surface);
    const champ = buildSunburst(snap).occupant;
    const reached = t?.roundReached ?? 0;
    const roundLabel = playerId === champ && snap.rounds.length
      ? "title contender" : (snap.rounds[reached]?.name ?? "");
    return {
      name: p.name, country: p.country, ranking: p.ranking, seed: p.seed,
      eloLabel: elo != null ? `${snap.tournament.surface} ELO ${Math.round(elo)}` : "",
      roundLabel, sec: t?.sec ?? 0, provisional: t?.provisional ?? false,
      projected: false,
    };
  };

  const updateReadout = (playerId: string | null) => {
    if (!ctx) return;
    const el = root.querySelector(".readout");
    if (!el) return;
    const info = buildReadout(ctx.snap, ctx.time, playerId ?? ctx.defaultId);
    el.outerHTML = renderReadout(info);
  };
```

- [ ] **Step 3: Update `draw()`** — replace the body that builds the sunburst + stage. Find in `draw()`:

```ts
    const time = timeOnCourt(snap);
    const arcs = layout(buildSunburst(snap), SIZE / 2 - 8, state.focusId);
    const color = colorScale(state.colorDim, snap, time);
    const lb = timeLeaderboard(snap, time);
```

Replace with:

```ts
    const time = timeOnCourt(snap);
    const tree = buildSunburst(snap);
    const arcs = layout(tree, SIZE / 2 - 8, state.focusId);
    const color = colorScale(state.colorDim, snap, time);
    const lb = timeLeaderboard(snap, time);
    const anchors = labelAnchors(tree);
    const labelText = (occ: string) => surname(snap.players[occ]?.name ?? occ);
    const focusOcc = state.focusId ? arcs.find((a) => a.id === state.focusId)?.occupant ?? null : null;
    const defaultId = focusOcc ?? tree.occupant ?? null;
    ctx = { snap, time, defaultId };
```

Then change the sunburst markup line in the same function from:

```ts
        `<div class="sunburst">${renderSunburst(arcs, color, SIZE)}</div>` +
```

to (adds labels + the readout overlay):

```ts
        `<div class="sunburst">${renderSunburst(arcs, color, SIZE, { anchors, text: labelText })}` +
          renderReadout(buildReadout(snap, time, defaultId)) + `</div>` +
```

- [ ] **Step 4: Add the hover handler** — after the existing `root.addEventListener("click", …)` block, add:

```ts
  root.addEventListener("pointermove", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-occupant]");
    updateReadout(el?.dataset.occupant || null);
  });
  root.addEventListener("pointerleave", () => updateReadout(null), true);
```

- [ ] **Step 5: Typecheck + full suite**

Run: `pnpm typecheck && pnpm test`
Expected: clean + all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app.ts
git commit -m "feat(app): write-once labels + centre readout with hover, surface-aware"
```

---

## Task 6: Styles, projected dashes, and visual smoke

**Files:**
- Modify: `src/app.css`

- [ ] **Step 1: Append styles to `src/app.css`**

```css
/* write-once arc labels */
.arc-label { fill: #f4f8fc; font-weight: 700; paint-order: stroke; stroke: rgba(4, 10, 16, .72); stroke-width: 2.4px; pointer-events: none; }
:root[data-theme="light"] .arc-label { fill: #0c1218; stroke: rgba(255, 255, 255, .8); }

/* faded + dashed projections (extends existing .arc.projected opacity) */
.arc.projected { stroke: var(--dim); stroke-width: .8px; stroke-dasharray: 3 2; }

/* centre readout overlay */
.sunburst { position: relative; }
.readout { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 150px; text-align: center; pointer-events: none; }
.readout .ro-ctry { font-size: 11px; letter-spacing: .08em; color: var(--dim); }
.readout .ro-name { font-weight: 700; font-size: 15px; margin-top: 1px; }
.readout .ro-meta { font-size: 11px; color: var(--dim); margin-top: 2px; line-height: 1.4; }
.readout .ro-elo { font-size: 11px; color: var(--teal); margin-top: 2px; }
.readout.projected .ro-name { font-style: italic; }
```

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: `tsc --noEmit` clean + `vite build` succeeds.

- [ ] **Step 3: Visual smoke** (manual — `pnpm dev`, needs a slam snapshot in `public/data`)

Confirm and **tune to taste** (the values below are the starting points to adjust live):
- Names read cleanly along the inner rings; the dense R128 ring is unlabelled until you zoom into a sector. If labels feel too sparse/dense, adjust the gate constant `0.55` and the `fs` clamp `(8…13)` in `renderSunburst` (Task 3).
- The centre readout names the champion by default and follows the cursor over arcs; leaving the wheel restores the default.
- Unplayed (projected) arcs read faded + dashed; played arcs are solid.
- Light theme labels stay legible.

- [ ] **Step 4: Commit any tuning**

```bash
git add src/app.css src/render.ts
git commit -m "style(sunburst): label/readout styling + projected dashes"
```

(If only `app.css` changed, stage just that.)

---

## Self-review

**Spec coverage** (spec §4-§6):
- §6 surface-ELO projection (surface → ranking → seed) + win-probability → Task 1.
- §4 write-once labelling (one per player at furthest ring) → Tasks 2-3.
- §4 true curved labels + width gating + R128 reveal-on-zoom → Task 3.
- §4 projected arcs faded + dashed → Task 6 (+ existing `.projected` opacity).
- §5 centre readout (name/rank/seed/country/surface-ELO/round/time), default champion, hover-follow → Tasks 4-5.

**Placeholder scan:** none. The "tune to taste" values in Task 6 are concrete starting constants with the exact knobs named, not placeholders.

**Type consistency:** `surfaceElo`/`projectFavorite`/`winProbability`/`labelAnchors` (Tasks 1-2) match their uses in Task 5 and `renderSunburst`'s `SunburstLabels { anchors, text }` (Task 3) matches the object Task 5 passes; `ReadoutInfo` (Task 4) matches `buildReadout`'s return (Task 5); `data-occupant` emitted in Task 3 is read by the Task 5 hover handler. `projectedWinner` keeps its signature; only its internal favourite call changed.

**Notes for the executor:**
- Country **flags** are intentionally absent here — the readout shows the ISO-3 code; Plan 4 adds `flags.ts` and retrofits flags into the readout, leaderboard, and country lens.
- The match-card and lens behaviour are untouched (Plans 4-5).
- Hover updates only the `.readout` node (via `outerHTML`), so it stays cheap on `pointermove`; the full `draw()` only runs on state changes.
