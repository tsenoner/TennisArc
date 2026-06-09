# TennisArc Player Birthdates + Birthday Display — Implementation Plan (6 of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Prerequisite:** Plans 1–5 merged. Retrofits the post-Plan-5 `renderReadout` and `renderMatchInsight`.

**Goal:** Store each player's real **date of birth** (instead of a static decimal age), compute exact age on the fly, and add a **non-intrusive birthday feature** — age + birthday shown where a player is already detailed (centre readout, match card), with a subtle 🎂 for players whose birthday falls during the slam.

**Architecture:** New `ingest/players.ts` fetches Jeff Sackmann's `atp_players.csv`/`wta_players.csv` and joins `dob` by full name (same pattern as ELO). `Player.birthdate` (ISO) joins the model; pure `ageOn` / `birthdayInWindow` / `formatBirthday` helpers in `state.ts` drive display in the readout + match card. The slam date is approximated by the snapshot's `generatedAt` (≈ the final for a complete slam, ≈ now for a live one), so no extra model fields are needed.

**Tech Stack:** TypeScript (strict, ESM), Node global `fetch`, Vitest.

**Spec:** brainstorm addendum (2026-06-09): real DOB > static age; non-intrusive birthday display.

---

## File structure

**New**
- `ingest/players.ts` — `parsePlayersCsv`, `applyBirthdates`, `fetchPlayers`.
- `ingest/players.test.ts`
- `ingest/fixtures/players-sample.csv`

**Modified**
- `src/model.ts` — `Player.birthdate: string | null`.
- `ingest/normalize.ts` — default `birthdate: null`.
- `ingest/index.ts` — fetch + apply birthdates per tour.
- `src/state.ts` — `ageOn`, `birthdayInWindow`, `formatBirthday`; `InsightSide` gains `age`/`birthdayNear`; `matchInsight` fills them.
- `src/render.ts` — `ReadoutInfo` gains `age`/`birthday`/`birthdayNear`; `renderReadout` + `renderMatchInsight` show them.
- `src/app.ts` — `buildReadout` computes age/birthday from `birthdate` + `snap.generatedAt`.
- `src/render.test.ts` / `src/render-detail.test.ts` — extend fixtures with the new fields.

---

## Task 1: Add `Player.birthdate` to the model

**Files:**
- Modify: `src/model.ts`
- Modify: `ingest/normalize.ts`

- [ ] **Step 1: Add the field** — in `src/model.ts` `interface Player`, after `elo: PlayerElo | null;` add:

```ts
  birthdate: string | null;   // ISO "YYYY-MM-DD" (from Jeff Sackmann player files)
```

- [ ] **Step 2: Default it in `ingest/normalize.ts`** — in the `players[pid] = { … }` literal, add `birthdate: null,` alongside `elo: null,`.

- [ ] **Step 3: Fix collateral Player literals** — run `pnpm typecheck`; for every "missing property birthdate" error (synthetic fixture + test files), add `birthdate: null,` to that Player literal.

Run: `pnpm typecheck`
Expected: clean after the additions.

- [ ] **Step 4: Commit**

```bash
git add src/model.ts ingest/normalize.ts src/fixtures/synthetic.ts ingest/*.test.ts src/*.test.ts
git commit -m "feat(data): add Player.birthdate (ISO date of birth)"
```

---

## Task 2: Parse + join Sackmann player birthdates

**Files:**
- Create: `ingest/players.ts`, `ingest/fixtures/players-sample.csv`
- Test: `ingest/players.test.ts`

- [ ] **Step 1: Create the fixture** — `ingest/fixtures/players-sample.csv` (header + namesake collision to prove full-name matching):

```
player_id,name_first,name_last,hand,dob,ioc,height,wikidata_id
206173,Jannik,Sinner,R,20010816,ITA,188,Q21154940
101441,Martin,Sinner,R,19680207,GER,180,Q72091
207989,Carlos,Alcaraz,R,20030505,ESP,183,Q60042164
100644,Alexander,Zverev,R,19970420,GER,198,Q14688
999999,Nodob,Player,U,,USA,,
```

