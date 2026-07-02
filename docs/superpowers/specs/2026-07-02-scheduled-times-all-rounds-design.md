# Scheduled times for all rounds (order of play to the Final) — design

**Date:** 2026-07-02
**Status:** draft (awaiting user review)

## Goal

Show a scheduled date/time for **every not-yet-played match, all the way to the
Final** — not just the imminent round — matching what SofaScore's own bracket
displays (`Qf1 vs Qf2 · 7 Jul 12:00`, `WSF1 vs WSF2 · 12 Jul 17:00`, etc.), and
label near dates as **Today / Tomorrow**. The time appears **on the match's arc
in the wheel** (always-on) and, in fuller form, in the match strip + detail panel.

This supersedes the imminent-only feature shipped in PR #49 (`feat/scheduled-match-times`),
which stamped a time only for scheduled matches with both players decided and
gated display to a narrow `[-6h, +36h]` trust window.

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

So the time for all rounds is available with **zero new network requests** — it
comes straight from the cuptrees block, not from per-event detail.

## Decisions (locked with the user)

1. **Source = `block.seriesStartDateTimestamp`** (cuptrees), read in
   `normalizeCuptrees`. It becomes the single source of `scheduledStart` for
   every not-yet-played match. Drop the per-event `ev.startTimestamp` stamping
   added to `enrich.ts` in PR #49.
2. **Show all rounds up to the Final.** No far-future suppression. A match whose
   players are both still TBD (`Qf1 vs Qf2`) still shows its date, exactly as
   SofaScore does.
3. **Adaptive precision.** A match within a near window (`start − now ≤ ~36h`,
   real order of play) shows **day + time** (`Today 14:30`); a match beyond it
   (shared nominal per-round time) shows **day/date only** (`Sat 7 Jul`) so we
   never imply a precise slot we don't have. The existing ~36h constant is
   **repurposed** from *hide* → *precise-vs-coarse*.
4. **Both surfaces (on-arc + panel).** A compact adaptive label on the match's
   arc in the wheel (always-on), plus the full line in the match strip + detail.
5. **On-arc label reuses the surname label slot.** The wheel draws a name/flag
   on an arc only when `!a.projected` (match decided). Scheduled/live/future arcs
   are `projected` → they carry no name. So the scheduled-time label and the
   winner's surname are **mutually exclusive on any arc** — the time occupies the
   same label slot and simply flips to the winner's surname once the match is
   decided. No overlay, no collision, one mechanism.
6. **On-arc gate = `projected && !live && !suspended` and has `scheduledStart`.**
   Times show for genuinely not-yet-started matches only — never for past, live,
   or suspended matches (those show a name, live hatch, or suspended state).
7. **Court stays imminent-only.** `scheduledCourt` continues to come from the
   fetched `event.venue`, only for matches we already fetch detail for (SofaScore
   shows no court for future rounds either). The PR #49 `collectEventIds`
   scheduled-fetch is **kept** so the imminent round still gets its court.
8. **Relative-day labels.** `Today` / `Tomorrow` / weekday within 7 days (`Sat`)
   / `7 Jul` beyond, computed in the viewer's local time.

## Non-goals

- No new "order of play" list/schedule view — the times live on the existing
  bracket + panel surfaces only.
- No court for future rounds (SofaScore has none either).
- No push/notification/reminder features.
- The nominal far-round times are provisional and shift with results/weather;
  we surface them as SofaScore does and mark them "subject to change" in the
  detail panel — we do not try to predict or correct them.

## Design

### 1. Ingest (`ingest/normalize.ts`, `ingest/enrich.ts`)

- Add `seriesStartDateTimestamp?: number` to the `SofaBlock` interface.
- In `normalizeCuptrees`, when building each `Match`, set
  `scheduledStart = block.seriesStartDateTimestamp` for every **not-yet-played**
  match (status `scheduled` or `notstarted`); leave it `undefined` for
  `finished` / `live`.
