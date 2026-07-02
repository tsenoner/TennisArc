# Scheduled times for all rounds (order of play to the Final) — design

**Date:** 2026-07-02 (rev 2 — after adversarial review panel; rev 1 flaws fixed are marked ⚠)
**Status:** implemented (branch `feat/scheduled-times-all-rounds`; day-0 clutter call resolved at
the visual check: labels render cleanly at the observed density — default **show** stands, no
outer-ring fallback needed. One deviation from §3: the centre-disc suppression gates on `y0 > 0`,
not depth — under zoom the focused hub keeps its hierarchy depth while becoming the centre disc.)

## Goal

Show a scheduled date/time for **every not-yet-played match, all the way to the
Final** — not just the imminent round — matching what SofaScore's own bracket
displays (`Qf1 vs Qf2 · 7 Jul 12:00`, `WSF1 vs WSF2 · 12 Jul 17:00`, etc.), and
label near matches as **Today / Tomorrow**. The time appears **on the match's arc
in the wheel** (always-on) and, in fuller form, in the match strip + detail panel.

This supersedes the imminent-only display shipped in PR #49
(`feat/scheduled-match-times`) but **keeps its ingest mechanism** (per-event
detail for imminent scheduled matches) as the precise-time source.

## Key finding (why this is now cheap)

The SofaScore **cuptrees payload we already fetch** carries a
**`seriesStartDateTimestamp` (Unix seconds) on every block, for every round** —
including future placeholder rounds whose participants are still `Qf1`/`WSF1`
winner-of slots. Verified live against Wimbledon 2026 (ATP ut 2361 / WTA 2600):

| round | participants | `seriesStartDateTimestamp` |
| --- | --- | --- |
| R128 / R64 (played) | real | distinct **per-match** times |
| R32 (imminent) | real | distinct **per-match** times (real order of play) |
| R16 / QF / SF / Final | placeholders | one **shared per-round** nominal time |

So a date for all rounds is available with **zero new network requests**.

## Decisions (locked with the user; ⚠ = revised after review)

1. ⚠ **Two-tier time source.** The cuptrees `seriesStartDateTimestamp` (read in
   `normalizeCuptrees`) stamps a **coarse** `scheduledStart` on every
   not-yet-played match. For the imminent scheduled matches whose per-event
   detail we already fetch (PR #49's `collectEventIds`: both players real),
   `enrichMatch` **overrides** `scheduledStart` with `ev.startTimestamp` and sets
   a new **`scheduledPrecise: true`** flag. Rationale: a nominal round-day stamp
   sits *within* any time window the evening before the round, so precision must
   be keyed on the **data source** (SofaScore published a per-event order-of-play
   slot), never on clock distance alone. The per-event value is also the fresher
   one under intra-day reschedules; cuptrees is the fallback.
2. **Show all rounds up to the Final.** No far-future suppression. A match whose
   players are both still TBD (`Qf1 vs Qf2`) still shows its date.
3. ⚠ **Adaptive precision = `scheduledPrecise && dt ≤ ~36h`** (36h as a backstop:
   an event-sourced stamp for a round 2+ days out can itself still be nominal).
   Precise → day + time (`Today 14:30`); coarse → date only (`Sat 7 Jul`).
4. **Both surfaces (on-arc + panel).** A compact adaptive label on the match's
   arc in the wheel (always-on), plus the full line in the match strip + detail.
5. ⚠ **On-arc label via a parallel, matchId-keyed channel** — NOT the
   occupant-keyed `labels.anchors`/`labels.text` pipeline (that one is keyed on
   a decided player id; a TBD match has none). `draw()` precomputes the compact
   string per match and passes `sched?: (matchId: string) => string | null` in
   `SunburstLabels`; `renderSunburst` adds a parallel branch that emits
   `.arc-sched` through the **same curved/radial textPath helpers**. Mutual
   exclusivity with surnames still holds (names require `!a.projected`; sched
   labels require `projected`), so the time occupies the empty label slot and
   flips to the winner's surname once the match is decided.
6. **On-arc gate = `projected && !live && !suspended`** and the match has
   scheduled info. Never for past, live, or suspended matches. ⚠ Additionally
   **suppressed on the centre disc**: under zoom, ANY focused section's node
   becomes the centre circle (not just the Final) — mirror the existing
   `anchors.delete(focusId)` exclusion. The centre node's time is available via
   the match strip on selection; no dedicated centre chip.
7. **Court stays imminent-only** (from the fetched `event.venue`, matches we
   already fetch detail for). SofaScore shows no court for future rounds either.
8. ⚠ **Relative-day words (`Today`/`Tomorrow`) apply to PRECISE slots only**,
   computed against the **viewer's local calendar midnight** (day-diff 0 →
   `Today`, 1 → `Tomorrow`, 2–6 → weekday `Sat`, else absolute `7 Jul`; a
   past-day start falls through to absolute — never a bare weekday, which would
   read as next week). **Coarse dates are absolute and venue-day-preserving**:
   formatted with `timeZone: "UTC"`, which keeps the venue calendar date for all
   four slams (their ~11:00-local nominal stamps stay inside the same UTC day),
   whereas viewer-local rendering would shift AO a day early for the Americas.
   Precise times ARE viewer-local — converting the clock is the point there, and
   Today/Tomorrow is exactly the imminent tier where those words matter.
