# In-app Help, sourced from `docs/HELP.md` — design

**Date:** 2026-06-16
**Status:** approved (design), pending implementation plan

## Goal

Give app users a concise, accurate, in-app explanation of the concepts TennisArc
shows — Elo ratings, expected win probability, the upset ⚡ symbol, the tennis
terms a non-fan won't know — and be transparent about (and credit) where the data
comes from. Keep it short and link out for depth. The content must have a single,
version-controlled home in the repo and must never drift from what users see.

## Single source of truth & data flow

`docs/HELP.md` is the **one** canonical file:

- Human-readable and creditable on GitHub; version-controlled.
- Bundled into the app at build via Vite's raw import: `import helpMd from '../../docs/HELP.md?raw'`
  (exact relative path resolved at implementation; Vite supports `?raw` natively, no config).
- The shipped Help panel renders the *exact same bytes* committed to the repo →
  the doc and the app cannot diverge, and it works offline (bundled, never fetched).

## Rendering

- Add `marked` (small, trusted, zero-config) to convert markdown → HTML.
  Content is first-party (authored in-repo, bundled at build, never user input),
  so there is no XSS surface and no sanitizer is required.
- The renderer splits the doc on top-level `##` headings into an **accordion**
  (`<details>`/`<summary>`), with the first section open. On GitHub the same file
  reads as a normal flat document.
- A leading HTML comment block in `HELP.md` (the maintenance contract, see below)
  and the H1 title are stripped before rendering the accordion.

## Presentation (UI)

- A **`?` button** in the header `.controls` row (placed after the theme toggle),
  `data-action="toggle-help"`, `aria-label="Help"`, class `.ctrl.help`.
- Opens a **dismissible sheet**: bottom-sheet on mobile / side panel on desktop,
  reusing the existing `.mi-scrim` + `.panel`/`.mi-detail` sheet pattern, sheet-bar
  grip + close button, and the semantic theme tokens — so it themes correctly and
  uses the dismiss gesture users already know.
- New state: `helpOpen: boolean` in `AppState` (default `false`). Toggled by the
  header button; closed by scrim tap, close button, and `Escape`.
- New `renderHelp(open: boolean): string` in `render.ts`; wired into the render
  orchestration and the event-delegation handler in `app.ts`.

## Content structure of `docs/HELP.md`

Concise; link out for depth. Top-level `##` sections (each becomes one accordion row):

1. **About** — one line: the wheel is a live radial bracket of the current Grand
   Slam draw for ATP and WTA.
2. **Elo ratings** — what Elo is; per-match update
   `E = 1 / (1 + 10^((rOpp − rSelf) / 400))`, `K = 250 / (n + 5)^0.4`, `D = 400`;
   surface Elo `= 0.5·overall + 0.5·(same-surface-only rating)`; what the numbers
   mean (career strength scale; surface rating = overall blended with surface form).
   Links: TA "An Introduction to Tennis Elo", the live ATP/WTA Elo boards.
3. **Win probability** — `P(A beats B) = 1 / (1 + 10^((eloB − eloA) / 400))`;
   explains the match readout, e.g. "Clay-ELO favoured Sinner 65% (+109)".
4. **Upsets & the ⚡** — an upset = the player with the higher **surface** Elo (the
   favourite) lost; the ⚡ marks it in the seed panel and match detail.
5. **Tennis terms** (glossary for non-fans) — surface (hard/clay/grass), seed,
   rounds (R128 → … → QF/SF/F, W = champion), bye, qualifying, tour tiers/levels
   (Grand Slam, Masters/WTA1000, 250/500, Finals, team events), Challenger / ITF,
   walkover (W/O) & retirement (RET), ranking points, W–L record, Olympics.
6. **Data & credit** — sources, each linked:
   - **Tennis Abstract / Jeff Sackmann** match CSVs — `github.com/JeffSackmann/tennis_atp`,
     `.../tennis_wta` — licensed **CC BY-NC-SA 4.0** (state the license and credit).
   - **Tennis Abstract** Elo boards & methodology blog (calibration + formulas).
   - **SofaScore** — live current-slam draws and scores.
   - **Wayback Machine** — archived historical Elo boards.
   - **ATP/WTA points tables** — per-round ranking points.
   - Honest one-liner: ratings are a faithful *reproduction* of TA's public method;
     byte-exact match is impossible because TA's exact generation code is private.

All formulas/constants in `HELP.md` are taken verbatim from `docs/elo-formula.md`
(lines 15–28) and `src/state.ts` (`winProbability` line 75, upset logic 398/516–522),
and must be re-verified against those sources at implementation time.

## Keeping it up to date

- `docs/HELP.md` is the single git-versioned source; the app renders the same file,
  so app and doc never diverge.
- A hidden leading **HTML-comment maintenance contract** in `HELP.md`:
  "Update this file when the Elo formula/constants change, a data source changes, or
  a new symbol/concept appears in the UI." Plus a visible **"Last updated: YYYY-MM-DD"** line.
- A **Claude-memory entry** pointing to `docs/HELP.md` and the contract, so future
  sessions keep it current.

## Out of scope (YAGNI)

- **Season Elo (yElo)** — not surfaced in the slam-wheel view; stays documented in the
  research docs only, omitted from user help.
- No runtime fetching, no markdown editing UI, no i18n, no search.
- No changes to Elo/upset computation — help only describes existing behaviour.

## Files

- **Create:** `docs/HELP.md`; help renderer module (e.g. `src/help.ts`) exporting the
  markdown→accordion-HTML transform.
- **Modify:** `src/render.ts` (`renderHelp`, header `?` button), `src/app.ts`
  (`helpOpen` state + handlers + Escape), `src/app.css` (help sheet styling, mostly
  reused tokens), `package.json` (add `marked`).

## Acceptance criteria

1. `pnpm build` succeeds; `marked` bundled; `?raw` import resolves.
2. `?` button visible in header on mobile and desktop; opens/closes the sheet;
   dismiss via scrim, close button, and Escape all work; themes correctly in
   dark/light.
3. Help renders the accordion from `docs/HELP.md`; first section open; links open
   in new tabs.
4. Every formula/constant/source/license in `HELP.md` matches the cited source files.
5. Maintenance contract + "Last updated" present in `HELP.md`; memory entry written.
6. Visual check on iPhone-15 viewport and desktop (Playwright) — sheet legible,
   scrollable, no layout break.
