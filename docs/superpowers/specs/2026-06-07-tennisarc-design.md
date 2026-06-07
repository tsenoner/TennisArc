# TennisArc — Design Spec

**Date:** 2026-06-07
**Status:** Approved (brainstorm) → ready for implementation plan
**Related:** [`/RESEARCH.md`](../../../RESEARCH.md) (verified data-source + technique research)

---

## 1. Overview

TennisArc is an **offline-first, installable PWA** that renders a Grand Slam
tennis draw (ATP + WTA) as a **zoomable sunburst bracket** that stays up to date
with live and completed results. It auto-builds from the official draw, shows
seed-based projections until players actually meet, and treats **cumulative
time-on-court** as a first-class, colour-encoded dimension. Tapping a match
deep-links to SofaScore; zooming reveals names, scores, and serve/return stats.

**Inspiration:** the r/tennis radial-bracket-for-Roland-Garros post. Stylistically
a sibling of the user's `ErgoFlow` (`web/`) and `wattblock` PWAs.

### Goals (v1)
- A beautiful, legible **sunburst** of a single Grand Slam, **ATP + WTA singles** (128 draw).
- **Auto-built** from the draw the moment it's released; **kept current** with results.
- **Seed projections** for unplayed matchups, replaced by actual results.
- **Cumulative time-on-court** per player, shown via a **swappable "colour by"** dimension (default = time-on-court heat) + a ranked leaderboard.
- **Tap a match** → detail card + SofaScore deep-link; **zoom** → names/score/stats.
- **Offline-first installable PWA**, great on phone and web, deployed on Vercel, **$0** to run.

### Non-goals (v1) / deferred
- Full-360° **radial-tree "wow" view** (A) — deferred as a future toggle; design keeps the layout layer pluggable so it can be added later.
- **Doubles**, **qualifying**, **past-Slam archive**, multiple simultaneous Slams.
- In-app real-time point-by-point ticking — real-time is delegated to the SofaScore deep-link; in-app freshness is the cron cadence (~5 min).
- Accounts, push notifications, prediction games, monetization.

---

## 2. Audience & data-strategy decision

**Personal / share-with-friends, non-commercial.** Consequence: we use
**SofaScore's free, key-free (unofficial) API** as the primary source — the only
source that provides, for both tours, the full draw as a pre-built bracket tree
*plus* live scores, stats, per-set durations, and a deep-link id. Mitigations for
its two real caveats (verified in `RESEARCH.md`):

