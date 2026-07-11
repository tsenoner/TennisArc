# Point-by-point live score in the match strip — design

**Date:** 2026-07-10
**Status:** approved (user, 2026-07-10)
**Predecessor:** `2026-07-08-flashscore-live-path-design.md` (the `/api/live` overlay this extends)
**Research:** deep-research pass 2026-07-10 (102 agents) + same-day first-hand spikes; report artifact
`claude.ai/code/artifact/1de49b17-95e8-4882-a550-d57b0d000b7f`. All Flashscore feed facts below were
verified first-hand against the live Sinner–Djokovic Wimbledon SF, including from Vercel egress.

## Goal

While a **live match is selected**, its strip shows the **current game's point score**
(`30–15`, `A–40`, tiebreak digits), a **serve dot** by the serving player, and at most one
**chip** — `BP` / `SP` / `MP` — computed locally. Nothing else changes: the wheel, the list-feed
overlay, and the panel lifecycle stay as shipped in PR #57.

Out of scope (deferred by decision): the full per-game point history (`df_mh`) as a reading
experience; centre-disc mirroring; showing points for unselected live matches.

## Spike findings (2026-07-10, ground truth)

- `df_mhs_1_<mid>` — current-game state, ~192 B. `TS/PT/PV`-tagged: two `TS÷SC` blocks, each
  `PT÷PT¬PV÷<playerNo>¬PT÷VA¬PV÷<points>`, where `<playerNo>` is `1` (home) / `2` (away) and
  `<points>` is `0|15|30|40|A` (plain digits during tiebreaks). Between games both read `0`.
- `df_mh_1_<mid>` — completed games only; the game in progress never appears. Not used in v1.
- `g_1_<mid>` — change-signature feed (hashes / 204). Not used.
- Same host + auth as the list feed: `https://global.flashscore.ninja/2/x/feed/<code>`,
  header `x-fsign: SW9D1eZo`, no UA/TLS/Cloudflare gate. **Vercel-egress verified 200** for all
  three feeds (user-deployed probe, fra1).
- The LIST feed (`f_2_0_3_en_1`) carries `CX÷<server short name>` on live records but **no
  in-game point field** — which is why points need the per-match feed and the server indicator
  rides the existing `/api/live` parse.
- Match id (`mid`) is the list feed's `AA` field — `/api/live` already parses those records, so
  the overlay join gives every live snapshot-match its `mid` for free.

## Approaches considered

- **A (chosen): dedicated `/api/pbp?mid=` over `df_mhs`.** Per-match scope, 192 B upstream,
  cache key per mid, and point ticks update the strip DOM **in place** — no `draw()`, no
  scroll/focus churn, no interaction with `samePatch()`.
- **B: enrich `/api/live` with points for all live matches.** Requires fanning out one `df_mhs`
  fetch per live match (~16 on busy days) each poll, and point-level churn would invalidate the
  overlay patch every few seconds → constant full redraws. Rejected.
- **C: derive from `df_mh`.** The current game isn't present until complete. Rejected.

## Architecture

```
client (selected live match, 8s tick, gated)
  └─ GET /api/pbp?mid=nkXJ8mYa                       same-origin Vercel fn
       └─ GET global.flashscore.ninja/2/x/feed/df_mhs_1_nkXJ8mYa   (x-fsign)
       ← { home: "30", away: "15" }                   s-maxage=5, SWR=15
  └─ orient home/away → p1/p2 via the overlay's flashHomeIsP1
  └─ chips from src/points.ts (pure)                  BP / SP / MP / tiebreak
  └─ in-place DOM update of the strip's point nodes   (freshness-chip pattern; never draw())
```

## Module map

- **`api/_flashscore.ts` (new, extracted):** the `x-fsign` token, UA string, feed host, and a
  `fetchFeed(code)` helper — imported by `api/live.ts` and `api/pbp.ts` **with `.js` extensions**
  (Vercel fns are unbundled ESM; a bare `./_flashscore` import crashes `ERR_MODULE_NOT_FOUND`).
  Files starting with `_` under `api/` are not routed as functions by Vercel.
