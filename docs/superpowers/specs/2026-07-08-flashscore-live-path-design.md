# Flashscore live-score path — design

**Date:** 2026-07-08
**Status:** implemented (branch feat/flashscore-live-path)

> **Post-design finding (deploy verification, build step 1 / Task 7):** because `package.json` is
> `"type": "module"`, Vercel transpiles `api/live.ts` to ESM without bundling, so relative imports
> in its chain need explicit `.js` extensions (Node ESM requirement) — omitted extensions crash
> cold start with `ERR_MODULE_NOT_FOUND`. Not anticipated in the design below; fixed in the code
> with inline comments.

**Tracks:** P2 (roadmap), GitHub #48 (Flashscore evaluation). Related: #41 (Sackmann→TML),
memory `flashscore-as-supplementary-source`, `sofascore-anti-bot-fingerprint`.

## Goal

Deliver **sub-minute live scores** for the in-play Grand Slam, at **$0**, with the Mac **out of
the live-score path**. The Mac still supplies the slow *structure* truth (draw shape, new matches,
durations, seeds, ELO) via the existing 30-min `data`-branch cycle; only **score/status
freshness** moves to a Flashscore-backed Vercel function. Today the client polls the snapshot
(`src/app.ts`, 90s), but `raw.githubusercontent.com` caches the `data` branch ~300s, so real
freshness is ceiling'd at ~5 min. This path adds a fast overlay on top of that slow truth.

## Spike findings (2026-07-08, live Wimbledon 2026, residential IP)

Verified first-hand — these **correct** the pre-spike architecture (which assumed `df_sur`):