- **ToS** forbids scraping/commercial use → we fetch **server-side only**, cache,
  **link out** (don't re-host their live UI), keep it non-commercial/no-ads, add
  attribution, and poll politely.
- **Cloudflare** is inconsistent (plain fetch sometimes 403s) → ingestion uses a
  **headless browser (Playwright)** in CI to reliably obtain the JSON, with
  **ESPN's never-blocked hidden API** as a live-score fallback.

The browser app **never** calls SofaScore directly — only our own normalized JSON.

---

## 3. Architecture

Two decoupled halves connected by a static JSON contract:

```
┌─ INGESTION (server, GitHub Actions cron ~5 min while a Slam is active) ─────────┐
│  ingest/ (Node + TS)                                                            │
│   1. resolve tournament (search → uniqueTournamentId → seasonId) for ATP & WTA  │
│   2. Playwright-fetch SofaScore: /cuptrees, results, live, /event/{id}, /stats  │
│      (ESPN fallback for live scores if SofaScore blocks)                        │
│   3. normalize → OUR schema (decoupled from SofaScore's shape)                  │
│   4. derive: cumulative time-on-court, seed projections, bracket tree           │
│   5. publish atp.json + wta.json + index.json to a CORS-enabled static CDN      │
└────────────────────────────────────────────────────────────────────────────────┘
                                   │ static JSON (versioned, cacheable)
                                   ▼
┌─ APP (client PWA on Vercel) ───────────────────────────────────────────────────┐
│  api.ts   fetch snapshots (revalidate on load/online/visibility)                │
│  store.ts idb-keyval cache of last-good JSON  → renders fully OFFLINE            │
│  state.ts pure: sunburst model, time-on-court, projections, colour domains      │
│  layout.ts pure: d3-hierarchy + radial partition → arc geometry                 │
│  color.ts pure: colour scale per "colour by" dimension                          │
│  render.ts → SVG/HTML strings (arcs, labels, legend, selectors, detail card)    │
│  app.ts   orchestration, hash router, event delegation (data-action), zoom      │
│  main.ts  thin: register SW (vite-plugin-pwa), mount                            │
└────────────────────────────────────────────────────────────────────────────────┘
```

**Publish target (open decision, low-stakes, swappable behind `api.ts`):** default
is a `data` git branch served via GitHub Pages / jsDelivr ($0, CORS, CDN-cached);
**Vercel Blob** is a drop-in alternative if we want tighter cache-control. Finalize
during planning. The app treats it as a plain `fetch(url)` regardless.

---

## 4. Normalized data model (the ingestion ⇄ app contract)

One file per tour (`atp.json`, `wta.json`) plus a small `index.json` describing the
active Slam. Shapes (TypeScript, mirrored in `model.ts`):

```ts
type Tour = "ATP" | "WTA";
type EntryType = "Q" | "WC" | "LL" | "PR" | null;        // qualifier/wildcard/lucky-loser/protected
type MatchStatus = "notstarted" | "scheduled" | "live" | "finished" | "retired" | "walkover";

interface Snapshot {
  schemaVersion: number;            // bump on breaking changes; app guards against mismatch
  generatedAt: string;              // ISO; drives "updated N min ago" + staleness
  tour: Tour;
  tournament: {
    slam: string;                   // "roland-garros" | "wimbledon" | "us-open" | "australian-open"
    name: string; year: number; surface: string;
    sofaUniqueTournamentId: number; sofaSeasonId: number;
    drawSize: number;               // 128
  };
  players: Record<string, Player>;
  matches: Record<string, Match>;   // keyed by our matchId = `${roundIndex}-${slot}`
  rounds: Round[];                  // ordered outer→inner (R128 … Final)
  playerStats: Record<string, PlayerStats>;
}

interface Player {
  id: string; name: string; country: string;   // IOC 3-letter
  seed: number | null; entry: EntryType; ranking: number | null;
  ageYears: number | null; sofaSlug: string | null;
}

interface Match {
  id: string; roundIndex: number; slot: number; nextMatchId: string | null;
  p1: string | null; p2: string | null;        // playerId; null = TBD
  status: MatchStatus; winner: "p1" | "p2" | null;
  score: SetScore[] | null;                     // [{p1,p2,tb?}], finished/live
  live: { set: number; game: string; server: "p1" | "p2" } | null;
  durationSec: number | null;                   // Σ time.periodN (provisional while live)
  durationProvisional: boolean;
  sofaEventId: number | null; sofaCustomId: string | null;   // deep-link
  stats: MatchStats | null;                     // aces, df, 1st%, bp, etc. (lazy)
  projection: { p1: string | null; p2: string | null } | null;  // seed-based, when unplayed
}

interface PlayerStats {
  cumulativeSec: number; provisional: boolean;  // sum across played matches
  matchesPlayed: number; roundReached: number;
}

interface Round {
  index: number;          // 0 = first round (R128, outer) … last = Final (inner)
  name: string;           // "Round of 128" … "Final"
  size: number;           // entrants this round (128, 64, …, 2)
  matchIds: string[];
}

interface SetScore { p1: number; p2: number; tb?: number; }   // games per set (+ tiebreak)

interface MatchStats {                                        // from /event/{id}/statistics
  aces?: [number, number]; doubleFaults?: [number, number];
  firstServePct?: [number, number]; breakPointsConverted?: [string, string];
  servicePointsWon?: [number, number];                        // [p1, p2]; extend as needed
}
```

`bracketTree` is **derived** in the app from `matches` via `nextMatchId` (root =
the Final), so the JSON stays flat and small.

---

## 5. Sunburst layout & interaction

- **Layout (`layout.ts`, pure):** build a `d3-hierarchy` over the bracket
  (root = Final match; leaves = 128 first-round slots) and apply a **radial
  partition** to assign each node an angular extent `[x0,x1]` and radial band
  `[y0,y1]`. Each ring = one round; each arc = a (round, bracket-slot) occupied by
  the actual winner if played, else the **projected** seed. Returns plain geometry
  objects — no DOM, no `d3-selection`. `render.ts` turns geometry into `<path>`/
  `<text>` strings.
- **Zoom = tap-to-focus (zoomable sunburst):** tapping an arc sets a `focus` node;
  the angular domain rescales so that subtree fills the circle, and labels/score/
  stats fade in at the higher zoom. Tap the centre (or a breadcrumb) to zoom out.
  This solves 128-on-the-outer-ring legibility and is thumb-friendly. (Free
  pinch-zoom is a later enhancement; v1 ships semantic tap-zoom.)
- **Match detail:** tapping a match opens a card (names, seeds, score, duration,
  key stats) with **"Open in SofaScore ↗"** (deep-link via `sofaCustomId`, opens
  the native app through Universal/App Links when installed, else web).
- **Live affordance:** in-progress matches pulse; "updated N min ago" shows snapshot age.
- **Controls:** ATP/WTA toggle; **"colour by"** selector; reset-zoom; legend.

---

## 6. Colour-by system (`color.ts`, pure)

Arcs are coloured by a **swappable dimension**. Each dimension maps a player/arc to
a colour via a pure scale:

- **time-on-court** (default): sequential heat scale over `playerStats.cumulativeSec` (cool=fresh → warm=heavy). `d3-interpolate`/`d3-scale`.
- **seed**: ordinal/sequential by seed (1 = brightest), unseeded muted.
- **nationality**: categorical by `country`.
- **round reached / status / age**: further dimensions as data allows.

A **leaderboard panel** lists players ranked by the active dimension (e.g. most
hours on court). Adding a dimension = adding one pure scale function + a legend
entry; nothing else changes.

---

## 7. Time-on-court computation (`state.ts`, pure)

Per `RESEARCH.md`:
- Per match, `durationSec = Σ event.time.periodN` (per-set seconds; robust to
  rain/overnight suspensions because each set's clock is bounded). Live matches
  get a **provisional** estimate (`Σ completed periods + (now − currentPeriodStart)`,
  else `now − startTimestamp`), finalized to `Σ periodN` at match end.
- **Gating:** count `finished` + `retired` (partial time is real) and `live`
  (provisional); **add 0** for `walkover` / `notstarted`. Treat missing duration as
  **unknown, never 0**, and surface that a value is provisional/partial.
- `playerStats.cumulativeSec` = sum of a player's counted matches; `provisional`
  true if any contributing match is live/provisional.

---

## 8. Seed projection (`state.ts`, pure)

For matches with TBD participants, fill a **"chalk" projection**: from the current
known results forward, advance the higher-seeded (fallback: higher-ranked) player
in each unplayed match. `match.projection` holds projected `p1/p2`. `render.ts`
draws projected arcs **dashed/dimmed**; once a match is actually played, the real
result replaces the projection. This yields "who would meet whom, until they
actually meet."

---

## 9. PWA / offline (`vite-plugin-pwa`)

- `registerType: "autoUpdate"`; manifest (name, icons via `@vite-pwa/assets-generator`, theme/background, standalone, start_url `/`).
- SW **precaches** the app shell; **runtime-caches** the data JSON with
  **StaleWhileRevalidate** so the bracket renders instantly and works offline.
- `store.ts` mirrors the last-good snapshot in **IndexedDB** (`idb-keyval`) with a
  `createMemoryStore()` fallback for private-mode/tests; the app always renders the
  last-good state even fully offline. Revalidate on load, `online`, and
  `visibilitychange` after staleness.
- Light/dark theme toggle, persisted (matches wattblock/ErgoFlow).

---

## 10. Ingestion (`ingest/`, Node + TS) & scheduling

- **Endpoints** (SofaScore, see `RESEARCH.md` §1 for verified shapes): `search/all`
  → `unique-tournament/{ut}/seasons` → `…/season/{s}/cuptrees` (draw+seeds),
  `…/events/last/0` (results), `sport/tennis/events/live` (live),
  `event/{id}` (durations + `customId`), `event/{id}/statistics` (lazy, completed
  matches first to limit calls).
- **Fetch:** Playwright (headless Chromium) requests the JSON endpoints in a real
  browser context to defeat Cloudflare. **ESPN** (`site.api.espn.com/.../tennis/
  {atp|wta}/scoreboard`) is a plain-fetch fallback for live scores/status.
- **Normalize:** map SofaScore's `cuptrees`/`event` shapes to §4. `teamSeed`
  → `seed`/`entry`. Isolate all SofaScore-specific parsing here so endpoint drift
  never touches the app.
- **Derive:** time-on-court, projections, `nextMatchId` links.
- **Publish:** write `atp.json`, `wta.json`, `index.json` to the chosen CDN target.
- **Schedule:** `.github/workflows/refresh.yml` cron (e.g. `*/5 * * * *`). The
  script self-throttles: if no target Slam is active, do a light no-op/low-frequency
  check. Config (`ingest/config.ts`) maps the current target Slam → fixed
  `uniqueTournamentId`s (ATP/WTA) with auto season resolution.
- **Robustness:** on fetch failure, **do not overwrite** the last-good JSON; log
  loudly. A schema/sanity check (expect 128 entrants once the draw is out) fails CI
  visibly so silent drift is caught.

---

## 11. Module / file layout

```
TennisArc/
  index.html
  vite.config.ts            # + VitePWA
  package.json  tsconfig.json
  src/
    model.ts                # normalized types (the contract)
    api.ts                  # fetch snapshots + revalidation
    store.ts                # idb-keyval cache (+ createMemoryStore)
    state.ts                # pure: sunburst model, time-on-court, projections, colour domains
    layout.ts               # pure: d3-hierarchy + radial partition → arc geometry
    color.ts                # pure: colour scales per dimension
    deeplink.ts             # SofaScore match URL from customId
    render.ts               # SVG/HTML strings
    app.ts                  # orchestration, hash router, event delegation, zoom
    main.ts                 # thin entry: SW register + mount
    theme.ts                # light/dark toggle (persisted)
    *.test.ts               # colocated Vitest
    app.css
  ingest/
    index.ts                # entry (run by CI)
    sofascore.ts            # Playwright fetch + parse (isolated)
    espn.ts                 # fallback live scores
    normalize.ts            # → model.ts shapes
    derive.ts               # time-on-court, projections, tree links
    publish.ts              # write to CDN target
    config.ts               # target Slam + tournament ids
    fixtures/               # captured RG2026 samples for tests
    *.test.ts
  .github/workflows/refresh.yml
  RESEARCH.md
```

---

## 12. Testing strategy

- **Vitest**, colocated `*.test.ts`, `TZ=UTC` pinned (deterministic time logic).
- **Pure modules get the coverage:** `state` (time-on-court gating incl. RET/W-O/
  live-provisional; projection chalk-fill), `layout` (angular/radial extents,
  focus rescale), `color` (each dimension's scale), `deeplink`, derive/normalize.
- **Fixtures:** capture a real **RG 2026 `cuptrees` + a few `event` payloads** to
  `ingest/fixtures/`; normalization + derivation tested against them, so we test
  against real SofaScore shapes without live calls.
- `store.ts` tested via `createMemoryStore()` (never mock IDB directly).
- `render.ts`: string-output assertions on representative states.
- `app.ts`/`main.ts`: **manual smoke checklist** (install/offline/zoom/deep-link/
  colour-by/ATP-WTA toggle), like wattblock.

---

## 13. Error handling & edge cases

- **No active draw yet:** show a "draw not released" state; ingestion keeps polling.
- **Fetch/Cloudflare failure:** app renders last-good IDB snapshot + a stale badge; ingestion never clobbers good data with a failure.
- **Byes / odd draws:** 128 singles slams have no byes, but the model tolerates `null` participants and TBD slots.
- **RET / W-O / suspended:** handled in §7 gating; suspended freezes the accumulator.
- **Endpoint drift:** isolated in `ingest/sofascore.ts`; `schemaVersion` guard in the app; CI sanity-check fails loudly.
- **Private mode / no IDB:** `createMemoryStore()` + a non-persistent banner.

---

## 14. Risks

| Risk | Mitigation |
|---|---|
| SofaScore Cloudflare blocks | Playwright in CI; ESPN fallback; always render last-good from IDB |
| SofaScore ToS | Non-commercial, server-side only, link-out, attribution, polite cadence |
| Endpoint shape changes | Isolated parsing + `schemaVersion` + loud CI sanity check |
| Sunburst legibility at 128 | Tap-to-focus zoom reveals labels; accessible linear fallback later |
| GH Actions cron latency (~5–15 min) | Acceptable for results; real-time via deep-link out |

---

## 15. Open decisions (resolve in planning, all reversible)
1. **Publish target:** GitHub Pages `data` branch / jsDelivr (default) vs Vercel Blob.
2. **Stats fetch breadth:** all matches vs completed-only-first (call-budget vs completeness).
3. **Animation of zoom transition:** instant re-layout (v1) vs rAF-tweened arcs (polish).