- **`api/pbp.ts` (new):** validates `mid` (`/^[A-Za-z0-9]{8}$/` → else 400), fetches
  `df_mhs_1_<mid>`, parses, responds `{ home, away }` or `{}` when the feed is empty/shape-less
  (finished / not started). `Cache-Control: public, s-maxage=5, stale-while-revalidate=15`.
  Upstream failure → 502 with `{}`-shaped body; never throws HTML at the client.
- **`ingest/flashscore.ts`:** `parseLiveFeed` additionally emits `srv?: 1 | 2` on stage-2 records
  (`CX` matched against `AE`/`AF` home/away names; absent or unmatched → undefined). Also emits
  the record id already (`AA`) — confirm it reaches `LiveRecord.id` (it does today).
- **`src/model.ts`:** `LiveRecord` gains `srv?: 1 | 2`. The overlay patch (`Partial<Match>`)
  gains three **transient** optional fields on `Match`: `flashId?: string`,
  `flashHomeIsP1?: boolean`, `serving?: "p1" | "p2"`. They exist only on patched live matches —
  snapshot JSON never carries them; they vanish when the match finishes (patch flips to
  `finished` and sets none of them).
- **`src/live.ts`:** `overlayLive` writes the three fields on stage-2 patches. New
  `fetchPbp(mid): Promise<{home: string; away: string} | null>` via `tryFetch` (`no-store`,
  same-origin — the function's `s-maxage` does the coalescing).
- **`src/points.ts` (new, pure):** tennis rules in one place.
  `pointState(input) → { tb: boolean; chip: "BP" | "SP" | "MP" | null; chipFor: "p1" | "p2" | null }`
  where `input = { pts: {p1, p2}, serving?, games: {p1, p2}, sets: {p1, p2}, bestOf: 3 | 5 }`.
  - Tiebreak: `games.p1 === games.p2 && games.p1 >= 6` (covers 6-6 and 12-12-style final sets).
  - In a tiebreak: `tb: true`, **no serve attribution**, chips only for SP/MP (the next point can
    close it: leader at ≥`target−1` points with a lead of ≥1, where `target` is 7 — or **10 in a
    final-set tiebreak** (`sets.p1 + sets.p2 === bestOf − 1`), the format at all four slams since
    2022); never BP.
  - Normal game: game point exists when a side has 40 (other <40) or A. It's a chip only when it
    escalates: receiver's game point → `BP`; game point that would take the set (winning the game
    puts the side to ≥6 games with a 2-game lead, or 7-6… i.e. games+1 wins the set) → `SP`; set
    point that would take the match (`sets+1` reaches `ceil(bestOf/2)`) → `MP`. Highest applicable
    chip wins (MP > SP > BP); exactly one chip, for exactly one side.
  - Unknown server (`serving` undefined) in a normal game → no BP chip (can't attribute), SP/MP
    still computable. Unparseable point strings → `chip: null`, render raw.
- **`src/render.ts`:** `MatchInsight` gains `live?: { flashId: string; homeIsP1: boolean; serving?: "p1"|"p2" }`
  (assembled in the existing insight builder from the patched match). `renderMatchStrip`, when
  `ins.status === "live"`, renders a points block in `.ms-mu`: per side a
  `<span class="ms-pts" data-pts-side="p1|p2">–</span>` (em-dash placeholder until the first
  tick), a serve dot `<span class="ms-serve">` on the serving side (hidden in tiebreaks), and one
  `<span class="ms-chip">` slot. All nodes carry stable data attributes so the poller can update
  them **without re-rendering the strip**.
- **`src/app.ts`:** one `setInterval` (`PBP_POLL_MS = 8_000`). Each tick short-circuits unless:
  `!document.hidden` ∧ `isLiveView()` ∧ a match is selected ∧ its (patched) status is `live` ∧ it
  has `flashId`. On pass: `fetchPbp` → orient via `flashHomeIsP1` → `pointState` → write text /
  toggle classes on the strip's `data-pts` nodes. Also fire one immediate tick when the selection
  changes to a qualifying match (don't make the user wait 8s). Selection change / close / match
  finished → next full render simply has no stale nodes (the strip re-renders through the normal
  path on those events already). Fetch failure → leave the last shown value, retry next tick.
- **`src/app.css`:** `.ms-pts` (tabular-nums, accent), `.ms-serve` (small dot, matches the
  existing `.ms-dot` language), `.ms-chip` (compact badge). Phone + desktop strip layouts.

## Endpoint, caching, volume

- Client 8s tick × edge `s-maxage=5` → N viewers of the same match ≈ one 192 B upstream fetch
  per ~5–8s, only while someone has a live match selected. De-minimis, in line with the legal
  guardrails from the predecessor spec (low volume, server-side cache, gap-fill display,
  attribution link already in the footer).
- `no-store` on the client fetch (browser cache must not eat ticks; the edge coalesces).

## Testing (TDD, vitest, TZ=UTC pinned by config)

1. **`api/pbp` parser** (fixtures from the live spike): mid-game (`15/30/40/A`), between-games
   (`0/0`), tiebreak digits, empty feed (finished match), garbage → `{}` / 400 / 502 paths.
   Handler tested with mocked `fetch` like `api.test.ts` does for `/api/live`.
2. **`src/points.ts` matrix:** deuce/advantage, BP (receiver 40–30; A for receiver), SP
   (5-4 40–15 serving → SP; 6-5 vs 5-4 distinctions), MP (bestOf 3 vs 5), TB entry at 6-6 &
   12-12, TB SP/MP (6+ lead-by-1), no-server → no BP, junk input → null chip.
3. **`overlayLive`:** stage-2 patch carries `flashId`/`flashHomeIsP1`/`serving` (orientation
   flipped when home is p2); stage-3 patch carries none; `samePatch` unaffected by identical
   transient fields (they're in the patch, so a serving flip **does** redraw — intended: it
   coincides with a games-score change).
4. **`parseLiveFeed`:** `CX` → `srv` mapping, including `CX` matching neither name.
5. **App level (`app.test.ts` patterns):** tick gating (hidden tab, archival view, no selection,
   finished match = no fetch), immediate tick on selecting a live match, in-place node update
   (strip innerHTML NOT rebuilt between ticks), placeholder before first tick, stale value kept
   on fetch failure.

## Build sequence (worktree branch `feat/pbp-live-points`)

1. `api/_flashscore.ts` extraction + `api/live.ts` refactor (tests stay green — pure move).
2. `parseLiveFeed` `srv` + `LiveRecord.srv` (TDD).
3. `overlayLive` transient fields (TDD).
4. `src/points.ts` (TDD — the dense matrix).
5. `api/pbp.ts` handler + parser (TDD).
6. `fetchPbp` + strip render nodes (TDD).
7. `app.ts` poll loop + in-place updates + css (TDD).
8. `/simplify` + `/code-review --fix`, full suite, PR.

Prod verification: during the WTA final (Sat) or ATP final (Sun 17:00) — select the live match on
tennisarc.vercel.app, confirm points tick within ~13s of Flashscore's own page, serve dot sits on
the server, chips appear at break/set/match points, and closing the panel stops `/api/pbp`
requests (network tab).

## Risks / accepted

- **`CX` server lag:** the dot rides the 30s list poll; a game flip can mislabel the server for
  ≤30s. Accepted (the games score it accompanies has the same cadence). Suppressed entirely in
  tiebreaks, where `CX` rotates too fast to trust.
- **Point strings unknown shape** (e.g. suspended mid-game oddities): renderer prints raw string,
  chip logic returns null on anything it doesn't recognize. Fails quiet, never wrong-loud.
- **Token rotation:** unchanged posture from `/api/live` (single shared constant in
  `api/_flashscore.ts` now — one place to fix; bundle re-scrape stays a future hardening item).
- **`mid` churn:** if Flashscore reassigns ids mid-match (never observed), the overlay's next
  30s tick delivers the new id; worst case ~30s of empty `{}` responses.
