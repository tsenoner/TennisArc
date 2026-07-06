# P1 Remainder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out the P1 remainder of the 2026-07 roadmap: issues #37, #9, #11, #7 plus the Help "Reading the wheel" section, prefers-color-scheme default theme, and document.title/OG tags.

**Architecture:** Seven independent, small tasks on one branch (`worktree-p1-remainder`, off origin/main). Two are deletions (#37 dead script, #9 dead field), two are hygiene (#11 escaping + de-assertion, OG/meta), three are small features (nation centre readout #7, system-preference theme default, Help section). Each task is its own commit with its own test cycle.

**Tech Stack:** Vite + TypeScript (vanilla DOM), Vitest (jsdom for app tests, TZ pinned to UTC by vite.config.ts `test.env`).

## Global Constraints

- Test command: `npx vitest run` (all), `npx vitest run <file>` (single). Typecheck: `npm run typecheck` (tsc --noEmit).
- All HTML built by string templates must escape interpolations with `escapeHtml` (src/render.ts convention).
- Country display convention is the ISO3 code + flag image (`flagImg(country, h)`), as in `renderCountryPanel`/`renderReadout` — there is no ISO3→display-name map; do not add one.
- Deployed URL for absolute OG values: `https://tennisarc.vercel.app`.
- Commit after every task; message style follows repo convention (`fix(scope): …`, `feat(scope): …`, `chore(scope): …`, `docs: …`).

---

### Task 1: #37 — delete orphaned `ingest/points/round-extraction.ts`

Option A from the issue (preferred there): the debug use case is superseded by `engine.ts --p=`, and the file's private exit-round logic has already drifted (no BYE refinement).

**Files:**
- Delete: `ingest/points/round-extraction.ts`
- Modify: `ingest/points/shared.ts:1-4` (header comment mentions the file)

**Interfaces:** none — nothing imports the deleted file (verified: only its own header and `shared.ts:4` mention it; no package.json script references it).

- [ ] **Step 1: Delete the file and fix the shared.ts header**

```bash
git rm ingest/points/round-extraction.ts
```

In `ingest/points/shared.ts`, the header line 4 currently ends:

```
// inline as an independent transcription cross-check). round-extraction.ts also imports isQ/norm from here.
```

Remove the trailing sentence so it ends:

```
// inline as an independent transcription cross-check).
```

- [ ] **Step 2: Verify no dangling references and clean typecheck**

Run: `grep -rn "round-extraction" --include="*.ts" --include="*.json" . | grep -v node_modules` → expect no output.
Run: `npm run typecheck` → expect exit 0.
Run: `npx vitest run` → expect all pass (509 passed / 2 skipped baseline).

- [ ] **Step 3: Commit**

```bash
git add -A ingest/points
git commit -m "chore(points): delete orphaned round-extraction.ts (#37) — exit logic lives once in shared.ts"
```

---

### Task 2: #9 — retire `Player.ageYears`

Decision: **drop the field** (issue option 1; matches roadmap phrasing "retire ageYears"). Age is computed from `birthdate` via `ageOn` everywhere the UI reads it; nothing reads `ageYears`. Old published snapshots that still carry the JSON key are unaffected — unknown keys are ignored on read.

**Files:**
- Modify: `src/model.ts:43` (drop field from `Player`)
- Modify: `ingest/normalize.ts:93` (drop `ageYears: null` from the literal)
- Modify: `ingest/elo.ts` (drop from `EloEntry` ~line 19, drop `cells[2]` parse ~line 40, drop backfill ~line 69, fix `applyElo` doc comment "attach ELO and back-fill age" → "attach ELO")
- Modify: `src/fixtures/synthetic.ts:37` (drop from fixture literal)
- Modify test fixture literals that name the field: `src/state.test.ts:8,349,366,383`, `ingest/enrich.test.ts:13,14,196,303`, `ingest/players.test.ts:9`, `src/deeplink.test.ts:6` (and any `ingest/elo.test.ts` expectations tsc/vitest flags)

**Interfaces:** `Player` loses `ageYears: number | null`; `EloEntry` loses `ageYears`. No consumer exists.

- [ ] **Step 1: Remove the field from model + ingest + fixtures**

Delete `ageYears: number | null;` from `Player` in `src/model.ts`. Delete `ageYears` from `EloEntry`, its `numOrNull(cells[2])` population, and the `if (p.ageYears == null && entry.ageYears != null) p.ageYears = entry.ageYears;` backfill in `ingest/elo.ts`. Delete the `ageYears:` property from every object literal listed above.

- [ ] **Step 2: Let the compiler find stragglers**

Run: `npm run typecheck`
Expected: errors only at any literal still naming `ageYears` — fix each by deleting the property, re-run until exit 0.

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run` → expect all pass.

- [ ] **Step 4: Commit**

```bash
git add -A src ingest
git commit -m "chore(model): retire Player.ageYears (#9) — age derives from birthdate via ageOn"
```

---

### Task 3: #11 — escape the SofaScore href; drop `matchInsight`'s non-null assertions

The `seedInsights` half of the issue is already gone (function no longer exists). Remaining: `render.ts:802` interpolates `sofaUrl` into `href` unescaped, and `matchInsight` (src/state.ts) uses `fav.elo!`/`oth.elo!` three times.

**Files:**
- Modify: `src/render.ts:801-802` (escape)
- Modify: `src/state.ts` `matchInsight` favourite block (~lines 625-633)
- Test: `src/render-detail.test.ts` (new escaping test)

**Interfaces:** none change — `renderMatchDetail(ins, sofaUrl, rounds, nowSec)` and `matchInsight(...)` keep their signatures and output.

- [ ] **Step 1: Write the failing escaping test**

In `src/render-detail.test.ts` (match its existing helpers for building a `MatchInsight`), add:

```ts
it("escapes the SofaScore URL in the link href", () => {
  const html = renderMatchDetail(baseInsight(), 'https://www.sofascore.com/tennis/match/a-b/x"><script>alert(1)</script>', ROUNDS, NOW);
  expect(html).not.toContain('x"><script>');
  expect(html).toContain("x&quot;&gt;&lt;script&gt;");
});
```

(Adapt `baseInsight()`/`ROUNDS`/`NOW` to the file's actual fixture names.)

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run src/render-detail.test.ts` → expect the new test FAILS (raw `">` present).

- [ ] **Step 3: Escape the href and de-assert matchInsight**

`src/render.ts:802`:

```ts
const link = sofaUrl
  ? `<a class="mi-link" href="${escapeHtml(sofaUrl)}" target="_blank" rel="noopener noreferrer">Open in SofaScore ↗</a>` : "";
```

`src/state.ts` `matchInsight` — replace the favourite block:

```ts
if (p1.elo != null && p2.elo != null) {
  const favSide = p1.elo >= p2.elo ? "p1" : "p2";
  const fav = favSide === "p1" ? p1 : p2;
  const favElo = Math.max(p1.elo, p2.elo);
  const othElo = Math.min(p1.elo, p2.elo);
  const pct = Math.round(winProbability(favElo, othElo) * 100);
  const diff = Math.round(favElo - othElo);
  eloLine = `${surface}-ELO favoured ${fav.name} ${pct}% (+${diff})`;
  if (m.winner && m.winner !== favSide) { upset = true; badges.push("Upset"); }
}
```

(`oth` disappears — it was only read for `.elo`.)

- [ ] **Step 4: Run tests + typecheck, verify pass**

Run: `npx vitest run src/render-detail.test.ts src/state.test.ts && npm run typecheck` → expect PASS / exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/render.ts src/state.ts src/render-detail.test.ts
git commit -m "fix(render): escape the SofaScore deep-link href; drop matchInsight elo non-null assertions (#11)"
```

---

### Task 4: default theme follows `prefers-color-scheme`

Stored choice always wins; only first-visit (no stored key) consults the system. No live media-query listener — default only, per roadmap.

**Files:**
- Modify: `src/theme.ts` `loadTheme`
- Test: `src/theme.test.ts`

**Interfaces:** `loadTheme(storage: Getter = localStorage, prefersLight: () => boolean = systemPrefersLight): Theme`. Existing zero-arg caller (`src/app.ts:60`) keeps working.

- [ ] **Step 1: Write the failing tests**

In `src/theme.test.ts`:

```ts
it("first visit follows the system preference; stored choice always wins", () => {
  expect(loadTheme(fakeStorage(), () => true)).toBe("light");
  expect(loadTheme(fakeStorage(), () => false)).toBe("dark");
  expect(loadTheme(fakeStorage({ "tennisarc-theme": "dark" }), () => true)).toBe("dark");
  expect(loadTheme(fakeStorage({ "tennisarc-theme": "light" }), () => false)).toBe("light");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/theme.test.ts`
Expected: FAIL — `loadTheme` ignores the second argument, first assertion gets "dark".

- [ ] **Step 3: Implement**

```ts
// Non-browser (tests) and legacy engines have no matchMedia — treat as "no preference" (dark).
const systemPrefersLight = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches;

export function loadTheme(
  storage: Getter = localStorage,
  prefersLight: () => boolean = systemPrefersLight,
): Theme {
  const stored = storage.getItem(KEY);
  if (stored === "light" || stored === "dark") return stored; // an explicit choice always wins
  return prefersLight() ? "light" : "dark";
}
```

Keep the existing tests' expectations: `loadTheme(fakeStorage())` in a node env (no matchMedia) still returns "dark" — update the old test's comment if it says "default dark" (now "default dark absent a system light preference").

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run src/theme.test.ts src/app.test.ts` → expect PASS (app tests mount with no matchMedia in jsdom? jsdom provides matchMedia returning matches:false — either way dark, unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/theme.ts src/theme.test.ts
git commit -m "feat(theme): first visit follows prefers-color-scheme; explicit choice still wins"
```

---

### Task 5: dynamic `document.title` + description/OG tags

`index.html` has only a static `<title>` — no meta description, no OG tags, and the app never updates the title per tournament.

**Files:**
- Modify: `index.html` (head)
- Modify: `src/app.ts` `draw()` (set `document.title`)
- Test: `src/app.test.ts`

**Interfaces:** none exported. Title format: `` `${snap.tournament.name} — TennisArc` ``.

- [ ] **Step 1: Write the failing title test**

In `src/app.test.ts` (use the existing `mountApp` helper):

```ts
it("names the current tournament in document.title", async () => {
  await mountApp();
  expect(document.title).toBe(`${SNAP.tournament.name} — TennisArc`);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app.test.ts -t "document.title"` → expect FAIL (title is "" in jsdom).

- [ ] **Step 3: Implement**

In `draw()` in `src/app.ts`, right after the snapshot is known-good (near where the status bar uses `snap.tournament.name`):

```ts
document.title = `${snap.tournament.name} — TennisArc`;
```

In `index.html`, after the `<meta name="theme-color" …>` line:

```html
<meta name="description" content="Live Grand Slam draws as a radial bracket — every ring a round, every arc a player. Trace paths, Elo win probabilities, upsets and time on court." />
<meta property="og:title" content="TennisArc" />
<meta property="og:description" content="Live Grand Slam draws as a radial bracket — every ring a round, every arc a player." />
<meta property="og:type" content="website" />
<meta property="og:url" content="https://tennisarc.vercel.app/" />
<meta property="og:image" content="https://tennisarc.vercel.app/pwa-512x512.png" />
<meta name="twitter:card" content="summary" />
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run src/app.test.ts` → expect PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html src/app.ts src/app.test.ts
git commit -m "feat(meta): per-tournament document.title; description + OG/twitter tags in index.html"
```

---

### Task 6: #7 — nation summary in the centre readout on the Country lens

When `state.colorDim === "country"` and `state.selectedCountry` is set (and no player is pinned), the float readout card shows a nation summary built from `countryBreakdown` instead of the per-player card. Hovering a player still previews that player; on hover-leave the nation summary is restored.

**Files:**
- Modify: `src/render.ts` (new `renderNationReadout` next to `renderReadout`)
- Modify: `src/app.ts` (`ctx` gains `nation`; `draw()` picks the nation card; `updateReadout` restores it on leave)
- Test: `src/render.test.ts` (pure render), `src/app.test.ts` (draw + hover-restore behavior)

**Interfaces:**
- Produces: `renderNationReadout(info: { country: string; entrants: number; stillIn: number }, cls?: string): string` in `src/render.ts` — the arg is structurally satisfied by `NationRow` (extra `players` field is fine).
- `ctx` (app.ts local) gains `nation: NationRow | null`.

- [ ] **Step 1: Write the failing render test**

In `src/render.test.ts`:

```ts
describe("renderNationReadout", () => {
  it("summarises a nation as flag/code + still-in count", () => {
    const html = renderNationReadout({ country: "ITA", entrants: 4, stillIn: 1 }, "ro-float");
    expect(html).toContain("ro-nation");
    expect(html).toContain("ITA");
    expect(html).toContain("1 of 4 still in");
  });
  it("reads 'all out' when nobody is left", () => {
    expect(renderNationReadout({ country: "SUI", entrants: 2, stillIn: 0 })).toContain("all 2 out");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/render.test.ts -t "renderNationReadout"` → expect FAIL (not exported).

- [ ] **Step 3: Implement the renderer**

In `src/render.ts`, directly after `renderReadout`:

```ts
/** Nation summary variant of the readout card: shown in the float slot while a nation is
 *  selected on the Country lens (issue #7) — flag + ISO3 code and the still-in count.
 *  Same .readout chrome so the CSS and the updateReadout outerHTML swap treat it alike. */
export function renderNationReadout(
  info: { country: string; entrants: number; stillIn: number }, cls = "",
): string {
  const c = cls ? ` ${cls}` : "";
  const line = info.stillIn > 0 ? `${info.stillIn} of ${info.entrants} still in` : `all ${info.entrants} out`;
  return (
    `<div class="readout filled ro-nation${c}">` +
    `<div class="ro-ctry">${flagImg(info.country, 11)} ${escapeHtml(info.country)}</div>` +
    `<div class="ro-name">${escapeHtml(line)}</div>` +
    `</div>`
  );
}
```

Run: `npx vitest run src/render.test.ts -t "renderNationReadout"` → expect PASS.

- [ ] **Step 4: Write the failing app test**

In `src/app.test.ts` (follow the file's existing patterns for switching lens and clicking `data-action="country"` rows — reuse whatever helper existing country-lens tests use):

```ts
it("country lens: selecting a nation shows the nation summary in the float readout, hover still previews players", async () => {
  const root = await mountApp();
  // switch to the Country lens, then select the first nation row
  (root.querySelector('[data-action="view"][data-view="country"]') as HTMLElement).click();
  await tick();
  (root.querySelector('[data-action="country"]') as HTMLElement).click();
  await tick();
  const card = root.querySelector(".readout.ro-float")!;
  expect(card.classList.contains("ro-nation")).toBe(true);
  expect(card.textContent).toMatch(/still in|all \d+ out/);
});
```

(Adapt the lens-switch selector to the real controls markup — check how existing tests flip `colorDim`; `tick`/`flush` helper names likewise.)

- [ ] **Step 5: Run to verify failure**

Run: `npx vitest run src/app.test.ts -t "nation summary"` → expect FAIL (card is the player readout).

- [ ] **Step 6: Wire it in app.ts**

1. Import `renderNationReadout` in the `./render` import list.
2. Extend `ctx`'s type with `nation: NationRow | null` (import the type from `./state`).
3. In `draw()` where `roFloat` is built (~line 382):

```ts
const nation = !pinned && state.colorDim === "country" && state.selectedCountry
  ? countryBreakdown(snap).find((r) => r.country === state.selectedCountry) ?? null
  : null;
ctx = { snap, time, defaultId, champId: tree.occupant, champProjected: tree.projected, pinned, isMatch, nation };
// …
const roFloat = nation
  ? renderNationReadout(nation, roCls(false))
  : renderReadout(buildReadout(snap, time, defaultId, tree.occupant, tree.projected), roCls(floatIdle));
```

Also update the `roCurrent`/`roIdle` seeding above it: when `nation` is set, seed `roCurrent = "nation:" + nation.country; roIdle = false;` (player ids never contain `:` prefix collisions — `"nation:"` is a safe sentinel namespace).

Note `ctx` is assigned once in `draw()` (~line 356) *before* `roFloat`; move the `nation` computation above that assignment and fold it into the one `ctx = { … }` literal — do not assign `ctx` twice.

4. In `updateReadout`, restore the nation card on hover-leave — after the `if (ctx.isMatch) return;` guard:

```ts
// A selected nation owns the idle card (issue #7): hover previews players as usual,
// but leaving restores the nation summary rather than the default player card.
if (!playerId && ctx.nation) {
  const key = `nation:${ctx.nation.country}`;
  if (roCurrent === key) return;
  const el = root.querySelector(".readout.ro-float");
  if (!el) return;
  roCurrent = key; roIdle = false;
  el.outerHTML = renderNationReadout(ctx.nation, roCls(false));
  return;
}
```

- [ ] **Step 7: Run tests + typecheck, verify pass**

Run: `npx vitest run src/app.test.ts src/render.test.ts && npm run typecheck` → expect PASS / exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/app.ts src/render.ts src/app.test.ts src/render.test.ts
git commit -m "feat(country): nation summary owns the centre readout while a nation is selected (#7)"
```

---

### Task 7: Help — "Reading the wheel" section

`docs/HELP.md` is the single source of truth bundled into the app; each `## ` heading is one accordion section. Add a section explaining the radial bracket itself (the top user-facing gap: rings, arcs, centre, corners, lenses, live/sched marks).

**Files:**
- Modify: `docs/HELP.md` (new `## Reading the wheel` section between `## About` and `## Elo ratings`)

**Interfaces:** none — `renderSections` splits on `## ` headings automatically; no code change.

- [ ] **Step 1: Write the section**

Insert after the `## About` section body, before `## Elo ratings`:

```markdown
## Reading the wheel

The wheel is the whole draw at once. Each **ring** is a round — the outermost ring is
the first round, and rounds move inward until the **centre disc**, which is the final
(the champion's name appears there once the title is decided).

Each **arc** is one player in one round: a player who keeps winning appears again on
every ring further in, so their run reads as a wedge narrowing toward the centre.
Tap or hover an arc to light up that player's whole path; tap again to open the match
they played in that round.

Colour comes from the active **lens** (the toggle in the header):

- **Time** — how long each player has spent on court so far.
- **Seed** — seeding bands, so upsets stand out as pale gaps deep in the draw.
- **Country** — one colour per nation; pick a nation in the side panel to spotlight it.

Around the wheel: the four **corner names** are the top seed of each quarter (dimmed
once they're out), a **pulsing arc** is a match in play, and a small **clock tag** on
an arc is that match's scheduled start. The ⚡ mark is an upset — see the next
sections for how Elo defines one.
```

- [ ] **Step 2: Verify the accordion still splits cleanly**

Run: `npx vitest run src/help.test.ts` → expect PASS.
Run: `npx vitest run` → expect full suite green.
Sanity: `grep -c "^## " docs/HELP.md` → expect 7 (was 6).

- [ ] **Step 3: Commit**

```bash
git add docs/HELP.md
git commit -m "docs(help): add 'Reading the wheel' section — rings, arcs, lenses, corner names, live/sched marks"
```

---

## Final verification (after all tasks)

- [ ] `npx vitest run` → full suite green.
- [ ] `npm run build` → tsc + vite build succeed.
- [ ] Drive the app once (`npm run dev`) and eyeball: title bar shows the tournament, Country lens + nation click shows the nation card, Help shows the new section, first visit in a light-preference profile opens light.
- [ ] Push branch, open PR referencing #37 #9 #11 #7.
