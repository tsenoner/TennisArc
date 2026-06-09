# TennisArc Match Insight — Implementation Plan (5 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Prerequisite:** Plans 1–4 merged. Builds on post-Plan-4 `state.ts` (surfaceElo/winProbability/timeOnCourt), `render.ts` (panels, flags, `roundAbbrev`), `app.ts` (lens-routed panel, readout/hover).

**Goal:** Turn the bottom-right detail card into a rich **match insight** in the panel slot — matchup with flags/seed/rank, set-by-set score, auto-badges (upset/comeback/straight/tiebreaks/marathon), aces/DF bars, ELO context, each player's path + time, SofaScore link — and **decouple inspecting a match from zooming** (tap = inspect; an explicit "Focus this section" button zooms; tap-centre zooms out).

**Architecture:** Pure `matchInsight(snapshot, matchId, time)` in `state.ts` derives everything (badges, ELO line, per-player context). `render.ts` replaces `renderMatchDetail` with `renderMatchInsight` (rendered in the panel column). `app.ts` routes the panel to the insight when a match is selected (with "back"), and splits the old combined "zoom" arc action into **inspect** (select) + **focus** (zoom).

**Tech Stack:** TypeScript (strict, ESM), Vitest.

**Spec:** [`../specs/2026-06-09-tennisarc-ux-overhaul-design.md`](../specs/2026-06-09-tennisarc-ux-overhaul-design.md) §7.

---

## File structure

**Modified**
- `src/state.ts` — `InsightSide`, `MatchInsight`, `matchInsight`.
- `src/state.test.ts`
- `src/render.ts` — replace `renderMatchDetail`/`renderPlayerLine`/`renderStats` with `renderMatchInsight`; keep score/tiebreak logic.
- `src/render-detail.test.ts` — retarget to `renderMatchInsight`.
- `src/render.test.ts` — arc action assertion `zoom` → `inspect`.
- `src/app.ts` — panel routes to the insight when selected; inspect/focus split; `selectedNodeId` state.
- `src/app.css` — insight card styling (matchup, badges, bars, context).

---

## Task 1: matchInsight (badges + ELO context + player paths)

**Files:**
- Modify: `src/state.ts`
- Test: `src/state.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/state.test.ts`:

```ts
import { matchInsight } from "./state";

describe("matchInsight", () => {
  it("derives upset + comeback + tiebreak badges and an ELO line", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 4, seed: 1 });
    const m = s.matches["0-0"];
    const win = m.winner === "p1" ? m.p1! : m.p2!;
    const lose = m.winner === "p1" ? m.p2! : m.p1!;
    s.players[win] = { ...s.players[win], elo: { overall: 1800, hard: 1800, clay: 1800, grass: 1800 } };
    s.players[lose] = { ...s.players[lose], elo: { overall: 2000, hard: 2000, clay: 2000, grass: 2000 } };
    // winner dropped the first set, then a tiebreak set
    s.matches["0-0"] = { ...m, score: [{ p1: 4, p2: 6 }, { p1: 7, p2: 6, tb: 5 }, { p1: 6, p2: 3 }] };
    if (m.winner === "p2") s.matches["0-0"].score = [{ p1: 6, p2: 4 }, { p1: 6, p2: 7, tb: 5 }, { p1: 3, p2: 6 }];
    const ins = matchInsight(s, "0-0", timeOnCourt(s))!;
    expect(ins.upset).toBe(true);
    expect(ins.badges).toContain("Upset");
    expect(ins.badges).toContain("From a set down");
    expect(ins.badges.some((b) => /tiebreak/.test(b))).toBe(true);
    expect(ins.eloLine).toMatch(/ELO favoured/);
    expect(ins.p1.elo).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/state.test.ts`
Expected: FAIL — `matchInsight` not exported.

- [ ] **Step 3: Add types + `matchInsight` to `src/state.ts`**