9. ⚠ **Single clock.** `nowSec = Date.now()/1000` captured **once per `draw()`**
   is the one reference for ALL scheduled display: the precise/stale gates in
   `scheduledInfo` AND the relative-day words AND the arc labels. The snapshot's
   `generatedAt` is **no longer used** for scheduled display (it remains the ref
   for ages/birthdays and the "updated Xh ago" status line). Rationale: the
   refresh can wedge for days; gating on `generatedAt` would confidently render
   "Today 14:30" for matches that already happened.
10. ⚠ **Staleness/recompute policy.** Redraw on `visibilitychange → visible`
    (covers the overnight-open tab at zero cost) plus a timer armed for the next
    viewer-local midnight while visible. Accepted residual rot: a tab left open
    and visible past midnight without interaction updates at the midnight tick.

## Non-goals / accepted limitations

- No new "order of play" list view; no court for future rounds; no notifications.
- Nominal far-round dates are **per-round**, but slams split rounds across days
  (R128 over days 1–2, AO/USO QFs over two days) — so pre-tournament, ~half a
  round's arcs may show a date one day off. SofaScore has the same limitation;
  the detail panel's "scheduled, subject to change" is the cue. Not solvable
  from this data; accepted.
- A washed-out day can push a whole round past its nominal date; coarse dates
  therefore hide by **calendar day** (see below), not a −6h cutoff, so labels
  survive a slow feed but drop once their day is truly over.

## Design

### 1. Ingest (`ingest/normalize.ts`, `ingest/enrich.ts`)

- `SofaBlock` gains `seriesStartDateTimestamp?: number`.
- `normalizeCuptrees`: for every match with status `scheduled` **or**
  `notstarted`, set `scheduledStart = block.seriesStartDateTimestamp`
  (undefined for `finished`/`live`).
- `enrichMatch` (replaces PR #49's stamping, ⚠ preserving — not clobbering — the
  normalize-set value): for `status === "scheduled"` with event detail, set
  `scheduledStart = ev.startTimestamp ?? m.scheduledStart` and
  `scheduledPrecise: true` (only when `ev.startTimestamp` is present);
  `scheduledCourt` from `ev.venue?.name || ev.venue?.stadium?.name` as today.
  For non-scheduled statuses it must **spread `...m` without touching**
  `scheduledStart`/`scheduledPrecise` (a match flipping to live/finished loses
  them via normalize on the next refresh anyway; enrich just must not stamp
  `undefined` over live data mid-pipeline).
- `collectEventIds` unchanged (its fetch now feeds court + freshest time +
  score/stats; ⚠ update its docblock — it is no longer the *only* time source).

### 2. Model / state (`src/model.ts`, `src/state.ts`)

- `Match` gains `scheduledPrecise?: boolean`; `scheduledStart`/`scheduledCourt`
  unchanged in shape (⚠ update their docblock: cuptrees-sourced, all upcoming
  rounds, precise flag semantics).
