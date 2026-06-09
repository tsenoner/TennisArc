# TennisArc — UX Overhaul & Multi-Slam Archive (Design Spec)

**Date:** 2026-06-09
**Status:** Approved (brainstorm) → ready for implementation plan
**Related:** [`2026-06-07-tennisarc-design.md`](./2026-06-07-tennisarc-design.md) (original design), [`/RESEARCH.md`](../../../RESEARCH.md)

---

## 1. Overview

A second-pass UX overhaul of the live TennisArc PWA (https://tennisarc.vercel.app). The app today renders a champion-centred sunburst of a single Grand Slam (ATP + WTA), coloured by a "colour-by" toggle (Time / Seed / Country), with a fixed "Most time on court" leaderboard and a tap-to-open match card. This overhaul makes the bracket **legible and named**, makes each colour mode a **self-contained lens** with its own insight, makes a single match genuinely **insightful**, fixes the **useless nationality view**, upgrades projections to **surface-specific ELO**, and adds a **multi-slam archive** so users can flip between the four Grand Slams of recent years.

It is a client-render + data-contract evolution. It keeps the existing pure-module architecture (`model → state → layout → color → render → app`, `store`/`api`, `ingest/`) and the offline-first, $0-to-run posture.

### Goals
1. **Names + rankings on the bracket** — readable, without clutter, at any zoom.
2. **Lens-scoped insights** — Time / Seed / Country each recolour the wheel *and* swap the side panel; "Most time on court" appears only on the Time lens.
3. **Match insight** — a specific match yields a rich, derived-narrative card.
4. **A genuinely useful nationality view** — flags, a nation breakdown, select-to-highlight.
5. **Surface-specific ELO projections** — clay/grass/hard ELO drives "who advances".
6. **Multi-slam archive** — per-`{tour,year,slam}` data + an index; switch between AO/RG/Wimbledon/US Open across recent years; only the active slam is ever overwritten.

### Non-goals / deferred
- Full Open-Era (pre-SofaScore) archive — explicitly rejected (results-only data would dark out the time/stat features).
- Doubles, qualifying, mixed.
- In-app real-time point-by-point (delegated to the SofaScore deep-link).
- Accounts, push, prediction games, monetization.
- Free pinch-zoom (semantic tap/Focus zoom only, as today).

---

## 2. Decisions locked (from brainstorm)

| # | Decision | Choice |
|---|---|---|
| 1 | On-arc label orientation | **Tangential**, true curved `textPath` |
| 2 | Label repetition | **Write once** — one label per player, on their furthest-reached (deepest decided) ring |
| 3 | Names/rankings everywhere else | **Centre readout** (hover/focus) + the lens panels |
| 4 | Projected (unplayed) arcs | **Faded + dashed** |
| 5 | Projection favourite | **Surface ELO** → overall ELO → ranking → seed (fallback chain) |
| 6 | Lenses | Time / Seed / Country, each with its **own** side panel + legend |
| 7 | Country colouring | **Neutral wheel + select-to-highlight** (not a 33-way rainbow) |
| 8 | Flags | **Bundled SVG flags** (ISO-3 → ISO-2), offline-safe |
| 9 | Match insight placement | **Side panel (desktop) / bottom sheet (mobile)**; zoom **decoupled** from inspect |
| 10 | Data files | **`{tour}-{year}-{slam}.json` + `index.json`**; overwrite active slam only |
| 11 | History reach | **Recent years (~2022–2026)** of all 4 slams, SofaScore source |

---

## 3. The lens model

The three "colour by" buttons become **lenses**. A lens = `{ id, colourFn, panel, legend }`. Switching a lens recolours arcs AND replaces the side panel AND updates the legend — all from a single `state.lens` value.

| Lens | Wheel colouring | Side panel (insight) |
|---|---|---|
| **Time** ⏱ | heat by cumulative on-court seconds (current) | "Most time on court" leaderboard (current) |
| **Seed** ▲ | heat by seed (1 brightest, unseeded muted) | "Seeds still in — N/32" + **biggest upsets** (ELO-defined) |
| **Country** ⚑ | neutral; selected nation highlighted | nations ranked by **players still in / entered**, expandable to players |

This resolves the "Most time on court shows on every tab" complaint structurally: the panel is a function of the lens, not a constant.

**Implementation:** `app.ts` `draw()` chooses `renderPanel(lens, …)`; `render.ts` gains `renderTimePanel`, `renderSeedPanel`, `renderCountryPanel`. When a match is selected, the panel slot instead renders the **match insight** (§7), with a "‹ back" affordance returning to the lens panel.

---

## 4. Sunburst & write-once labelling

The bracket geometry is unchanged: champion at centre (`buildSunburst`), 128 entrants on the outer ring, each winner re-occupying an arc per round advanced. The change is purely in **how occupants are labelled and styled**.

### 4.1 Write-once anchors (pure, `state.ts`)
A new pure function marks, for every `SunNode`, whether it is the **label anchor** for its occupant:

> A node is a label anchor iff its occupant is *decided here* AND the occupant is **not** the occupant of its parent node (i.e., they did not win the next round) — OR the node is the deepest decided node on that path (champion / current frontier).

Equivalently: each player is labelled exactly once, on the innermost (deepest) arc they actually occupy. Eliminated-early players anchor on the rim; deep players anchor on big inner arcs (so legibility scales with how far a player went). All other arcs of that player's wedge are drawn (in colour) but **unlabelled** — the visible "trail".

### 4.2 Curved labels (`render.ts`)
- Labels render as `<textPath>` following a circular arc at the band's mid-radius — **true curvature**, flipped on the bottom half so text stays upright.
- **Tangential** orientation.
- **Gating:** a label renders only if the arc's chord length can hold the text (`midRadius · angularWidth ≥ textLen · fontSize · k`). At full zoom-out only inner rounds qualify; zooming a sector reveals more (existing `focusId` zoom).
- Content: surname; on large arcs (≈QF inward) append `#rank` (or seed). On the Country lens the label becomes **flag + surname**.
- Halo (`paint-order: stroke`) keeps text legible over any arc colour.

### 4.3 Projected styling (`render.ts` + `color.ts`)
- **Decided** arcs (results): solid, full colour.
- **Projected** arcs (not yet played, toward centre): translucent fill + **dashed** stroke. The translucent core shrinks as rounds complete.
- Projection occupants may carry a faint italic label (the projected name) and are never given a solid "anchor" label.

---

## 5. Centre readout (`render.ts`)

The empty centre hole becomes a guaranteed-legible **readout** that always answers "who is this":
- **Default:** the (projected) champion. On the **Country lens**, the selected-nation summary ("🇮🇹 Italy · 1 still in · 4 entered").
- **On hover/focus of any arc:** the hovered player's flag, name, ATP/WTA rank, seed, surface ELO, round reached, and cumulative time-on-court.
- Drives a new `state.hoveredPlayerId` (pointer move over arcs, debounced) and reuses `state.focusId`.

This is the second home for names/rankings: the wheel stays clean; the readout is the always-on detail surface.

---

## 6. Projection engine — surface ELO (`state.ts` + ingest)

Replace the seed/ranking chalk-pick with an ELO-driven favourite, surface-matched to the slam.

### 6.1 Data (ingest)
- New `ingest/elo.ts` fetches **Tennis Abstract** ELO tables (`/reports/atp_elo_ratings.html`, `/reports/wta_elo_ratings.html`) via the existing headless-Chromium context. Parsed columns: `Elo` (overall), `hElo`/`cElo`/`gElo` (hard/clay/grass), `Age`, ELO rank.
- `ingest/enrich.ts` joins ELO onto players by **normalized name** (strip accents, lowercase, last-name + first-initial), with a small manual alias map for known mismatches; unmatched players keep `elo: null`. The join also **back-fills `ageYears`** (SofaScore returns `null`).
- Licence: Tennis Abstract / Sackmann data is CC BY-NC-SA — non-commercial + attribution; add a Tennis Abstract credit alongside SofaScore.

### 6.2 Model
`Player.elo: { overall: number; hard: number; clay: number; grass: number } | null`. `Player.ageYears` now populated.

### 6.3 Projection (pure)
`projectFavorite(players, a, b, surface)` replaces `betterSeed`, comparing in order: **surface ELO → overall ELO → ranking → seed → tie→a**. `projectedWinner()` threads `snapshot.tournament.surface`.

### 6.4 Win probability (pure)
`winProbability(eloA, eloB) = 1 / (1 + 10^((eloB − eloA)/400))`, surface-specific. Used by the match insight ("clay-ELO favoured X 63%") and by **upset detection** (`Seed` lens): a result is an upset when the actual winner was the ELO underdog; magnitude = ELO gap overcome. Falls back to seed-gap when ELO is missing.

---

## 7. Match insight (`render.ts`, `state.ts`)

### 7.1 Placement & interaction
- **Side panel on desktop / bottom sheet on mobile** (responsive container in the existing panel slot), replacing the lens panel while a match is selected; "‹ back" restores the lens panel.
- **Inspect decoupled from zoom:** tapping a match arc sets `state.selectedMatchId` (opens insight) + the centre readout — it no longer zooms. A **"⊕ Focus this section"** button performs the zoom (sets `focusId`); tapping the centre zooms back out. This removes today's surprising tap-zooms-and-opens-card coupling.

### 7.2 Content (derived, from data we actually have)
Built by a pure `matchInsight(snapshot, matchId)`:
- **Matchup:** both players — flag, name, seed, rank; winner highlighted + ✓.
- **Score:** set-by-set, tiebreak superscripts, winner's sets emphasized.
- **Auto-badges:** `Upset` (ELO underdog won), `From a set down` / `Comeback` (lost first set, won), `Straight sets`, `N tiebreaks`, `Marathon` (>3h) / `Quick` (<90m) — all derivable from score, `durationSec`, ELO.
- **Stat bars:** aces and double-faults (the only two raw stats SofaScore populates), as diverging comparison bars — presented well rather than as a sparse table. (Other `MatchStats` fields stay optional; rendered only if ever present.)
- **ELO context:** pre-match surface-ELO favourite + probability, flagged when the result defied it.
- **Player context:** each player's round reached + cumulative time-on-court (ties back to the Time lens).
- **Actions:** "Open in SofaScore ↗" (existing deep-link via `sofaCustomId`) + "⊕ Focus this section".

---

## 8. Country lens & flags

### 8.1 Flags (`flags.ts`, new, pure)
- ISO-3 → ISO-2 map (our data is ISO 3166-1 alpha-3) → a flag asset.
- **Bundled SVG flags** (flag-icons set or equivalent, MIT), referenced by ISO-2, so they render identically on Windows/Android (emoji flags do **not** render on Windows) and work offline. Unknown code → neutral placeholder.
- Helper returns an `<svg>`/`<img>`/sprite reference for a country code; used in arcs, panels, readout, match insight.

### 8.2 Colouring (`color.ts`)
Country lens is **not** an ordinal palette over 33 countries. Arcs are muted by default; the selected country (from `state.selectedCountry`) is drawn in an accent and others dimmed. Flags on arcs (gated by size) carry identity; colour carries focus.

### 8.3 Panel (`render.ts`)
`renderCountryPanel` lists nations ranked by **players still in**, then entrants — each row: flag, name, `N/M`. A row expands to that nation's players (surname + round reached, alive flagged). Clicking a row (or an arc) sets `state.selectedCountry`, highlighting the wheel and summarizing in the centre readout.

---

## 9. Slam switcher & multi-slam data architecture

### 9.1 Files
- One snapshot per slam: **`{tour}-{year}-{slam}.json`** (e.g. `atp-2026-roland-garros.json`).
- **`index.json`** manifest: `{ schemaVersion, generatedAt, slams: AvailableSlam[] }`, where `AvailableSlam = { tour, year, slam, name, surface, status: "upcoming"|"live"|"complete", generatedAt, drawSize }`.
- Completed slams are **immutable**; only the in-progress slam's file is rewritten each refresh. Back-compat: keep emitting `atp.json`/`wta.json` as aliases of the active slam during transition (optional, low-stakes).

### 9.2 App
- `AppState` gains `year`, `slam` (and `selectedCountry`, `hoveredPlayerId`, `lens` rename of `colorDim`).
- On boot, `api.fetchIndex()` → build the **slam switcher** (year stepper + AO/RG/W/USO segments, surface-themed: clay/grass/hard accent; unavailable slams greyed). Default to the most recent `live`, else most recent `complete`.
- `api.fetchSnapshot(tour, year, slam)` constructs the per-slam filename; `store.ts` keys IndexedDB by `snapshot:${tour}:${year}:${slam}` (+ a cached `index`). Each slam caches independently and renders offline.
- Switching tour preserves `year`/`slam`/`lens`.

### 9.3 Ingest & publish
- `ingest/config.ts`: SLAMS already maps the 4 slams → SofaScore `uniqueTournamentId`s. Add a **backfill target list** of `{year, slam}` and per-year season resolution: `resolveSeasonId(utId, year)` selects the season whose `year` matches the target (not merely the newest).
- `ingest/index.ts`: write per-slam files + regenerate `index.json`; never clobber a `complete` slam; the draw-completeness + season-year guards (already present) gate the active slam.
- `scripts/publish-data.sh`: change from force-overwrite to **additive** (git-add per-slam files + `index.json`; history accumulates on the `data` branch). The scheduled cron refreshes only the active slam; backfill is a manual/occasional run over the target list.

---

## 10. Data model changes (`src/model.ts`)

```ts
interface Player {
  // …existing: id, name, country (ISO-3), seed, entry, ranking, sofaSlug
  ageYears: number | null;                 // now populated (from Tennis Abstract)
  elo: PlayerElo | null;                    // new
}
interface PlayerElo { overall: number; hard: number; clay: number; grass: number; }

// index.json
interface SlamIndex { schemaVersion: number; generatedAt: string; slams: AvailableSlam[]; }
interface AvailableSlam {
  tour: Tour; year: number; slam: string; name: string; surface: string;
  status: "upcoming" | "live" | "complete"; generatedAt: string; drawSize: number;
}
```

`Snapshot.tournament` already carries `slam`, `year`, `surface`. Bump `schemaVersion`; the app guards on mismatch (existing pattern).

---

## 11. Module / file layout

```
src/
  model.ts        # + Player.elo, ageYears populated; SlamIndex / AvailableSlam
  api.ts          # + fetchIndex(); fetchSnapshot(tour, year, slam)
  store.ts        # key by tour+year+slam; cache index
  state.ts        # + projectFavorite(surface), winProbability, labelAnchors(tree),
                  #   seedInsights, countryBreakdown, matchInsight  (timeLeaderboard stays)
  layout.ts       # + expose angular width / centroid for label gating (geometry only)
  color.ts        # Time/Seed unchanged; Country → neutral + selectedCountry highlight
  flags.ts        # NEW pure: ISO-3→ISO-2, flag asset lookup
  render.ts       # + curved textPath labels (write-once anchors), centre readout,
                  #   flags on arcs, renderTimePanel/SeedPanel/CountryPanel,
                  #   renderMatchInsight, slam switcher + year stepper
  app.ts          # AppState{ tour, year, slam, lens, focusId, selectedMatchId,
                  #   selectedCountry, hoveredPlayerId }; index-driven boot;
                  #   handlers: lens, slam, country-select, hover-readout, inspect, focus-zoom
ingest/
  config.ts       # + backfill target list; per-year season resolution
  sofascore.ts    # resolveSeasonId(utId, year) selects matching season
  elo.ts          # NEW: fetch + parse Tennis Abstract ELO tables
  enrich.ts       # + join ELO + age by normalized name (+ alias map, fallback)
  normalize.ts    # surface threaded into projection
  index.ts        # write {tour}-{year}-{slam}.json + index.json; preserve complete slams
public/data/
  index.json
  {atp,wta}-{year}-{slam}.json
scripts/publish-data.sh   # additive publish (keep history on data branch)
+ bundled SVG flag assets
```

---

## 12. Data flow

```
ingest (active slam each cron; backfill list occasionally)
  SofaScore cuptrees/events  +  Tennis Abstract ELO/age
    → normalize + enrich (ELO/age join, surface projection, durations)
    → write {tour}-{year}-{slam}.json  +  regenerate index.json
    → publish (data branch, additive)
APP
  fetchIndex → slam switcher → fetchSnapshot(tour,year,slam) (→ IDB cache)
    → state: buildSunburst, labelAnchors, projectFavorite(surface),
             lens insights (time/seed/country), matchInsight
    → layout (radial partition + focus zoom + label geometry)
    → color (lens + selection)
    → render (arcs, curved write-once labels, centre readout, flags, lens panel / match insight, switcher)
    → app events: lens · slam · country-select · hover(readout) · inspect · focus(zoom)
```

---

## 13. Error handling & edge cases

- **ELO name miss** → `elo: null`; projection falls back to ranking/seed; ELO context/age omitted gracefully; ingest logs unmatched names for alias-map curation.
- **Surface ELO missing for a player** → overall ELO → ranking → seed.
- **Slam not yet released / not in index** → switcher greys it; selecting an absent slam shows a "draw not released / not archived" state (no infinite spinner).
- **Offline** → `index.json` + per-slam snapshots served from IDB; render last-good; stale badge as today.
- **Flag missing** for a code → neutral placeholder; never blocks render.
- **Live/provisional durations** → unchanged gating (`countsTime`); provisional marked.
- **Backfill reach** → `index.json` lists only slams actually fetched; switcher reflects reality.
- **Schema bump** (Player.elo/age, per-slam files) → `schemaVersion` guard + loud CI sanity check (≥127 matches once a draw is out).
- **Write-once with all-projected early draw** → every player's anchor is the rim (gated/hidden); centre readout + zoom carry identification until results thin the field inward.

---

## 14. Testing strategy

Vitest, colocated, `TZ=UTC` pinned (existing).
- **`state.ts`:** `projectFavorite` surface ordering + fallbacks; `winProbability`; `labelAnchors` (champion once at centre; eliminated-at-round anchoring; no repeats); `seedInsights` (upset detection incl. ELO-missing fallback, seeds-remaining count); `countryBreakdown` (entrants vs still-in, player lists); `matchInsight` badges (upset/comeback/straight/tiebreak/marathon/quick) and ELO context.
- **`color.ts`:** Country selection model (selected vs muted); Time/Seed scales unchanged.
- **`flags.ts`:** ISO-3→ISO-2 incl. edge cases (GBR→GB, NLD→NL, CHE→CH, DEU→DE); unknown → placeholder.
- **`layout.ts`:** angular width / centroid; focus rescale; degenerate filtering.
- **`render.ts`:** string assertions for curved-label anchors, centre readout, lens panels, match insight, switcher.
- **ingest:** `elo.ts` parse against a captured TA fixture; `enrich.ts` name-join + alias + fallback; `normalize` surface projection; `index.ts` per-slam filenames + index generation + "don't clobber complete" guard.
- **app:** manual smoke checklist (install/offline/zoom/inspect/lens-swap/slam-switch/country-highlight/deep-link).

---

## 15. Risks & mitigations

| Risk | Mitigation |
|---|---|
| ELO ↔ SofaScore name matching accuracy | normalize + manual alias map + fallback chain + log unmatched; never hard-fail |
| SofaScore retention of past-season `cuptrees` (how far back backfill reaches) | **verify reach in planning**; `index.json` reflects what we actually have |
| Curved-label legibility / SVG perf at 128 arcs | render only anchors, size-gate, lean on zoom + centre readout |
| Flag asset weight | bundle a compact SVG set (sprite or subset of countries present); offline-cached |
| `data` branch growth | per-slam JSON is small; additive history is bounded (≈40 files for 5 yrs × 4 slams × 2 tours) |
| ELO staleness (weekly) | refresh ELO each ingest of the active slam; archived slams freeze the ELO snapshot as-of-event |

---

## 16. Open decisions (planning, all reversible)
1. **Backfill year range** — confirmed reach pending SofaScore retention check (target ~2022–2026).
2. **Flag asset delivery** — full flag-icons sprite vs inline subset of countries present in the archive.
3. **ELO storage** — per-snapshot embedded on `Player.elo` (chosen default; self-contained, archivable) vs a shared `elo.json`.
4. **Win-probability surfacing** — match-insight badge only (default) vs also shading projected arcs by confidence.
5. **Label content on big arcs** — `#rank` vs seed vs both.

---

*Sources for the ELO data path: [Tennis Abstract ATP Elo](https://tennisabstract.com/reports/atp_elo_ratings.html), [WTA Elo](https://tennisabstract.com/reports/wta_elo_ratings.html) (verified 2026-06-09: overall + hElo/cElo/gElo + Age columns, scrapable HTML).*