```ts
import type { MatchStatus, SetScore } from "./model"; // merge with the existing ./model import line

export interface InsightSide {
  id: string | null; name: string; country: string;
  seed: number | null; ranking: number | null;
  elo: number | null; roundReached: number; sec: number;
}

export interface MatchInsight {
  matchId: string; roundName: string; surface: string;
  status: MatchStatus; winner: "p1" | "p2" | null;
  score: SetScore[] | null; durationSec: number | null; durationProvisional: boolean;
  p1: InsightSide; p2: InsightSide;
  badges: string[]; upset: boolean; eloLine: string;
  aces: [number, number] | null; doubleFaults: [number, number] | null;
}

function insightSide(s: Snapshot, pid: string | null, surface: string, time: Map<string, PlayerTime>): InsightSide {
  const p = pid ? s.players[pid] : null;
  const t = pid ? time.get(pid) : undefined;
  return {
    id: pid, name: p?.name ?? "TBD", country: p?.country ?? "",
    seed: p?.seed ?? null, ranking: p?.ranking ?? null,
    elo: p ? surfaceElo(p, surface) : null,
    roundReached: t?.roundReached ?? 0, sec: t?.sec ?? 0,
  };
}

/** Derive a rich, narrative match insight (badges, ELO context, per-player path) for one match. */
export function matchInsight(s: Snapshot, matchId: string, time: Map<string, PlayerTime>): MatchInsight | null {
  const m = s.matches[matchId];
  if (!m) return null;
  const surface = s.tournament.surface;
  const p1 = insightSide(s, m.p1, surface, time);
  const p2 = insightSide(s, m.p2, surface, time);
  const badges: string[] = [];
  let upset = false;
  let eloLine = "";

  if (p1.elo != null && p2.elo != null) {
    const favSide = p1.elo >= p2.elo ? "p1" : "p2";
    const fav = favSide === "p1" ? p1 : p2;
    const oth = favSide === "p1" ? p2 : p1;
    eloLine = `${surface}-ELO favoured ${fav.name} ${Math.round(winProbability(fav.elo!, oth.elo!) * 100)}%`;
    if (m.winner && m.winner !== favSide) { upset = true; badges.push("Upset"); }
  }
  if (m.winner && m.score && m.score.length) {
    const won = (set: SetScore) => (m.winner === "p1" ? set.p1 > set.p2 : set.p2 > set.p1);
    if (!won(m.score[0])) badges.push("From a set down");
    if (m.score.every(won)) badges.push("Straight sets");
    const tb = m.score.filter((set) => set.tb != null).length;
    if (tb) badges.push(`${tb} tiebreak${tb > 1 ? "s" : ""}`);
  }
  if (m.durationSec != null) {
    if (m.durationSec >= 10800) badges.push("Marathon");
    else if (m.status === "finished" && m.durationSec < 5400) badges.push("Quick");
  }

  return {
    matchId, roundName: s.rounds[m.roundIndex]?.name ?? "", surface,
    status: m.status, winner: m.winner, score: m.score,
    durationSec: m.durationSec, durationProvisional: m.durationProvisional,
    p1, p2, badges, upset, eloLine,
    aces: m.stats?.aces ?? null, doubleFaults: m.stats?.doubleFaults ?? null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state.ts src/state.test.ts
git commit -m "feat(state): matchInsight — badges, ELO context, player paths"
```

---

## Task 2: renderMatchInsight (replaces the detail card)

**Files:**
- Modify: `src/render.ts`
- Test: `src/render-detail.test.ts` (retarget)

- [ ] **Step 1: Replace the test** — overwrite `src/render-detail.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import { renderMatchInsight } from "./render";
import type { MatchInsight } from "./state";

const rounds = [
  { index: 0, name: "Round of 128", size: 128, matchIds: [] },
  { index: 5, name: "Semifinal", size: 4, matchIds: [] },
  { index: 6, name: "Final", size: 2, matchIds: [] },
];
const base: MatchInsight = {
  matchId: "6-0", roundName: "Final", surface: "Clay", status: "finished", winner: "p1",
  score: [{ p1: 4, p2: 6 }, { p1: 7, p2: 6, tb: 5 }, { p1: 6, p2: 3 }],
  durationSec: 11760, durationProvisional: false,
  p1: { id: "a", name: "Carlos Alcaraz", country: "ESP", seed: 2, ranking: 2, elo: 2106, roundReached: 7, sec: 22320 },
  p2: { id: "b", name: "Jannik Sinner", country: "ITA", seed: 1, ranking: 1, elo: 2215, roundReached: 6, sec: 19000 },
  badges: ["Upset", "From a set down", "1 tiebreak", "Marathon"], upset: true,
  eloLine: "Clay-ELO favoured Jannik Sinner 65%",
  aces: [9, 12], doubleFaults: [3, 2],
};

describe("renderMatchInsight", () => {
  it("renders matchup, flags, score, badges, ELO line, stats and links", () => {
    const html = renderMatchInsight(base, "https://www.sofascore.com/tennis/match/x/abc", "r", rounds);
    expect(html).toContain("Carlos Alcaraz");
    expect(html).toContain("Jannik Sinner");
    expect(html).toContain("🇪🇸");
    expect(html).toContain("Final");
    expect(html).toContain("7<sup>5</sup>-6"); // set-2 tiebreak on winner side
    expect(html).toContain("Upset");
    expect(html).toContain("Clay-ELO favoured");
    expect(html).toContain("12"); // sinner aces
    expect(html).toContain('href="https://www.sofascore.com/tennis/match/x/abc"');
    expect(html).toContain('data-action="focus"');
    expect(html).toContain('data-action="close-detail"');
  });

  it("tolerates a TBD side and a missing link", () => {
    const ins = { ...base, winner: null, score: null, eloLine: "", badges: [], aces: null, doubleFaults: null,
      p2: { ...base.p2, id: null, name: "TBD", elo: null } };
    const html = renderMatchInsight(ins, null, "r", rounds);
    expect(html).toContain("TBD");
    expect(html).not.toContain("Open in SofaScore");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/render-detail.test.ts`