- **Live path is the LIST feed, not `df_sur`.** `df_sur_1_<id>` for an in-progress match is ~130
  bytes (empty) — it is the *finished*-match summary/duration feed. Live scores ride the global
  livescore feed **`https://global.flashscore.ninja/2/x/feed/f_2_0_3_en_1`** (`2`=tennis; ~1.4 MB,
  all pro tennis for the day, Wimbledon block at the top). `df_sur` stays reserved for the
  duration gap-fill (#48), out of scope here.
- **`x-fsign: SW9D1eZo` is required** (no header → HTTP 401); the decade-old token still works.
- **No UA / TLS-JA3 / Cloudflare gate.** Bare `curl` (no browser UA) + the header → HTTP 200 full
  payload; `server: nginx`, no `cf-ray`. SofaScore's entire block mechanism is *absent* here.
- **Live deltas proven:** snapshotting all live matches 40s apart, **38 of 43** changed game/set
  score; a completing match flipped stage `2→3` live.
- **One assumption remains:** that Flashscore answers from a **Vercel egress IP**. Strong indirect
  evidence (no fingerprint layer at all; prior 3-vote datacenter verification 2026-07-03), but not
  yet confirmed from an actual Vercel IP. **Closed by build step 1** (preview-deploy probe).

### List-feed record shape (ground truth)

Records split on `~`; a match record starts `AA÷`; pairs split on `¬`; key÷value on `÷`.
Tournaments are **positional**: a header record carrying `ZA`/`ZB` precedes its match records
until the next header — the parser tracks "current tournament" as it walks.

| field | meaning |
| --- | --- |
| `AA` | Flashscore event id (8-char opaque) |
| `AB` | stage: `1`=scheduled, `2`=**live**, `3`=finished |
| `AE` / `AF` | home / away short name, **surname-first** (`"Fritz T."`) |
| `AG` / `AH` | sets won (home / away) |
| `BA/BB`, `BC/BD`, `BE/BF`, … | per-set games (set 1, set 2, set 3, …) home/away |
| `CX` | current server (name) |
| `ZA` | tournament header (`"ATP - SINGLES: Wimbledon (United Kingdom), grass"`) |
| `ZB` | tournament id |
| `AL`, `MW` | betting-odds noise — **strip** |

## Architecture

```
Flashscore  f_2_0_3_en_1  (1.4 MB, all tennis)
     │  x-fsign header, server-side fetch
     ▼
/api/live.ts  ── thin Vercel Node fn: fetch → parseLiveFeed(tour,slam) → JSON (few KB)
     │            Cache-Control: public, s-maxage=25, stale-while-revalidate=60
     │            NO data-branch read, NO Mac dependency (pure Flashscore → parsed)
     ▼
client  src/live.ts ── fetchLive() every ~30s while viewing a LIVE slam (+ visibility gate)
     │            overlayLive(): join Flashscore records ↔ snapshot matches by surname-pair
     ▼
state.livePatch { matchId → Partial<Match> }  ── merged at draw() OVER the immutable snapshot
                                                  (snapshot stays the source of truth)
```

Chosen (Approach 1 of 3): **stateless `/api/live` parser + client-side join.** Rejected:
server-side join (couples the fn to the `data` branch) and a Mac-baked `flashscoreId` map (a new
match wouldn't go live until the next Mac cycle — partially reintroduces the Mac to the live path).

## Module map

| file | change | responsibility |
| --- | --- | --- |
| `src/names.ts` | **new** | Move `nameTokens/fullKey/sigKey/pairKey` here (pure, dependency-free). Add `flashSigKey`. |
| `ingest/names.ts` | edit | Re-export the moved primitives from `../src/names`; keep `TOURNEY`/`ROUND`. Behaviour byte-identical (`durations.test.ts` pins it). |
| `ingest/flashscore.ts` | **new** | `parseLiveFeed(text, {tour, slam})` → `LiveRecord[]`. Pure, unit-tested. |
| `api/live.ts` | **new** | Vercel Node fn: fetch feed w/ `x-fsign`, call `parseLiveFeed`, return JSON + cache headers; upstream failure → `{matches:[]}`. |
| `src/live.ts` | **new** | `fetchLive(tour, slam)` + `overlayLive(snapshot, records)` → `Record<matchId, Partial<Match>>`. Unit-tested. |
| `src/app.ts` | edit | ~30s `/api/live` poll gated on `isLiveView()` + visibility; apply patches to `state.livePatch`; redraw on change. Flashscore attribution in the credits line. |
| `vercel.json` | edit (verify) | Ensure `/api/*` is served as a function and not swallowed by the SPA catch-all rewrite. |

## The join (client-side)

`flashSigKey` normalizes Flashscore's surname-first short name to the **same** `"surname:initial"`
space as SofaScore's `sigKey(fullName)`:

- SofaScore `sigKey("Taylor Fritz")` = last token `fritz` + first-token initial `t` → `"fritz:t"`.
- Flashscore `flashSigKey("Fritz T.")`: trailing single-letter token is the initial (`t`); the
  token before it is the surname (`fritz`) → `"fritz:t"`. **Match.**
- Compound: `flashSigKey("Van Uytvanck A.")` → surname token `uytvanck`, initial `a` → `"uytvanck:a"`,
  equal to `sigKey("Alison Van Uytvanck")` (both take the *last* surname token, per existing convention).
- Hyphens split (`nameTokens`): `flashSigKey("Auger-Aliassime F.")` → `"aliassime:f"` = `sigKey("Felix Auger-Aliassime")`.

Within one live singles draw a surname+initial **pair** is effectively unique, so the join keys on
the sorted `sigKey` pair — **no round needed**. Steps in `overlayLive`:

1. Build `pairIndex: sortedSigPair → Match` from the snapshot's matches; **drop ambiguous keys**
   (two matches sharing a pair → skip both, never mis-join — mirrors `applyDurations`' null guard).
2. For each Flashscore record: compute the pair from `flashSigKey(home)`+`flashSigKey(away)`; look
   up the match; if found, resolve orientation (`flashSigKey(home) === sigKey(p1.name)` → home=p1,
   else home=p2) and orient sets/won accordingly.
3. Emit `Partial<Match>`: `status` (stage 2→`live`, 3→`finished`), `winner`, `score` (`SetScore[]`
   from oriented per-set games), and `live` (`{set, game, server}`) when derivable.
   - **Winner (fail-safe):** on stage 3, set `winner` only when a side **reached the sets-to-win
     threshold** (ATP slam best-of-5 → 3; WTA best-of-3 → 2). Otherwise (equal, or a lead below
     threshold — the retirement/walkover shape) leave `winner` unset and let the snapshot decide.
     This never shows a retiree-who-led as the winner; the snapshot reconciles within a cycle.

**Overlay scope: live (stage 2) AND just-finished (stage 3).** Both beat the ≤5-min snapshot
ceiling (faster winner reveal). Scheduled (stage 1) is skipped (no score to add). The next
snapshot poll **reconciles authoritatively** and adds what Flashscore is *not* trusted for:
retired/walkover nuance and official durations. Overlay never mutates the stored snapshot; it is
applied to a per-match shallow clone at render time, so the 90s snapshot poll's `generatedAt`
comparison and panel-scroll/interaction preservation are unaffected.

## Endpoint, caching, failure

- `GET /api/live?tour=atp&slam=wimbledon` (only one Grand Slam is live at a time; `tour` picks the
  ATP vs WTA block; `year` is unnecessary — the live feed is inherently "now").
- Response: `{ matches: LiveRecord[] }`, a few KB (only the requested main-draw singles block).
- `Cache-Control: public, s-maxage=25, stale-while-revalidate=60` → all viewers collapse to
  **~1 upstream feed fetch per 25s**. Client polls `/api/live` every ~30s while the viewed slam is
  live (separate from the 90s snapshot poll; reuses the `isLiveView()` + `document.hidden` gates).
- Upstream 401 (token rotated) or any error → fn returns `{matches:[]}` with a short cache; the
  client simply applies no overlay and keeps snapshot values. Graceful, additive-only.
- Filtering excludes non-main-draw blocks: qualifying, doubles, juniors/girls/boys (by `ZA`).

## Legal / volume guardrails (per `flashscore-as-supplementary-source`)

- Extract **only** the live slam's handful of matches; **never persist or republish** the full feed.
- Low volume: ~1 fetch/25s, only during ~slam weeks (~8/year).
- Descriptive User-Agent. Add a **Flashscore attribution** link beside the existing Tennis Abstract
  credit. Gap-fill/cross-check use, not a bulk mirror — de-minimis per the memory's analysis.

## Testing

- `parseLiveFeed` against a **trimmed captured fixture** (real feed sample): asserts tournament
  filtering, per-set orientation, stage mapping, odds-noise stripping. No live network.
- `flashSigKey` cases: simple, compound surname, hyphenated, single-token/edge → `""`.
- `overlayLive`: join success, home/away orientation + score orientation, ambiguity drop, stage
  1/2/3 handling, winner derivation.
- App poll wiring reuses the existing `app.test.ts` "live polling" harness pattern (fake timers,
  hidden-tab gate, single-flight).

## Build sequence

1. **Vercel-IP probe (gate).** Land `api/live.ts` as a minimal fetch-parse-return; deploy a
   **Vercel preview**; confirm it returns live Wimbledon matches *from Vercel's egress*. User review
   gates the merge. If it fails, the flagship pivots here — nothing else is built.
2. `src/names.ts` extraction + `flashSigKey`; keep `ingest/*` tests green.
3. `ingest/flashscore.ts` parser + fixture tests.
4. Flesh out `api/live.ts` (block filtering, cache headers, failure path).
5. `src/live.ts` overlay + tests.
6. `src/app.ts` poll wiring + Flashscore attribution.

## Risks / open items

- **Vercel-IP tolerance** — the one unconfirmed assumption; step 1 closes it before real build.
- **`x-fsign` rotation** — static ~decade; v1 hardcodes it and fails soft (empty overlay). Auto
  re-scrape from the JS bundle is a noted future self-heal, not v1.
- **Full-feed fetch cost** — 1.4 MB parsed per cache-miss (~1/25s). Trivial on Fluid Compute; a
  tournament-scoped feed is a future optimization, not v1.
- **Name-join edge** — two same-surname-same-initial players in one draw drop safely to the
  snapshot (ambiguity guard). Acceptable.
