# Point-by-Point Live Score Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While a live match is selected, its strip shows the current game's point score (30–15, tiebreak digits), a serve dot on the serving player, and a computed BP/SP/MP chip — fed by a new `/api/pbp` Vercel function proxying Flashscore's per-match `df_mhs` feed.

**Architecture:** A second stateless Vercel function (`api/pbp.ts`) fetches the ~192-byte `df_mhs_1_<mid>` feed per match id with the same `x-fsign` auth as `/api/live`. The client polls it every 8s ONLY while a live match is selected, and writes the values into the existing match strip **in place** — never through `draw()` — so point ticks cause zero wheel redraws. The match id, home/away orientation, and server ride the existing `/api/live` overlay patch as three new transient `Match` fields. Tennis rules (tiebreak detection, BP/SP/MP) live in a new pure module `src/points.ts`.

**Tech Stack:** TypeScript, Vite, vitest (jsdom; TZ=UTC pinned by vite.config.ts), Vercel Node functions (unbundled ESM — relative imports need `.js` extensions), pnpm.

**Spec:** `docs/superpowers/specs/2026-07-10-pbp-live-points-design.md`

## Global Constraints

- Vercel `api/*` functions are unbundled ESM: every relative import in their import chain MUST carry a `.js` extension (resolves to `.ts` across tsc/Vite/tsx/vitest). Files under `api/` starting with `_` are NOT deployed as routes — safe for shared helpers.
- Point ticks must NEVER call `draw()` — in-place DOM writes only. `samePatch()` semantics in `src/live.ts` must remain order-insensitive and unaffected by identical transient fields.
- Feed values are raw display strings: `"0" | "15" | "30" | "40" | "A"`, plain digits during tiebreaks. Render raw strings verbatim; chip logic returns `null` on anything unrecognized (fail quiet, never wrong-loud).
- Tiebreak: no serve attribution, no BP chip; SP/MP only. Final-set tiebreak (sets sum = bestOf−1) plays to 10, others to 7 (post-2022 slam rules).
- `/api/pbp` caching: success `Cache-Control: public, s-maxage=5, stale-while-revalidate=15`; empty/failure fallback `public, s-maxage=5`. Failure responds `200` with `{}` (matches `api/live.ts`'s empty-overlay convention, deliberately deviating from the spec's 502 — same-shaped body either way).
- Client poll: `PBP_POLL_MS = 8_000`, gated on `!document.hidden` ∧ `isLiveView()` ∧ a selected match that is (patched-)live with a `flashId`. `no-store` on the client fetch.
- Run tests with `npx vitest run <file>` (TZ already pinned). Full suite: `npx vitest run`.
- Branch: `feat/pbp-live-points` in a worktree (superpowers:using-git-worktrees) — the main checkout is shared with parallel sessions.

---

### Task 1: Extract shared Flashscore feed constants (`api/_flashscore.ts`)

Pure refactor — no behavior change, no new tests; the existing suite is the gate.

**Files:**
- Create: `api/_flashscore.ts`
- Modify: `api/live.ts` (lines 9–11 and line 21)

**Interfaces:**
- Consumes: nothing new.
- Produces: `export const FEED_HOST: string` (`"https://global.flashscore.ninja/2/x/feed"`), `export const X_FSIGN: string`, `export const UA: string` — imported by `api/live.ts` now and `api/pbp.ts` in Task 6.

- [ ] **Step 1: Create `api/_flashscore.ts`**

```ts
// Shared Flashscore feed constants for the api/* functions. The leading underscore keeps
// Vercel from deploying this file as a route. The x-fsign token has been stable for ~a
// decade; if it ever rotates, this is the single place to fix (see the design spec's
// token-rotation note in docs/superpowers/specs/2026-07-10-pbp-live-points-design.md).
export const FEED_HOST = "https://global.flashscore.ninja/2/x/feed";
export const X_FSIGN = "SW9D1eZo";
export const UA = "TennisArc/1.0 (+https://tennisarc.vercel.app)";
```

- [ ] **Step 2: Point `api/live.ts` at it**

Replace lines 9–11:

```ts
const FEED = "https://global.flashscore.ninja/2/x/feed/f_2_0_3_en_1";
const X_FSIGN = "SW9D1eZo";
const UA = "TennisArc/1.0 (+https://tennisarc.vercel.app)";
```

with:

```ts
// .js extension REQUIRED here too (same ESM rule as the parseLiveFeed import below).
import { FEED_HOST, UA, X_FSIGN } from "./_flashscore.js";

const FEED = `${FEED_HOST}/f_2_0_3_en_1`;
```