- `enrich.ts`: remove the `scheduledStart` stamping (now owned by normalize);
  keep `scheduledCourt` (from `ev.venue?.name || ev.venue?.stadium?.name`, for
  `status === "scheduled"` only). Ensure `enrichMatch` preserves the
  normalize-set `scheduledStart` (spread `...m`, don't overwrite).
- Keep `collectEventIds` as merged in PR #49 (imminent scheduled events are still
  fetched, now only for their court + score, not their time).

### 2. State / model (`src/state.ts`, `src/model.ts`)

- `Match.scheduledStart` / `scheduledCourt`: unchanged shape; `scheduledStart`
  now populated for all upcoming matches.
- Replace `scheduledInfo(m, nowSec)` return with
  `{ start: number; court: string | null; precise: boolean } | null`. Let
  `dt = start - nowSec`; three cases:
  - `dt < -SCHED_STALE_BEHIND_SEC` (≈ 6h in the past) → **`null`**. A stale/overdue
    slot the feed hasn't flipped to live/finished; hide it. (Future rounds'
    nominal dates are always ahead, so this only ever trims the imminent round.)
  - `-SCHED_STALE_BEHIND_SEC ≤ dt ≤ SCHED_PRECISE_AHEAD_SEC` (≈ 36h ahead) →
    **`precise: true`** (real order of play; a just-overdue match still counts).
  - `dt > SCHED_PRECISE_AHEAD_SEC` → **`precise: false`** (shown, coarse — the
    old `> 36h → null` far-future *suppression* is removed; it now shows the
    nominal day/date instead of hiding).
  - Also `null` when the match is finished/live/suspended or has no
    `scheduledStart`. Court included when known.
  - (These reuse the two existing `~36h` / `~6h` constants, renamed to reflect
    their new precise-cutoff / stale-cutoff roles.)
- `MatchInsight.scheduled` becomes `{ start, court, precise } | null`.

### 3. Rendering (`src/render.ts`, `src/app.css`)

- `formatScheduled(start, court, opts)` gains:
  - **relative-day** helper: `Today` / `Tomorrow` / weekday (≤7 days) / `D Mon`.
  - **precision**: append `HH:MM` only when `precise`. Compact form (strip/arc)
    omits the calendar month when a weekday/relative word suffices; full form
    (detail) always carries the date.
- **Match strip + detail panel:** drop the imminent-only gate — render for any
  match with a `scheduled` info. Detail keeps
  `🗓 <full> · scheduled, subject to change`.
- **On-arc label (new):** in the sunburst label pass, for an arc that is
  `projected && !live && !suspended` whose match has `scheduled` info, emit the
  compact adaptive label through the **same curved/radial `arc-label` textPath
  path** used for surnames (reusing `labels.anchors` selection, extended to these
  future match nodes). Small dedicated class (e.g. `.arc-sched`) for teal styling
  and slightly smaller size. The Final (innermost / centre) is the one special
  spot — its time renders in/near the centre-pill area rather than a centre arc.
- Anchor selection: each upcoming **match node** is its own anchor (one label per
  match); the repetition of a shared nominal date across a round mirrors
  SofaScore's per-box dates and is acceptable.

### 4. Testing

- **Ingest:** `normalizeCuptrees` stamps `scheduledStart` from
  `seriesStartDateTimestamp` for scheduled + notstarted, not for finished/live;
  fixture gains a `seriesStartDateTimestamp` per block.
- **State:** `scheduledInfo` — `precise` true inside ~36h, false beyond; still
  returns (coarse) for far-future and just-overdue; `null` for finished/live.
- **Render:** `formatScheduled` relative-day matrix (Today/Tomorrow/weekday/date)
  × precise/coarse; strip + detail render for a far-future TBD match; on-arc
  label emitted for a projected future match and **absent** for decided/live/
  suspended arcs.

## Open questions

None blocking. The exact on-arc typography (size, teal shade, how the Final's
time sits by the centre pill) is a visual-polish detail to settle during
implementation against the running app.
