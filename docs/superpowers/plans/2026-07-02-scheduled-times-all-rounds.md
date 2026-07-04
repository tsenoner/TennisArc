# Scheduled Times for All Rounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a scheduled date/time for every not-yet-played match up to the Final — on the match's arc in the wheel (always-on) and in the strip/detail — with Today/Tomorrow words for the imminent precise tier and absolute venue dates for the nominal coarse tier.

**Architecture:** Two-tier time source: `normalizeCuptrees` stamps a coarse `scheduledStart` on every upcoming match from the cuptrees block's `seriesStartDateTimestamp` (already fetched, all rounds); `enrichMatch` upgrades imminent matches to the precise per-event `ev.startTimestamp` and sets `scheduledPrecise`. Display gates in `scheduledInfo` (allowlist + precise/stale rules) run on a single wall-clock `nowSec` captured per `draw()`. On-arc labels flow through a new matchId-keyed `sched` channel in `SunburstLabels`, reusing the existing curved/radial textPath fitting.

**Tech Stack:** TypeScript, Vite, vitest (jsdom for app tests), no framework, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-02-scheduled-times-all-rounds-design.md` (rev 2)

## Global Constraints

- Branch: `feat/scheduled-times-all-rounds` (already exists; spec committed on it).
- Tests are pinned to `TZ=UTC` via `test.env` in `vite.config.ts` (since 2026-07-04), so any launch — `pnpm test`, a bare `npx vitest run`, or an IDE runner — is deterministic on non-UTC machines. The `TZ=UTC` prefix on the `Run:` commands below is now redundant (harmless if kept).
- `npx tsc --noEmit` must be clean after every task.
- One wall-clock `nowSec = Math.floor(Date.now() / 1000)` per `draw()` is the ONLY time reference for scheduled display. `snap.generatedAt` must never gate it.
- Precise tier constant: `36 * 3600` (backstop). Stale-behind constant: `6 * 3600` (precise slots only). Coarse slots hide only once their UTC calendar day is fully past.
- Every commit ends with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- All Unix timestamps are **seconds** (SofaScore convention), converted with `* 1000` only at `Date` construction.

## File Structure

| File | Responsibility |
| --- | --- |
| `ingest/normalize.ts` | Coarse tier: stamp `scheduledStart` from `seriesStartDateTimestamp` |
| `ingest/enrich.ts` | Precise tier: `ev.startTimestamp` override + `scheduledPrecise` flag |
| `src/model.ts` | `Match.scheduledPrecise?` + updated docblocks |
| `src/state.ts` | `scheduledInfo` rework (allowlist/precise/coarse-hide), `matchInsight` nowSec param |
| `src/render.ts` | `formatScheduled` rework, strip/detail threading, on-arc `sched` channel |
| `src/app.ts` | per-draw `nowSec`, `schedLabel` closure, visibilitychange + midnight recompute |
| `src/app.css` | `.arc-sched` teal styling |

---

### Task 1: Ingest — normalize stamps the coarse `scheduledStart` from cuptrees

**Files:**
- Modify: `ingest/normalize.ts:13-16` (SofaBlock), `ingest/normalize.ts:96-106` (match literal), `ingest/normalize.ts:45-51` (collectEventIds docblock)
- Modify: `ingest/fixtures/cuptrees-sample.ts` (add `seriesStartDateTimestamp` per block)
- Test: `ingest/normalize.test.ts`

**Interfaces:**
- Consumes: existing `blockStatus`, `Match` (has optional `scheduledStart?: number` already).
- Produces: every `Match` with status `"scheduled"` or `"notstarted"` carries `scheduledStart` when the block has `seriesStartDateTimestamp`; `finished`/`live` matches leave it `undefined`. Task 2 relies on `m.scheduledStart` being pre-set when `enrichMatch` runs.

- [ ] **Step 1: Add `seriesStartDateTimestamp` to the fixture**

In `ingest/fixtures/cuptrees-sample.ts`, add the field to each of the three blocks (values chosen to be distinct):
- finished block (`events: [9001]`): `seriesStartDateTimestamp: 1782736200,`
- live block (`events: [9002]`): `seriesStartDateTimestamp: 1782738300,`
- final-round block (`events: [9003]`): `seriesStartDateTimestamp: 1783868400,`

Place each after `blockId: N,` to match the fixture's field ordering.

- [ ] **Step 2: Write the failing tests**

Append to `ingest/normalize.test.ts` (inside the file, after the `collectEventIds` describe; `meta` and `cuptreesSample` are already imported at the top):

```ts
describe("normalizeCuptrees — scheduledStart (coarse order-of-play tier)", () => {
  const s = normalizeCuptrees(cuptreesSample as never, meta);

  it("stamps a not-yet-played match's scheduledStart from the block's seriesStartDateTimestamp", () => {
    expect(s.matches["1-0"].scheduledStart).toBe(1783868400); // scheduled final
  });

  it("leaves finished and live matches timeless", () => {
    expect(s.matches["0-0"].scheduledStart).toBeUndefined(); // finished
    expect(s.matches["0-1"].scheduledStart).toBeUndefined(); // live
  });

  it("stamps a notstarted match (both sides placeholders) too — future rounds carry a nominal date", () => {
    const cup = { cupTrees: [{ rounds: [{ description: "Quarterfinal", blocks: [{
      finished: false, eventInProgress: false, order: 1, events: [77], seriesStartDateTimestamp: 1783418400,
      participants: [
        { order: 1, winner: false, team: { id: 901, name: "Qf1", slug: "qf1" } },
        { order: 2, winner: false, team: { id: 902, name: "Qf2", slug: "qf2" } },
      ],
    }] }] }] };
    const snap = normalizeCuptrees(cup as never, meta);
    expect(snap.matches["0-0"].status).toBe("notstarted");
    expect(snap.matches["0-0"].scheduledStart).toBe(1783418400);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `TZ=UTC npx vitest run ingest/normalize.test.ts`
Expected: 3 FAIL — `scheduledStart` is `undefined` where a value is expected (normalize never sets it yet).

- [ ] **Step 4: Implement**

In `ingest/normalize.ts`, extend `SofaBlock`:

```ts
interface SofaBlock {
  finished: boolean; eventInProgress: boolean; order: number;
  participants: SofaParticipant[]; events?: number[];
  seriesStartDateTimestamp?: number;  // per-block scheduled start; a shared nominal round-day time on future rounds
}
```

In `normalizeCuptrees`, replace the match literal (currently lines 96-106):

```ts
      const winner = home?.winner ? "p1" : away?.winner ? "p2" : null;
      const status = blockStatus(b, !!home || !!away);
      const match: Match = {
        id, roundIndex, slot,
        nextMatchId: roundIndex < lastRound ? `${roundIndex + 1}-${Math.floor(slot / 2)}` : null,
        p1: home ? String(home.team.id) : null,
        p2: away ? String(away.team.id) : null,
        status, winner,
        // Coarse order-of-play tier: cuptrees carries seriesStartDateTimestamp on EVERY block, every
        // round — a real per-match time once the order of play is out, a shared nominal round-day time
        // on future placeholder rounds. Stamped only while unplayed; enrichMatch upgrades the imminent
        // matches to the precise per-event time (scheduledPrecise).
        scheduledStart: status === "scheduled" || status === "notstarted" ? b.seriesStartDateTimestamp : undefined,
        score: null, live: null, durationSec: null, durationProvisional: false,
        sofaEventId: b.events?.[0] ?? null, sofaCustomId: null, stats: null,
      };
```

Update the `collectEventIds` docblock (lines 45-51): change the phrase "an imminent match whose published order-of-play time and court we want to surface" to "an imminent match whose per-event detail we still want (court, the freshest order-of-play time, live score/stats) — the coarse time for every round now comes from the blocks' seriesStartDateTimestamp".

- [ ] **Step 5: Run tests to verify they pass**

Run: `TZ=UTC npx vitest run ingest/normalize.test.ts && npx tsc --noEmit`
Expected: all PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add ingest/normalize.ts ingest/normalize.test.ts ingest/fixtures/cuptrees-sample.ts
git commit -m "feat(ingest): stamp coarse scheduledStart from cuptrees seriesStartDateTimestamp

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Ingest — enrich upgrades imminent matches to the precise per-event time

**Files:**
- Modify: `src/model.ts:76-82` (scheduled docblock + new field)
- Modify: `ingest/enrich.ts:46-53` (SofaEvent — verify `startTimestamp?: number` exists; it does, used at line 115), `ingest/enrich.ts:141-152` (stamping + return)
- Test: `ingest/enrich.test.ts:133-165`

**Interfaces:**
- Consumes: `m.scheduledStart` pre-set by Task 1's normalize for upcoming matches.
- Produces: `Match.scheduledPrecise?: boolean` — set `true` only when `status === "scheduled"` and `ev.startTimestamp != null`. `scheduledStart` = `ev.startTimestamp ?? m.scheduledStart` for scheduled; passed through untouched for every other status. Task 3's `scheduledInfo` reads `m.scheduledPrecise === true`.

- [ ] **Step 1: Update the model**

In `src/model.ts`, replace the scheduled-fields docblock and add the flag (currently lines 76-82):

```ts
  /** Order-of-play display fields, re-derived every refresh. `scheduledStart` (Unix seconds) is
   *  stamped by normalizeCuptrees for EVERY not-yet-played match, all rounds to the Final, from the
   *  cuptrees block's seriesStartDateTimestamp — a shared nominal round-day time on future rounds.
   *  For the imminent scheduled matches whose per-event detail is fetched (both players real),
   *  enrichMatch overrides it with the published per-event startTimestamp and sets
   *  `scheduledPrecise` — only that tier may display a clock time (see `scheduledInfo`).
   *  `scheduledCourt` is per-event too, so it exists only for the imminent tier. */
  scheduledStart?: number;
  scheduledPrecise?: boolean;
  scheduledCourt?: string;
```

- [ ] **Step 2: Rewrite the enrich tests**

In `ingest/enrich.test.ts`, replace the three scheduled tests (lines 133-165, the ones titled "records a scheduled match's…", "falls back to the stadium name…", "falls back to the stadium name when the venue name is blank…", "does NOT stamp scheduled fields onto a finished match") with:

```ts
  it("upgrades a scheduled match to the precise per-event time and court", () => {
    const m = enrichMatch(baseMatch({ status: "scheduled", winner: null, sofaEventId: 999, scheduledStart: 1783000000 }), scheduledEventSample, null, players(), 0);
    expect(m.status).toBe("scheduled");
    expect(m.scheduledStart).toBe(1782999600);   // ev.startTimestamp overrides the cuptrees stamp
    expect(m.scheduledPrecise).toBe(true);
    expect(m.scheduledCourt).toBe("Court 2");
    expect(m.winner).toBeNull();
    expect(m.durationSec).toBeNull();
  });

  it("keeps the cuptrees stamp (no precise flag) when the event carries no startTimestamp", () => {
    const ev = { ...scheduledEventSample, startTimestamp: undefined };
    const m = enrichMatch(baseMatch({ status: "scheduled", winner: null, scheduledStart: 1783000000 }), ev, null, players(), 0);
    expect(m.scheduledStart).toBe(1783000000);
    expect(m.scheduledPrecise).toBeFalsy();
  });

  it("falls back to the stadium name when the venue has no direct name", () => {
    const ev = { ...scheduledEventSample, venue: { stadium: { name: "Centre Court" } } };
    const m = enrichMatch(baseMatch({ status: "scheduled", winner: null }), ev, null, players(), 0);
    expect(m.scheduledCourt).toBe("Centre Court");
  });

  it("falls back to the stadium name when the venue name is blank (not just absent)", () => {
    const ev = { ...scheduledEventSample, venue: { name: "", stadium: { name: "Centre Court" } } };
    const m = enrichMatch(baseMatch({ status: "scheduled", winner: null }), ev, null, players(), 0);
    expect(m.scheduledCourt).toBe("Centre Court");
  });

  it("passes normalize-set scheduled fields through untouched for a non-scheduled status", () => {
    // A match that flipped to live/finished in event detail mid-refresh: enrich must not stamp
    // undefined over the normalize-set coarse fields (the next refresh's normalize clears them).
    const m = enrichMatch(baseMatch({ scheduledStart: 1783000000, scheduledPrecise: true }), eventSample, statsSample, players(), 0);
    expect(m.status).toBe("finished");
    expect(m.scheduledStart).toBe(1783000000);
    expect(m.scheduledPrecise).toBe(true);
  });
```

- [ ] **Step 3: Run tests to verify the new ones fail**

Run: `TZ=UTC npx vitest run ingest/enrich.test.ts`
Expected: FAIL — `scheduledPrecise` undefined; the pass-through test fails because current code stamps `scheduledStart: undefined` for non-scheduled statuses.

- [ ] **Step 4: Implement**

In `ingest/enrich.ts`, replace the stamping block (currently lines 141-148, from the `// Order-of-play time + court…` comment through `const scheduledCourt = …`):

```ts
  // Precise order-of-play tier: the per-event startTimestamp is the published per-match slot (and
  // the freshest value under intra-day reshuffles) — it overrides normalize's coarse cuptrees stamp
  // and flags the time precise. Every other status passes the normalize-set fields through
  // untouched; the next refresh's normalize drops them once the match is no longer upcoming.
  const scheduled = status === "scheduled";
  const scheduledStart = scheduled ? (ev.startTimestamp ?? m.scheduledStart) : m.scheduledStart;
  const scheduledPrecise = scheduled && ev.startTimestamp != null ? true : m.scheduledPrecise;
  // `||` not `??`: a blank venue name ("") should fall through to the stadium name, not stand as an
  // empty court that renders no court at all (formatScheduled drops a falsy court).
  const scheduledCourt = scheduled ? (ev.venue?.name || ev.venue?.stadium?.name) : m.scheduledCourt;
```

And in the return literal change `scheduledStart, scheduledCourt,` to `scheduledStart, scheduledPrecise, scheduledCourt,`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `TZ=UTC npx vitest run ingest/enrich.test.ts && npx tsc --noEmit`
Expected: all PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/model.ts ingest/enrich.ts ingest/enrich.test.ts
git commit -m "feat(ingest): precise per-event time tier — scheduledPrecise flag + pass-through

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: State — `scheduledInfo` rework + wall-clock `nowSec` in `matchInsight`

**Files:**
- Modify: `src/state.ts:506-523` (ScheduledInfo + constants + scheduledInfo), `src/state.ts:557-565` (matchInsight signature + now derivation)
- Test: `src/state.test.ts` (rewrite the `scheduledInfo` and `matchInsight — scheduled` describes, ~lines 569-635)

**Interfaces:**
- Consumes: `Match.scheduledStart` / `scheduledPrecise` / `scheduledCourt` (Tasks 1-2).
- Produces:
  - `export interface ScheduledInfo { start: number; court: string | null; precise: boolean; }`
  - `export function scheduledInfo(m: Match, nowSec: number): ScheduledInfo | null` — allowlist gate (`"scheduled" | "notstarted"`), `precise = m.scheduledPrecise === true && dt <= 36h`, precise hides at `dt < -6h`, coarse hides once its UTC day is past.
  - `export function matchInsight(s, matchId, time, nowSec?: number)` — 4th param defaults to `Math.floor(Date.now() / 1000)`; `MatchInsight.scheduled: ScheduledInfo | null` now carries `precise`. Tasks 4-7 consume both.

- [ ] **Step 1: Rewrite the state tests**

In `src/state.test.ts`, replace the whole `describe("scheduledInfo", …)` and `describe("matchInsight — scheduled", …)` blocks (keep the `schedMatch` helper above them, unchanged) with:

```ts
describe("scheduledInfo", () => {
  const DAY = 86400;
  const NOW = 20_000 * DAY + 12 * 3600; // noon UTC on an arbitrary day — pure arithmetic either way

  it("precise: flagged + within 36h → start, court, precise:true", () => {
    expect(scheduledInfo(schedMatch({ scheduledStart: NOW + 3600, scheduledPrecise: true, scheduledCourt: "Court 2" }), NOW))
      .toEqual({ start: NOW + 3600, court: "Court 2", precise: true });
  });

  it("coarse: an UNFLAGGED nominal stamp within 36h is NOT precise", () => {
    // The evening-before case: a nominal 11:00 round-day stamp sits inside any window — precision
    // must come from the data source (the per-event override), never clock distance alone.
    expect(scheduledInfo(schedMatch({ scheduledStart: NOW + 20 * 3600 }), NOW))
      .toEqual({ start: NOW + 20 * 3600, court: null, precise: false });
  });

  it("coarse: a flagged stamp beyond 36h degrades to coarse (backstop)", () => {
    expect(scheduledInfo(schedMatch({ scheduledStart: NOW + 48 * 3600, scheduledPrecise: true }), NOW))
      .toEqual({ start: NOW + 48 * 3600, court: null, precise: false });
  });

  it("far-future placeholder rounds are shown (coarse), not suppressed", () => {
    expect(scheduledInfo(schedMatch({ status: "notstarted", p1: null, p2: null, scheduledStart: NOW + 5 * DAY }), NOW))
      .toEqual({ start: NOW + 5 * DAY, court: null, precise: false });
  });

  it("precise slot: just-overdue still shows; >6h past hides", () => {
    expect(scheduledInfo(schedMatch({ scheduledStart: NOW - 1800, scheduledPrecise: true }), NOW))
      .toEqual({ start: NOW - 1800, court: null, precise: true });
    expect(scheduledInfo(schedMatch({ scheduledStart: NOW - 7 * 3600, scheduledPrecise: true }), NOW)).toBeNull();
  });

  it("coarse slot survives hours past its stamp but drops once its UTC day is over", () => {
    expect(scheduledInfo(schedMatch({ scheduledStart: NOW - 11 * 3600 }), NOW))     // 01:00 today UTC — day not over
      .toEqual({ start: NOW - 11 * 3600, court: null, precise: false });
    expect(scheduledInfo(schedMatch({ scheduledStart: NOW - 13 * 3600 }), NOW)).toBeNull(); // 23:00 yesterday UTC
  });

  it("allowlist: no other status leaks a time, even with stray fields", () => {
    for (const status of ["finished", "live", "suspended", "retired", "walkover"] as const) {
      expect(scheduledInfo(schedMatch({ status, scheduledStart: NOW + 3600, scheduledPrecise: true }), NOW)).toBeNull();
    }
  });

  it("returns null when the match carries no scheduledStart", () => {
    expect(scheduledInfo(schedMatch(), NOW)).toBeNull();
  });
});

describe("matchInsight — scheduled", () => {
  const NOW = 1_700_000_000;

  it("uses the passed wall-clock now — a stale generatedAt never gates the display", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1, completedRounds: 0 });
    s.generatedAt = new Date((NOW - 12 * 3600) * 1000).toISOString(); // half-day-old snapshot
    s.matches["0-0"] = { ...s.matches["0-0"], status: "scheduled", winner: null,
      scheduledStart: NOW + 2 * 3600, scheduledPrecise: true, scheduledCourt: "Centre Court" };
    expect(insight3(s, "0-0", toc3(s), NOW)!.scheduled)
      .toEqual({ start: NOW + 2 * 3600, court: "Centre Court", precise: true });
  });

  it("surfaces a far-future placeholder date as coarse", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1, completedRounds: 0 });
    s.matches["0-0"] = { ...s.matches["0-0"], status: "scheduled", winner: null, scheduledStart: NOW + 5 * 86400 };
    expect(insight3(s, "0-0", toc3(s), NOW)!.scheduled)
      .toEqual({ start: NOW + 5 * 86400, court: null, precise: false });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `TZ=UTC npx vitest run src/state.test.ts`
Expected: FAIL — old `scheduledInfo` returns null for far-future/notstarted, has no `precise` field, and `matchInsight` takes no 4th argument (TS error surfaces at run).

- [ ] **Step 3: Implement**

In `src/state.ts`, replace lines 506-523 with:

```ts
export interface ScheduledInfo { start: number; court: string | null; precise: boolean; }

// Two-tier order-of-play display. PRECISE = the per-event startTimestamp override (scheduledPrecise,
// set at ingest) within a ~36h backstop — only that tier shows a clock time; an event-sourced stamp
// for a round 2+ days out can itself still be a nominal placeholder. Everything else upcoming is
// COARSE: a date-only nominal round-day stamp. Hide rules differ: a precise slot >6h past is stale
// (the match surely started); a coarse slot survives until its UTC calendar day — the venue day —
// is fully over, so a rain-slipped round keeps its date while the feed catches up.
const SCHED_PRECISE_AHEAD_SEC = 36 * 3600;
const SCHED_STALE_BEHIND_SEC = 6 * 3600;

/** The order-of-play info to display for a not-yet-played match, or null when there is nothing
 *  trustworthy to show. `nowSec` is the WALL-CLOCK reference (Unix seconds) — never derive it from
 *  the snapshot's generatedAt, which can lag hours when the refresh wedges. */
export function scheduledInfo(m: Match, nowSec: number): ScheduledInfo | null {
  const upcoming = m.status === "scheduled" || m.status === "notstarted"; // allowlist: walkover/retired never leak a time
  if (!upcoming || m.scheduledStart == null) return null;
  const dt = m.scheduledStart - nowSec;
  const precise = m.scheduledPrecise === true && dt <= SCHED_PRECISE_AHEAD_SEC;
  if (precise) {
    if (dt < -SCHED_STALE_BEHIND_SEC) return null;
  } else if (nowSec >= (Math.floor(m.scheduledStart / 86400) + 1) * 86400) {
    return null; // coarse: its UTC day is over
  }
  return { start: m.scheduledStart, court: m.scheduledCourt ?? null, precise };
}
```

Then change `matchInsight` (lines 557-565): add the 4th parameter and drop the generatedAt-derived nowSec:

```ts
export function matchInsight(
  s: Snapshot, matchId: string, time: Map<string, PlayerTime>,
  nowSec: number = Math.floor(Date.now() / 1000),
): MatchInsight | null {
  const m = s.matches[matchId];
  if (!m) return null;
  const surface = s.tournament.surface;
  const ref = s.generatedAt ?? new Date().toISOString(); // ages/birthdays reference only — never gates scheduled display
```

(Remove the `parsedRef` / `Number.isNaN` lines entirely; `scheduled: scheduledInfo(m, nowSec)` at the bottom stays as-is.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `TZ=UTC npx vitest run src/state.test.ts && npx tsc --noEmit`
Expected: all PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/state.ts src/state.test.ts
git commit -m "feat(state): two-tier scheduledInfo (precise/coarse) on a wall-clock now

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Render — `formatScheduled` rework (relative words, UTC coarse dates)

**Files:**
- Modify: `src/render.ts:343-360` (cached formatters + formatScheduled)
- Test: `src/render.test.ts` (replace the `formatScheduled` describe, ~lines 312-334)

**Interfaces:**
- Consumes: nothing new.
- Produces: `export interface SchedFormatOpts { nowSec: number; precise: boolean; full?: boolean; }` and `export function formatScheduled(start: number, court: string | null, opts: SchedFormatOpts): string`. Output shapes Tasks 5-7 rely on: precise compact `"Today 15:40"` / `"Tmrw 13:40"` / `"Sun 13:40"` / `"1 Jul 13:40"`; precise full `"Tomorrow 3 Jul, 13:40"`; coarse `"Tue 7 Jul"` (UTC-rendered, no time). Court appended as `" · Court 2"` when non-null.

- [ ] **Step 1: Rewrite the formatScheduled tests**

Replace the existing `describe("formatScheduled", …)` block in `src/render.test.ts` with (the `import { formatScheduled } from "./render";` line above it stays):

```ts
describe("formatScheduled", () => {
  const NOW = 1_782_999_600; // Thu 02 Jul 2026, 13:40 UTC (tests run TZ=UTC → viewer-local == UTC)
  const at = (h: number) => NOW + h * 3600;

  it("precise same-day → 'Today HH:MM · court'", () => {
    expect(formatScheduled(at(2), "Court 2", { nowSec: NOW, precise: true })).toBe("Today 15:40 · Court 2");
  });

  it("precise next-day: compact 'Tmrw', full 'Tomorrow' + calendar date", () => {
    expect(formatScheduled(at(24), null, { nowSec: NOW, precise: true })).toBe("Tmrw 13:40");
    expect(formatScheduled(at(24), null, { nowSec: NOW, precise: true, full: true })).toBe("Tomorrow 3 Jul, 13:40");
  });

  it("precise 2-6 days out → weekday + time", () => {
    expect(formatScheduled(at(3 * 24), null, { nowSec: NOW, precise: true })).toBe("Sun 13:40"); // 5 Jul 2026
  });

  it("precise past-day falls through to the absolute date — never a bare weekday", () => {
    expect(formatScheduled(at(-24), null, { nowSec: NOW, precise: true })).toBe("1 Jul 13:40");
  });

  it("coarse → venue-day date only, no clock time, no relative words", () => {
    const s = formatScheduled(at(5 * 24), null, { nowSec: NOW, precise: false });
    expect(s).toContain("Tue");
    expect(s).toContain("7 Jul");
    expect(s).not.toMatch(/\d{2}:\d{2}/);
    expect(s).not.toContain("Today");
  });

  it("coarse renders in UTC so the venue date never shifts for far-zone viewers", () => {
    // An AO-shaped nominal stamp at 00:00 UTC: viewer-local rendering west of UTC would say 9 Jul.
    const s = formatScheduled(Date.UTC(2026, 6, 10) / 1000, null, { nowSec: NOW, precise: false });
    expect(s).toContain("10 Jul");
  });

  it("omits the court separator (and never prints 'null') when no court is known", () => {
    const s = formatScheduled(at(2), null, { nowSec: NOW, precise: true });
    expect(s).not.toContain("·");
    expect(s).not.toContain("null");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `TZ=UTC npx vitest run src/render.test.ts`
Expected: FAIL — current `formatScheduled(start, court, full?: boolean)` has a different signature; TS/type errors and assertion failures.

- [ ] **Step 3: Implement**

In `src/render.ts`, replace the whole cached-formatter block + `formatScheduled` (currently lines 343-360, from the `// Two order-of-play formatters…` comment to the function's closing brace):

```ts
// Order-of-play formatters, built once at module load (Intl.DateTimeFormat construction is costly;
// the zone is fixed per session, and each date's UTC offset — incl. DST — is still resolved at
// format() time). Viewer-local for PRECISE slots (converting the clock is the point); UTC for
// COARSE date-only slots so the VENUE calendar day never shifts — every slam's nominal ~11:00-local
// stamp stays inside the same UTC day, where viewer-local rendering would show e.g. the Australian
// Open a day early in the Americas.
const SCHED_TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
const SCHED_DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short" });
const SCHED_DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const SCHED_DATE_UTC = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** Whole viewer-local calendar-day difference (compares local midnights — DST-safe, no 24h buckets). */
function localDayDiff(start: number, nowSec: number): number {
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((midnight(new Date(start * 1000)) - midnight(new Date(nowSec * 1000))) / 86_400_000);
}

/** Relative-day word for a PRECISE slot, or null when none applies (past day or >6 days out — a bare
 *  weekday for yesterday would read as NEXT week, so those fall through to the absolute date). */
function relativeDay(start: number, nowSec: number, full: boolean): string | null {
  const d = localDayDiff(start, nowSec);
  if (d === 0) return "Today";
  if (d === 1) return full ? "Tomorrow" : "Tmrw";
  if (d >= 2 && d <= 6) return SCHED_DAY.format(new Date(start * 1000));
  return null;
}

export interface SchedFormatOpts { nowSec: number; precise: boolean; full?: boolean; }

/** An order-of-play slot for a not-yet-played match. PRECISE (published per-event time): compact
 *  "Today 15:40" / "Tmrw 13:40" / "Sun 13:40"; full adds the calendar date — "Tomorrow 3 Jul, 13:40".
 *  COARSE (nominal round-day stamp): venue-day date only, "Tue 7 Jul", never a clock time or a
 *  relative word (cross-zone "Tomorrow" on a nominal date misleads). `nowSec` is the wall-clock
 *  reference. Returns plain text with the court unescaped — escape at the HTML boundary. */
export function formatScheduled(start: number, court: string | null, opts: SchedFormatOpts): string {
  const date = new Date(start * 1000);
  let when: string;
  if (opts.precise) {
    const word = relativeDay(start, opts.nowSec, opts.full ?? false);
    const time = SCHED_TIME.format(date);
    when = opts.full
      ? `${word ? `${word} ` : ""}${SCHED_DATE.format(date)}, ${time}`
      : `${word ?? SCHED_DATE.format(date)} ${time}`;
  } else {
    when = SCHED_DATE_UTC.format(date);
  }
  return court ? `${when} · ${court}` : when;
}
```

- [ ] **Step 4: Run tests — expect OTHER failures too**

Run: `TZ=UTC npx vitest run src/render.test.ts src/render-detail.test.ts`
Expected: the new `formatScheduled` describe PASSES; `render-detail.test.ts` and the two call sites in `render.ts` FAIL TO COMPILE (old 3-arg boolean call shape). That is Task 5's job — to keep this task compiling, apply the minimal call-site fix now:

In `src/render.ts:628-632` (`renderMatchStrip` schedTag) and `:674-677` (`renderMatchDetail` sched), the calls `formatScheduled(ins.scheduled.start, ins.scheduled.court)` / `(…, true)` will not typecheck. Temporarily leave them broken ONLY if proceeding immediately to Task 5 in the same session; otherwise apply Task 5's render.ts changes now (they are small) and commit both together. **Default: do Task 5 immediately and commit at its end** — do not commit mid-broken.

- [ ] **Step 5: proceed to Task 5 (shared commit)**

---

### Task 5: Render — strip + detail for all rounds, `nowSec` threaded

**Files:**
- Modify: `src/render.ts:628-632` (renderMatchStrip opts + schedTag), `src/render.ts:669-693` (renderMatchDetail signature + sched line)
- Modify: `src/app.ts:230` (nowSec const), `src/app.ts:292` (matchInsight call), `src/app.ts:306-311` (strip/detail calls)
- Test: `src/render-detail.test.ts`

**Interfaces:**
- Consumes: `MatchInsight.scheduled: { start, court, precise } | null` (Task 3); `formatScheduled(start, court, {nowSec, precise, full})` (Task 4).
- Produces: `renderMatchStrip(ins, nodeId, opts: { expanded: boolean; focused: boolean; noZoom?: boolean; nowSec: number })`; `renderMatchDetail(ins: MatchInsight, sofaUrl: string | null, rounds: Round[], nowSec: number)`. `draw()` exposes `const nowSec` for Tasks 6-7.

- [ ] **Step 1: Update the render call sites**

`renderMatchStrip` — change the opts type and schedTag (render.ts:628-632):

```ts
export function renderMatchStrip(ins: MatchInsight, nodeId: string, opts: { expanded: boolean; focused: boolean; noZoom?: boolean; nowSec: number }): string {
```

```ts
  // Upcoming match: a compact order-of-play tag in the caption — a precise "Today 15:40 · Court 2"
  // for the imminent tier, a coarse venue-day date ("Tue 7 Jul") for future rounds.
  const schedTag = ins.scheduled
    ? ` · <span class="ms-sched">🗓 ${escapeHtml(formatScheduled(ins.scheduled.start, ins.scheduled.court, { nowSec: opts.nowSec, precise: ins.scheduled.precise }))}</span>` : "";
```

`renderMatchDetail` — add the param and use full form (render.ts:669, 674-677):

```ts
export function renderMatchDetail(ins: MatchInsight, sofaUrl: string | null, rounds: Round[], nowSec: number): string {
```

```ts
  const sched = ins.scheduled
    ? `<div class="mi-sched">🗓 ${escapeHtml(formatScheduled(ins.scheduled.start, ins.scheduled.court, { nowSec, precise: ins.scheduled.precise, full: true }))}` +
      ` <span class="mi-prov">· scheduled, subject to change</span></div>`
    : "";
```

- [ ] **Step 2: Wire app.ts**

In `draw()` right after the `if (!snap) { … return; }` guard (app.ts:~237), add:

```ts
    // THE wall-clock reference for all scheduled-time display this render pass (never generatedAt —
    // a wedged refresh must not make stale data claim "Today"). Captured once so the strip, detail
    // and on-arc labels agree.
    const nowSec = Math.floor(Date.now() / 1000);
```

Update the call sites: `matchInsight(snap, state.selectedMatchId!, time, nowSec)!` (line ~292); add `nowSec` to the strip opts object (line ~306-310); `renderMatchDetail(ins, u, snap.rounds, nowSec)` (line ~311).

- [ ] **Step 3: Update render-detail tests**

In `src/render-detail.test.ts`: the `base` fixture keeps `scheduled: null`. Change `const opts = { expanded: false, focused: false };` to `const opts = { expanded: false, focused: false, nowSec: 1_782_999_600 };` (Thu 02 Jul 2026, 13:40 UTC). Replace the two scheduled tests and every `renderMatchDetail(x, y, rounds)` call (add `, 1_782_999_600`):

```ts
  it("shows a compact precise scheduled tag for an imminent match", () => {
    const ins: MatchInsight = { ...base, status: "scheduled", winner: null, score: null,
      scheduled: { start: 1782999600 + 2 * 3600, court: "Centre Court", precise: true } };
    const html = renderMatchStrip(ins, "r.0", opts);
    expect(html).toContain("ms-sched");
    expect(html).toContain("Today 15:40");
    expect(html).toContain("Centre Court");
  });

  it("shows a coarse venue-day date for a far-future TBD match", () => {
    const ins: MatchInsight = { ...base, status: "scheduled", winner: null, score: null,
      scheduled: { start: 1782999600 + 5 * 86400, court: null, precise: false } };
    const html = renderMatchStrip(ins, "r.0", opts);
    expect(html).toContain("7 Jul");
    expect(html).not.toMatch(/\d{2}:\d{2}/); // no fake clock time on a nominal date
  });
```

And in the detail describe:

```ts
  it("renders the full scheduled line, flagged provisional", () => {
    const ins: MatchInsight = { ...base, status: "scheduled", winner: null, score: null, durationSec: null,
      scheduled: { start: 1782999600 + 24 * 3600, court: "Court 2", precise: true } };
    const html = renderMatchDetail(ins, null, rounds, 1_782_999_600);
    expect(html).toContain("mi-sched");
    expect(html).toContain("Tomorrow 3 Jul, 13:40");
    expect(html).toContain("Court 2");
    expect(html).toContain("subject to change");
  });

  it("omits the scheduled line for a match with no scheduled info", () => {
    expect(renderMatchDetail(base, null, rounds, 1_782_999_600)).not.toContain("mi-sched");
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `TZ=UTC npx vitest run src/render.test.ts src/render-detail.test.ts src/app.test.ts && npx tsc --noEmit`
Expected: all PASS (app.test exercises draw() end-to-end), tsc clean.

- [ ] **Step 5: Commit (covers Tasks 4+5)**

```bash
git add src/render.ts src/render.test.ts src/render-detail.test.ts src/app.ts
git commit -m "feat(render): adaptive scheduled display — relative words, UTC coarse dates, all rounds

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Render — on-arc `sched` channel

**Files:**
- Modify: `src/render.ts:35-42` (SunburstLabels), `src/render.ts:180-275` (label pass: extract fitting helper + sched branch)
- Modify: `src/app.css` (after line 256, the `.arc-label` light-theme rule)
- Test: `src/render.test.ts`

**Interfaces:**
- Consumes: `LayoutArc` fields `matchId/projected/live/suspended/depth` (all exist — see render.ts:277, app.ts:245).
- Produces: `SunburstLabels.sched?: (matchId: string) => string | null`. Arcs that are `projected && !live && !suspended && depth >= 1` with a non-null `sched(matchId)` emit a `<text class="arc-label arc-sched">` through the same curved/radial fitting as names. Task 7 supplies the closure.

- [ ] **Step 1: Write the failing tests**

Append to `src/render.test.ts`:

```ts
import { renderSunburst } from "./render";
import type { LayoutArc } from "./layout";

describe("renderSunburst — on-arc scheduled labels", () => {
  const arc = (o: Partial<LayoutArc> = {}): LayoutArc => ({
    id: "r.0", matchId: "1-0", occupant: null, projected: true, live: false, suspended: false,
    depth: 1, x0: 0, x1: 1.2, y0: 120, y1: 180, ...o,
  } as LayoutArc);
  const color = Object.assign(() => "#123456", {}) as Parameters<typeof renderSunburst>[1];
  const labels = (sched: (id: string) => string | null) =>
    ({ anchors: new Set<string>(), text: () => "", sched }) as Parameters<typeof renderSunburst>[3];

  it("emits an .arc-sched label (through the shared arc-label class) for an upcoming projected arc", () => {
    const html = renderSunburst([arc()], color, 700, labels((id) => (id === "1-0" ? "Tmrw 14:30" : null)));
    expect(html).toContain("arc-label arc-sched");
    expect(html).toContain("Tmrw");
  });

  it("never emits one for live, suspended, or decided arcs, nor for the centre disc", () => {
    const sched = labels(() => "Tmrw 14:30");
    expect(renderSunburst([arc({ live: true })], color, 700, sched)).not.toContain("arc-sched");
    expect(renderSunburst([arc({ suspended: true })], color, 700, sched)).not.toContain("arc-sched");
    expect(renderSunburst([arc({ projected: false, occupant: "p9" })], color, 700, sched)).not.toContain("arc-sched");
    expect(renderSunburst([arc({ depth: 0 })], color, 700, sched)).not.toContain("arc-sched"); // focused hub / centre
  });

  it("emits nothing when sched returns null (no scheduled info)", () => {
    expect(renderSunburst([arc()], color, 700, labels(() => null))).not.toContain("arc-sched");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `TZ=UTC npx vitest run src/render.test.ts`
Expected: FAIL — `sched` not in `SunburstLabels` (TS), no `arc-sched` in output.

- [ ] **Step 3: Implement**

3a. Add to `SunburstLabels` (render.ts:35-42):

```ts
  /** Always-on order-of-play tag for an UPCOMING match's arc, keyed by matchId (the anchors/text
   *  channel is occupant-keyed and only serves decided arcs). Null = no label. Mutually exclusive
   *  with the name label by construction: names need !projected, sched needs projected. */
  sched?: (matchId: string) => string | null;
```

3b. Extract the text-fitting cascade. The block currently inside the name-label `else` branch (render.ts:203-273, from `const label = labels.text(a.occupant); if (label) {` — specifically the geometry from `const rc = (a.y0 + a.y1) / 2;` through the end of the curved/radial cascade) moves into a helper declared just above `const arcPaths = arcs.map(…)` (i.e., in the same scope where `defs`, `texts`, `pt`, `fitLabel`, `splitTwo` are visible):

```ts
  /** Fit `label` onto arc `a` through the curved/radial cascade and emit it into defs/texts.
   *  `extra` suffixes the class (e.g. " arc-sched"); `shortForm`, when given, replaces the
   *  truncate-last-resort (a chopped "Tmrw 14…" is worse than a clean "Tmrw"). */
  const emitFitted = (a: LayoutArc, label: string, extra = "", shortForm?: string) => {
    const rc = (a.y0 + a.y1) / 2;
    const span = a.x1 - a.x0;
    const mid = (a.x0 + a.x1) / 2;
    const radial = a.y1 - a.y0;
    const idb = a.id.replace(/[^a-z0-9]/gi, "");
    const big = span > Math.PI ? 1 : 0;
    const apad = Math.min(0.03, span * 0.12);
    const s0 = a.x0 + apad, s1 = a.x1 - apad;
    const chord = rc * (s1 - s0);               // usable tangential length for fitting
    const revT = mid > Math.PI / 2 && mid < 3 * Math.PI / 2;  // curved flips on the bottom half
    const revR = mid > Math.PI;                 // radial (spoke) flips on the left half
    const fitOrShort = (l: string, budget: number): string =>
      l.length <= budget ? l : shortForm && shortForm.length <= budget ? shortForm : fitLabel(l, budget);
    const curved = (r: number, txt: string, f: number, id: string) => {
      const dPath = revT
        ? `M${pt(r, s1)} A${r},${r} 0 ${big} 0 ${pt(r, s0)}`
        : `M${pt(r, s0)} A${r},${r} 0 ${big} 1 ${pt(r, s1)}`;
      defs.push(`<path id="${id}" d="${dPath}"></path>`);
      texts.push(
        `<text class="arc-label${extra}" font-size="${f.toFixed(1)}">` +
        `<textPath href="#${id}" startOffset="50%" text-anchor="middle">${escapeHtml(txt)}</textPath></text>`,
      );
    };
    const radialAt = (ang: number, txt: string, f: number, id: string) => {
      const dPath = revR
        ? `M${pt(a.y1 - 2, ang)} L${pt(a.y0 + 2, ang)}`
        : `M${pt(a.y0 + 2, ang)} L${pt(a.y1 - 2, ang)}`;
      defs.push(`<path id="${id}" d="${dPath}"></path>`);
      texts.push(
        `<text class="arc-label arc-radial${extra}" font-size="${f.toFixed(1)}">` +
        `<textPath href="#${id}" startOffset="50%" text-anchor="middle">${escapeHtml(txt)}</textPath></text>`,
      );
    };
    const [l1, l2] = splitTwo(label);
    if (radial > rc * span) {
      // RADIAL — text runs OUTWARDS along the ring depth (R128, R64). A ring wide enough for two
      // columns (R64) gets a SECOND radial row so long names show in full without rotating to a
      // curve; the thinnest ring (R128) keeps a single spoke.
      const rf = Math.min(11, Math.max(7.5, radial * 0.24));
      const rbudget = Math.max(2, Math.floor((radial - 4) / (rf * 0.6)));
      const colW = rf * 1.05;
      if (rc * span >= 2 * colW && label.length > rbudget) {
        const off = (colW * 0.5) / rc;            // angular offset for two side-by-side columns
        // order columns by which half of the wheel we're on (matches the revR reading flip), so
        // the first row never lands above the second in the top-left / bottom-right quarters
        radialAt(revR ? mid + off : mid - off, fitOrShort(l1, rbudget), rf, `lr1${idb}`);
        radialAt(revR ? mid - off : mid + off, fitOrShort(l2, rbudget), rf, `lr2${idb}`);
      } else {
        radialAt(mid, fitOrShort(label, rbudget), rf, `lr${idb}`);
      }
    } else {
      // CURVED — text follows the ring (R32 inward): one line → two lines (≥3 chars) → truncate.
      const fs = Math.min(13, Math.max(8, radial * 0.42));
      const budget = Math.floor(chord / (fs * 0.58));
      const f2 = Math.min(fs, 10);                // slightly smaller so two lines fit narrow rings
      const budget2 = Math.floor(chord / (f2 * 0.58));
      const fitFs = chord / (label.length * 0.58); // font size at which the whole name fills one line
      if (label.length <= budget) {
        curved(rc, label, fs, `lp${idb}`);        // fits on one line at full size
      } else if (radial >= 2.3 * f2 && l1.length >= 3 && l2.length >= 3 && l1.length <= budget2 && l2.length <= budget2) {
        const gap = f2 * 0.62;                     // two curved lines — whole name, no mid-word break
        const upper = Math.cos(mid) > 0;           // top half → first line on the outer ring
        curved(upper ? rc + gap : rc - gap, l1, f2, `la${idb}`);
        curved(upper ? rc - gap : rc + gap, l2, f2, `lb${idb}`);
      } else if (fitFs >= 8) {
        curved(rc, label, Math.min(fs, fitFs), `lp${idb}`); // shrink one line to show the full short name ("Halys")
      } else {
        curved(rc, fitOrShort(label, budget), fs, `lp${idb}`); // truncate — last resort (or the shortForm)
      }
    }
  };
```

Note the ONLY intentional behavior changes vs the original inline code: `fitLabel(x, b)` at the two single-slot spots and the final truncate become `fitOrShort(x, b)` (identical when `shortForm` is undefined, i.e. for all name labels — 2-arg `fitLabel` calls inside the two-column branch also route through `fitOrShort` with the same no-shortForm equivalence).

3c. Replace the original name-label text branch body with a call, and add the sched branch. The structure becomes:

```ts
      if (labels && !a.projected && a.occupant && labels.anchors.has(a.id)) {
        // …existing image (flag) branch unchanged…
        } else {
        const label = labels.text(a.occupant);
        if (label) emitFitted(a, label);
        } // end image/text branch
      } else if (labels?.sched && a.projected && !a.live && !a.suspended && a.depth >= 1) {
        // Upcoming match: the always-on order-of-play tag, in the same label slot a winner's surname
        // will occupy once decided. depth 0 is the centre disc (root or focused hub) — its cramped
        // full-circle path draws garbage, and its pill/strip already carries the info; skip it.
        // splitTwo splits "Tmrw 14:30" into day/time rows on two-column rings; the shortForm keeps
        // a clean bare day-word where even that doesn't fit.
        const stxt = labels.sched(a.matchId);
        if (stxt) emitFitted(a, stxt, " arc-sched", stxt.split(" ")[0]);
      }
```

3d. Add the CSS after the `:root[data-theme="light"] .arc-label` rule (app.css:256):

```css
/* upcoming match: the on-arc order-of-play tag — teal like .ms-sched; pointer-events:none and the
   halo come from .arc-label (taps fall through to the arc). Both rules needed: the light-theme
   .arc-label fill outranks a lone class. */
.arc-sched { fill: var(--teal-text); font-weight: 600; }
:root[data-theme="light"] .arc-sched { fill: var(--teal-text); }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `TZ=UTC npx vitest run src/render.test.ts src/app.test.ts && npx tsc --noEmit`
Expected: new tests PASS; the 70 app tests still PASS (labels behave identically without a `sched` callback); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/render.ts src/render.test.ts src/app.css
git commit -m "feat(render): always-on order-of-play tags on upcoming arcs (.arc-sched)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: App — wire `schedLabel` + recompute policy

**Files:**
- Modify: `src/app.ts:1` (import scheduledInfo), `src/app.ts:5-7` (import formatScheduled), `src/app.ts:~262` (schedLabel closure), `src/app.ts:~362` (labels object), `src/app.ts:~770` (listeners)
- Test: existing suites (wiring is exercised end-to-end by `src/app.test.ts`)

**Interfaces:**
- Consumes: `scheduledInfo(m, nowSec)` (Task 3), `formatScheduled(start, null, {nowSec, precise})` (Task 4), `SunburstLabels.sched` (Task 6), `nowSec` in `draw()` (Task 5).
- Produces: the live feature.

- [ ] **Step 1: Wire the labels channel**

Add `scheduledInfo` to the `./state` import list (app.ts:1) and `formatScheduled` to the `./render` import list (app.ts:5-7). After the `labelImage` definition (app.ts:~262), add:

```ts
    // Always-on order-of-play tags for upcoming arcs (matchId-keyed — anchors/text serve decided
    // arcs only). Court is strip/detail-only; arcs stay compact. Lens-independent by design.
    const schedLabel = (matchId: string): string | null => {
      const m = snap.matches[matchId];
      const info = m ? scheduledInfo(m, nowSec) : null;
      return info ? formatScheduled(info.start, null, { nowSec, precise: info.precise }) : null;
    };
```

In the `renderSunburst` call (app.ts:~362) change the labels object to `{ anchors, text: labelText, image: labelImage, sched: schedLabel }`.

- [ ] **Step 2: Recompute policy**

Near the other `window.addEventListener` blocks (after app.ts:~770, still inside the scope where `signal` and `draw` live), add:

```ts
  // Scheduled-time staleness policy: all scheduled display runs on wall-clock "now" captured per
  // draw(), so a long-lived tab must redraw when (a) it becomes visible again — the overnight-open
  // tab — and (b) the viewer's local midnight passes while visible ("Today" must roll over). draw()
  // self-guards while no snapshot is loaded.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) draw(); }, { signal });
  let midnightTimer = 0;
  const armMidnight = () => {
    const now = new Date();
    const msToMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();
    midnightTimer = window.setTimeout(() => { draw(); armMidnight(); }, msToMidnight + 1000);
  };
  armMidnight();
  signal.addEventListener("abort", () => clearTimeout(midnightTimer));
```

- [ ] **Step 3: Verify end-to-end**

Run: `pnpm test && npx tsc --noEmit`
Expected: full suite PASSES (app tests boot createApp — the timer must be cleaned by the abort listener; if vitest reports a leaked timer, the abort wiring is wrong — fix, don't skip). tsc clean.

- [ ] **Step 4: Commit**

```bash
git add src/app.ts
git commit -m "feat(app): wire on-arc scheduled tags + visibility/midnight recompute

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Verification — live-data visual check, day-0 clutter call, docblock sweep

**Files:**
- Modify (docblocks only, if the sweep finds stragglers): `src/state.ts`, `src/render.ts`, `src/model.ts`, `ingest/normalize.ts`
- Modify: `docs/superpowers/specs/2026-07-02-scheduled-times-all-rounds-design.md` (status line → implemented)

- [ ] **Step 1: Stale-wording sweep**

Run: `grep -rn "trust window\|trust-window\|TRUST" src/ ingest/ --include="*.ts" | grep -v test`
Expected: no hits outside comments updated in Tasks 3-4. Fix any straggler docblocks (the spec's checklist: `model.ts` scheduled fields — done Task 2; `render.ts` formatScheduled — done Task 4; `normalize.ts` collectEventIds — done Task 1; `state.ts` constants — done Task 3).

- [ ] **Step 2: Full suite + typecheck + build**

Run: `pnpm test && npx tsc --noEmit && pnpm build`
Expected: all pass. (`pnpm build` = `tsc --noEmit && vite build` — catches anything vitest's transform tolerates.)

- [ ] **Step 3: Visual check against live data (Wimbledon 2026 is mid-flight)**

Run `pnpm dev` and load the ATP Wimbledon draw (live data via `VITE_DATA_BASE_URL`; NOTE: the data branch only carries `scheduledStart` after the next launchd refresh runs the new ingest — if the fields are absent, run `pnpm ingest` locally or verify against a locally-built snapshot). Check, with a screenshot for the user:
1. Upcoming R32 arcs show precise tags ("Today 14:30"-shaped) once order-of-play data exists; future-round arcs (R16 → Final) show coarse dates ("Tue 7 Jul"-shaped).
2. Decided arcs still show surnames; live arcs show the hatch, no sched tag.
3. Zoom into a section: the focused hub (centre disc) carries NO sched label; its strip does.
4. Tap an upcoming TBD match: strip shows the compact tag, expanded detail shows the full "… · scheduled, subject to change" line.
5. **Day-0 clutter call (spec §3):** judge the whole-wheel-labeled look (many coarse labels at once). If it reads as noise, apply the spec's stated fallback — suppress coarse labels on the outermost ring only (`a.depth >= 1` → also require `a.y1 - a.y0` above the R128 thinness, or gate on `stxt`'s precise tier for depth-max arcs) — and record the decision in the spec. Default = show.

- [ ] **Step 4: Update spec status + commit**

Change the spec's status line to `**Status:** implemented`. Then:

```bash
git add docs/superpowers/specs/2026-07-02-scheduled-times-all-rounds-design.md
git commit -m "docs(spec): mark scheduled-times-all-rounds implemented

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** Decision 1 → Tasks 1-2; D2 → T3 (no suppression); D3 → T3 (precise flag + backstop); D4 → T5-6; D5 → T6 (sched channel); D6 → T6 (gate + depth≥1 centre suppression); D7 → T2 (court unchanged); D8 → T4 (relative words precise-only, UTC coarse, past fallthrough); D9 → T3+T5 (wall-clock nowSec); D10 → T7 (visibility + midnight). §4 testing items all mapped; PR #49 leftover tests rewritten in T2 (enrich) and T3 (state suppression inversions).
- **Type consistency:** `ScheduledInfo {start, court, precise}` (T3) consumed by T5/T7; `SchedFormatOpts {nowSec, precise, full?}` (T4) consumed by T5/T7; `SunburstLabels.sched?: (matchId: string) => string | null` (T6) supplied by T7; `renderMatchDetail(ins, sofaUrl, rounds, nowSec)` and strip `opts.nowSec` (T5) match app.ts call sites.
- **Known coupling:** Tasks 4 and 5 share one commit (T4's signature change breaks T5's call sites; committing mid-broken is worse than one two-task commit).