(Place the import with the other imports at the top; keep the `const FEED` where the old constants were. Line 21's fetch call is unchanged — it already reads `X_FSIGN`/`UA` by name.)

- [ ] **Step 3: Full suite green**

Run: `npx vitest run`
Expected: all tests pass (549+ at last count), nothing new.

- [ ] **Step 4: Commit**

```bash
git add api/_flashscore.ts api/live.ts
git commit -m "refactor(api): extract shared Flashscore feed constants for the coming /api/pbp"
```

---

### Task 2: `parseCurrentGame` — the `df_mhs` parser

**Files:**
- Modify: `ingest/flashscore.ts` (append after `parseLiveFeed`)
- Test: `ingest/flashscore.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `export function parseCurrentGame(text: string): { home: string; away: string } | null` — used by `api/pbp.ts` (Task 6).

- [ ] **Step 1: Write the failing tests** (append a new describe to `ingest/flashscore.test.ts`)

```ts
import { parseCurrentGame, parseLiveFeed } from "./flashscore";

describe("parseCurrentGame (df_mhs current-game feed)", () => {
  // Verbatim shape captured live 2026-07-10 (Sinner–Djokovic Wimbledon SF, between games).
  const BETWEEN_GAMES =
    "TS÷GR¬PT÷TI¬PV÷notab¬TS÷TA¬TS÷HD¬PT÷VA¬PV÷Current game¬TE÷HD¬TS÷RWP¬" +
    "TS÷SC¬PT÷PT¬PV÷1¬PT÷VA¬PV÷0¬TE÷SC¬TS÷SC¬PT÷PT¬PV÷2¬PT÷VA¬PV÷0¬TE÷SC¬" +
    "TE÷RWP¬TE÷TA¬TE÷GR¬A1÷559e897e9099399799bb8fe726208ada¬~";
  const MID_GAME = BETWEEN_GAMES.replace("PV÷1¬PT÷VA¬PV÷0", "PV÷1¬PT÷VA¬PV÷40")
    .replace("PV÷2¬PT÷VA¬PV÷0", "PV÷2¬PT÷VA¬PV÷A");

  it("reads both sides' point values (home = player 1)", () => {
    expect(parseCurrentGame(MID_GAME)).toEqual({ home: "40", away: "A" });
  });

  it("reads 0/0 between games", () => {
    expect(parseCurrentGame(BETWEEN_GAMES)).toEqual({ home: "0", away: "0" });
  });

  it("does NOT capture the 'Current game' header text as a value", () => {
    // the header block is PT÷VA¬PV÷Current game with no preceding PT÷PT — must be skipped
    const parsed = parseCurrentGame(BETWEEN_GAMES);
    expect(parsed).not.toBeNull();
    expect(Object.values(parsed!)).not.toContain("Current game");
  });

  it("reads tiebreak digit values", () => {
    const tb = BETWEEN_GAMES.replace("PV÷1¬PT÷VA¬PV÷0", "PV÷1¬PT÷VA¬PV÷6")
      .replace("PV÷2¬PT÷VA¬PV÷0", "PV÷2¬PT÷VA¬PV÷5");
    expect(parseCurrentGame(tb)).toEqual({ home: "6", away: "5" });
  });

  it("returns null when a side is missing (finished / not-started match)", () => {
    expect(parseCurrentGame("A1÷deadbeef¬~")).toBeNull();
    expect(parseCurrentGame("")).toBeNull();
    expect(parseCurrentGame("TS÷SC¬PT÷PT¬PV÷1¬PT÷VA¬PV÷15¬TE÷SC¬~")).toBeNull(); // only player 1
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run ingest/flashscore.test.ts`
Expected: FAIL — `parseCurrentGame` is not exported.

- [ ] **Step 3: Implement** (append to `ingest/flashscore.ts`)

```ts
/**
 * Parse a `df_mhs_1_<mid>` current-game feed into the two sides' point values, or null when
 * no current game is present (match finished / not started / malformed). Values are the raw
 * display strings ("0" | "15" | "30" | "40" | "A"; plain digits during a tiebreak) — callers
 * render them verbatim. Structure: TS/TE-delimited blocks where each score cell is
 * `PT÷PT ¬ PV÷<playerNo> ¬ PT÷VA ¬ PV÷<value>`; a PT÷VA with no pending player (the
 * "Current game" header) must not capture.
 */
export function parseCurrentGame(text: string): { home: string; away: string } | null {
  let player: string | null = null;
  let expect: "player" | "value" | null = null;
  const vals: Record<string, string> = {};
  for (const p of text.split("¬")) {
    const i = p.indexOf("÷");
    if (i <= 0) continue;
    const k = p.slice(0, i), v = p.slice(i + 1);
    if (k === "PT") { expect = v === "PT" ? "player" : v === "VA" && player != null ? "value" : null; continue; }
    if (k === "PV") {
      if (expect === "player") player = v;
      else if (expect === "value" && player != null) { vals[player] = v; player = null; }
      expect = null;
    }
  }
  return vals["1"] != null && vals["2"] != null ? { home: vals["1"], away: vals["2"] } : null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run ingest/flashscore.test.ts`
Expected: PASS, including all pre-existing `parseLiveFeed` tests.

- [ ] **Step 5: Commit**

```bash
git add ingest/flashscore.ts ingest/flashscore.test.ts
git commit -m "feat(ingest): parse the df_mhs current-game feed (point-by-point spike shape)"
```

---

### Task 3: `parseLiveFeed` emits the server (`srv`) from `CX`

**Files:**
- Modify: `src/model.ts` (the `LiveRecord` interface, ~line 100)
- Modify: `ingest/flashscore.ts` (`parseLiveFeed`, the record-push block at lines 62–68)
- Test: `ingest/flashscore.test.ts`

**Interfaces:**
- Consumes: existing `parseLiveFeed` + `LiveRecord`.
- Produces: `LiveRecord.srv?: 1 | 2` — `1` = home serving, `2` = away; only ever set on stage-2 (live) records. Consumed by `overlayLive` (Task 4).

- [ ] **Step 1: Write the failing tests** (extend the existing `parseLiveFeed` describe in `ingest/flashscore.test.ts`; reuse its existing header/record fixture helpers — the tests below show records inline with the same `¬`/`÷`/`~` encoding the file already uses)

```ts
it("emits srv from CX on a live record (1 = home, 2 = away)", () => {
  const feed =
    "ZA÷ATP - SINGLES: Wimbledon (United Kingdom), grass¬ZB÷5724¬~" +
    "AA÷aaaa1111¬AB÷2¬AE÷Sinner J.¬AF÷Djokovic N.¬CX÷Sinner J.¬AG÷1¬AH÷0¬BA÷6¬BB÷4¬~" +
    "AA÷bbbb2222¬AB÷2¬AE÷Alcaraz C.¬AF÷Zverev A.¬CX÷Zverev A.¬AG÷0¬AH÷0¬BA÷2¬BB÷3¬~";
  const recs = parseLiveFeed(feed, { tour: "ATP", slam: "wimbledon" });
  expect(recs.map((r) => r.srv)).toEqual([1, 2]);
});

it("omits srv when CX is absent, unmatched, or the record is not live", () => {
  const feed =
    "ZA÷ATP - SINGLES: Wimbledon (United Kingdom), grass¬ZB÷5724¬~" +
    "AA÷cccc3333¬AB÷2¬AE÷Fritz T.¬AF÷Paul T.¬AG÷0¬AH÷0¬BA÷1¬BB÷1¬~" +          // no CX
    "AA÷dddd4444¬AB÷2¬AE÷Ruud C.¬AF÷Rune H.¬CX÷Somebody E.¬AG÷0¬AH÷0¬BA÷1¬BB÷1¬~" + // unmatched CX
    "AA÷eeee5555¬AB÷3¬AE÷Fery A.¬AF÷Zverev A.¬CX÷Zverev A.¬AG÷0¬AH÷3¬BA÷6¬BB÷7¬~";  // finished (CX persists upstream)
  const recs = parseLiveFeed(feed, { tour: "ATP", slam: "wimbledon" });
  expect(recs.map((r) => r.srv)).toEqual([undefined, undefined, undefined]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run ingest/flashscore.test.ts`
Expected: FAIL — `srv` is `undefined` everywhere / TS error on the property.

- [ ] **Step 3: Implement**

In `src/model.ts`, extend `LiveRecord`:

```ts
export interface LiveRecord {
  id: string;
  stage: 1 | 2 | 3;              // 1 scheduled, 2 live, 3 finished
  home: string;
  away: string;
  setsWon: [number, number];     // [home, away]
  sets: Array<[number, number]>; // per-set games [home, away], in order
  srv?: 1 | 2;                   // current server (CX), live records only — 1 home, 2 away
}
```

In `ingest/flashscore.ts`, replace the `out.push({...})` block (lines 62–68) with:

```ts
    const rec: LiveRecord = {
      id: f.get("AA") ?? "",
      stage: stage as 1 | 2 | 3,
      home, away,
      setsWon: [num(f.get("AG") ?? ""), num(f.get("AH") ?? "")],
      sets,
    };
    // CX names the current server, but it PERSISTS on finished records (last server) — only a
    // live record's value means "serving now". Exact match against the record's own names.
    if (stage === 2) {
      const cx = f.get("CX") ?? "";
      if (cx === home) rec.srv = 1;
      else if (cx === away) rec.srv = 2;
    }
    out.push(rec);
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run ingest/flashscore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/model.ts ingest/flashscore.ts ingest/flashscore.test.ts
git commit -m "feat(ingest): surface the current server (CX) on live list-feed records"
```

---

### Task 4: `overlayLive` carries `flashId` / `flashHomeIsP1` / `serving`

**Files:**
- Modify: `src/model.ts` (the `Match` interface, after `live:` ~line 73)
- Modify: `src/live.ts` (`overlayLive`, the patch-building block at lines 49–58)
- Test: `src/live.test.ts`

**Interfaces:**
- Consumes: `LiveRecord.srv` (Task 3).
- Produces: three transient optional `Match` fields set ONLY on stage-2 patches: `flashId?: string`, `flashHomeIsP1?: boolean`, `serving?: "p1" | "p2"`. Consumed by `matchInsight` (Task 8) and the app poll loop (Task 9).

- [ ] **Step 1: Write the failing tests** (extend the `overlayLive` describe in `src/live.test.ts` — reuse its existing snapshot/record fixtures; the file already builds a snapshot whose two players have known names and a matching record)

```ts
it("stamps flashId/orientation/serving on a live patch", () => {
  // reuse the describe's existing snapshot + live record (home = p1's short name), adding srv
  const rec: LiveRecord = { ...liveRecord, stage: 2, srv: 2 };   // away serving
  const patch = overlayLive(snap, [rec])[matchId];
  expect(patch.flashId).toBe(rec.id);
  expect(patch.flashHomeIsP1).toBe(true);
  expect(patch.serving).toBe("p2");                              // away = p2 when home is p1
});

it("resolves orientation and serving when the record's home is our p2", () => {
  const rec: LiveRecord = { ...liveRecord, stage: 2, srv: 1, home: liveRecord.away, away: liveRecord.home };
  const patch = overlayLive(snap, [rec])[matchId];
  expect(patch.flashHomeIsP1).toBe(false);
  expect(patch.serving).toBe("p2");                              // record home serving = our p2
});

it("puts NO transient live fields on a finished patch", () => {
  const rec: LiveRecord = { ...liveRecord, stage: 3, setsWon: [3, 0], srv: 1 };
  const patch = overlayLive(snap, [rec])[matchId];
  expect(patch.flashId).toBeUndefined();
  expect(patch.flashHomeIsP1).toBeUndefined();
  expect(patch.serving).toBeUndefined();
});
```

(Adapt the fixture variable names — `liveRecord`, `snap`, `matchId` — to the ones the describe already defines; do not build a new snapshot.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/live.test.ts`
Expected: FAIL — the fields are undefined on live patches.

- [ ] **Step 3: Implement**

In `src/model.ts`, add to `Match` directly under the `live:` field:

```ts
  /** Transient live-overlay fields (set by src/live.ts overlayLive on in-play matches only) —
   *  never present in snapshot JSON, gone the moment the overlay marks the match finished.
   *  flashId keys the /api/pbp per-match feed; flashHomeIsP1 orients its home/away values. */
  flashId?: string;
  flashHomeIsP1?: boolean;
  serving?: "p1" | "p2";
```

In `src/live.ts`, inside `overlayLive`'s record loop, after the `patch` literal is built (line 52) and before the `if (r.stage === 3)` block, add:

```ts
    if (r.stage === 2) {
      patch.flashId = r.id;
      patch.flashHomeIsP1 = homeIsP1;
      if (r.srv) patch.serving = (r.srv === 1) === homeIsP1 ? "p1" : "p2";
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/live.test.ts`
Expected: PASS, including the pre-existing `samePatch` tests (identical transient fields compare equal via the same JSON.stringify path — no change needed there).

- [ ] **Step 5: Commit**

```bash
git add src/model.ts src/live.ts src/live.test.ts
git commit -m "feat(live): carry Flashscore match id, orientation and server on the live patch"
```

---

### Task 5: `src/points.ts` — tennis point rules (the dense matrix)

**Files:**
- Create: `src/points.ts`
- Test: create `src/points.test.ts`

**Interfaces:**
- Consumes: `SetScore` from `./model` (`{ p1: number; p2: number; tb?: number | null }`).
- Produces (consumed by Task 9's `applyPbp`):

```ts
export interface PointStateInput {
  pts: { p1: string; p2: string };
  serving?: "p1" | "p2";
  games: { p1: number; p2: number };
  sets: { p1: number; p2: number };
  bestOf: 3 | 5;
}
export interface PointState { tb: boolean; chip: "BP" | "SP" | "MP" | null; chipFor: "p1" | "p2" | null; }
export function pointState(i: PointStateInput): PointState;
export function deriveContext(score: SetScore[] | null): { games: { p1: number; p2: number }; sets: { p1: number; p2: number } };
```

- [ ] **Step 1: Write the failing tests** (`src/points.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { deriveContext, pointState } from "./points";
import type { SetScore } from "./model";

const st = (over: Partial<Parameters<typeof pointState>[0]> = {}) => pointState({
  pts: { p1: "0", p2: "0" }, serving: "p1",
  games: { p1: 0, p2: 0 }, sets: { p1: 0, p2: 0 }, bestOf: 5, ...over,
});

describe("pointState — normal games", () => {
  it("no chip on a plain rally score", () => {
    expect(st({ pts: { p1: "30", p2: "15" } })).toEqual({ tb: false, chip: null, chipFor: null });
  });
  it("no chip at deuce", () => {
    expect(st({ pts: { p1: "40", p2: "40" } }).chip).toBeNull();
  });
  it("server's plain game point is NOT a chip", () => {
    expect(st({ pts: { p1: "40", p2: "30" }, serving: "p1" }).chip).toBeNull();
  });
  it("receiver's game point is a BP (40 and advantage forms)", () => {
    expect(st({ pts: { p1: "40", p2: "30" }, serving: "p2" })).toEqual({ tb: false, chip: "BP", chipFor: "p1" });
    expect(st({ pts: { p1: "40", p2: "A" }, serving: "p1" })).toEqual({ tb: false, chip: "BP", chipFor: "p2" });
  });
  it("unknown server → no BP (cannot attribute)", () => {
    expect(st({ pts: { p1: "40", p2: "15" }, serving: undefined }).chip).toBeNull();
  });
  it("game point that takes the set escalates to SP — even for the server", () => {
    expect(st({ pts: { p1: "40", p2: "15" }, serving: "p1", games: { p1: 5, p2: 3 } }))
      .toEqual({ tb: false, chip: "SP", chipFor: "p1" });
  });
  it("5-4 is SP but 5-5 is not (needs a 2-game margin at 6)", () => {
    expect(st({ pts: { p1: "40", p2: "0" }, games: { p1: 5, p2: 4 } }).chip).toBe("SP");
    expect(st({ pts: { p1: "40", p2: "0" }, games: { p1: 5, p2: 5 } }).chip).toBeNull();
    expect(st({ pts: { p1: "40", p2: "0" }, games: { p1: 6, p2: 5 } }).chip).toBe("SP"); // 7-5
  });
  it("set point that takes the match escalates to MP (bestOf-aware)", () => {
    expect(st({ pts: { p1: "40", p2: "0" }, games: { p1: 5, p2: 2 }, sets: { p1: 2, p2: 0 }, bestOf: 5 }).chip).toBe("MP");
    expect(st({ pts: { p1: "40", p2: "0" }, games: { p1: 5, p2: 2 }, sets: { p1: 1, p2: 0 }, bestOf: 5 }).chip).toBe("SP");
    expect(st({ pts: { p1: "40", p2: "0" }, games: { p1: 5, p2: 2 }, sets: { p1: 1, p2: 0 }, bestOf: 3 }).chip).toBe("MP");
  });
  it("BP that is also SP/MP for the receiver reports the higher chip", () => {
    expect(st({ pts: { p1: "0", p2: "40" }, serving: "p1", games: { p1: 3, p2: 5 }, sets: { p1: 0, p2: 1 }, bestOf: 3 }))
      .toEqual({ tb: false, chip: "MP", chipFor: "p2" });
  });
  it("junk point strings → no chip, no crash", () => {
    expect(st({ pts: { p1: "Adv?", p2: "" } })).toEqual({ tb: false, chip: null, chipFor: null });
  });
});

describe("pointState — tiebreaks", () => {
  const tb = (p1: string, p2: string, over: Partial<Parameters<typeof pointState>[0]> = {}) =>
    st({ pts: { p1, p2 }, games: { p1: 6, p2: 6 }, ...over });
  it("detects the tiebreak from 6-6 games and never awards BP", () => {
    expect(tb("6", "5", { serving: "p2" })).toEqual({ tb: true, chip: "SP", chipFor: "p1" });
  });
  it("no chip mid-tiebreak or level at 6-6 points", () => {
    expect(tb("3", "2").chip).toBeNull();
    expect(tb("6", "6").chip).toBeNull();
    expect(tb("7", "7").chip).toBeNull();
  });
  it("beyond the target it is one-point-from-winning whenever leading (8-7)", () => {
    expect(tb("8", "7")).toEqual({ tb: true, chip: "SP", chipFor: "p1" });
  });
  it("SP escalates to MP when the tiebreak decides the match", () => {
    // NOT a final set (2-1 in a best-of-5 → target 7): the leader already holds 2 sets, so
    // winning this tiebreak wins the match.
    expect(tb("6", "3", { sets: { p1: 2, p2: 1 }, bestOf: 5 }).chip).toBe("MP");
  });
  it("a FINAL-SET tiebreak plays to 10 (no chip at 6-5; SP/MP from 9)", () => {
    expect(tb("6", "5", { sets: { p1: 2, p2: 2 }, bestOf: 5 }).chip).toBeNull();
    expect(tb("9", "8", { sets: { p1: 2, p2: 2 }, bestOf: 5 }).chip).toBe("MP");
    expect(tb("9", "8", { sets: { p1: 1, p2: 1 }, bestOf: 3 }).chip).toBe("MP");
  });
  it("non-numeric tiebreak values → tb detected, chip suppressed", () => {
    expect(tb("A", "5")).toEqual({ tb: true, chip: null, chipFor: null });
  });
});

describe("deriveContext", () => {
  const s = (p1: number, p2: number, tbv?: number): SetScore => ({ p1, p2, tb: tbv ?? null });
  it("last entry is the current set; completed earlier sets are counted", () => {
    expect(deriveContext([s(6, 4), s(4, 6), s(2, 1)]))
      .toEqual({ games: { p1: 2, p2: 1 }, sets: { p1: 1, p2: 1 } });
  });
  it("7-6 and 7-5 count as completed; 6-5 and 5-4 do not", () => {
    expect(deriveContext([s(7, 6, 4), s(5, 7), s(6, 5), s(0, 0)]).sets).toEqual({ p1: 1, p2: 1 });
  });
  it("null/empty score → zeros", () => {
    expect(deriveContext(null)).toEqual({ games: { p1: 0, p2: 0 }, sets: { p1: 0, p2: 0 } });
    expect(deriveContext([])).toEqual({ games: { p1: 0, p2: 0 }, sets: { p1: 0, p2: 0 } });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/points.test.ts`
Expected: FAIL — module `./points` does not exist.

- [ ] **Step 3: Implement `src/points.ts`**

```ts
import type { SetScore } from "./model";

/** Live current-game rules for the match strip: tiebreak detection and the single BP/SP/MP
 *  chip. Inputs are the RAW feed point strings ("0"|"15"|"30"|"40"|"A", digits in tiebreaks);
 *  anything unrecognized suppresses the chip rather than guessing (fail quiet, never wrong-loud). */
export interface PointStateInput {
  pts: { p1: string; p2: string };
  serving?: "p1" | "p2";
  games: { p1: number; p2: number };   // games in the current set
  sets: { p1: number; p2: number };    // completed sets won
  bestOf: 3 | 5;
}
export interface PointState { tb: boolean; chip: "BP" | "SP" | "MP" | null; chipFor: "p1" | "p2" | null; }

const RANK: Record<string, number> = { "0": 0, "15": 1, "30": 2, "40": 3, "A": 4 };
const other = (s: "p1" | "p2"): "p1" | "p2" => (s === "p1" ? "p2" : "p1");

export function pointState(i: PointStateInput): PointState {
  const toWin = i.bestOf === 5 ? 3 : 2;
  const finalSet = i.sets.p1 + i.sets.p2 === i.bestOf - 1;
  const tb = i.games.p1 === i.games.p2 && i.games.p1 >= 6;
  // Winning the current SET: MP if it completes the match for that side, else SP.
  const setChip = (side: "p1" | "p2"): "SP" | "MP" => (i.sets[side] + 1 >= toWin ? "MP" : "SP");

  if (tb) {
    // No serve attribution in a tiebreak (the server rotates every two points, faster than the
    // 30s CX cadence) — so never BP; the tiebreak decides the set, so a lead at target−1+ is SP/MP.
    const target = finalSet ? 10 : 7; // 10-point final-set TB at every slam since 2022
    const a = Number(i.pts.p1), b = Number(i.pts.p2);
    if (!Number.isFinite(a) || !Number.isFinite(b) || i.pts.p1.trim() === "" || i.pts.p2.trim() === "")
      return { tb: true, chip: null, chipFor: null };
    for (const side of ["p1", "p2"] as const) {
      const mine = side === "p1" ? a : b, theirs = side === "p1" ? b : a;
      if (mine >= target - 1 && mine - theirs >= 1) return { tb: true, chip: setChip(side), chipFor: side };
    }
    return { tb: true, chip: null, chipFor: null };
  }

  const r1 = RANK[i.pts.p1], r2 = RANK[i.pts.p2];
  if (r1 == null || r2 == null) return { tb: false, chip: null, chipFor: null };
  for (const side of ["p1", "p2"] as const) {
    const mine = side === "p1" ? r1 : r2, theirs = side === "p1" ? r2 : r1;
    const gamePoint = (mine === 3 && theirs < 3) || mine === 4;
    if (!gamePoint) continue;                       // at most one side can hold game point
    const gWin = i.games[side] + 1;
    if (gWin >= 6 && gWin - i.games[other(side)] >= 2) return { tb: false, chip: setChip(side), chipFor: side };
    if (i.serving && i.serving !== side) return { tb: false, chip: "BP", chipFor: side };
    return { tb: false, chip: null, chipFor: null }; // the server's plain game point
  }
  return { tb: false, chip: null, chipFor: null };
}

/** Current-set games and completed-set counts from a live overlay score. The LAST entry is the
 *  set in progress (Flashscore appends sets as they start); earlier entries count when decided
 *  by the standard rule (≥6 with a 2-game margin, or 7-6). */
export function deriveContext(score: SetScore[] | null): { games: { p1: number; p2: number }; sets: { p1: number; p2: number } } {
  const games = { p1: 0, p2: 0 }, sets = { p1: 0, p2: 0 };
  if (!score || score.length === 0) return { games, sets };
  const last = score[score.length - 1];
  games.p1 = last.p1; games.p2 = last.p2;
  for (const set of score.slice(0, -1)) {
    const hi = Math.max(set.p1, set.p2), lo = Math.min(set.p1, set.p2);
    if ((hi >= 6 && hi - lo >= 2) || (hi === 7 && lo === 6)) sets[set.p1 > set.p2 ? "p1" : "p2"]++;
  }
  return { games, sets };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/points.test.ts`
Expected: PASS (all ~20 cases).

- [ ] **Step 5: Commit**

```bash
git add src/points.ts src/points.test.ts
git commit -m "feat(points): pure current-game rules — tiebreak detection and the BP/SP/MP chip"
```

---

### Task 6: `api/pbp.ts` — the per-match proxy function

Thin handler in the exact mold of `api/live.ts` (which has no dedicated handler test — the parsing brains are tested at the ingest level in Task 2; keep that convention).

**Files:**
- Create: `api/pbp.ts`

**Interfaces:**
- Consumes: `FEED_HOST`/`X_FSIGN`/`UA` (Task 1), `parseCurrentGame` (Task 2).
- Produces: `GET /api/pbp?mid=<8-char id>` → `200 {"home":"30","away":"15"}`, or `200 {}` when there is no current game / upstream fails, or `400` on a bad `mid`. Consumed by `fetchPbp` (Task 7).

- [ ] **Step 1: Create `api/pbp.ts`**

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
// .js extensions REQUIRED: unbundled ESM function (see api/live.ts for the full rule).
import { FEED_HOST, UA, X_FSIGN } from "./_flashscore.js";
import { parseCurrentGame } from "../ingest/flashscore.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const mid = String(req.query.mid ?? "");
  if (!/^[A-Za-z0-9]{8}$/.test(mid)) {
    res.status(400).json({ error: "mid (8-char Flashscore match id) is required" });
    return;
  }
  try {
    const r = await fetch(`${FEED_HOST}/df_mhs_1_${mid}`, { headers: { "x-fsign": X_FSIGN, "user-agent": UA } });
    if (r.ok) {
      // No current game (finished / not started) parses to null → {}. The client treats {} as
      // "nothing to show" and keeps its last value; same 200-with-empty posture as /api/live.
      const game = parseCurrentGame(await r.text());
      res.setHeader("Cache-Control", "public, s-maxage=5, stale-while-revalidate=15");
      res.status(200).json(game ?? {});
      return;
    }
  } catch { /* fall through to the empty fallback */ }
  res.setHeader("Cache-Control", "public, s-maxage=5");
  res.status(200).json({});
}
```

- [ ] **Step 2: Typecheck + full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean typecheck; suite green.

- [ ] **Step 3: Commit**

```bash
git add api/pbp.ts
git commit -m "feat(api): /api/pbp — per-match current-game proxy over Flashscore df_mhs"
```

---

### Task 7: `fetchPbp` client fetcher

**Files:**
- Modify: `src/live.ts` (append after `fetchLive`)
- Test: `src/live.test.ts`

**Interfaces:**
- Consumes: `tryFetch` from `./api` (already imported in `src/live.ts`).
- Produces: `export interface CurrentGame { home: string; away: string }` and `export async function fetchPbp(mid: string): Promise<CurrentGame | null>` — consumed by Task 9.

- [ ] **Step 1: Write the failing tests** (extend `src/live.test.ts`, mirroring the existing `fetchLive` describe which stubs `globalThis.fetch` with `vi`)

```ts
describe("fetchPbp", () => {
  it("fetches same-origin with no-store and returns the game", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ home: "30", away: "15" }) } as Response));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchPbp("nkXJ8mYa")).toEqual({ home: "30", away: "15" });
    expect(fetchMock).toHaveBeenCalledWith("/api/pbp?mid=nkXJ8mYa", { cache: "no-store" });
  });
  it("returns null on the empty {} body (no current game)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) } as Response)));
    expect(await fetchPbp("nkXJ8mYa")).toBeNull();
  });
  it("returns null on HTTP failure and thrown fetch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 } as Response)));
    expect(await fetchPbp("nkXJ8mYa")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("net"); }));
    expect(await fetchPbp("nkXJ8mYa")).toBeNull();
  });
});
```

(Add `fetchPbp` to the import list at the top of the test file.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/live.test.ts`
Expected: FAIL — `fetchPbp` is not exported.