Expected: FAIL — `renderMatchInsight` not exported.

- [ ] **Step 3: In `src/render.ts`, delete `renderMatchDetail`, `renderPlayerLine`, `renderStats`, `renderScore`** (the whole detail-card block) and add `renderMatchInsight`:

```ts
import type { InsightSide, MatchInsight } from "./state"; // merge into the existing ./state import line

function insightScore(ins: MatchInsight): string {
  if (!ins.score || !ins.score.length) return ins.status === "live" ? "Live" : "—";
  return ins.score
    .map((set) => {
      const sup = set.tb != null ? `<sup>${set.tb}</sup>` : "";
      return set.p1 >= set.p2 ? `${set.p1}${sup}-${set.p2}` : `${set.p1}-${set.p2}${sup}`;
    })
    .join(" ");
}

function insightPlayer(side: InsightSide, win: boolean, rounds: Round[]): string {
  const tag = side.seed != null ? `#${side.ranking ?? "?"} · seed ${side.seed}`
    : side.ranking != null ? `#${side.ranking}` : "";
  const path = `${roundAbbrev(side.roundReached, rounds)}${side.sec > 0 ? ` · ${formatDuration(side.sec)}` : ""}`;
  return (
    `<div class="mi-pl${win ? " mi-win" : ""}">` +
    `<span class="mi-fl">${flagEmoji(side.country)}</span>` +
    `<span class="mi-who"><b>${escapeHtml(side.name)}</b>${win ? ' <span class="mi-chk">✓</span>' : ""}` +
    `<small>${escapeHtml(tag)} · ${escapeHtml(path)}</small></span></div>`
  );
}

function statBar(label: string, v: [number, number] | null): string {
  if (!v) return "";
  const [a, b] = v, max = Math.max(1, a + b);
  return (
    `<div class="mi-stat"><span class="mi-sv">${a}</span>` +
    `<span class="mi-bar"><i style="width:${Math.round((a / max) * 100)}%"></i><i style="width:${Math.round((b / max) * 100)}%"></i></span>` +
    `<span class="mi-sv">${b}</span><span class="mi-slab">${label}</span></div>`
  );
}

/** Rich match insight rendered in the panel column (replaces the lens panel while a match is selected). */
export function renderMatchInsight(ins: MatchInsight, sofaUrl: string | null, nodeId: string, rounds: Round[]): string {
  const badges = ins.badges
    .map((b) => `<span class="mi-bdg${b === "Upset" ? " up" : ""}">${escapeHtml(b)}</span>`)
    .join("");
  const dur = ins.durationSec != null
    ? `⏱ ${formatDuration(ins.durationSec)}${ins.durationProvisional ? " (live)" : ""}` : "";
  const link = sofaUrl
    ? `<a class="mi-link" href="${sofaUrl}" target="_blank" rel="noopener noreferrer">Open in SofaScore ↗</a>` : "";
  return (
    `<aside class="panel match-insight" role="dialog" aria-label="Match insight">` +
    `<div class="mi-hd"><button class="mi-back" data-action="close-detail">‹ back</button>` +
    `<span class="mi-rnd">${escapeHtml(ins.roundName)} · ${escapeHtml(ins.surface)}</span></div>` +
    `<div class="mi-mu">${insightPlayer(ins.p1, ins.winner === "p1", rounds)}` +
    `<div class="mi-score">${insightScore(ins)}</div>` +
    `${insightPlayer(ins.p2, ins.winner === "p2", rounds)}</div>` +
    (badges ? `<div class="mi-badges">${badges}</div>` : "") +
    statBar("Aces", ins.aces) + statBar("Double faults", ins.doubleFaults) +
    (ins.eloLine ? `<div class="mi-elo">${escapeHtml(ins.eloLine)}${ins.upset ? " — upset" : ""}</div>` : "") +
    (dur ? `<div class="mi-dur">${dur}</div>` : "") +
    `<div class="mi-acts">${link}<button class="mi-focus" data-action="focus" data-id="${escapeHtml(nodeId)}">⊕ Focus this section</button></div>` +
    `</aside>`
  );
}
```

(Remove the now-unused `MatchStats`/`Player` imports from `render.ts` only if they become unused — check with `pnpm typecheck`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/render-detail.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render.ts src/render-detail.test.ts
git commit -m "feat(render): renderMatchInsight (matchup, badges, ELO, stats, paths)"
```