- [ ] **Step 2: Write the failing test** — create `ingest/players.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parsePlayersCsv, applyBirthdates } from "./players";
import type { Player } from "../src/model";

const csv = readFileSync(resolve(__dirname, "fixtures/players-sample.csv"), "utf8");
const player = (name: string): Player => ({
  id: name, name, country: "", seed: null, entry: null, ranking: null, ageYears: null, sofaSlug: null, elo: null, birthdate: null,
});

describe("parsePlayersCsv", () => {
  const map = parsePlayersCsv(csv);
  it("keys DOB by full normalized name (ISO) and resolves namesakes", () => {
    expect(map.get("janniksinner")).toBe("2001-08-16");
    expect(map.get("martinsinner")).toBe("1968-02-07");
    expect(map.get("carlosalcaraz")).toBe("2003-05-05");
  });
  it("skips rows with no dob", () => {
    expect(map.get("nodobplayer")).toBeUndefined();
  });
});

describe("applyBirthdates", () => {
  it("sets birthdate on matched players, leaves others null", () => {
    const players: Record<string, Player> = { a: player("Jannik Sinner"), b: player("Nobody Here") };
    const res = applyBirthdates(players, parsePlayersCsv(csv));
    expect(players.a.birthdate).toBe("2001-08-16");
    expect(players.b.birthdate).toBeNull();
    expect(res.matched).toBe(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test ingest/players.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Create `ingest/players.ts`**

```ts
import type { Player, Tour } from "../src/model";
import { normalizeName } from "./elo";

const PLAYERS_URL: Record<Tour, string> = {
  ATP: "https://raw.githubusercontent.com/JeffSackmann/tennis_atp/master/atp_players.csv",
  WTA: "https://raw.githubusercontent.com/JeffSackmann/tennis_wta/master/wta_players.csv",
};

const dobToIso = (dob: string): string | null =>
  /^\d{8}$/.test(dob) ? `${dob.slice(0, 4)}-${dob.slice(4, 6)}-${dob.slice(6, 8)}` : null;

/** Parse a Sackmann players CSV into a normalized-full-name → ISO-birthdate map. */
export function parsePlayersCsv(csv: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = csv.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 5) continue;
    const iso = dobToIso(cols[4]?.trim() ?? "");
    if (!iso) continue;
    const key = normalizeName(`${cols[1]} ${cols[2]}`);
    if (key && !out.has(key)) out.set(key, iso); // keep first (CSV is roughly chronological)
  }
  return out;
}

/** Mutate players: set birthdate from the DOB map by normalized full name. */
export function applyBirthdates(players: Record<string, Player>, dob: Map<string, string>): { matched: number; unmatched: number } {
  let matched = 0, unmatched = 0;
  for (const p of Object.values(players)) {
    const iso = dob.get(normalizeName(p.name));
    if (iso) { p.birthdate = iso; matched++; } else { unmatched++; }
  }
  return { matched, unmatched };
}

