# TennisArc Lens Panels + Flags — Implementation Plan (4 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Prerequisite:** Plans 1–3 merged. Builds on the post-Plan-3 `state.ts` (surfaceElo/winProbability/labelAnchors), `render.ts` (renderSunburst labels, renderReadout), `color.ts`, and `app.ts` (draw + colorDim + readout/hover).

**Goal:** Make each colour mode a real **lens** with its own side panel — Time (existing leaderboard), Seed (seeds-still-in + ELO upsets), Country (nation breakdown with **flags** + select-to-highlight) — so "Most time on court" only shows on Time, and the nationality view becomes genuinely useful.

**Architecture:** New pure `flags.ts` (ISO-3→emoji flag) and `state.ts` insight builders (`seedInsights`, `countryBreakdown`); `color.ts` country dimension becomes neutral + selected-country highlight; `render.ts` gains `renderSeedPanel`/`renderCountryPanel` and flags retrofit into the leaderboard + readout; `app.ts` routes the panel by `colorDim`, tracks `selectedCountry`, and shows flag labels on the Country lens.

**Tech Stack:** TypeScript (strict, ESM), Vitest. Flags use Unicode regional-indicator **emoji** (zero assets, render on macOS/iOS/Android). Cross-platform SVG flags are a documented follow-up (emoji flags don't render on Windows).

**Spec:** [`../specs/2026-06-09-tennisarc-ux-overhaul-design.md`](../specs/2026-06-09-tennisarc-ux-overhaul-design.md) §3, §8.

---

## File structure

**New**
- `src/flags.ts` — `iso3to2`, `flagEmoji` (ISO-3 → ISO-2 → regional-indicator emoji).
- `src/flags.test.ts`

**Modified**
- `src/state.ts` — `Upset`, `seedInsights`; `NationRow`, `countryBreakdown`; `eliminatedSet` helper.
- `src/state.test.ts`
- `src/color.ts` — country dimension takes a selected country (neutral + highlight).
- `src/color.test.ts`
- `src/render.ts` — `renderSeedPanel`, `renderCountryPanel`; flags in `renderLeaderboard` + `renderReadout`.
- `src/render.test.ts`
- `src/app.ts` — panel routing by `colorDim`; `selectedCountry` state + country-select event; flag labels on Country lens; pass selected country to `colorScale`.
- `src/app.css` — panel + flag + highlight styles.

---

## Task 1: Flag emoji helper

**Files:**
- Create: `src/flags.ts`
- Test: `src/flags.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/flags.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { iso3to2, flagEmoji } from "./flags";

describe("iso3to2", () => {
  it("maps ISO-3 (and common IOC variants) to ISO-2", () => {
    expect(iso3to2("ESP")).toBe("ES");
    expect(iso3to2("DEU")).toBe("DE");
    expect(iso3to2("GBR")).toBe("GB");
    expect(iso3to2("CHE")).toBe("CH");
    expect(iso3to2("SUI")).toBe("CH"); // IOC alias
    expect(iso3to2("zzz")).toBeNull();
  });
});

describe("flagEmoji", () => {
  it("produces the regional-indicator flag, or a white flag fallback", () => {
    expect(flagEmoji("ESP")).toBe("🇪🇸");
    expect(flagEmoji("USA")).toBe("🇺🇸");
    expect(flagEmoji("???")).toBe("🏳");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/flags.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/flags.ts`**

```ts
// ISO 3166-1 alpha-3 → alpha-2 for nations that appear in Grand Slam draws.
// A few IOC aliases (SUI, GER, NED, DEN, CRO, BUL, SLO, RSA) are included because
// some feeds use IOC rather than ISO codes. Unknown codes fall back to a white flag.
const ISO3_TO_2: Record<string, string> = {
  ESP: "ES", FRA: "FR", ITA: "IT", DEU: "DE", GER: "DE", GBR: "GB", USA: "US",
  SRB: "RS", RUS: "RU", CHE: "CH", SUI: "CH", AUT: "AT", AUS: "AU", ARG: "AR",
  BRA: "BR", CAN: "CA", CHN: "CN", JPN: "JP", KAZ: "KZ", GRC: "GR", NOR: "NO",
  DNK: "DK", DEN: "DK", SWE: "SE", NLD: "NL", NED: "NL", BEL: "BE", POL: "PL",
  CZE: "CZ", SVK: "SK", HRV: "HR", CRO: "HR", BGR: "BG", BUL: "BG", HUN: "HU",
  ROU: "RO", PRT: "PT", POR: "PT", FIN: "FI", UKR: "UA", BLR: "BY", GEO: "GE",
  CHL: "CL", COL: "CO", PER: "PE", URY: "UY", PRY: "PY", ECU: "EC", BOL: "BO",
  VEN: "VE", MEX: "MX", IND: "IN", KOR: "KR", TWN: "TW", TPE: "TW", THA: "TH",
  HKG: "HK", ISR: "IL", TUR: "TR", EGY: "EG", TUN: "TN", MAR: "MA", ZAF: "ZA",
  RSA: "ZA", NZL: "NZ", MDA: "MD", BIH: "BA", SVN: "SI", SLO: "SI", EST: "EE",
  LVA: "LV", LTU: "LT", CYP: "CY", LUX: "LU", MCO: "MC", SMR: "SM", SAU: "SA",
  UZB: "UZ", LBN: "LB", JOR: "JO",
};

/** ISO-3 (or common IOC) → ISO-2, or null if unknown. */
export function iso3to2(code: string): string | null {
  return ISO3_TO_2[code.toUpperCase()] ?? null;
}

/** A country's flag emoji (regional-indicator pair), or 🏳 when the code is unknown. */
export function flagEmoji(iso3: string): string {
  const a2 = iso3to2(iso3);
  if (!a2) return "🏳";
  return String.fromCodePoint(...[...a2].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/flags.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/flags.ts src/flags.test.ts
git commit -m "feat(flags): ISO-3 → regional-indicator flag emoji"
```

---

## Task 2: Seed insights (seeds remaining + ELO upsets)

**Files:**
- Modify: `src/state.ts`
- Test: `src/state.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/state.test.ts`:

```ts
import { seedInsights } from "./state";

describe("seedInsights", () => {
  it("counts seeded players still in and flags ELO upsets", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 2 });
    // give two players elo so an upset is detectable on the first match
    const ids = Object.keys(s.players);
    const m = s.matches["0-0"];
    const win = m.winner === "p1" ? m.p1! : m.p2!;
    const lose = m.winner === "p1" ? m.p2! : m.p1!;
    s.players[win] = { ...s.players[win], elo: { overall: 1800, hard: 1800, clay: 1800, grass: 1800 } };
    s.players[lose] = { ...s.players[lose], elo: { overall: 2000, hard: 2000, clay: 2000, grass: 2000 }, seed: 1 };
    const out = seedInsights(s);
    expect(out.seedsTotal).toBeGreaterThan(0);
    expect(out.seedsRemaining).toBeLessThanOrEqual(out.seedsTotal);
    const up = out.upsets.find((u) => u.winnerId === win && u.loserId === lose);
    expect(up).toBeTruthy();
    expect(up!.eloGap).toBeCloseTo(200, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/state.test.ts`
Expected: FAIL — `seedInsights` not exported.

- [ ] **Step 3: Add `eliminatedSet`, `Upset`, `seedInsights` to `src/state.ts`**

```ts
/** Players who lost a decided (finished/retired/walkover) match. */
export function eliminatedSet(s: Snapshot): Set<string> {
  const out = new Set<string>();
  for (const m of Object.values(s.matches)) {
    if (m.winner == null) continue;
    const loser = m.winner === "p1" ? m.p2 : m.p1;
    if (loser) out.add(loser);
  }
  return out;
}

export interface Upset {
  winnerId: string; winnerName: string; loserId: string; loserName: string;
  loserSeed: number | null; roundName: string; eloGap: number; // loser elo − winner elo (>0)
}

export interface SeedInsights { seedsTotal: number; seedsRemaining: number; upsets: Upset[]; }

/** Seeds still alive + biggest upsets (winner was the surface-ELO underdog), strongest first. */
export function seedInsights(s: Snapshot, limit = 8): SeedInsights {
  const out = eliminatedSet(s);
  const seeded = Object.values(s.players).filter((p) => p.seed != null);
  const surface = s.tournament.surface;
  const upsets: Upset[] = [];
  for (const m of Object.values(s.matches)) {
    if (m.winner == null) continue;
    const winId = m.winner === "p1" ? m.p1 : m.p2;
    const loseId = m.winner === "p1" ? m.p2 : m.p1;
    if (!winId || !loseId) continue;
    const w = s.players[winId], l = s.players[loseId];
    if (!w || !l) continue;
    const ew = surfaceElo(w, surface), el = surfaceElo(l, surface);
    if (ew == null || el == null || el <= ew) continue; // upset only when winner was the ELO underdog
    upsets.push({
      winnerId: winId, winnerName: w.name, loserId: loseId, loserName: l.name,
      loserSeed: l.seed, roundName: s.rounds[m.roundIndex]?.name ?? "", eloGap: el - ew,
    });
  }
  upsets.sort((a, b) => b.eloGap - a.eloGap);
  return {
    seedsTotal: seeded.length,
    seedsRemaining: seeded.filter((p) => !out.has(p.id)).length,
    upsets: upsets.slice(0, limit),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state.ts src/state.test.ts
git commit -m "feat(state): seedInsights — seeds remaining + ELO upsets"
```

---

## Task 3: Country breakdown

**Files:**
- Modify: `src/state.ts`
- Test: `src/state.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/state.test.ts`:

```ts
import { countryBreakdown } from "./state";

describe("countryBreakdown", () => {
  it("groups players by country with entrants + still-in counts, ranked", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    // force two known countries
    const ids = Object.keys(s.players);
    ids.forEach((id, i) => { s.players[id] = { ...s.players[id], country: i < 5 ? "ESP" : "FRA" }; });
    const rows = countryBreakdown(s);
    const esp = rows.find((r) => r.country === "ESP")!;
    expect(esp.entrants).toBe(5);
    expect(esp.stillIn).toBeLessThanOrEqual(esp.entrants);
    expect(esp.players.length).toBe(5);
    // ranked by stillIn desc then entrants desc
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i];
      expect(a.stillIn > b.stillIn || (a.stillIn === b.stillIn && a.entrants >= b.entrants)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/state.test.ts`
Expected: FAIL — `countryBreakdown` not exported.

- [ ] **Step 3: Add `NationRow` + `countryBreakdown` to `src/state.ts`**

```ts
export interface NationPlayer { id: string; name: string; roundReached: number; alive: boolean; }
export interface NationRow { country: string; entrants: number; stillIn: number; players: NationPlayer[]; }

/** Per-country breakdown: entrants, players still in, and each player's furthest round. */
export function countryBreakdown(s: Snapshot): NationRow[] {
  const out = eliminatedSet(s);
  const reached = new Map<string, number>();
  for (const m of Object.values(s.matches)) {
    for (const side of ["p1", "p2"] as const) {
      const pid = m[side];
      if (!pid) continue;
      const r = m.winner === side ? m.roundIndex + 1 : m.roundIndex;
      if (r > (reached.get(pid) ?? -1)) reached.set(pid, r);
    }
  }
  const byCountry = new Map<string, NationRow>();
  for (const p of Object.values(s.players)) {
    const c = p.country || "—";
    let row = byCountry.get(c);
    if (!row) { row = { country: c, entrants: 0, stillIn: 0, players: [] }; byCountry.set(c, row); }
    const alive = !out.has(p.id);
    row.entrants++;
    if (alive) row.stillIn++;
    row.players.push({ id: p.id, name: p.name, roundReached: reached.get(p.id) ?? 0, alive });
  }
  for (const row of byCountry.values()) row.players.sort((a, b) => b.roundReached - a.roundReached);
  return [...byCountry.values()].sort(
    (a, b) => b.stillIn - a.stillIn || b.entrants - a.entrants || a.country.localeCompare(b.country),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state.ts src/state.test.ts
git commit -m "feat(state): countryBreakdown — nations by players-still-in"
```

---

## Task 4: Country lens colouring (neutral + highlight)

**Files:**
- Modify: `src/color.ts`
- Test: `src/color.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/color.test.ts` (merge the import with any existing `./color` import):

```ts
import { colorScale } from "./color";
import { makeSyntheticSnapshot } from "./fixtures/synthetic";
import { timeOnCourt } from "./state";

describe("colorScale country lens", () => {
  it("highlights the selected country and mutes the rest", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const ids = Object.keys(s.players);
    s.players[ids[0]] = { ...s.players[ids[0]], country: "ESP" };
    s.players[ids[1]] = { ...s.players[ids[1]], country: "FRA" };
    const time = timeOnCourt(s);
    const sel = colorScale("country", s, time, "ESP");
    const none = colorScale("country", s, time);
    expect(sel(ids[0])).not.toBe(sel(ids[1])); // ESP highlighted, FRA muted
    expect(none(ids[0])).toBe(none(ids[1]));   // no selection → both muted (same colour)
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/color.test.ts`
Expected: FAIL — `colorScale` ignores the 4th arg.

- [ ] **Step 3: Update `colorScale` in `src/color.ts`**

Add the constants near the top (after `NEUTRAL`):

```ts
const COUNTRY_MUTED = "#2c3744";
const COUNTRY_HL = "#4ea1ff";
```

Change the signature and the country branch. Replace the function signature line:

```ts
export function colorScale(dim: ColorDim, s: Snapshot, time: Map<string, PlayerTime>): ColorFn {
```

with:

```ts
export function colorScale(
  dim: ColorDim, s: Snapshot, time: Map<string, PlayerTime>, selectedCountry?: string,
): ColorFn {
```

and replace the entire `// country` branch (the sorted-domain ordinal block) with:

```ts
  // country — neutral wheel; the selected nation lights up (flags carry identity)
  return (id) => {
    const c = id ? s.players[id]?.country : null;
    if (!c) return NEUTRAL;
    return selectedCountry && c === selectedCountry ? COUNTRY_HL : COUNTRY_MUTED;
  };
```

(The `d3-scale`/`scaleOrdinal` import and `CATEGORICAL` may now be unused — remove `scaleOrdinal` from the import and delete `CATEGORICAL` if so, to keep typecheck clean under `noUnusedLocals`.)

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm test src/color.test.ts && pnpm typecheck`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add src/color.ts src/color.test.ts
git commit -m "feat(color): country lens = neutral + selected-nation highlight"
```

---

## Task 5: Seed + Country panels; flags in leaderboard & readout

**Files:**
- Modify: `src/render.ts`
- Test: `src/render.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/render.test.ts`:

```ts
import { renderSeedPanel, renderCountryPanel } from "./render";
import type { SeedInsights, NationRow } from "./state";

describe("renderSeedPanel", () => {
  const ins: SeedInsights = {
    seedsTotal: 32, seedsRemaining: 11,
    upsets: [{ winnerId: "a", winnerName: "Bublik", loserId: "b", loserName: "Medvedev", loserSeed: 6, roundName: "Round of 16", eloGap: 120 }],
  };
  it("shows seeds-in count and upset rows", () => {
    const html = renderSeedPanel(ins);
    expect(html).toContain("11");
    expect(html).toContain("Bublik");
    expect(html).toContain("Medvedev");
  });
});

describe("renderCountryPanel", () => {
  const rows: NationRow[] = [
    { country: "ITA", entrants: 4, stillIn: 1, players: [{ id: "x", name: "Sinner", roundReached: 5, alive: true }] },
  ];
  it("renders a nation row with flag, counts and select action; expands the selected one", () => {
    const html = renderCountryPanel(rows, "ITA");
    expect(html).toContain("🇮🇹");
    expect(html).toContain('data-action="country"');
    expect(html).toContain('data-country="ITA"');
    expect(html).toContain("Sinner"); // expanded because ITA is selected
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/render.test.ts`
Expected: FAIL — `renderSeedPanel`/`renderCountryPanel` not exported.

- [ ] **Step 3: Implement in `src/render.ts`**

Add the import at the top:

```ts
import { flagEmoji } from "./flags";
import type { LeaderRow, SeedInsights, NationRow } from "./state";
```

(merge `LeaderRow` with the existing `./state` import line — do not duplicate it).

In `renderLeaderboard`, replace the country span:

```ts
        `<span class="lb-name">${escapeHtml(r.name)} <span class="lb-ctry">${escapeHtml(r.country)}</span></span>` +
```

with (flag + code):

```ts
        `<span class="lb-name">${escapeHtml(r.name)} <span class="lb-ctry">${flagEmoji(r.country)} ${escapeHtml(r.country)}</span></span>` +
```

In `renderReadout`, replace the `ro-ctry` line:

```ts
    `<div class="ro-ctry">${escapeHtml(info.country)}</div>` +
```

with:

```ts
    `<div class="ro-ctry">${flagEmoji(info.country)} ${escapeHtml(info.country)}</div>` +
```

Append the two panel renderers:

```ts
export function renderSeedPanel(ins: SeedInsights): string {
  const pct = ins.seedsTotal ? Math.round((ins.seedsRemaining / ins.seedsTotal) * 100) : 0;
  const rows = ins.upsets
    .map((u) =>
      `<li class="up-row">` +
      `<span class="up-bolt">⚡</span>` +
      `<span class="up-m"><b>${escapeHtml(u.winnerName)}</b> <small>d. ${u.loserSeed != null ? `[${u.loserSeed}] ` : ""}${escapeHtml(u.loserName)}</small></span>` +
      `<span class="up-rd">${escapeHtml(u.roundName)}</span>` +
      `</li>`)
    .join("");
  return (
    `<aside class="panel seed-panel">` +
    `<div class="seeds-in"><div class="seeds-top"><span>Seeds still in</span><b>${ins.seedsRemaining} / ${ins.seedsTotal}</b></div>` +
    `<div class="seeds-track"><span style="width:${pct}%"></span></div></div>` +
    (rows ? `<div class="panel-sub">Biggest upsets</div><ol class="up-list">${rows}</ol>` : `<div class="panel-empty">No upsets yet</div>`) +
    `</aside>`
  );
}

export function renderCountryPanel(rows: NationRow[], selected?: string): string {
  const items = rows
    .map((r) => {
      const on = selected === r.country;
      const head =
        `<li class="ct-row${on ? " on" : ""}" data-action="country" data-country="${escapeHtml(r.country)}">` +
        `<span class="ct-flag">${flagEmoji(r.country)}</span>` +
        `<span class="ct-name">${escapeHtml(r.country)}</span>` +
        `<span class="ct-cnt"><b>${r.stillIn}</b>/${r.entrants}</span></li>`;
      if (!on) return head;
      const expand = r.players
        .map((p) =>
          `<div class="ct-pl"><b>${escapeHtml(p.name)}</b>` +
          `<span class="ct-rd${p.alive ? " alive" : ""}">${p.alive ? "in · " : ""}R${p.roundReached}</span></div>`)
        .join("");
      return head + `<li class="ct-expand">${expand}</li>`;
    })
    .join("");
  return `<aside class="panel country-panel"><div class="panel-sub">Nations — still in</div><ol class="ct-list">${items}</ol></aside>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/render.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render.ts src/render.test.ts
git commit -m "feat(render): seed + country panels; flags in leaderboard & readout"
```

---

## Task 6: Wire the lens panels + country highlight into the app

Integration (verified by `pnpm typecheck` + the pure tests + smoke).

**Files:**
- Modify: `src/app.ts`

- [ ] **Step 1: Update imports** — extend the `./state` and `./render` imports:

```ts
import { buildSunburst, timeOnCourt, timeLeaderboard, labelAnchors, surfaceElo, seedInsights, countryBreakdown, type PlayerTime } from "./state";
import {
  renderSunburst, renderControls, renderLegend, renderLeaderboard, renderMatchDetail, renderReadout,
  renderSeedPanel, renderCountryPanel, type ReadoutInfo,
} from "./render";
import { flagEmoji } from "./flags";
```

- [ ] **Step 2: Add `selectedCountry` to `AppState`** — in the interface add `selectedCountry: string | undefined;` and in the initial state object add `selectedCountry: undefined,`.

- [ ] **Step 3: Make labels lens-aware + route the panel in `draw()`**

Replace:

```ts
    const color = colorScale(state.colorDim, snap, time);
    const lb = timeLeaderboard(snap, time);
    const anchors = labelAnchors(tree);
    anchors.delete(tree.id); // champion is named by the centre readout — skip its cramped on-arc label
    const labelText = (occ: string) => surname(snap.players[occ]?.name ?? occ);
```

with:

```ts
    const color = colorScale(state.colorDim, snap, time, state.selectedCountry);
    const anchors = labelAnchors(tree);
    anchors.delete(tree.id); // champion is named by the centre readout — skip its cramped on-arc label
    const labelText = (occ: string) =>
      state.colorDim === "country"
        ? flagEmoji(snap.players[occ]?.country ?? "")
        : surname(snap.players[occ]?.name ?? occ);
    const panel =
      state.colorDim === "seed" ? renderSeedPanel(seedInsights(snap))
      : state.colorDim === "country" ? renderCountryPanel(countryBreakdown(snap), state.selectedCountry)
      : renderLeaderboard(timeLeaderboard(snap, time), color);
```

Then replace the leaderboard line in the stage markup:

```ts
        renderLeaderboard(lb, color) +
```

with:

```ts
        panel +
```

- [ ] **Step 4: Add the country-select handler** — in the click handler, after the `colordim` branch, add a `country` branch:

```ts
    } else if (a === "colordim" && el.dataset.dim) {
      state.colorDim = el.dataset.dim as ColorDim;
      if (state.colorDim !== "country") state.selectedCountry = undefined;
      draw();
    } else if (a === "country" && el.dataset.country) {
      state.selectedCountry = state.selectedCountry === el.dataset.country ? undefined : el.dataset.country;
      draw();
```

(Replace the existing `colordim` branch with the version above; the original was `state.colorDim = el.dataset.dim as ColorDim; draw();`.)

- [ ] **Step 5: Reset `selectedCountry` on slam/tour/year change** — in `selectForTour` and in the `slam`/`year` click branches, set `state.selectedCountry = undefined;` alongside the existing `state.focusId = undefined;` lines.

- [ ] **Step 6: Typecheck + full suite**

Run: `pnpm typecheck && pnpm test`
Expected: clean + all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app.ts
git commit -m "feat(app): lens-routed panels + country select-to-highlight"
```

---

## Task 7: Panel + flag styles, and visual smoke

**Files:**
- Modify: `src/app.css`

- [ ] **Step 1: Append styles to `src/app.css`**

```css
/* lens panels share the leaderboard column */
.panel { width: 280px; max-width: 38vw; overflow-y: auto; }
.panel-sub { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--dim); margin: 6px 2px 8px; }
.panel-empty { color: var(--dim); font-size: 13px; padding: 8px 2px; }

/* seed panel */
.seeds-in { background: #0e151d; border-radius: 8px; padding: 8px 10px; margin-bottom: 6px; }
.seeds-top { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 5px; }
.seeds-top b { color: var(--teal); }
.seeds-track { height: 7px; background: #1d2a36; border-radius: 4px; overflow: hidden; }
.seeds-track span { display: block; height: 100%; background: var(--teal); }
.up-list { list-style: none; margin: 0; padding: 0; }
.up-row { display: grid; grid-template-columns: 16px 1fr auto; gap: 8px; align-items: center; padding: 6px 2px; border-bottom: 1px solid #1b2430; font-size: 12.5px; }
.up-bolt { color: var(--accent); }
.up-m small { color: var(--dim); }
.up-rd { font-size: 10px; color: var(--dim); text-transform: uppercase; }

/* country panel */
.ct-list { list-style: none; margin: 0; padding: 0; }
.ct-row { display: grid; grid-template-columns: 20px 1fr auto; gap: 9px; align-items: center; padding: 6px 4px; border-bottom: 1px solid #1b2430; font-size: 13px; cursor: pointer; border-radius: 6px; }
.ct-row:hover { background: #1b2733; }
.ct-row.on { background: rgba(78,161,255,.14); box-shadow: inset 2px 0 0 #4ea1ff; }
.ct-flag { font-size: 15px; }
.ct-cnt { font-variant-numeric: tabular-nums; color: var(--dim); font-size: 12px; }
.ct-cnt b { color: #4ea1ff; }
.ct-expand { list-style: none; padding: 2px 4px 8px 30px; border-bottom: 1px solid #1b2430; }
.ct-pl { display: flex; justify-content: space-between; font-size: 12px; padding: 3px 0; color: var(--dim); }
.ct-pl b { color: var(--text); font-weight: 600; }
.ct-rd { font-size: 10.5px; text-transform: uppercase; }
.ct-rd.alive { color: var(--teal); }
```

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: `tsc --noEmit` clean + `vite build` succeeds.

- [ ] **Step 3: Visual smoke** (manual — `pnpm dev`)

- Time lens → "Most time on court" (with flags now).
- Seed lens → "Seeds still in N/32" + upset rows; no leaderboard.
- Country lens → grey wheel + flags on arcs; the nation list; click a nation → its arcs light up, the centre/panel reflect it, the row expands to players. Clicking again clears.
- Switching lens off Country clears the highlight.

- [ ] **Step 4: Commit any tuning**

```bash
git add src/app.css
git commit -m "style(panels): seed + country lens panel styling"
```

---

## Self-review

**Spec coverage** (spec §3, §8):
- Three lenses, three panels; "Most time on court" only on Time → Tasks 5-6.
- Seed lens = seeds-in + ELO upsets → Tasks 2, 5-6.
- Country lens = flags + nation breakdown + select-to-highlight → Tasks 1, 3, 4, 5-6.
- Flags in readout + leaderboard → Tasks 1, 5.
- Country colour = neutral + highlight (not a 33-way rainbow) → Task 4.

**Placeholder scan:** none.

**Type consistency:** `flagEmoji` (Task 1) used in Tasks 5-6; `SeedInsights`/`Upset` (Task 2) and `NationRow`/`NationPlayer` (Task 3) consumed by `renderSeedPanel`/`renderCountryPanel` (Task 5) and `app.ts` (Task 6); `colorScale(dim, s, time, selectedCountry?)` (Task 4) matches the Task 6 call; `data-action="country"`/`data-country` emitted in Task 5 is handled in Task 6.

**Notes for the executor:**
- Flags are **emoji** (great on macOS/iOS/Android; render as letter-boxes on Windows). Cross-platform SVG flags (`flag-icons`) are a documented follow-up, not in scope here.
- The Country lens shows flags **instead of surnames** on arcs (identity via flag); Time/Seed keep surnames.
- The match card (`renderMatchDetail`) is unchanged — Plan 5 reworks it.
