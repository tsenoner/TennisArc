# Shareable deep-link routes — design

**Date:** 2026-06-30
**Status:** approved (design), pending implementation plan

## Goal

Make every meaningful view of TennisArc directly shareable by encoding it in the
URL, so a pasted link reopens the **same tour, year, tournament, tab (lens), and
subtab (seed sort)**. The base URL `/` (and the logo) always lands on the current
tournament. Browser Back undoes view switches one at a time.

Today none of this is in the URL: view state (`tour`, `year`, `slam`, `colorDim`,
`seedSort`) lives only in memory, and the URL hash is used *only* for the
ephemeral zoom/focus (`#r.0.0`), which is deliberately scrubbed on load
(`app.ts` "Deep-link restore is deliberately NOT implemented").

## Decisions (locked with the user)

1. **Hybrid path + query scheme.** The genuinely-distinct, indexable resource
   (a specific draw) lives in the **path** — `/{tour}/{year}/{slam}`. The view
   state (lens + seed sort) lives in the **query** — `?view=…&sub=…`. Path
   addresses *what* you're looking at; query says *how* you're viewing it.
2. **Query param names: `view` and `sub`.** `view` = lens (`colorDim`),
   `sub` = subtab (seed sort).
3. **Back undoes each switch** — view changes push history entries.
4. **Zoom/focus is out of scope** for sharing — it stays session-only (URL hash)
   and is still scrubbed on cold load.
5. **`/` → ATP current tournament** (the existing `pickDefaultSlam` default for the
   default tour), then the URL is canonicalized to the concrete path.
6. **Logo = plain reload to `/`** — keep the existing `<a href="/">`; no SPA intercept.

## Non-goals (stay ephemeral — not in the URL)

Zoom/focus, selected match, pinned player, selected country, theme. These remain
in-memory session state, matching the user's shareable-fields list. (The query
scheme makes adding any of these trivial later — e.g. `&country=ESP` — but they
are explicitly deferred for now.)

## URL grammar

```
/{tour}/{year}/{slam}?view={lens}&sub={sort}
```

Path segments (the resource):

| Segment | Values                                                          | Maps to                  |
| ------- | -------------------------------------------------------------- | ------------------------ |
| `tour`  | `atp` \| `wta`                                                 | state `Tour` (`ATP`/`WTA`) |
| `year`  | 4 digits                                                       | `year: number`           |
| `slam`  | `australian-open` \| `roland-garros` \| `wimbledon` \| `us-open` | `slam: string` (existing IDs) |

Query params (the view, omitted when default):

| Param          | Values                       | Maps to               | Default (omitted) |
| -------------- | ---------------------------- | --------------------- | ----------------- |
| `view` ("tab") | `time` \| `seed` \| `country` | `colorDim: ColorDim`  | `time`            |
| `sub` ("subtab") | `seed` \| `elo`            | `seedSort: SeedSort`  | `seed`; only meaningful when `view=seed` |

**Canonical examples**

```
/atp/2025/wimbledon                       → default view (time lens)
/atp/2025/wimbledon?view=seed             → seed lens, seed sort
/atp/2025/wimbledon?view=seed&sub=elo     → seed lens, ELO sort
/atp/2025/wimbledon?view=country          → country lens
/wta/2024/roland-garros                   → default view
/                                          → resolves to ATP current, then canonicalizes
```

### Build rules (canonical, what the app emits)

- Path is always the three resource segments; `tour` lowercased.
- Omit `view` when it is the default (`time`).
- Omit `sub` unless `view=seed` **and** `sub=elo` (the only non-default, meaningful
  case). `sub` is never emitted on a non-seed lens.
- Query keys emitted in a fixed order (`view` before `sub`) for stable, cache-friendly URLs.

### Parse rules (tolerant, what the app accepts)

- Path: `/{tour}/{year}/{slam}`. `tour` is case-insensitive; a trailing slash is
  ignored; missing/extra/unknown path segments leave that field unset (filled by
  defaults during validation) rather than throwing.
- Query: read via `URLSearchParams` — order-independent. Unknown keys are ignored.
- `view` not in `{time,seed,country}` → unset → default `time`.
- `sub` not in `{seed,elo}` → unset → default `seed`. `sub` present under a
  non-seed `view` is accepted into state but is inert and gets dropped on the next
  canonicalization (build omits it off the seed lens).

## New pure module: `src/route.ts`

```ts
export interface Route {
  tour: Tour;
  year: number;
  slam: string;
  view: ColorDim;   // lens / "tab"
  sub: SeedSort;    // seed sort / "subtab"
}

/** Tolerant parse of pathname + search into whatever fields are present &
 *  syntactically valid. No index validation here (that needs the manifest) —
 *  only shape/whitelist checks. Pure: takes strings, never touches `location`. */
export function parseRoute(pathname: string, search: string): Partial<Route>;

/** Canonical relative URL (path + query, no hash) for a fully-resolved view.
 *  Lowercases tour; omits default `view`/`sub` per the build rules above. */
export function buildRoute(r: Route): string;
```