/** Fetch + parse the Sackmann player file for a tour (plain HTTPS GitHub raw). */
export async function fetchPlayers(tour: Tour): Promise<Map<string, string>> {
  const res = await fetch(PLAYERS_URL[tour], { headers: { "User-Agent": "Mozilla/5.0 TennisArc/1.0" } });
  if (!res.ok) throw new Error(`players HTTP ${res.status} for ${tour}`);
  return parsePlayersCsv(await res.text());
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test ingest/players.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ingest/players.ts ingest/players.test.ts ingest/fixtures/players-sample.csv
git commit -m "feat(ingest): join Sackmann player birthdates by full name"
```

---

## Task 3: Wire birthdates into the ingest

**Files:**
- Modify: `ingest/index.ts`

- [ ] **Step 1: Import + apply** — add to the imports:

```ts
import { fetchPlayers, applyBirthdates } from "./players";
```

In `ingestTour`, right after the existing ELO try/catch block, add:

```ts
    try {
      const dob = await fetchPlayers(tour);
      const { matched, unmatched } = applyBirthdates(snap.players, dob);
      console.log(`${cfg.slam} ${tour}: birthdates matched ${matched} (${unmatched} unmatched)`);
    } catch (err) {
      console.warn(`${cfg.slam} ${tour}: birthdate enrichment skipped:`, err);
    }
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add ingest/index.ts
git commit -m "feat(ingest): enrich players with birthdates"
```

---

## Task 4: Age + birthday helpers

**Files:**
- Modify: `src/state.ts`
- Test: `src/state.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/state.test.ts`:

```ts
import { ageOn, birthdayInWindow, formatBirthday } from "./state";

describe("age + birthday helpers", () => {
  it("ageOn computes integer age as of a date", () => {
    expect(ageOn("1987-05-22", "2026-06-07")).toBe(39);
    expect(ageOn("1987-05-22", "2026-05-21")).toBe(38); // before birthday that year
    expect(ageOn(null, "2026-06-07")).toBeNull();
  });
  it("birthdayInWindow detects a birthday within N days before the reference", () => {
    expect(birthdayInWindow("2000-05-28", "2026-06-07", 16)).toBe(true);  // 28 May within ~2wk before 7 Jun
    expect(birthdayInWindow("2000-01-01", "2026-06-07", 16)).toBe(false);
    expect(birthdayInWindow(null, "2026-06-07", 16)).toBe(false);
  });
  it("formatBirthday gives a short day-month label", () => {
    expect(formatBirthday("1987-05-22")).toBe("22 May");
    expect(formatBirthday(null)).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/state.test.ts`
Expected: FAIL — helpers not exported.

- [ ] **Step 3: Add the helpers to `src/state.ts`**

```ts
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Integer age of a player (ISO birthdate) as of an ISO date. */
export function ageOn(birthdate: string | null, onISO: string): number | null {
  if (!birthdate) return null;
  const b = new Date(birthdate + "T00:00:00Z"), on = new Date(onISO);
  if (Number.isNaN(b.getTime()) || Number.isNaN(on.getTime())) return null;
  let age = on.getUTCFullYear() - b.getUTCFullYear();
  const m = on.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && on.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

/** True if the player's birthday falls within `days` before (or on) the reference date — i.e. during the slam. */
export function birthdayInWindow(birthdate: string | null, refISO: string, days = 16): boolean {
  if (!birthdate) return false;
  const b = new Date(birthdate + "T00:00:00Z"), ref = new Date(refISO);
  if (Number.isNaN(b.getTime()) || Number.isNaN(ref.getTime())) return false;
  const bday = Date.UTC(ref.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  const diffDays = (ref.getTime() - bday) / 86400000;
  return diffDays >= 0 && diffDays <= days;
}

/** Short "22 May" label from an ISO birthdate. */
export function formatBirthday(birthdate: string | null): string {
  if (!birthdate) return "";
  const b = new Date(birthdate + "T00:00:00Z");
  if (Number.isNaN(b.getTime())) return "";
  return `${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state.ts src/state.test.ts
git commit -m "feat(state): ageOn / birthdayInWindow / formatBirthday"
```

---

## Task 5: Show age + birthday in the readout and match card

**Files:**
- Modify: `src/state.ts` (`InsightSide`, `matchInsight`)
- Modify: `src/render.ts` (`ReadoutInfo`, `renderReadout`, `renderMatchInsight`)
- Modify: `src/app.ts` (`buildReadout`)
- Test: `src/render-detail.test.ts`

- [ ] **Step 1: Extend `InsightSide` + fill it in `matchInsight`** — in `src/state.ts`, add to `InsightSide`:

```ts
  age: number | null; birthday: string; birthdayNear: boolean;
```

In `insightSide`, compute them (it already has `s`/the player — pass `s.generatedAt`). Change `insightSide` to also take the reference date and set:

```ts
    age: p ? ageOn(p.birthdate, ref) : null,
    birthday: p ? formatBirthday(p.birthdate) : "",
    birthdayNear: p ? birthdayInWindow(p.birthdate, ref) : false,
```

and in `matchInsight` pass `s.generatedAt` as `ref` to both `insightSide(...)` calls.

- [ ] **Step 2: Show it in `renderMatchInsight`** — in `src/render.ts` `insightPlayer`, append age/birthday to the `<small>` path line:

```ts
  const bd = side.age != null ? ` · ${side.age}y${side.birthdayNear ? ` 🎂 ${escapeHtml(side.birthday)}` : ""}` : "";
```

and include `${bd}` inside the `<small>…</small>` (after the existing `path`).

- [ ] **Step 3: Extend `ReadoutInfo` + `renderReadout`** — in `src/render.ts` add to `ReadoutInfo`:

```ts
  age: number | null; birthday: string; birthdayNear: boolean;
```

In `renderReadout`, after the `eloLabel` line, add a birthday line:

```ts
    (info.age != null
      ? `<div class="ro-meta">${info.age}y${info.birthdayNear ? ` · 🎂 ${escapeHtml(info.birthday)}` : ""}</div>`
      : "") +
```

- [ ] **Step 4: Fill the readout fields in `app.ts` `buildReadout`** — add to the returned object (it has `p` and `snap.generatedAt`):

```ts
      age: ageOn(p.birthdate, snap.generatedAt),
      birthday: formatBirthday(p.birthdate),
      birthdayNear: birthdayInWindow(p.birthdate, snap.generatedAt),
```

and import the helpers: extend the `./state` import in `app.ts` with `ageOn, birthdayInWindow, formatBirthday`.

- [ ] **Step 5: Update the match-insight test fixture** — in `src/render-detail.test.ts`, add `age`, `birthday`, `birthdayNear` to both `p1` and `p2` objects (e.g. `age: 22, birthday: "5 May", birthdayNear: true` for one, `age: 24, birthday: "16 Aug", birthdayNear: false` for the other) and assert the card contains an age (`expect(html).toContain("22y")`).

- [ ] **Step 6: Typecheck + full suite**

Run: `pnpm typecheck && pnpm test`
Expected: clean + all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/state.ts src/render.ts src/app.ts src/render-detail.test.ts
git commit -m "feat(app): age + non-intrusive 🎂 birthday in readout and match card"
```

---

## Task 6: Re-ingest + visual smoke

**Files:** none (data + verification).

- [ ] **Step 1: Build**

Run: `pnpm build`
Expected: clean + succeeds.

- [ ] **Step 2: Re-ingest (residential IP)** — repopulate RG2026 with birthdates:

Run: `SLAM=roland-garros pnpm ingest`
Expected: logs `birthdates matched N (…)` for ATP + WTA; per-slam JSON now carries `birthdate`. Spot-check: a known player has a non-null `birthdate`.

- [ ] **Step 3: Visual smoke** (manual — `pnpm dev`)

- Hover a player → the readout shows their **age**; for someone with a birthday during the slam fortnight, a 🎂 + date appears.
- Open a match → each player's line shows age (and 🎂 when applicable).

- [ ] **Step 4: Commit the refreshed data**

```bash
git add public/data
git commit -m "data: RG2026 refresh with player birthdates"
```

---

## Self-review

**Spec coverage:**
- Real DOB stored (not static age) → Tasks 1-3.
- Exact age on the fly → Task 4 (`ageOn`) used in Task 5.
- Non-intrusive birthday display (age everywhere a player is detailed; 🎂 only for birthdays during the slam) → Task 5.
- Namesake-safe join (full name) → Task 2 (fixture proves Martin vs Jannik Sinner).

**Placeholder scan:** none.

**Type consistency:** `Player.birthdate` (Task 1) read by `applyBirthdates` (Task 2), `ageOn`/`birthdayInWindow`/`formatBirthday` (Task 4); `InsightSide.age/birthday/birthdayNear` (Task 5) filled by `matchInsight` and rendered by `renderMatchInsight`; `ReadoutInfo.age/...` (Task 5) filled by `buildReadout`. `normalizeName` reused from `ingest/elo.ts`.

**Notes for the executor:**
- The slam reference date is `snap.generatedAt` (≈ the final for a complete slam) — good enough to flag "birthday during the slam" without new model fields.
- `ageYears` (Tennis Abstract static age) stays as a harmless fallback; the UI prefers `ageOn(birthdate, …)`.
- Step 2 of Task 6 (`pnpm ingest`) needs a residential IP (Cloudflare); it is run by the controller, not headless CI.
