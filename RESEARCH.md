# TennisArc — Research Findings

> Live, radial-bracket PWA for Grand Slam tennis (ATP + WTA). Two rounds of
> fan-out web research, every load-bearing claim adversarially re-verified
> against live endpoints during the **2026 Roland Garros final (2026-06-07)**.
> Confidence tags below reflect that verification.

---

## TL;DR / Decisions surfaced

1. **Data source — round 1's "you must pay $150/mo" conclusion is WRONG.**
   **SofaScore's free, key-free unofficial JSON API delivers everything we need
   for both tours** — full Grand Slam draws *as a pre-built bracket tree* (with
   seeds + Q/WC/LL tags), live scores, point-by-point, per-match stats, and
   per-set durations (→ time-on-court). Verified live. **Catch:** it's
   reverse-engineered (their ToS forbids scraping/commercial use) and
   Cloudflare-protected, so it must be fetched **server-side with caching, never
   from the browser**. ESPN's hidden API is a clean, unblocked **fallback** for
   live scores. Official slam IBM JSON feeds are an authoritative **draws**
   source. Legally-clean budget path if we ever ship publicly: balldontlie /
   api-sports.io free tiers.

2. **Visualization — fully solved.** The radial bracket is a standard D3
   radial-tree layout (`d3-hierarchy` + `d3-shape`). We can use D3's *math*
   (layout + path generation) and emit SVG ourselves.

3. **The niche is OPEN.** Every radial bracket in the wild is **static NCAA
   basketball**. Every strong tennis product (TNNS, Tennis Abstract,
   tennisstats.com, bracket.tennis) uses **linear/tabular** draws. A
   **radial + live + time-on-court + offline-PWA** tennis bracket does not exist.

4. **Hosting freshness gotcha.** Vercel **Hobby caps cron at once/day**;
   sub-daily auto-refresh needs **Pro (~$20/mo)** — OR an external free scheduler
   (GitHub Actions / cron-job.org) pinging a refresh endpoint, which sidesteps Pro.

---

## 1. Data sources (both ATP + WTA)

### ⭐ SofaScore unofficial API — the one source that does it all (verified live)

Base host `api.sofascore.com` (mirror `www.sofascore.com/api/v1`). **No API key.**
All endpoints below returned HTTP 200 + valid JSON during RG 2026:

| Need | Endpoint | Notes |
|---|---|---|
| Discover tournament | `/api/v1/search/all?q=roland%20garros` | RG ATP `uniqueTournament` **id 2480**, WTA **id 2577**; Wimbledon ATP **2361**, WTA **2600** |
| Resolve season | `/api/v1/unique-tournament/{utId}/seasons` | RG2026 ATP seasonId **85951**, WTA **85953** |
| **Full draw as a tree** | `/api/v1/unique-tournament/{utId}/season/{seasonId}/cuptrees` | **Pre-built single-elim bracket, R128→Final.** Each participant has `team.id/name/ranking` + **`teamSeed`** string = `"1".."32"` or `"Q"/"WC"/"LL"`; direct entries have no `teamSeed`. `block.events` links each node to a live match id. **We don't have to reconstruct the bracket.** |
| Live now | `/api/v1/sport/tennis/events/live` | in-play matches; current game point (`"40"`,`"30"`), set scores `period1..5`, serving, `groundType`, `roundInfo`, rankings |
| Schedule by date | `/api/v1/sport/tennis/scheduled-events/YYYY-MM-DD` | `tournament.category.name` = `ATP`/`WTA` |
| Results list | `/api/v1/unique-tournament/{utId}/season/{seasonId}/events/last/0` | all completed matches w/ `roundInfo`, set scores, `winnerCode` |
| **Stats** | `/api/v1/event/{id}/statistics` | aces, double faults, 1st/2nd serve return %, break points converted, service pts won, max-in-a-row |
| **Point-by-point** | `/api/v1/event/{id}/point-by-point` | sets→games→points, `homePoint/awayPoint`, `*PointType`, serving player |
| **Match timing** | `/api/v1/event/{id}` | `time.period1/period2/...` = **per-set seconds** (sum = on-court time); `startTimestamp`; `status.code` (0 notstarted, 8/9 inprogress, 100 finished); `changes.changeTimestamp` ≈ match end; `customId` for deep-links |

**Caveats (verified):**
- **ToS / legal:** scraping + commercial/derivative use prohibited. SofaScore
  itself can't expose an API (upstream Sportradar/Enetpulse deals). → Fine for a
  **personal, free, no-ads hobby PWA**; risky to monetize/ship publicly.
- **Cloudflare:** plain `curl` often gets `403`. Worked from some server IPs in
  testing; one agent needed a real browser (Playwright). **Mitigation:** always
  fetch server-side with a realistic User-Agent, poll **≥25–60 s**, cache hard,
  and fall back to ESPN on block.
- Undocumented → can change without notice.