---

## Task 3: Route the panel to the insight; decouple inspect from zoom

**Files:**
- Modify: `src/app.ts`
- Modify: `src/render.ts` (arc action) + `src/render.test.ts`

- [ ] **Step 1: Rename the arc action** — in `src/render.ts` `renderSunburst`, change `data-action="zoom"` to `data-action="inspect"`. In `src/render.test.ts`, change the assertion `expect(svg).toContain('data-action="zoom"')` to `expect(svg).toContain('data-action="inspect"')`.

- [ ] **Step 2: Update `src/app.ts` imports + state** — add `matchInsight` to the `./state` import, `renderMatchInsight` to the `./render` import, and `sofascoreMatchUrl` is already imported. In `AppState` add `selectedNodeId: string | undefined;` and in the initial state add `selectedNodeId: undefined,`.

- [ ] **Step 3: Route the panel** — in `draw()`, change the panel computation so a selected match takes over the column:

```ts
    const panel = state.selectedMatchId && snap.matches[state.selectedMatchId]
      ? (() => {
          const mm = snap.matches[state.selectedMatchId!];
          const ins = matchInsight(snap, state.selectedMatchId!, time)!;
          const u = sofascoreMatchUrl(mm, mm.p1 ? snap.players[mm.p1] ?? null : null, mm.p2 ? snap.players[mm.p2] ?? null : null);
          return renderMatchInsight(ins, u, state.selectedNodeId ?? "r", snap.rounds);
        })()
      : state.colorDim === "seed" ? renderSeedPanel(seedInsights(snap))
      : state.colorDim === "country" ? renderCountryPanel(countryBreakdown(snap), state.selectedCountry, snap.rounds)
      : renderLeaderboard(timeLeaderboard(snap, time), color);
```

- [ ] **Step 4: Remove the old bottom-right detail** — delete the `let detail = "";` block (the `renderMatchDetail` call) and the trailing `+ detail` in the `root.innerHTML` assignment. The match now lives in `panel`.

- [ ] **Step 5: Split inspect/focus in the click handler** — replace the final `zoom`/`reset` branches:

```ts
    } else if (a === "inspect" && el.dataset.match) {
      state.selectedMatchId = el.dataset.match;
      state.selectedNodeId = id;
      draw();
    } else if (a === "focus" && el.dataset.id) {
      state.focusId = el.dataset.id;
      draw();
    } else if (a === "close-detail") {
      state.selectedMatchId = undefined;
      draw();
    } else if (a === "reset" || (id && id === state.focusId)) {
      state.focusId = undefined;
      state.selectedMatchId = undefined;
      draw();
    }
```

(Remove the old separate `close-detail` and `zoom` branches if duplicated — there must be exactly one of each.)

- [ ] **Step 6: Clear the selection on lens/slam/tour/year change** — wherever `state.selectedCountry = undefined;` / `state.focusId = undefined;` are reset (lens switch, `selectForTour`, slam/year branches), also set `state.selectedMatchId = undefined; state.selectedNodeId = undefined;`.

- [ ] **Step 7: Typecheck + full suite**