- ⚠ `scheduledInfo(m, nowSec)` — `nowSec` is now the **wall-clock** reference
  (Decision 9). Returns `{ start, court, precise } | null`:
  - **Positive status gate**: non-null only for `status === "scheduled" ||
    status === "notstarted"` (an allowlist — a denylist would leak walkover/
    retired-before-play statuses) and `scheduledStart != null`.
  - `precise = m.scheduledPrecise === true && (start - nowSec) <= PRECISE_AHEAD_SEC (36h)`.
  - **Hide rules**: precise slot → `null` when `start - nowSec < -STALE_BEHIND_SEC`
    (6h; overdue-but-running-late still shows). Coarse slot → `null` only once
    its **UTC calendar day is fully past** (venue day over) — never the −6h rule
    (⚠ rev 1 wrongly claimed coarse dates are "always ahead"; a rain-slipped
    round would have blanked).
- `matchInsight` accepts/threads the wall-clock `nowSec` (its `generatedAt`-based
  `ref` stays for ages only). `MatchInsight.scheduled` carries `precise`.

### 3. Rendering (`src/render.ts`, `src/app.ts`, `src/app.css`)

- `formatScheduled(start, court, opts)` reworked per Decisions 3/8:
  - precise: relative-day word (viewer-local midnight diff; `Tomorrow` in the
    detail/full form, `Tmrw` in compact — ⚠ "Tomorrow" doesn't fit a thin-ring
    radial slot) + `HH:MM`, `· court` when known.
  - coarse: `Sat 7 Jul` rendered with `timeZone: "UTC"`; no time, no relative
    words.
- **Match strip + detail:** render for any match with scheduled info (gate drop);
  detail keeps `🗓 <full> · scheduled, subject to change`.
- **On-arc (new):** `draw()` builds `schedLabel(matchId)` using the shared
  `nowSec`; `renderSunburst` branch for `projected && !live && !suspended` arcs
  emits `.arc-sched` (teal, slightly smaller) through the existing curved/radial
  fitting incl. its degradation (drop the time before the day-word on tight
  arcs). ⚠ `.arc-sched` must keep `pointer-events: none` (labels paint above the
  arc paths; taps and the touch-hover path rely on hit-through). ⚠ Renders
  identically on **all three lenses** (it is match-keyed; the Country lens's
  flag-image slot is occupant-keyed and only for decided arcs — no interaction).
  ⚠ Centre-disc suppression per Decision 6.
- **Recompute** per Decision 10: `visibilitychange` listener + next-local-
  midnight timer, both funnelling into the existing `draw()`.
- ⚠ **Day-0 check:** pre-tournament, ~127 arcs carry a label (64 thin R128 arcs
  with identical dates). Implementation must be checked against a day-0-shaped
  fixture/screenshot; stated fallback if it reads as noise: suppress coarse
  labels on the outermost (thinnest) ring only — dates remain one tap away in
  the strip. (Decision deferred to visual check, default = show.)

### 4. Testing

- **Ingest:** `normalizeCuptrees` stamps from `seriesStartDateTimestamp` for
  scheduled + notstarted, not finished/live (fixture gains the field);
  `enrichMatch` override sets precise + prefers `ev.startTimestamp`, falls back
  to the cuptrees value, and never clobbers normalize-set fields for
  non-scheduled statuses. ⚠ Rewrite PR #49's enrich tests (they assert the old
  event-only stamping) and **invert** the far-future suppression tests in
  state.test.ts (suppression is removed — those would now fail as-is).
- **State:** `scheduledInfo` matrix — allowlist gate (walkover/retired/finished/
  live → null); precise only with the flag AND ≤36h (⚠ nominal stamp at dt=20h
  → coarse); precise stale-hide at −6h; coarse hides only after its UTC day;
  wall-clock now vs a stale `generatedAt` (12h-old snapshot → overdue slot
  hidden, day words from the viewer clock).
- **Render:** relative-day matrix incl. ⚠ the past-day fallthrough (never a bare
  weekday); coarse UTC venue-date for a UTC−5 viewer (AO-shaped stamp keeps its
  date); compact `Tmrw` vs full `Tomorrow`; strip + detail for a far-future TBD
  match; on-arc label present for projected-future, absent for decided/live/
  suspended and for the centre disc under zoom; `.arc-sched` carries
  `pointer-events: none`.
- ⚠ **Docblock checklist** (stale after this change): `model.ts` scheduled
  fields, `render.ts` formatScheduled, `normalize.ts` collectEventIds,
  `state.ts` trust-window constants (renamed to precise/stale roles).

## Open questions

None blocking. Remaining visual-polish calls (exact `.arc-sched` size/shade,
day-0 fallback trigger) are settled during implementation against the running
app per §3.