### ESPN hidden API — clean, unblocked fallback for live scores (verified)
- `https://site.api.espn.com/apis/site/v2/sports/tennis/{atp|wta}/scoreboard`
  — key-free, **no Cloudflare**. ATP league id `851`, **WTA `900`**. Has player
  names, set-by-set linescores (+ tiebreaks), `status` (`STATUS_FINAL`/in-progress),
  `major:true` for Slams, and **seed** via `competitor.curatedRank.current`.
- `?dates=YYYYMMDD` selects by **tournament/year**, not exact day.
- ❌ No bracket tree, ❌ no per-match stats, ❌ no usable match duration
  (`endDate` absent for tennis). ToS: non-commercial only.
- **Role:** secondary live-score feed + status when SofaScore blocks.

### Official Grand Slam IBM JSON feeds — authoritative draws (verified, plain JSON, no Cloudflare)
- Wimbledon `https://www.wimbledon.com/en_GB/scores/feeds/{year}/draws/{code}.json`
- US Open `https://www.usopen.org/en_US/scores/feeds/{year}/draws/{code}.json`
- `code`: `MS` = men's singles, `LS` = ladies'/women's singles.
- `drawSize:128`, `totalRounds:7`, 127 match objects; each `team1/team2` has
  `seed` (int|null) and `entryStatus` (null|`Q`|`WC`|`LL`). **Plain `curl` works.**
- ⚠️ **Roland Garros & Australian Open use different (per-site) feed paths** —
  must be discovered via browser devtools each season. Undocumented.
- WTA official PDFs: `https://wtafiles.wtatennis.com/pdf/draws/{year}/{tid}/MDS.pdf`.

### Budget / legally-clean path (only if shipping publicly)
- **balldontlie.io** — sanctioned API key; lists **ATP + WTA**; free 5 req/min
  (1 sport, "Basic" depth); paid $9.99/$39.99 per sport. Draw/stat depth unverified.
- **api-sports.io** — permanent free **100 req/day**, all endpoints; ~$10–25/mo paid.
  100/day is fine for periodic draw/results sync, not whole-Slam live polling.

### Dead ends
api-tennis.com (trial→$40+/mo, **no seed/draw fields**), Goalserve ($150/mo),
Flashscore (no API, obfuscated, scraping-only), LiveScore (Cloudflare),
tennis-data.co.uk (weekly CSV, 2-wk lag), RapidAPI tennis (tiny free tiers).

### Draw timing
Grand Slam main draws drop **~2 days before R1** (Thu draw ceremony → Sun/Mon
start). RG2026: draw Thu 21 May, play from 24 May. AO2026: draw Thu 15 Jan, play
from Sun 18 Jan. → Start polling the morning of the draw ceremony.

---

## 2. Radial bracket visualization (solved — D3 radial tree)

- Layout: `d3.tree()`/`d3.cluster().size([2*Math.PI, radius])` over
  `d3.hierarchy(data)` — **x = angle (radians), y = radius**.
- Links: `d3.linkRadial().angle(d=>d.x).radius(d=>d.y)` → curved SVG `<path>`.
- Node placement: `transform="rotate(${d.x*180/Math.PI-90}) translate(${d.y},0)"`;
  flip left-side labels with `rotate(d.x>=Math.PI?180:0)`.
- Responsive: `radius = Math.min(width,height)/2 - margin`; re-run on resize/zoom.
- **We can use `d3-hierarchy` + `d3-shape` as pure layout/path math and emit our
  own SVG strings** (fits the wattblock/ErgoFlow `render.ts`-returns-strings
  pattern) — no need for `d3-selection` DOM manipulation.

**Known failure modes to design around (well-documented):**
- 128-player outer ring gets **cramped on mobile** (label legibility + touch
  targets). → semantic **zoom/pan**, zoom-to-quadrant, or hybrid radial-quadrant.
- Radial brackets show **stats well but advancement/progression poorly**
  (Nightingale/McDade). → animate the live "fill" inward; make the path a player
  takes legible.
- Hand-rolled D3-selection radial code is **hard to maintain/make accessible**
  (Bill Mill reverted his NCAA bracket to a CSS grid). → keep D3 to math only;
  own the SVG; provide an accessible linear fallback view.

---

## 3. Offline-first installable PWA

- **Recommended stack = the user's own proven one** (ErgoFlow `web/`, wattblock):
  **Vite + TypeScript (strict) + `vite-plugin-pwa` + `idb-keyval` + Vitest**,
  deployed on Vercel. The radial bracket is pure client-side SVG — **no SSR
  needed**, so Next.js is unnecessary.