- [ ] **Step 3: Implement** (append to `src/live.ts`)

```ts
/** The selected live match's current-game points, from the same-origin /api/pbp proxy.
 *  Null on any failure or when there is no current game ({} body) — the caller keeps
 *  showing its last value and retries on the next tick. `no-store` for the same reason
 *  as fetchLive: the function's own s-maxage does the coalescing. */
export interface CurrentGame { home: string; away: string }
export async function fetchPbp(mid: string): Promise<CurrentGame | null> {
  return tryFetch<CurrentGame>(
    `/api/pbp?mid=${encodeURIComponent(mid)}`,
    (d) => typeof d?.home === "string" && typeof d?.away === "string",
    "no-store",
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/live.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/live.ts src/live.test.ts
git commit -m "feat(live): fetchPbp — client fetcher for the per-match current game"
```

---

### Task 8: Strip render nodes — points, serve dot, chip slot

**Files:**
- Modify: `src/state.ts` (the `MatchInsight` interface ~line 587 and the `matchInsight` return ~line 660)
- Modify: `src/render.ts` (`stripSide` ~line 757, `renderMatchStrip` ~line 769)
- Modify: `src/app.css` (append)
- Test: `src/render-detail.test.ts`

**Interfaces:**
- Consumes: `Match.flashId`/`flashHomeIsP1`/`serving` (Task 4).
- Produces: `MatchInsight.live: { flashId: string; homeIsP1: boolean; serving?: "p1" | "p2" } | null`; strip DOM contract for Task 9's in-place updater — `.ms-game` container holding `.ms-pts[data-side="p1"]`, `.ms-pts-sep`, `.ms-pts[data-side="p2"]`, `.ms-chip[hidden]`; serve dot `.ms-serve` inside the serving player's `.ms-side`.

