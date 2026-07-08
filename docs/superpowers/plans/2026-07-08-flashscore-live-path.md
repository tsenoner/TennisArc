# Flashscore live-score path — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overlay sub-minute live scores onto the in-play slam via a stateless `/api/live` Vercel function that parses the Flashscore livescore feed, joined to the snapshot client-side — with the Mac out of the live-score path.

**Architecture:** A Vercel Node function fetches the Flashscore global livescore feed (`f_2_0_3_en_1`), a pure parser filters it to the requested slam's main-draw singles and returns compact `LiveRecord`s (cached ~25s). The client polls it every ~30s while viewing a live slam, joins records to its snapshot matches by surname-pair (reusing `sigKey`), and overlays live/finished status+score+winner onto an immutable-snapshot render.

**Tech Stack:** TypeScript, Vite SPA, Vercel Node functions (`@vercel/node`), Vitest.

Design spec: `docs/superpowers/specs/2026-07-08-flashscore-live-path-design.md`.

## Global Constraints

- **Feed URL:** `https://global.flashscore.ninja/2/x/feed/f_2_0_3_en_1` (`2`=tennis). Live path is this LIST feed, **not** `df_sur`.
- **Required header:** `x-fsign: SW9D1eZo` (no header → HTTP 401). Hardcode; fail soft on 401.
- **User-Agent:** `TennisArc/1.0 (+https://tennisarc.vercel.app)`.
- **Cache:** success `Cache-Control: public, s-maxage=25, stale-while-revalidate=60`; error path `public, s-maxage=10`.
- **Client poll:** ~30s, gated on `isLiveView()` + `!document.hidden`; separate from the 90s snapshot poll.
- **Overlay scope:** stages **2 (live)** and **3 (finished)** only; stage 1 (scheduled) skipped.
- **Winner (fail-safe):** on stage 3, set `winner` **only** when a side reached the sets-to-win threshold — **ATP 3, WTA 2**; otherwise leave `winner` to the snapshot (retirement/walkover).
- **Feed record format:** records split on `~`; match record starts `AA÷`; pairs split on `¬`; key÷value on `÷`. Fields: `AA` id, `AB` stage, `AE`/`AF` home/away short names (surname-first), `AG`/`AH` sets won, `BA/BB…BI/BJ` per-set games, `ZA` tournament header, `ZB` id. `AL`/`MW` are odds noise — never emitted.
- **Legal/volume:** extract only the live slam's matches; **never persist or republish** the full feed. Add a **Flashscore attribution** link in the UI.
- **Tests:** no live network — mock `fetch`. Suite is pinned to `TZ=UTC` in `vite.config.ts`.
- **The snapshot stays the source of truth;** overlay is additive and never mutates `state.snapshots`.

---

### Task 1: Vercel-egress probe (GATE)

Prove Flashscore answers from a Vercel egress IP **before** building the parser/join/client. This is the one unconfirmed assumption; if it fails, the flagship pivots and nothing else is built. The probe body is temporary — Task 4 replaces it.

**Files:**
- Create: `api/live.ts` (temporary probe body)
- Modify: `package.json` (add `@vercel/node` devDependency), `tsconfig.json:15` (add `"api"` to `include`)

**Interfaces:**
- Produces: the `/api/live` route (real shape lands in Task 4).

- [ ] **Step 1: Add the `@vercel/node` types dependency**

Run: `pnpm add -D @vercel/node`

- [ ] **Step 2: Add `api/` to the TypeScript project**

Modify `tsconfig.json` line 15:

```json
  "include": ["src", "ingest", "api"]
```

- [ ] **Step 3: Write the temporary probe function**

Create `api/live.ts`:

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

// TEMPORARY egress probe — replaced by the real handler in Task 4. Proves Flashscore answers from
// Vercel's egress IP before we invest in the parser/join/client.
const FEED = "https://global.flashscore.ninja/2/x/feed/f_2_0_3_en_1";
const X_FSIGN = "SW9D1eZo";
const UA = "TennisArc/1.0 (+https://tennisarc.vercel.app)";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const r = await fetch(FEED, { headers: { "x-fsign": X_FSIGN, "user-agent": UA } });
    const body = await r.text();
    const recs = body.split("~").filter((s) => s.startsWith("AA÷"));
    const live = recs.filter((s) => s.split("¬").some((p) => p === "AB÷2"));
    res.status(200).json({
      upstreamStatus: r.status,
      bytes: body.length,
      liveCount: live.length,
      hasWimbledon: body.includes("Wimbledon"),
      sample: live.slice(0, 5).map((s) => {
        const d: Record<string, string> = {};
        for (const p of s.split("¬")) { const i = p.indexOf("÷"); if (i > 0) d[p.slice(0, i)] = p.slice(i + 1); }
        return `${d.AE ?? "?"} v ${d.AF ?? "?"}`;
      }),
    });
  } catch (e) {
    res.status(502).json({ error: String((e as Error)?.message ?? e) });
  }
}
```

- [ ] **Step 4: Typecheck passes**

Run: `pnpm typecheck`
Expected: PASS (no errors in `api/live.ts`).

- [ ] **Step 5: Deploy a Vercel PREVIEW (user-run or user-approved)**

This deploys agent-written code, so **the user runs or explicitly approves it** — it is not a prod deploy:

Run: `vercel deploy` (preview target; note the printed preview URL)

- [ ] **Step 6: Verify the function reaches Flashscore from Vercel's egress**

Open `<preview-url>/api/live` in the authed browser (or read it via Claude-in-Chrome). Expected JSON:
- `upstreamStatus: 200`
- `liveCount > 0` (during a live slam) and `sample` shows real player names
- `hasWimbledon: true` (while Wimbledon is live)

**GATE:** If `upstreamStatus` is 401/403 or the request errored, **STOP** — Flashscore does not tolerate Vercel egress and the design must change. Report and reconvene. Otherwise continue.

- [ ] **Step 7: Commit**

```bash
git add api/live.ts package.json pnpm-lock.yaml tsconfig.json
git commit -m "feat(live): Vercel-egress probe for the Flashscore livescore feed (build step 1 gate)"
```

---

### Task 2: Extract name primitives to `src/names.ts` + `flashSigKey`

Move the pure name-join primitives out of `ingest/names.ts` so the client (`src/`) can reuse them, and add the Flashscore-format key. Behaviour of the moved functions must stay byte-identical (`ingest/durations.test.ts` and `ingest/names.test.ts` pin them).

**Files:**
- Create: `src/names.ts`
- Modify: `ingest/names.ts`
- Test: `src/names.test.ts`

**Interfaces:**
- Produces: `nameTokens`, `fullKey`, `sigKey`, `pairKey` (from `src/names`), and new `flashSigKey(name: string): string`.
- Consumers: `ingest/names.ts` re-exports these; `durations.ts` etc. keep importing from `./names` unchanged.

- [ ] **Step 1: Write the failing test for `flashSigKey`**

Create `src/names.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { flashSigKey, sigKey } from "./names";