- (For reference, the Next.js path needs **Serwist** `@serwist/next` for offline —
  Next's built-in PWA support is manifest/install only, not caching.)
- Service worker precaches the app shell; `idb-keyval` caches the latest
  draw/scores JSON so the bracket renders **fully offline** (last-synced state).

---

## 4. Deep-linking into a specific match (verified)

| Site | Pattern | Construct from ID? | App deep-link |
|---|---|---|---|
| **SofaScore** ⭐ | `https://www.sofascore.com/tennis/match/{any-slug}/{customId}` | ✅ **slug is cosmetic** — a wrong slug still resolves; `customId` is the key (we get it from `/event/{id}`) | ✅ iOS Universal Links (`*/match/*`) + Android App Links (`com.sofascore.results`) — same https URL opens the app |
| **Flashscore** | `https://www.flashscore.com/match/{8-char-id}/` | ✅ cleanest (no slug), id permanent — **but we'd have no Flashscore id** (no API) | ✅ Universal Links `/match/*` + `/r/*` share route |
| tennisstats.com | `/h2h/{p1}-vs-{p2}-{numericId}` | ⚠️ needs player slugs | none verified |
| ESPN | `/tennis/recap/_/gameId/{id}` | ⚠️ ESPN-only id, sparse coverage | — |
| Google | `search?q={players}+tennis` | best-effort, not deterministic | — |

**→ Use SofaScore for deep-links** (we already hold `customId`; best mobile UX;
opens native app if installed, web otherwise). Outbound linking with an id we
already store is normal referral traffic — low risk. Avoid tnnslive (SPA, no
constructible URL).

---

## 5. Cumulative time-on-court per player (verified)

- **Best signal:** SofaScore `event.time.period1/period2/...` (per-set **seconds**)
  → **sum = on-court time** (excludes inter-set/overnight dead time, so robust to
  rain/night suspensions). Fall back to `changeTimestamp - startTimestamp`
  (wall-clock; includes suspensions) only if periods missing.
- **Live match:** `time` object is **empty `{}`** while in progress (no live
  clock). Estimate = `sum(completed periodN) + (now - currentPeriodStartTimestamp)`;
  if absent, `now - startTimestamp` marked **PROVISIONAL**, finalize with
  `sum(periodN)` when the match ends.
- **Edge cases:** count **RET** (partial time is real); add **zero** for
  **W/O / DEF / not-started** (never impute). **Freeze the accumulator** while
  status = suspended/postponed.
- Historical context (pre-app seasons): Jeff Sackmann `tennis_atp`/`tennis_wta`
  `minutes` column — but **CC BY-NC-SA (non-commercial)**, historical-only, many
  nulls (treat null as unknown, not zero).

---

## 6. Prior art & differentiation

| Project | What it is | Gap |
|---|---|---|
| llimllib **roundbracket** | radial NCAA bracket, D3, static CSVs | not tennis, not live; author later reverted D3→CSS grid for a11y |
| radial-bracket.com, StewEsho/radial-bracket | NCAA only / WIP generic | not tennis, not live |
| **TNNS** (tnnslive) | feature-rich live tennis app (pbp, predictors, bracket games, push) | **linear** draw; no radial, no time-on-court, no offline PWA. Don't out-data them. |
| Tennis Abstract | gold-standard Elo round-by-round forecasts | static **tabular** HTML, not live in-match |
| tennisstats.com, bracket.tennis | stat tables / prediction game | linear/tabular |
| brackets-viewer.js, react-tournament-brackets | reusable bracket libs | **all linear** — none radial (but `brackets-model` is a reusable data schema) |

**Our wedge:** radial draw + **live fill animation** + **time-on-court as an
encoded dimension** (arc thickness/color = cumulative minutes — a real fatigue
narrative nobody visualizes) + **offline installable PWA** + clean **deep-links**.
Show win-probability ("who would meet" until they actually meet) inspired by TA's
Elo, computed/approximated ourselves to avoid ToS issues.

---

## Recommended architecture (for design discussion)

```
 GitHub Actions cron (free, ~5 min)  ──fetch──▶  SofaScore (server-side, cached)
        │  (fallback: ESPN; draws: official IBM feeds)        │
        └── writes normalized JSON snapshots ──▶ Vercel (static / Blob / KV)
                                                       │
 PWA (Vite + TS + vite-plugin-pwa)  ──fetch same-origin JSON──┘
   state.ts (pure: bracket model, seed-prediction, time-on-court)
   store.ts (idb-keyval cache → offline)
   render.ts (SVG strings; d3-hierarchy/d3-shape for layout math)
   app.ts/main.ts (zoom/pan, event delegation, deep-links)
```

This keeps the browser off SofaScore entirely (CORS + Cloudflare + ToS all
handled server-side), needs **no Vercel Pro** (GH Actions schedules the refresh),
and renders **fully offline** from the last cached snapshot.

---

*Sources: SofaScore/ESPN live endpoints (verified 2026-06-07), official D3 docs,
Next.js/Vercel/Serwist docs, Jeff Sackmann repos, Nightingale, apple-app-site-association
files. Full citation list in the workflow transcripts.*