- `view` is validated against `COLOR_DIMS` (`color.ts`); `sub` against `seed`/`elo`;
  `slam` against `SLAM_ORDER` (`slams.ts`); `tour` against `ATP`/`WTA`; `year` is a
  finite 4-digit number. Anything failing a whitelist is treated as "unset".
- Pure and dependency-light (imports only types + the existing whitelists). No DOM,
  no `location` — the caller passes `location.pathname` / `location.search`.

### `route.test.ts` (new)

- `parseRoute`: bare slam (view defaults); `?view=seed`; `?view=seed&sub=elo`;
  `?sub=elo&view=seed` (order-independent); mixed-case tour; trailing slash;
  unknown `view`/`sub`/slam/tour (→ unset); unknown query keys ignored; `sub` under
  a non-seed view (accepted, inert); `/` (→ empty).
- `buildRoute`: default view omits the query entirely; `view=seed` (default sub)
  omits `sub`; `view=seed&sub=elo` emits both; non-seed view never emits `sub`;
  tour lowercased; key order `view` then `sub`.
- **Round-trip**: `parseRoute(...split(buildRoute(r)))` deep-equals `r` for every
  canonical `r`.

## Load & default behavior (`app.ts`)

1. On boot, `parseRoute(location.pathname, location.search)` seeds candidate
   `tour/year/slam/view/sub`, replacing the current hardcoded init defaults
   (`tour:"ATP", year:0, ...`). Fields the URL doesn't supply stay at their existing
   defaults (`colorDim:"time"`, `seedSort:"seed"`).
2. When the index resolves (existing bootstrap IIFE), **validate** the candidate:
   - `tour` not `ATP`/`WTA` → default `ATP`.
   - `year`+`slam` not available for that tour (via `availableYears`/`slamsForYear`)
     → `pickDefaultSlam(index, tour)`.
   - `view`/`sub` already whitelisted at parse time.
3. After resolving, **canonicalize** the URL with `replaceState(buildUrl())` so `/`,
   partial, or stale links become the concrete clean URL (and a copy-paste then
   shares that exact view). No new history entry.
4. The existing "warm the other tour" background load is unchanged (keyed off the
   resolved tour).

`/` and the logo: the logo stays `<a href="/">` (plain reload). A reload of `/`
re-runs `createApp`, resolves the ATP current tournament, and canonicalizes — so
both paths converge on the same default behavior with no extra code.

## Unified history model (core refactor)

The current focus-history code (`ownsEntry`, `setFocus`, `resetSelection`, the
`popstate` handler, the startup scrub) restores **only focus** on `popstate`. Once
the URL also carries view state, `popstate` must restore **both**. The two history
axes are therefore unified behind one URL builder and one commit primitive.

```ts
// Full canonical URL for the current state: path + query (view) + optional "#" + focus.
const buildUrl = () => buildRoute(currentRoute()) + (state.focusId ? `#${state.focusId}` : "");

// One write primitive. `push` adds an entry (Back-able); otherwise replaces in place.
const commit = (push: boolean) =>
  history[push ? "pushState" : "replaceState"]({ f: state.focusId }, "", buildUrl());
```

Behavior table:

| Action                                               | History op                              |
| ---------------------------------------------------- | --------------------------------------- |
| View change (tour/year/slam/view/sub), not zoomed    | **push** (Back undoes each switch)      |
| Enter zoom (focus a section)                          | push (one entry per zoom session)       |
| Zoom level change (drill deeper / ancestor chip)     | replace (still one entry)               |
| Esc / crumb "Full draw" / hub clears zoom            | `history.back()` (Back/Esc exit zoom)   |
| tour/year/slam change **while zoomed**               | clear focus in state, then push new view |
| view/sub change **while zoomed**                     | replace, **keep** zoom (no Back pile-up) |
| Cold load carrying a `#focus`                         | scrubbed (zoom not shared)              |

Rationale for the two "while zoomed" rows:

- A tournament switch is a "go somewhere new" gesture → push the new view (the old
  zoomed entry remains behind; Back returns to it). This avoids the
  `history.back()`-then-`pushState` race that makes the old `resetSelection` teardown
  incompatible with pushing a new view.
- Toggling a lens while drilled into a quarter is a recolor of the *same* place, so
  it replaces (keeps zoom, no extra Back step). Outside zoom, view/sub push normally.

### `popstate` handler (rewritten, view-aware)

On `popstate`:

1. Resolve the target route from the URL:
   `parseRoute(location.pathname, location.search)`, validated against the
   (now-loaded) index; fall back to defaults if it doesn't resolve.