Run: `pnpm typecheck && pnpm test`
Expected: clean + all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app.ts src/render.ts src/render.test.ts
git commit -m "feat(app): match insight in panel; inspect/zoom decoupled"
```

---

## Task 4: Match insight styling + visual smoke

**Files:**
- Modify: `src/app.css`

- [ ] **Step 1: Append styles to `src/app.css`** (and remove the now-unused `.detail`/`.md-*` rules if present):

```css
.match-insight { display: flex; flex-direction: column; gap: 10px; }
.mi-hd { display: flex; align-items: center; justify-content: space-between; }
.mi-back { background: none; border: none; color: var(--dim); cursor: pointer; font-size: 12px; padding: 0; }
.mi-rnd { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--teal); font-weight: 600; }
.mi-mu { display: grid; gap: 6px; }
.mi-pl { display: grid; grid-template-columns: 22px 1fr; gap: 8px; align-items: center; padding: 6px 8px; border-radius: 8px; background: #0e151d; }
.mi-pl.mi-win { box-shadow: inset 2px 0 0 var(--teal); }
.mi-fl { font-size: 17px; }
.mi-who b { font-size: 13.5px; } .mi-who small { display: block; color: var(--dim); font-size: 11px; }
.mi-chk { color: var(--teal); }
.mi-score { text-align: center; font-variant-numeric: tabular-nums; font-weight: 700; letter-spacing: 1px; }
.mi-score sup { font-size: 9px; color: var(--dim); }
.mi-badges { display: flex; flex-wrap: wrap; gap: 6px; }
.mi-bdg { font-size: 11px; padding: 3px 8px; border-radius: 7px; background: #13202a; border: 1px solid var(--line); }
.mi-bdg.up { border-color: var(--accent); color: #ffb59c; }
.mi-stat { display: grid; grid-template-columns: 26px 1fr 26px; gap: 6px; align-items: center; font-size: 12px; font-variant-numeric: tabular-nums; }
.mi-stat .mi-slab { grid-column: 1 / -1; text-align: center; font-size: 10px; text-transform: uppercase; color: var(--dim); }
.mi-bar { display: flex; height: 7px; background: #0e151d; border-radius: 4px; overflow: hidden; }
.mi-bar i { background: #5a6b7d; } .mi-bar i:first-child { background: var(--teal); margin-right: auto; }
.mi-elo { font-size: 12px; color: var(--dim); background: #0e151d; border-radius: 8px; padding: 8px 10px; }
.mi-dur { font-size: 12px; color: var(--dim); }
.mi-acts { display: flex; gap: 8px; margin-top: 2px; }
.mi-link, .mi-focus { flex: 1; text-align: center; font-size: 12px; padding: 9px; border-radius: 9px; cursor: pointer; text-decoration: none; }
.mi-link { background: var(--teal); color: #04211f; font-weight: 700; }
.mi-focus { background: transparent; border: 1px solid var(--line); color: var(--dim); }
```

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: clean + succeeds.

- [ ] **Step 3: Visual smoke** (manual — `pnpm dev`)

- Tap a match arc → the panel becomes the insight (matchup w/ flags + seed/rank, set scores, badges, aces/DF bars, ELO line, each player's round + time, SofaScore link). "‹ back" returns to the lens panel.
- Tapping the arc does **not** zoom; "⊕ Focus this section" zooms into that subtree; tapping the centre zooms out.
- Switching lens/slam/tour clears the open match.

- [ ] **Step 4: Commit any tuning**

```bash
git add src/app.css
git commit -m "style(match-insight): panel card, badges, stat bars"
```

---

## Self-review

**Spec coverage** (spec §7):
- Rich match content (matchup+flags, set scores, auto-badges, aces/DF bars, ELO context, player path) → Tasks 1-2.
- Placement: insight replaces the lens panel (side panel desktop / stacked on mobile via existing responsive CSS) with "back" → Task 3.
- Interaction: inspect decoupled from zoom (tap=inspect; Focus button=zoom; centre=zoom out) → Tasks 3.
- SofaScore deep-link retained → Task 2.

**Placeholder scan:** none.

**Type consistency:** `MatchInsight`/`InsightSide` (Task 1) consumed by `renderMatchInsight` (Task 2) and the `draw()` panel router (Task 3); `roundAbbrev`/`flagEmoji`/`formatDuration`/`escapeHtml` reused from earlier plans; `data-action="inspect"`/`"focus"`/`"close-detail"` emitted (Tasks 2-3) all handled in the Task 3 click handler; arc action renamed consistently in `render.ts` + `render.test.ts`.

**Notes for the executor:**
- Removing `renderMatchDetail`/`renderScore`/`renderStats`/`renderPlayerLine` may free up imports (`MatchStats`, `Player`) in `render.ts` — drop any that `noUnusedLocals` flags.
- The match insight reuses the existing responsive panel column, so no separate mobile "sheet" code is needed (the column already stacks below the wheel under the `max-width:720px` media query).
- Player birthdates/age + the 🎂 feature are **Plan 6** (retrofit into this card + the readout).