describe("flashSigKey", () => {
  it("matches sigKey of the equivalent full name (simple)", () => {
    expect(flashSigKey("Fritz T.")).toBe("fritz:t");
    expect(flashSigKey("Fritz T.")).toBe(sigKey("Taylor Fritz"));
  });
  it("uses the last surname token for compound surnames", () => {
    expect(flashSigKey("Van Uytvanck A.")).toBe("uytvanck:a");
    expect(flashSigKey("Van Uytvanck A.")).toBe(sigKey("Alison Van Uytvanck"));
  });
  it("splits hyphenated surnames like nameTokens", () => {
    expect(flashSigKey("Auger-Aliassime F.")).toBe("aliassime:f");
    expect(flashSigKey("Auger-Aliassime F.")).toBe(sigKey("Felix Auger-Aliassime"));
  });
  it("returns '' when it can't be keyed", () => {
    expect(flashSigKey("Fritz")).toBe("");
    expect(flashSigKey("")).toBe("");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test -- src/names.test.ts`
Expected: FAIL — cannot resolve `./names` / `flashSigKey` not exported.

- [ ] **Step 3: Create `src/names.ts` with the moved primitives + `flashSigKey`**

Create `src/names.ts` (the first four are moved verbatim from `ingest/names.ts`):

```ts
// Shared name-join primitives. Moved here from ingest/names.ts so both the ingest pipeline and the
// client (Flashscore live join) share ONE implementation — keep behaviour byte-identical
// (ingest/durations.test.ts + ingest/names.test.ts pin the first four).

/** Lowercased letter-only name tokens. Hyphens split tokens (Auger-Aliassime ↔ "Auger Aliassime");
 *  apostrophes don't (O'Connell ↔ "Oconnell"). Ł/ł need an explicit map — NFD can't decompose them. */
export function nameTokens(name: string): string[] {
  return name
    .replace(/[Łł]/g, "l")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[\s-]+/)
    .map((t) => t.replace(/[^a-z]/g, ""))
    .filter(Boolean);
}

export const fullKey = (name: string): string => nameTokens(name).join("");

/** Abbreviation-tolerant signature: surname + first initial ("A. van Uytvanck" ↔ "Alison Van Uytvanck"). */
export const sigKey = (name: string): string => {
  const t = nameTokens(name);
  return t.length ? `${t[t.length - 1]}:${t[0][0]}` : "";
};

export const pairKey = (roundIndex: number, a: string, b: string): string =>
  `${roundIndex}|${[a, b].sort().join("~")}`;

/** Flashscore lists names surname-first with a trailing initial ("Fritz T.", "Van Uytvanck A.").
 *  Normalize to the SAME "surname:initial" space as sigKey(fullName): the trailing single-letter
 *  token is the first-name initial; the token before it is the (last) surname token — matching
 *  sigKey's last-token surname convention. "" when it can't be keyed. */
export const flashSigKey = (name: string): string => {
  const t = nameTokens(name);
  if (t.length < 2) return "";
  const initial = t[t.length - 1];
  const surname = t[t.length - 2];
  return surname && initial ? `${surname}:${initial[0]}` : "";
};
```

- [ ] **Step 4: Re-export from `ingest/names.ts`**

Replace the top of `ingest/names.ts` — delete the local `nameTokens`/`fullKey`/`sigKey`/`pairKey` definitions and re-export them, keeping `TOURNEY`/`ROUND`:

```ts
// Shared name-join primitives now live in src/names.ts (client + ingest share one impl). This module
// keeps the Sackmann-specific tourney/round maps and re-exports the primitives so durations / finals /
// seeds / historical-elo keep importing them from "./names" unchanged.
export { nameTokens, fullKey, sigKey, pairKey, flashSigKey } from "../src/names";

// Sackmann tourney_name variants per slam key (compared lowercased; 2024 files say "Us Open").
export const TOURNEY: Record<string, string[]> = {
  "australian-open": ["australian open"],
  "roland-garros": ["roland garros", "french open"],
  wimbledon: ["wimbledon"],
  "us-open": ["us open"],
};
export const ROUND: Record<string, number> = { R128: 0, R64: 1, R32: 2, R16: 3, QF: 4, SF: 5, F: 6 };
```

- [ ] **Step 5: Run the new test + the pinned ingest tests**

Run: `pnpm test -- src/names.test.ts ingest/names.test.ts ingest/durations.test.ts`
Expected: PASS (all three files green — the move is behaviour-preserving).

- [ ] **Step 6: Full typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/names.ts src/names.test.ts ingest/names.ts
git commit -m "refactor(names): move join primitives to src/names.ts; add flashSigKey"
```

---

### Task 3: Flashscore feed parser (`ingest/flashscore.ts`)

A pure parser turning the raw feed text into `LiveRecord[]` for one slam's main-draw singles.

**Files:**
- Modify: `src/model.ts` (add `LiveRecord` interface)
- Create: `ingest/flashscore.ts`
- Create: `ingest/fixtures/flashscore-live.sample.txt`
- Test: `ingest/flashscore.test.ts`

**Interfaces:**
- Consumes: `TOURNEY` from `ingest/names`; `Tour`, `LiveRecord` from `src/model`.
- Produces: `parseLiveFeed(text: string, opts: { tour: Tour; slam: string }): LiveRecord[]`.

- [ ] **Step 1: Add the `LiveRecord` type to `src/model.ts`**

Append to `src/model.ts` (after the `Match` interface):

```ts
/** A live/finished/scheduled match extracted from the Flashscore livescore feed (server-parsed by
 *  ingest/flashscore.ts, joined onto the snapshot client-side by src/live.ts). Names are
 *  Flashscore's surname-first short form ("Fritz T."). */
export interface LiveRecord {
  id: string;
  stage: 1 | 2 | 3;              // 1 scheduled, 2 live, 3 finished
  home: string;
  away: string;
  setsWon: [number, number];     // [home, away]
  sets: Array<[number, number]>; // per-set games [home, away], in order
}
```

- [ ] **Step 2: Create the fixture**

Create `ingest/fixtures/flashscore-live.sample.txt` (one line; `¬`=U+00AC, `÷`=U+00F7, `~` between records — copy exactly). It holds an ATP-singles-Wimbledon block (live, finished-normal, finished-retirement-shape, scheduled), a WTA-singles-Wimbledon block, an ATP-doubles-Wimbledon block, an ATP-singles **qualification** block, and a different tournament — to test filtering:

```
SA÷2~ZA÷ATP - SINGLES: Wimbledon (United Kingdom), grass¬ZB÷3473162~AA÷aaa1¬AB÷2¬AE÷Fritz T.¬AF÷Zverev A.¬AG÷1¬AH÷0¬BA÷6¬BB÷4¬BC÷3¬BD÷2¬AL÷{"2":[]}~AA÷aaa2¬AB÷3¬AE÷Alcaraz C.¬AF÷Sinner J.¬AG÷3¬AH÷1¬BA÷6¬BB÷4¬BC÷4¬BD÷6¬BE÷6¬BF÷3¬BG÷6¬BH÷2~AA÷aaa3¬AB÷3¬AE÷Nadal R.¬AF÷Djokovic N.¬AG÷2¬AH÷0¬BA÷6¬BB÷3¬BC÷6¬BD÷4~AA÷aaa4¬AB÷1¬AE÷Medvedev D.¬AF÷Rune H.~ZA÷WTA - SINGLES: Wimbledon (United Kingdom), grass¬ZB÷2600~AA÷bbb1¬AB÷2¬AE÷Swiatek I.¬AF÷Sabalenka A.¬AG÷1¬AH÷1¬BA÷6¬BB÷4¬BC÷2¬BD÷6¬BE÷3¬BF÷2~ZA÷ATP - DOUBLES: Wimbledon (United Kingdom), grass¬ZB÷9999~AA÷ddd1¬AB÷2¬AE÷Krawietz K./Puetz T.¬AF÷Cash J./Glasspool L.¬AG÷1¬AH÷0¬BA÷7¬BB÷5~ZA÷ATP - SINGLES - QUALIFICATION: Wimbledon (United Kingdom), grass¬ZB÷8888~AA÷qqq1¬AB÷2¬AE÷Kopp S.¬AF÷Dhamne M.¬AG÷1¬AH÷0¬BA÷6¬BB÷2~ZA÷ATP - SINGLES: Bastad (Sweden), clay¬ZB÷7777~AA÷zzz1¬AB÷2¬AE÷Ruud C.¬AF÷Berrettini M.¬AG÷0¬AH÷1¬BA÷4¬BB÷6~
```

- [ ] **Step 3: Write the failing parser tests**

Create `ingest/flashscore.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseLiveFeed } from "./flashscore";

const feed = readFileSync(fileURLToPath(new URL("./fixtures/flashscore-live.sample.txt", import.meta.url)), "utf8");

describe("parseLiveFeed", () => {
  it("keeps only the ATP-singles main-draw Wimbledon block", () => {
    const r = parseLiveFeed(feed, { tour: "ATP", slam: "wimbledon" });
    expect(r.map((m) => m.id).sort()).toEqual(["aaa1", "aaa2", "aaa3", "aaa4"]);
  });
  it("excludes doubles, qualification, and other tournaments", () => {
    const ids = parseLiveFeed(feed, { tour: "ATP", slam: "wimbledon" }).map((m) => m.id);
    expect(ids).not.toContain("ddd1"); // doubles
    expect(ids).not.toContain("qqq1"); // qualification
    expect(ids).not.toContain("zzz1"); // Bastad
    expect(ids).not.toContain("bbb1"); // WTA
  });
  it("filters by tour", () => {
    const r = parseLiveFeed(feed, { tour: "WTA", slam: "wimbledon" });
    expect(r.map((m) => m.id)).toEqual(["bbb1"]);
  });
  it("parses stage, names, sets won, and per-set games", () => {
    const live = parseLiveFeed(feed, { tour: "ATP", slam: "wimbledon" }).find((m) => m.id === "aaa1")!;
    expect(live).toMatchObject({ stage: 2, home: "Fritz T.", away: "Zverev A.", setsWon: [1, 0], sets: [[6, 4], [3, 2]] });
  });
  it("omits odds-noise fields", () => {
    const live = parseLiveFeed(feed, { tour: "ATP", slam: "wimbledon" }).find((m) => m.id === "aaa1")!;
    expect(Object.keys(live)).toEqual(["id", "stage", "home", "away", "setsWon", "sets"]);
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `pnpm test -- ingest/flashscore.test.ts`
Expected: FAIL — `./flashscore` not found.

- [ ] **Step 5: Implement the parser**

Create `ingest/flashscore.ts`:

```ts
import type { LiveRecord, Tour } from "../src/model";
import { TOURNEY } from "./names";

const num = (v: string): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Value of a `¬`-joined `key÷value` pair, or "" when absent. */
function field(rec: string, key: string): string {
  for (const p of rec.split("¬")) {
    const i = p.indexOf("÷");
    if (i > 0 && p.slice(0, i) === key) return p.slice(i + 1);
  }
  return "";
}

const SET_PAIRS: ReadonlyArray<readonly [string, string]> =
  [["BA", "BB"], ["BC", "BD"], ["BE", "BF"], ["BG", "BH"], ["BI", "BJ"]];

/**
 * Parse the Flashscore global livescore feed down to one slam's MAIN-DRAW SINGLES matches.
 * Tournaments are positional: a header record carrying `ZA` precedes its match records until the
 * next header. The `"${TOUR} - SINGLES: "` prefix excludes qualification ("- SINGLES - QUALIFICATION:"),
 * doubles ("- DOUBLES:") and juniors ("- GIRLS - SINGLES:"). Odds fields (AL/MW) are never read.
 */
export function parseLiveFeed(text: string, opts: { tour: Tour; slam: string }): LiveRecord[] {
  const wantNames = TOURNEY[opts.slam] ?? [opts.slam.replace(/-/g, " ")];
  const prefix = `${opts.tour.toLowerCase()} - singles: `;
  const out: LiveRecord[] = [];
  let inBlock = false;

  for (const rec of text.split("~")) {
    const za = field(rec, "ZA");
    if (za) {
      const label = za.toLowerCase();
      inBlock = label.startsWith(prefix) && wantNames.some((n) => label.slice(prefix.length).startsWith(n));
      continue; // a header record is never a match record
    }
    if (!inBlock || !rec.startsWith("AA÷")) continue;

    const stage = num(field(rec, "AB"));
    if (stage !== 1 && stage !== 2 && stage !== 3) continue;
    const home = field(rec, "AE"), away = field(rec, "AF");
    if (!home || !away || home.includes("/") || away.includes("/")) continue; // "/" = doubles pair, skip defensively

    const sets: Array<[number, number]> = [];
    for (const [h, a] of SET_PAIRS) {
      const hv = field(rec, h), av = field(rec, a);
      if (hv === "" && av === "") continue;
      sets.push([num(hv), num(av)]);
    }
    out.push({
      id: field(rec, "AA"),
      stage: stage as 1 | 2 | 3,
      home, away,
      setsWon: [num(field(rec, "AG")), num(field(rec, "AH"))],
      sets,
    });
  }
  return out;
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm test -- ingest/flashscore.test.ts`
Expected: PASS (all 5 cases).

- [ ] **Step 7: Commit**

```bash
git add src/model.ts ingest/flashscore.ts ingest/flashscore.test.ts ingest/fixtures/flashscore-live.sample.txt
git commit -m "feat(live): Flashscore feed parser + LiveRecord type"
```

---

### Task 4: Real `/api/live` handler

Replace the Task-1 probe with the production handler: validate params, fetch, parse, cache, fail soft.

**Files:**
- Modify: `api/live.ts`
- Test: `api/live.test.ts`

**Interfaces:**
- Consumes: `parseLiveFeed` (Task 3), `Tour` from `src/model`.
- Produces: `GET /api/live?tour=atp&slam=wimbledon` → `{ matches: LiveRecord[] }`; the default export `handler`.

- [ ] **Step 1: Write the failing handler test**

Create `api/live.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import handler from "./live";

const feed = readFileSync(fileURLToPath(new URL("../ingest/fixtures/flashscore-live.sample.txt", import.meta.url)), "utf8");

function fakeRes() {
  return {
    statusCode: 0, headers: {} as Record<string, string>, body: undefined as unknown,
    status(c: number) { this.statusCode = c; return this; },
    setHeader(k: string, v: string) { this.headers[k] = v; },
    json(b: unknown) { this.body = b; return this; },
  };
}
afterEach(() => vi.restoreAllMocks());

describe("/api/live handler", () => {
  it("returns parsed matches with a cache header on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, text: async () => feed })));
    const res = fakeRes();
    await handler({ query: { tour: "atp", slam: "wimbledon" } } as any, res as any);
    expect(res.statusCode).toBe(200);
    expect((res.body as any).matches.map((m: any) => m.id)).toEqual(["aaa1", "aaa2", "aaa3", "aaa4"]);
    expect(res.headers["Cache-Control"]).toContain("s-maxage=25");
  });
  it("400s when params are missing", async () => {
    const res = fakeRes();
    await handler({ query: {} } as any, res as any);
    expect(res.statusCode).toBe(400);
  });
  it("fails soft to empty matches on upstream 401", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, text: async () => "" })));
    const res = fakeRes();
    await handler({ query: { tour: "atp", slam: "wimbledon" } } as any, res as any);
    expect(res.statusCode).toBe(200);
    expect((res.body as any).matches).toEqual([]);
  });
  it("fails soft on a thrown fetch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    const res = fakeRes();
    await handler({ query: { tour: "wta", slam: "wimbledon" } } as any, res as any);
    expect(res.statusCode).toBe(200);
    expect((res.body as any).matches).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- api/live.test.ts`
Expected: FAIL — handler still returns the probe's diagnostic shape (no `matches`).

- [ ] **Step 3: Replace `api/live.ts` with the real handler**

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Tour } from "../src/model";
import { parseLiveFeed } from "../ingest/flashscore";

const FEED = "https://global.flashscore.ninja/2/x/feed/f_2_0_3_en_1";
const X_FSIGN = "SW9D1eZo";
const UA = "TennisArc/1.0 (+https://tennisarc.vercel.app)";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const tour = String(req.query.tour ?? "").toUpperCase();
  const slam = String(req.query.slam ?? "");
  if ((tour !== "ATP" && tour !== "WTA") || !slam) {
    res.status(400).json({ error: "tour (atp|wta) and slam are required" });
    return;
  }
  try {
    const r = await fetch(FEED, { headers: { "x-fsign": X_FSIGN, "user-agent": UA } });
    if (!r.ok) {
      res.setHeader("Cache-Control", "public, s-maxage=10");
      res.status(200).json({ matches: [] });
      return;
    }
    const body = await r.text();
    res.setHeader("Cache-Control", "public, s-maxage=25, stale-while-revalidate=60");
    res.status(200).json({ matches: parseLiveFeed(body, { tour: tour as Tour, slam }) });
  } catch {
    res.setHeader("Cache-Control", "public, s-maxage=10");
    res.status(200).json({ matches: [] });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- api/live.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Commit**

```bash
git add api/live.ts api/live.test.ts
git commit -m "feat(live): real /api/live handler — parse, cache, fail-soft"
```

---

### Task 5: Client fetch + overlay (`src/live.ts`)

Pure client logic: fetch `/api/live`, join records to the snapshot, produce match patches, and apply them immutably.

**Files:**
- Create: `src/live.ts`
- Test: `src/live.test.ts`

**Interfaces:**
- Consumes: `sigKey`, `flashSigKey` from `src/names`; `Snapshot`, `Match`, `SetScore`, `LiveRecord`, `Tour` from `src/model`.
- Produces:
  - `fetchLive(tour: Tour, slam: string): Promise<LiveRecord[] | null>`
  - `overlayLive(snap: Snapshot, records: LiveRecord[]): Record<string, Partial<Match>>`
  - `applyLivePatch(snap: Snapshot, patch: Record<string, Partial<Match>> | undefined): Snapshot`

- [ ] **Step 1: Write the failing tests**

Create `src/live.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { overlayLive, applyLivePatch, fetchLive } from "./live";
import type { LiveRecord, Match, Player, Snapshot } from "./model";

const player = (id: string, name: string): Player => ({
  id, name, country: "", seed: null, entry: null, ranking: null, sofaSlug: null, elo: null, birthdate: null,
});
const match = (id: string, p1: string, p2: string, extra: Partial<Match> = {}): Match => ({
  id, roundIndex: 0, slot: 0, nextMatchId: null, p1, p2, status: "scheduled", winner: null, score: null,
  live: null, durationSec: null, durationProvisional: false, sofaEventId: null, sofaCustomId: null, stats: null, ...extra,
});
const snap = (tour: "ATP" | "WTA", players: Player[], matches: Match[]): Snapshot => ({
  schemaVersion: 1, generatedAt: "2026-07-08T00:00:00Z", tour,
  tournament: { slam: "wimbledon", name: "Wimbledon", year: 2026, surface: "grass", sofaUniqueTournamentId: 0, sofaSeasonId: 0, drawSize: 128 },
  players: Object.fromEntries(players.map((p) => [p.id, p])), rounds: [],
  matches: Object.fromEntries(matches.map((m) => [m.id, m])),
});
const rec = (o: Partial<LiveRecord> & Pick<LiveRecord, "home" | "away" | "stage">): LiveRecord => ({
  id: "x", setsWon: [0, 0], sets: [], ...o,
});

afterEach(() => vi.restoreAllMocks());

describe("overlayLive", () => {
  it("joins by surname-pair and overlays a live score, oriented to p1/p2", () => {
    const s = snap("ATP", [player("a", "Taylor Fritz"), player("b", "Alexander Zverev")], [match("0-0", "a", "b")]);
    // Flashscore lists Zverev as home, Fritz as away → must orient to p1=Fritz(a)
    const patch = overlayLive(s, [rec({ home: "Zverev A.", away: "Fritz T.", stage: 2, setsWon: [0, 1], sets: [[4, 6], [2, 3]] })]);
    expect(patch["0-0"]).toEqual({ status: "live", score: [{ p1: 6, p2: 4 }, { p1: 3, p2: 2 }] });
  });
  it("sets winner on a finished match only when a side reaches the sets-to-win threshold (ATP=3)", () => {
    const s = snap("ATP", [player("a", "Carlos Alcaraz"), player("b", "Jannik Sinner")], [match("0-0", "a", "b")]);
    const patch = overlayLive(s, [rec({ home: "Alcaraz C.", away: "Sinner J.", stage: 3, setsWon: [3, 1], sets: [[6, 4]] })]);
    expect(patch["0-0"]!.status).toBe("finished");
    expect(patch["0-0"]!.winner).toBe("p1");
  });
  it("leaves winner unset on a retirement shape (leader below threshold)", () => {
    const s = snap("ATP", [player("a", "Rafael Nadal"), player("b", "Novak Djokovic")], [match("0-0", "a", "b")]);
    const patch = overlayLive(s, [rec({ home: "Nadal R.", away: "Djokovic N.", stage: 3, setsWon: [2, 0], sets: [] })]);
    expect(patch["0-0"]!.status).toBe("finished");
    expect("winner" in patch["0-0"]!).toBe(false);
  });
  it("uses the WTA threshold of 2", () => {
    const s = snap("WTA", [player("a", "Iga Swiatek"), player("b", "Aryna Sabalenka")], [match("0-0", "a", "b")]);
    const patch = overlayLive(s, [rec({ home: "Swiatek I.", away: "Sabalenka A.", stage: 3, setsWon: [2, 1], sets: [] })]);
    expect(patch["0-0"]!.winner).toBe("p1");
  });
  it("skips scheduled (stage 1) records", () => {
    const s = snap("ATP", [player("a", "Daniil Medvedev"), player("b", "Holger Rune")], [match("0-0", "a", "b")]);
    expect(overlayLive(s, [rec({ home: "Medvedev D.", away: "Rune H.", stage: 1 })])).toEqual({});
  });
  it("drops ambiguous surname-pairs rather than mis-joining", () => {
    const s = snap("ATP",
      [player("a", "Taylor Fritz"), player("b", "Alexander Zverev"), player("c", "Tommy Fritz"), player("d", "Andrey Zverev")],
      [match("0-0", "a", "b"), match("0-1", "c", "d")]);
    expect(overlayLive(s, [rec({ home: "Fritz T.", away: "Zverev A.", stage: 2, setsWon: [1, 0], sets: [[6, 0]] })])).toEqual({});
  });
});

describe("applyLivePatch", () => {
  it("returns a new snapshot with patched matches and leaves the original untouched", () => {
    const s = snap("ATP", [player("a", "Taylor Fritz"), player("b", "Alexander Zverev")], [match("0-0", "a", "b")]);
    const out = applyLivePatch(s, { "0-0": { status: "live" } });
    expect(out).not.toBe(s);
    expect(out.matches["0-0"].status).toBe("live");
    expect(s.matches["0-0"].status).toBe("scheduled"); // original immutable
  });
  it("returns the same object when there is no patch", () => {
    const s = snap("ATP", [player("a", "X Y")], []);
    expect(applyLivePatch(s, undefined)).toBe(s);
    expect(applyLivePatch(s, {})).toBe(s);
  });
});

describe("fetchLive", () => {
  it("returns the matches array on a valid response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ matches: [rec({ home: "A B.", away: "C D.", stage: 2 })] }) })));
    expect(await fetchLive("ATP", "wimbledon")).toHaveLength(1);
  });
  it("returns null on a non-ok response or non-JSON body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    expect(await fetchLive("ATP", "wimbledon")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => { throw new Error("html"); } })));
    expect(await fetchLive("ATP", "wimbledon")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- src/live.test.ts`
Expected: FAIL — `./live` not found.

- [ ] **Step 3: Implement `src/live.ts`**

```ts
import type { LiveRecord, Match, SetScore, Snapshot, Tour } from "./model";
import { flashSigKey, sigKey } from "./names";

/** Fetch the same-origin live overlay for a view. Null on any failure (dev server has no function,
 *  network error, non-JSON) → the caller simply applies no overlay. Always same-origin (the Vercel
 *  function is co-deployed) — NOT VITE_DATA_BASE_URL, which points at the data branch. */
export async function fetchLive(tour: Tour, slam: string): Promise<LiveRecord[] | null> {
  try {
    const res = await fetch(`/api/live?tour=${tour.toLowerCase()}&slam=${encodeURIComponent(slam)}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data?.matches) ? (data.matches as LiveRecord[]) : null;
  } catch {
    return null;
  }
}

/**
 * Join Flashscore live records onto snapshot matches by sorted surname-pair (unique within a live
 * singles draw). Returns matchId → Partial<Match> for LIVE (stage 2) and FINISHED (stage 3) records.
 * Orientation (which Flashscore side is p1) is resolved per record. Ambiguous pairs — two matches
 * sharing a key — are dropped rather than mis-joined. Winner is set on a finished match ONLY when a
 * side reached the sets-to-win threshold (ATP best-of-5 → 3, WTA best-of-3 → 2); otherwise it is
 * left to the snapshot (the retirement/walkover shape).
 */
export function overlayLive(snap: Snapshot, records: LiveRecord[]): Record<string, Partial<Match>> {
  const keyOf = (m: Match): string | null => {
    const n1 = m.p1 ? snap.players[m.p1]?.name : undefined;
    const n2 = m.p2 ? snap.players[m.p2]?.name : undefined;
    if (!n1 || !n2) return null;
    const a = sigKey(n1), b = sigKey(n2);
    return a && b ? [a, b].sort().join("~") : null;
  };
  const index = new Map<string, Match | null>(); // null = ambiguous
  for (const m of Object.values(snap.matches)) {
    const k = keyOf(m);
    if (k) index.set(k, index.has(k) ? null : m);
  }

  const setsToWin = snap.tour === "ATP" ? 3 : 2;
  const out: Record<string, Partial<Match>> = {};
  for (const r of records) {
    if (r.stage !== 2 && r.stage !== 3) continue;
    const hk = flashSigKey(r.home), ak = flashSigKey(r.away);
    if (!hk || !ak) continue;
    const m = index.get([hk, ak].sort().join("~"));
    if (!m) continue; // unmatched or ambiguous

    const p1name = m.p1 ? snap.players[m.p1]?.name : undefined;
    const homeIsP1 = p1name != null && hk === sigKey(p1name);
    const score: SetScore[] = r.sets.map(([h, a]) => (homeIsP1 ? { p1: h, p2: a } : { p1: a, p2: h }));
    const patch: Partial<Match> = {
      status: r.stage === 2 ? "live" : "finished",
      score: score.length ? score : null,
    };
    if (r.stage === 3) {
      const [p1Won, p2Won] = homeIsP1 ? r.setsWon : [r.setsWon[1], r.setsWon[0]];
      if (p1Won >= setsToWin) patch.winner = "p1";
      else if (p2Won >= setsToWin) patch.winner = "p2";
      // else: leave winner to the snapshot (retirement/walkover)
    }
    out[m.id] = patch;
  }
  return out;
}

/** A new snapshot with `patch` merged over its matches; the original is never mutated. Returns the
 *  same object (no clone) when there is nothing to apply. */
export function applyLivePatch(snap: Snapshot, patch: Record<string, Partial<Match>> | undefined): Snapshot {
  if (!patch || Object.keys(patch).length === 0) return snap;
  const matches: Record<string, Match> = {};
  for (const [id, m] of Object.entries(snap.matches)) matches[id] = patch[id] ? { ...m, ...patch[id] } : m;
  return { ...snap, matches };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- src/live.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/live.ts src/live.test.ts
git commit -m "feat(live): client fetch + surname-pair overlay join (src/live.ts)"
```

---

### Task 6: Wire the overlay + poll into `src/app.ts`

Add `livePatch` state, apply it at the single render read in `draw()`, poll `/api/live` every ~30s while live, and add Flashscore attribution.

**Files:**
- Modify: `src/app.ts`
- Test: `src/app.test.ts` (extend the existing `"live polling"` describe)

**Interfaces:**
- Consumes: `fetchLive`, `overlayLive`, `applyLivePatch` (Task 5); existing `snapKey`, `statusFor`, `isLiveView`, `draw`, `state`.

- [ ] **Step 1: Write the failing app tests**

Add a new `describe` block to `src/app.test.ts` (after the existing `describe("live polling", …)`). It reuses the file's `SNAP`, `LIVE_INDEX` (defined in `live polling`; lift it to module scope or redeclare it here), `mountApp`, and `NOON`. The fetch mock is built inline so it can also answer `/api/live`. `short()` converts a snapshot full name to Flashscore's surname-first short form so `flashSigKey` joins it:

```ts
describe("live score overlay (/api/live)", () => {
  const LIVE_INDEX_2: SlamIndex = { ...INDEX, slams: [{ ...INDEX.slams[0], status: "live" as const }, INDEX.slams[1]] };
  const NOON2 = new Date("2026-06-15T12:00:00.000Z");
  const short = (full: string) => { const t = full.split(" "); return `${t[t.length - 1]} ${t[0][0]}.`; };
  // a real synthetic match with two known players → build a matching Flashscore record
  const M = Object.values(SNAP.matches).find((x) => x.p1 && x.p2)!;
  const baseRecord = {
    id: "fs1", stage: 2 as const,
    home: short(SNAP.players[M.p1!].name), away: short(SNAP.players[M.p2!].name),
    setsWon: [1, 0] as [number, number], sets: [[6, 4]] as Array<[number, number]>,
  };

  function installLiveNet(record: () => unknown): () => number {
    let liveCalls = 0;
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/api/live")) { liveCalls++; return { ok: true, json: async () => ({ matches: [record()] }) } as Response; }
      const body = u.includes("index.json") ? LIVE_INDEX_2 : (u.includes("roland-garros") || u.includes("wimbledon")) ? SNAP : null;
      return { ok: body != null, status: body != null ? 200 : 404, json: async () => body } as Response;
    }) as unknown as typeof fetch;
    return () => liveCalls;
  }

  it("polls /api/live and overlays a changing live score onto the draw", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: NOON2 });
    let served: unknown = { ...baseRecord };
    const liveCalls = installLiveNet(() => served);
    const root = await mountApp();
    const marker = root.querySelector(".chart")!;
    // the score advances → the next 30s tick produces a different patch → a redraw
    served = { ...baseRecord, sets: [[6, 4], [3, 0]] };
    await vi.advanceTimersByTimeAsync(30_000);
    expect(liveCalls()).toBeGreaterThan(0);
    await vi.waitFor(() => {
      if (root.querySelector(".chart") === marker) throw new Error("overlay did not redraw");
    }, { timeout: 2000 });
  });

  it("does not poll /api/live while the tab is hidden", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: NOON2 });
    const liveCalls = installLiveNet(() => baseRecord);
    await mountApp();
    await vi.advanceTimersByTimeAsync(50);                                              // let the mount-time kick settle
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    const before = liveCalls();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(liveCalls()).toBe(before);
  });

  it("does not poll /api/live on a non-live view", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: NOON2 });
    // standard (non-live) INDEX → the view is "complete", so the live gate stays shut
    let liveCalls = 0;
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/api/live")) { liveCalls++; return { ok: true, json: async () => ({ matches: [] }) } as Response; }
      const body = u.includes("index.json") ? INDEX : (u.includes("roland-garros") || u.includes("wimbledon")) ? SNAP : null;
      return { ok: body != null, status: body != null ? 200 : 404, json: async () => body } as Response;
    }) as unknown as typeof fetch;
    await mountApp();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(liveCalls).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test -- src/app.test.ts`
Expected: FAIL — no `/api/live` polling exists yet.

- [ ] **Step 3: Import the live helpers + add `livePatch` to state**

In `src/app.ts`, add a new import line (with the other `./` imports), and add `Match` to the existing `./model` type import (currently `import type { Player, SlamIndex, Snapshot, Tour } from "./model";` at `app.ts:13`):

```ts
import { fetchLive, overlayLive, applyLivePatch } from "./live";
// extend the existing line 13 import → import type { Match, Player, SlamIndex, Snapshot, Tour } from "./model";
```

Add the field to the `AppState` interface (after `snapshots: Record<string, Snapshot>;`):

```ts
  livePatch: Record<string, Record<string, Partial<Match>>>; // snapKey → matchId → live overlay
```

Add it to the `state` initializer (in the object literal after `snapshots: {}`):

```ts
    livePatch: {},
```

- [ ] **Step 4: Apply the overlay at the single render read in `draw()`**

In `draw()`, replace the snapshot read (currently `const snap = state.year ? state.snapshots[snapKey(state.tour, state.year, state.slam)] : undefined;`) with a raw read + overlay:

```ts
    const k0 = snapKey(state.tour, state.year, state.slam);
    const rawSnap = state.year ? state.snapshots[k0] : undefined;
    const snap = rawSnap ? applyLivePatch(rawSnap, state.livePatch[k0]) : undefined;
```

Leave `inTree` (the `const snap = …; buildSunburst(snap)` inside `inTree`) on the RAW snapshot — the overlay changes status/score/winner but never the tree structure, so tree-membership must not depend on it.

- [ ] **Step 5: Add `loadLive()` and the ~30s poll**

Add `loadLive` next to `loadCurrent` (after its definition):

```ts
  const LIVE_SCORE_POLL_MS = 30_000;
  // Fast score overlay from Flashscore (src/live.ts) — independent of the 90s snapshot poll. Joins
  // to the CURRENT snapshot's players; redraws only when the computed patch actually changes.
  const loadLive = async (): Promise<void> => {
    const k = snapKey(state.tour, state.year, state.slam);
    const raw = state.snapshots[k];
    if (!raw) return; // nothing to join against yet
    const records = await fetchLive(state.tour, state.slam);
    if (!records) return;
    if (snapKey(state.tour, state.year, state.slam) !== k) return; // view changed mid-fetch
    const patch = overlayLive(raw, records);
    if (JSON.stringify(state.livePatch[k] ?? {}) === JSON.stringify(patch)) return;
    state.livePatch[k] = patch;
    draw();
  };
```

Add the poll timer next to the existing `pollTimer` block:

```ts
  const liveScoreTimer = window.setInterval(() => {
    if (document.hidden) return;
    if (statusFor(state.index, state.tour, state.year, state.slam) !== "live") return;
    void loadLive();
  }, LIVE_SCORE_POLL_MS);
  signal.addEventListener("abort", () => clearInterval(liveScoreTimer));
```

In the existing `visibilitychange` handler, after the snapshot-refetch line, kick a live fetch on tab return:

```ts
      if (isLiveView()) void loadLive();
```

And kick one immediately after the initial load resolves when the view is live — in `bootstrap()`, directly after `await loadCurrent();` (currently `app.ts:1009`), add:

```ts
    if (isLiveView()) void loadLive();
```

- [ ] **Step 6: Add Flashscore attribution to the credits line**

In `draw()`'s status/credits `innerHTML` (the `durations &amp; ratings: … Tennis Abstract …` span), extend the credit to name Flashscore for live scores:

```ts
        ` · <span class="credits">durations &amp; ratings: <a href="https://www.tennisabstract.com/" target="_blank" rel="noopener noreferrer">Tennis Abstract</a> · live: <a href="https://www.flashscore.com/" target="_blank" rel="noopener noreferrer">Flashscore</a></span></div>`;
```

- [ ] **Step 7: Run the app tests + typecheck**

Run: `pnpm test -- src/app.test.ts && pnpm typecheck`
Expected: PASS (new overlay/poll tests green; no type errors).

- [ ] **Step 8: Full suite**

Run: `pnpm test`
Expected: PASS (whole suite).

- [ ] **Step 9: Commit**

```bash
git add src/app.ts src/app.test.ts
git commit -m "feat(live): poll /api/live and overlay live scores onto the draw + attribution"
```

---

### Task 7: Verify routing end-to-end + docs

Confirm `/api/live` isn't swallowed by the SPA catch-all rewrite, then document the live path and update the spec status.

**Files:**
- Verify (maybe modify): `vercel.json`
- Modify: `docs/data-refresh-ops.md`, `docs/superpowers/specs/2026-07-08-flashscore-live-path-design.md`, `README.md`

- [ ] **Step 1: Deploy a preview and confirm the real endpoint**

Run (user-run or approved): `vercel deploy`
Then open `<preview-url>/api/live?tour=atp&slam=wimbledon` — expect `{ "matches": [ … ] }` with live/finished Wimbledon singles matches (empty out of slam season is also correct). Confirm the SPA still loads at `/` and a deep link (e.g. `/atp/2026/wimbledon`) still hard-reloads (the `vercel.json` catch-all must not have been disturbed).

- [ ] **Step 2: Only if `/api/live` returned the SPA HTML instead of JSON**

Add an explicit passthrough as the FIRST rewrite in `vercel.json` (before the catch-all), so nothing rewrites `/api/*`:

```json
    { "source": "/api/(.*)", "destination": "/api/$1" },
```

Re-deploy the preview and re-verify Step 1. (Expected: not needed — Vercel serves `/api` functions before rewrites — but verify.)

- [ ] **Step 3: Load-test the overlay against the live slam (visual)**

With the preview open on the live Wimbledon view, confirm a live match shows a moving score/live state within ~30s and that switching to a non-live archival slam stops the overlay (no `/api/live` calls in the network panel).

- [ ] **Step 4: Document + flip the spec status**

- In `docs/data-refresh-ops.md`, add a short "Live scores (Flashscore)" section: `/api/live` is a stateless Vercel function parsing `f_2_0_3_en_1`, cached ~25s, overlaid client-side; the Mac is not in the live-score path (only structure/durations).
- In the design spec header, change `Status:` to `implemented`.
- In `README.md`, add Flashscore to the data-sources/attribution note.

- [ ] **Step 5: Commit**

```bash
git add vercel.json docs/data-refresh-ops.md docs/superpowers/specs/2026-07-08-flashscore-live-path-design.md README.md
git commit -m "docs(live): document the Flashscore live path; verify /api routing"
```

---

## Notes for the implementer

- **`#48`** (Flashscore evaluation) is addressed by this work — mention it in the final PR so it can be closed. The **duration** gap-fill via `df_sur` (the other half of #48) and **#41** (Sackmann→TML) are separate P2 items, out of scope here.
- **v1 does NOT populate `Match.live` (`{set, game, server}`)** or tiebreak points (`SetScore.tb`) — those feed fields are unverified; the snapshot supplies them. Noted as future refinements.
- **`x-fsign` is hardcoded** and fails soft (empty overlay) if it ever rotates; auto re-scrape from the JS bundle is a future self-heal.
- **Local `vite dev` has no `/api/live` function** → `fetchLive` returns null and the overlay simply no-ops; this is expected. Verify live behaviour on a Vercel preview, not `vite dev`.
```