2. Resolve target focus from `e.state.f` (or `location.hash`), adopted only if it
   names a real node in the target draw (existing `normalizeFocus`/`inTree`).
3. If tour/year/slam changed: apply them, drop per-draw selections (the existing
   `resetSelection` minus its history mutations — popstate must never write history),
   then `draw()` and `load()` the snapshot if not cached.
4. Else if only view/sub/focus changed: apply and `draw()`.

This subsumes the current focus-only `popstate` handler.

### Startup scrub (kept, narrowed)

Still scrub a cold-load **hash** before the first draw (zoom is not shared). But the
**path and query are now honored**, so the scrub targets only the hash/`history.state`,
never the pathname/search (`replaceState(null, "", location.pathname + location.search)`
already preserves both — unchanged line, new significance).

### View-change handlers

Each existing click handler that changes a shared field
(`tour`, `slam`, `year`, `colordim`, `seed-sort`) gains a `commit(push)` call after
its state mutation and `draw()`, following the table above. `selectForTour`,
`resetSelection`, and `setFocus` are reworked to route their history writes through
`commit`/`buildUrl` instead of ad-hoc `pushState`/`replaceState`/`back()`.

## Production routing: `vercel.json`

Add an SPA-fallback rewrite so a hard load of a deep path serves the app (Vercel's
documented Vite-SPA pattern):

```jsonc
{ "source": "/(.*)", "destination": "/index.html" }
```

- Placed **last** in `rewrites`. Vercel checks the filesystem (static assets like
  `/logo.svg`, `/assets/*`, PWA files) **before** rewrites, and the existing
  `/data/...` rewrite is more specific and listed first — so neither is shadowed.
  (Query strings don't affect rewrite matching; only the path does.)
- Vite dev (`appType: 'spa'`) and `vite preview` already do SPA fallback, so local
  dev needs no change. This rewrite is for the deployed site only.

## PWA offline deep-links: `vite.config.ts`

The Workbox config currently sets no `navigateFallback`, so an **installed/offline**
PWA opening a deep path (`/atp/2024/wimbledon`) has no cached response for that URL
and the navigation fails. Add to the `workbox` block:

```ts
navigateFallback: "/index.html",
navigateFallbackDenylist: [/^\/data\//],   // data is runtime-cached, not the app shell
```

So offline navigations to any in-app route resolve to the precached app shell, while
`/data/*` keeps using its `StaleWhileRevalidate` runtime cache. (Online, the Vercel
rewrite already covers this; this is the offline/installed path.)

## Files touched

- **New:** `src/route.ts`, `src/route.test.ts`
- **Edit:**
  - `src/app.ts` — init from `parseRoute`; `buildUrl`/`commit`; validate +
    canonicalize on index load; view-aware `popstate`; `commit` calls in view
    handlers; rework `setFocus`/`resetSelection`/`selectForTour`/startup scrub.
  - `src/app.test.ts` — rewrite the "focus history discipline" / "startup scrub"
    suites to the unified model; add cold-load-from-URL, default-at-`/`,
    push-on-view-change, and `popstate`-restores-view tests.
  - `vercel.json` — SPA fallback rewrite.
  - `vite.config.ts` — Workbox `navigateFallback` + denylist.
- **Optional:** a short "Sharing links" note in `docs/HELP.md` / `README.md`.

## Testing strategy

- **Unit (`route.test.ts`):** parse/build/round-trip per the cases above.
- **Integration (`app.test.ts`, jsdom):**
  - Cold load `/wta/2026/roland-garros?view=seed&sub=elo` → state reflects all five fields.
  - Cold load `/` → ATP current; URL canonicalized via `replaceState`.
  - Cold load a stale/invalid path → falls back to default; URL canonicalized.
  - A view/slam/year/sub switch calls `pushState` with the canonical URL.
  - `popstate` to a prior entry restores the full view (and clears/sets focus).
  - Cold load with a `#focus` hash is still scrubbed; the path + query are preserved.
- The full existing suite (`TZ=UTC vitest run`) must pass; `tsc --noEmit` clean.

## Edge cases

- **Stale shared link** (year/slam since removed from the manifest) → default +
  canonicalize (no error screen).
- **Hand-typed junk** (`/atp/abcd/foo?view=bogus`) → tolerant parse leaves bad
  fields unset → defaults fill them → canonicalized.
- **Tour-only / year-only path fragments** → unresolved fields default.
- **`popstate` to an entry whose snapshot isn't cached** → `load()` fetches it
  (existing path), `draw()` shows the loading state meanwhile.
- **`sub` without a seed `view`** (`?view=time&sub=elo`) → accepted, inert, dropped
  on the next canonicalization.
- **Unknown query keys** (`?utm_source=x`) → ignored on parse, dropped on canonicalize.