- [ ] **Step 1: Write the failing tests** (append to `src/render-detail.test.ts`, following its existing pattern of building a `MatchInsight` literal and asserting on `renderMatchStrip` output; reuse the file's existing insight fixture/helper and spread-override it)

```ts
describe("renderMatchStrip — live current-game block", () => {
  const liveIns = (over: Partial<MatchInsight> = {}): MatchInsight => ({
    ...baseInsight,                                    // the file's existing MatchInsight fixture
    status: "live", winner: null,
    live: { flashId: "nkXJ8mYa", homeIsP1: true, serving: "p1" },
    ...over,
  });
  const opts = { expanded: false, focused: false, nowSec: 1_750_000_000 };

  it("renders the points placeholders, separator and hidden chip for a live match", () => {
    const html = renderMatchStrip(liveIns(), "r.0", opts);
    const el = document.createElement("div"); el.innerHTML = html;
    const pts = el.querySelectorAll(".ms-game .ms-pts");
    expect(pts).toHaveLength(2);
    expect(pts[0].getAttribute("data-side")).toBe("p1");
    expect(pts[1].getAttribute("data-side")).toBe("p2");
    expect(pts[0].textContent).toBe("–");
    expect(el.querySelector<HTMLElement>(".ms-chip")!.hidden).toBe(true);
  });

  it("marks the serving player's side with the serve dot", () => {
    const el = document.createElement("div");
    el.innerHTML = renderMatchStrip(liveIns({ live: { flashId: "nkXJ8mYa", homeIsP1: true, serving: "p2" } }), "r.0", opts);
    const sides = el.querySelectorAll(".ms-side");
    expect(sides[0].querySelector(".ms-serve")).toBeNull();
    expect(sides[1].querySelector(".ms-serve")).not.toBeNull();
  });

  it("renders no game block when the match is not live (live: null)", () => {
    const el = document.createElement("div");
    el.innerHTML = renderMatchStrip(liveIns({ status: "finished", live: null, winner: "p1" }), "r.0", opts);
    expect(el.querySelector(".ms-game")).toBeNull();
    expect(el.querySelector(".ms-serve")).toBeNull();
  });
});
```

(If the file has no reusable insight fixture, build one literal with every `MatchInsight` field — copy the interface from `src/state.ts:587` — rather than importing `matchInsight`.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/render-detail.test.ts`
Expected: FAIL — TS error: `live` is not a `MatchInsight` field.

- [ ] **Step 3: Implement**

`src/state.ts` — add to the `MatchInsight` interface:

```ts
  /** Present only while the match is live AND the Flashscore overlay joined it: everything the
   *  strip needs to poll /api/pbp and orient its home/away values. */
  live: { flashId: string; homeIsP1: boolean; serving?: "p1" | "p2" } | null;
```

and to the `matchInsight` return object:

```ts
    live: m.status === "live" && m.flashId != null && m.flashHomeIsP1 != null
      ? { flashId: m.flashId, homeIsP1: m.flashHomeIsP1, ...(m.serving ? { serving: m.serving } : {}) }
      : null,
```

`src/render.ts` — `stripSide` gains a `serve` flag (dot sits by the name, inside the side span so Task 9 can address it per side):

```ts
function stripSide(side: InsightSide, win: boolean, rev: boolean, serve = false): string {
  const short = side.name.split(" ").slice(-1)[0] || side.name;
  const name = `<span class="ms-name"><span class="nm-full">${escapeHtml(side.name)}</span>` +
    `<span class="nm-short">${escapeHtml(short)}</span></span>`;
  const chk = win ? '<span class="mi-chk">✓</span>' : "";
  const dot = serve ? '<span class="ms-serve" role="img" aria-label="serving"></span>' : "";
  const flag = `<span class="ms-fl">${flagImg(side.country, 14, side.country)}</span>`;
  return `<span class="ms-side">${rev ? `${name}${dot}${chk}${flag}` : `${flag}${name}${dot}${chk}`}</span>`;
}
```

`renderMatchStrip` — replace the `.ms-mu` row (lines 798–800) with:

```ts
    `<div class="ms-mu">${stripSide(ins.p1, ins.winner === "p1", false, ins.live?.serving === "p1")}` +
    `<div class="ms-score">${insightScore(ins)}${gameBlock(ins)}</div>` +
    `${stripSide(ins.p2, ins.winner === "p2", true, ins.live?.serving === "p2")}</div>` +
```

and add above `renderMatchStrip`:

```ts
/** The live current-game slot next to the set score. Rendered with placeholders; the app's
 *  8s /api/pbp tick fills the nodes IN PLACE (data-side addressing) — a redraw resets them to
 *  "–" and the tick (or the post-draw re-apply) restores the last known values. */
function gameBlock(ins: MatchInsight): string {
  if (!ins.live) return "";
  return `<span class="ms-game"><span class="ms-pts" data-side="p1">–</span>` +
    `<span class="ms-pts-sep" aria-hidden="true">·</span>` +
    `<span class="ms-pts" data-side="p2">–</span><span class="ms-chip" hidden></span></span>`;
}
```

`src/app.css` — append (reuse the exact color custom-property the existing `.ms-dot` rule uses — open `src/app.css`, find `.ms-dot`, and use the same var in place of `--live-accent` below):

```css
/* Live current-game block in the match strip (fed in place by the /api/pbp tick). */
.ms-game { display: inline-flex; align-items: baseline; gap: 4px; margin-left: 10px; font-variant-numeric: tabular-nums; font-weight: 600; color: var(--live-accent); }
.ms-pts-sep { opacity: 0.5; }
.ms-chip { font-size: 10px; font-weight: 700; letter-spacing: 0.06em; padding: 1px 5px; border-radius: 4px; margin-left: 4px; background: var(--live-accent); color: var(--bg); }
.ms-serve { width: 6px; height: 6px; border-radius: 50%; background: var(--live-accent); display: inline-block; margin: 0 4px; flex: none; }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/render-detail.test.ts && npx vitest run`
Expected: new tests PASS; full suite green (other strip snapshots/assertions unaffected — the game block only renders when `ins.live` is set, which no existing fixture sets).

- [ ] **Step 5: Commit**

```bash
git add src/state.ts src/render.ts src/app.css src/render-detail.test.ts
git commit -m "feat(render): live current-game slot, serve dot and chip in the match strip"
```

---

### Task 9: App poll loop — gated 8s tick, in-place updates

**Files:**
- Modify: `src/app.ts` (imports; the poll-timers block around lines 976–993; the `draw()` tail; the `inspect` click branch)
- Test: `src/app.test.ts`

**Interfaces:**
- Consumes: `fetchPbp`/`CurrentGame` (Task 7), `pointState`/`deriveContext` (Task 5), `Match.flashId`/`flashHomeIsP1`/`serving` (Task 4), the strip DOM contract (Task 8).
- Produces: user-visible behavior; nothing downstream.

- [ ] **Step 1: Write the failing tests** (append a describe to `src/app.test.ts`, inside/adjacent to the existing `live score overlay (/api/live)` describe so its `LIVE_SNAP`/`M`/`baseRecord` fixtures are in scope)

```ts
describe("point-by-point (/api/pbp)", () => {
  /** installLiveNet + an /api/pbp route. `game` is re-read per request; `pbpOk` can kill the route. */
  function installPbpNet(record: () => unknown, game: () => unknown, pbpOk: () => boolean = () => true) {
    let pbpCalls = 0;
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/api/pbp")) {
        pbpCalls++;
        return { ok: pbpOk(), status: pbpOk() ? 200 : 500, json: async () => game() } as Response;
      }
      if (u.includes("/api/live")) return { ok: true, json: async () => ({ matches: [record()] }) } as Response;
      const body = u.includes("index.json") ? LIVE_INDEX_2 : (u.includes("roland-garros") || u.includes("wimbledon")) ? LIVE_SNAP : null;
      return { ok: body != null, status: body != null ? 200 : 404, json: async () => body } as Response;
    }) as unknown as typeof fetch;
    return () => pbpCalls;
  }
  const liveArc = (root: HTMLElement) => root.querySelector<HTMLElement>(`path.arc[data-match="${M.id}"]`)!;
  const ptsText = (root: HTMLElement) =>
    [...root.querySelectorAll<HTMLElement>(".ms-game .ms-pts")].map((el) => el.textContent);

  it("selecting the live match kicks an immediate /api/pbp fetch and fills the points in place", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: NOON2 });
    let game: unknown = { home: "30", away: "15" };
    const pbpCalls = installPbpNet(() => ({ ...baseRecord, srv: 1 }), () => game);
    const root = await mountApp();
    await vi.advanceTimersByTimeAsync(50);
    click(liveArc(root));
    await vi.waitFor(() => { if (pbpCalls() === 0) throw new Error("no immediate pbp kick"); });
    await vi.waitFor(() => { if (ptsText(root)[0] !== "30") throw new Error("points not applied"); });
    expect(ptsText(root)).toEqual(["30", "15"]);            // record home = M.p1 → no flip
    // in-place update: the strip node identity survives the next tick
    const strip = root.querySelector(".match-strip")!;
    game = { home: "40", away: "15" };
    await vi.advanceTimersByTimeAsync(8_000);
    await vi.waitFor(() => { if (ptsText(root)[0] !== "40") throw new Error("tick not applied"); });
    expect(root.querySelector(".match-strip")).toBe(strip);
  });

  it("shows the chip when the point is a set point", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: NOON2 });
    // baseRecord sets=[[6,4]] → current set reads 6-4; p1 at 40 wins 7-4 ⇒ SP (0 completed sets)
    installPbpNet(() => ({ ...baseRecord, srv: 1 }), () => ({ home: "40", away: "30" }));
    const root = await mountApp();
    await vi.advanceTimersByTimeAsync(50);
    click(liveArc(root));
    await vi.waitFor(() => {
      const chip = root.querySelector<HTMLElement>(".ms-chip");
      if (!chip || chip.hidden || chip.textContent !== "SP") throw new Error("no SP chip");
    });
  });

  it("does not poll /api/pbp while nothing is selected", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: NOON2 });
    const pbpCalls = installPbpNet(() => baseRecord, () => ({ home: "0", away: "0" }));
    await mountApp();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(pbpCalls()).toBe(0);
  });

  it("does not poll /api/pbp while the tab is hidden", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: NOON2 });
    const pbpCalls = installPbpNet(() => ({ ...baseRecord, srv: 1 }), () => ({ home: "30", away: "15" }));
    const root = await mountApp();
    await vi.advanceTimersByTimeAsync(50);
    click(liveArc(root));
    await vi.waitFor(() => { if (pbpCalls() === 0) throw new Error("no immediate pbp kick"); });
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    const before = pbpCalls();
    await vi.advanceTimersByTimeAsync(24_000);
    expect(pbpCalls()).toBe(before);
  });

  it("keeps the last shown points when a pbp fetch fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: NOON2 });
    let ok = true;
    installPbpNet(() => ({ ...baseRecord, srv: 1 }), () => ({ home: "30", away: "15" }), () => ok);
    const root = await mountApp();
    await vi.advanceTimersByTimeAsync(50);
    click(liveArc(root));
    await vi.waitFor(() => { if (ptsText(root)[0] !== "30") throw new Error("points not applied"); });
    ok = false;
    await vi.advanceTimersByTimeAsync(9_000);
    expect(ptsText(root)).toEqual(["30", "15"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app.test.ts`
Expected: the four new tests FAIL (no pbp calls, no `.ms-pts` content); every pre-existing test still passes.

- [ ] **Step 3: Implement in `src/app.ts`**

Add to the imports: `fetchPbp` and `CurrentGame` from `./live`; `deriveContext, pointState` from `./points`.

Insert after the `liveScoreTimer` block (after line 993):

```ts
  // Point-by-point: while a LIVE match is selected, poll its per-match current game and write
  // the values into the strip IN PLACE — never draw(): a point tick must not wipe panel
  // scroll/focus or rebuild the wheel. lastPbp survives redraws; draw()'s tail re-applies it
  // so the 30s overlay redraw doesn't blank the slot back to its "–" placeholders.
  const PBP_POLL_MS = 8_000;
  let lastPbp: { mid: string; game: CurrentGame } | null = null;
  /** The selected match with its live patch merged — undefined unless it is live and joined. */
  const pbpTarget = (): Match | undefined => {
    if (!isLiveView() || !state.selectedMatchId) return undefined;
    const k = snapKey(state.tour, state.year, state.slam);
    const raw = state.snapshots[k]?.matches[state.selectedMatchId];
    if (!raw) return undefined;
    const m = { ...raw, ...state.livePatch[k]?.[state.selectedMatchId] };
    return m.status === "live" && m.flashId ? m : undefined;
  };
  const applyPbp = (): void => {
    if (!lastPbp) return;
    const m = pbpTarget();
    if (!m || m.flashId !== lastPbp.mid) return;
    const gameEl = root.querySelector<HTMLElement>(".ms-game");
    if (!gameEl) return;
    const homeIsP1 = m.flashHomeIsP1 !== false;
    const pts = {
      p1: homeIsP1 ? lastPbp.game.home : lastPbp.game.away,
      p2: homeIsP1 ? lastPbp.game.away : lastPbp.game.home,
    };
    const st = pointState({ pts, serving: m.serving, ...deriveContext(m.score), bestOf: state.tour === "ATP" ? 5 : 3 });
    for (const side of ["p1", "p2"] as const) {
      const el = gameEl.querySelector<HTMLElement>(`.ms-pts[data-side="${side}"]`);
      if (el) el.textContent = pts[side];
    }
    const chip = gameEl.querySelector<HTMLElement>(".ms-chip");
    if (chip) { chip.hidden = st.chip == null; chip.textContent = st.chip ?? ""; }
    // CX rotates every two points in a tiebreak — faster than its 30s cadence — so hide the dot.
    for (const dot of root.querySelectorAll<HTMLElement>(".ms-serve")) dot.hidden = st.tb;
  };
  const pbpTick = async (): Promise<void> => {
    if (document.hidden) return;
    const m = pbpTarget();
    if (!m?.flashId) return;
    const game = await fetchPbp(m.flashId);
    if (!game) return;                                  // keep the last shown values; retry next tick
    if (pbpTarget()?.flashId !== m.flashId) return;     // selection changed mid-fetch
    lastPbp = { mid: m.flashId, game };
    applyPbp();
  };
  const pbpTimer = window.setInterval(() => { void pbpTick(); }, PBP_POLL_MS);
  signal.addEventListener("abort", () => clearInterval(pbpTimer));
```

Two wiring points:
1. **`draw()` tail:** at the very end of the `draw` function body (after the DOM is rebuilt), add `applyPbp();` — restores the last known points after any redraw.
2. **Immediate kick on selection:** find the delegated click branch that handles `data-action="inspect"` (it sets `state.selectedMatchId` and calls `draw()`); append `void pbpTick();` after its `draw()` call. (Search for `"inspect"` in `src/app.ts`; there is exactly one handling branch.)

NOTE for the placement of this block: it references `isLiveView`, `state`, `root`, `snapKey`, `signal` — all in scope at line 993. `Match` may need adding to the type-import list from `./model`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/app.test.ts`
Expected: all four new tests PASS; zero regressions in the file.

- [ ] **Step 5: Full suite, typecheck, build**

Run: `npx vitest run && npx tsc --noEmit && npx vite build`
Expected: suite green, clean typecheck, successful build.

- [ ] **Step 6: Commit**

```bash
git add src/app.ts src/app.test.ts
git commit -m "feat(app): 8s gated /api/pbp tick renders live points in place — no draw()"
```

---

### Task 10: Finishing pass

- [ ] **Step 1: Full verification**

Run: `npx vitest run && npx tsc --noEmit && npx vite build`
Expected: everything green. Record the final test count.

- [ ] **Step 2: Dev-server smoke** (optional but cheap): `npx vite` + open the local app on the live slam; with no `/api/pbp` locally the strip must degrade to permanent "–" placeholders without console errors (fetchPbp null path).

- [ ] **Step 3: Hand back for review** — the orchestrating session runs `/simplify` and `/code-review --fix` on the branch, pushes, and opens the PR (per the spec's build sequence). Prod verification happens during a live final (select the live match on tennisarc.vercel.app; points must move within ~13s of Flashscore's own page; closing the strip must stop `/api/pbp` requests).
