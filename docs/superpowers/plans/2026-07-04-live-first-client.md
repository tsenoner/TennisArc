# Live-First Client (offline removal phase 1 + client freshness) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the offline-first layer (IndexedDB cache now, service worker via a self-destroying kill switch) and make the client actually live: poll the current slam while it's in play, refetch on tab return, show an error/retry state, and make the freshness label a refresh control.

**Architecture:** The app keeps its single `load() → state.snapshots → draw()` loop, but the loop becomes fetch-only (no IDB pre-read) with change detection on `generatedAt` so polling never causes redundant full re-renders. A 90 s interval and the `visibilitychange` handler both call `load()` when the manifest says the current slam is `live`. `vite-plugin-pwa` stays installed this release with `selfDestroying: true` — the generated `sw.js` unregisters the old workbox SW on every installed client; the plugin itself is removed in a later phase (phase 2) once this has soaked in production.

**Tech Stack:** Vite 5 + vanilla TypeScript, vitest (jsdom for app tests, `TZ=UTC`), vite-plugin-pwa 0.20.

**Research basis:** docs claim verified 2026-07-03 — deleting `sw.js` outright strands installed clients on the precached shell forever because the `vercel.json` SPA catch-all serves 200-HTML for `/sw.js` (MIME mismatch → update check fails → registration never clears). Hence the two-phase kill switch. `src/store.ts` caches ONLY snapshots + index (theme is localStorage, view state is the URL) — nothing must be migrated.

## Global Constraints

- Run tests as `pnpm test` (wraps `TZ=UTC vitest run`); typecheck via `pnpm typecheck`.
- Do NOT remove `vite-plugin-pwa` from package.json this release — phase 2 only.
- Do NOT touch `vercel.json` (both rewrites are load-bearing; flat-path rewrite leaves months after phase 2).
- Preserve the Escape-layering, zoom/history, and URL grammar in `src/app.ts` untouched.
- Polling cadence constant: `LIVE_POLL_MS = 90_000`.
- After each package.json dependency change run `pnpm install` so the lockfile stays in sync.

---

### Task 1: `statusFor` manifest helper

**Files:**
- Modify: `src/slams.ts` (append)
- Test: `src/slams.test.ts` (append)

**Interfaces:**
- Produces: `statusFor(index: SlamIndex | undefined, tour: Tour, year: number, slam: string): SlamStatus | undefined` — later tasks use it as the "is the current view live?" predicate.

- [x] **Step 1: Write the failing test** — append to `src/slams.test.ts`:

```ts
describe("statusFor", () => {
  it("returns the manifest status for a tour/year/slam and undefined when absent", () => {
    const index: SlamIndex = {
      schemaVersion: 1, generatedAt: "2026-07-01T00:00:00.000Z",
      slams: [{ tour: "ATP", year: 2026, slam: "wimbledon", name: "Wimbledon", surface: "Grass", status: "live", generatedAt: "2026-07-01T00:00:00.000Z", drawSize: 128 }],
    };
    expect(statusFor(index, "ATP", 2026, "wimbledon")).toBe("live");
    expect(statusFor(index, "WTA", 2026, "wimbledon")).toBeUndefined();
    expect(statusFor(undefined, "ATP", 2026, "wimbledon")).toBeUndefined();
  });
});
```

(Import `statusFor` alongside the existing imports from `./slams`, and `SlamIndex` from `./model` if not already imported.)

- [x] **Step 2: Run test to verify it fails** — `pnpm exec vitest run src/slams.test.ts` → FAIL (`statusFor` not exported).

- [x] **Step 3: Implement** — append to `src/slams.ts`:

```ts
/** Manifest status for one tour/year/slam, or undefined when the entry is absent. */
export function statusFor(
  index: SlamIndex | undefined, tour: Tour, year: number, slam: string,
): SlamStatus | undefined {
  return index?.slams.find((s) => s.tour === tour && s.year === year && s.slam === slam)?.status;
}
```

Add `SlamStatus` to the type import from `./model` at the top of `src/slams.ts`.

- [x] **Step 4: Run test to verify it passes** — `pnpm exec vitest run src/slams.test.ts` → PASS.

- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(slams): statusFor manifest helper"`

---

### Task 2: Remove the IndexedDB layer

**Files:**
- Delete: `src/store.ts`, `src/store.test.ts`
- Modify: `src/app.ts` (import line 11, `let store` line 70, `load()` lines 406–418, bootstrap lines 842–845)
- Modify: `src/app.test.ts` (delete the `vi.mock("./store", …)` block, lines 6–18)
- Modify: `package.json` (drop dep `idb-keyval`)

**Interfaces:**
- Produces: `load(tour, year, slam)` is now fetch-only; bootstrap reads `state.index = (await fetchIndex()) ?? undefined`. Later tasks modify `load()` further.

- [x] **Step 1: Delete files** — `git rm src/store.ts src/store.test.ts`

- [x] **Step 2: Excise store from app.ts** —
  - Delete line 11: `import { createStore, type Store } from "./store";`
  - Delete line 70: `let store: Store | undefined;`
  - Replace `load()` (lines 406–418) with:

```ts
  const load = async (tour: Tour, year: number, slam: string) => {
    const k = snapKey(tour, year, slam);
    const fresh = await fetchSnapshot(tour, year, slam);
    if (fresh) {
      state.snapshots[k] = fresh;
      if (snapKey(state.tour, state.year, state.slam) === k) draw();
    }
  };
```

  - In the bootstrap IIFE (lines 842–845), replace

```ts
    store = await createStore();
    state.index = (await fetchIndex()) ?? (await store.getIndex()) ?? undefined;
    if (state.index) void store.setIndex(state.index);
```

  with

```ts
    state.index = (await fetchIndex()) ?? undefined;
```

- [x] **Step 3: Remove the store mock from app.test.ts** — delete the whole `vi.mock("./store", () => ({ … }))` block (lines 6–18) and its explanatory comment (line 6). Keep the `import { createApp } from "./app";` that follows.

- [x] **Step 4: Drop the dep** — remove `"idb-keyval": "^6.2.5",` from package.json dependencies; run `pnpm install`.

- [x] **Step 5: Verify** — `pnpm test && pnpm typecheck` → all pass, and `grep -r "idb-keyval\|./store" src/ index.html` → no hits.

- [x] **Step 6: Commit** — `git add -A && git commit -m "feat(app)!: remove IndexedDB offline cache — load() is fetch-only"`

---

### Task 3: Service-worker kill switch (`selfDestroying`) + drop PWA asset tooling

**Files:**
- Modify: `vite.config.ts`
- Delete: `pwa-assets.config.ts`
- Modify: `package.json` (drop script `generate-pwa-assets`, devDep `@vite-pwa/assets-generator`)

**Interfaces:**
- Produces: `pnpm build` emits a self-destroying `dist/sw.js` at the same URL as the old workbox SW. Manifest + icons still emitted/injected by the plugin (installability unchanged this release).

- [x] **Step 1: Rewrite the VitePWA block** in `vite.config.ts` — replace the whole `VitePWA({ … })` argument (lines 13–46) with:

```ts
    VitePWA({
      // OFFLINE-FIRST REMOVAL, phase 1 (kill switch): ship a self-destroying sw.js at the same
      // URL, which unregisters the old workbox SW and clears its caches on every installed
      // client. Do NOT delete the plugin yet — /sw.js must keep resolving as real JS: the
      // vercel.json SPA catch-all would serve HTML for a deleted file (MIME error → the stale
      // registration never clears and installed clients keep the precached shell forever).
      // Phase 2, after weeks in production: remove the plugin, add a static
      // public/manifest.webmanifest + <link>s in index.html, and keep a tiny static
      // public/sw.js kill switch indefinitely.
      selfDestroying: true,
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "apple-touch-icon-180x180.png", "logo.svg"],
      manifest: {
        name: "TennisArc",
        short_name: "TennisArc",
        description: "Live radial bracket for Grand Slam tennis (ATP + WTA).",
        theme_color: "#0d1014",
        background_color: "#0d1014",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
```

(The `workbox:` block is gone — precache config is dead under `selfDestroying`.)

- [x] **Step 2: Fix the stale comment** on `assetsInlineLimit` (lines 8–9) — replace with:

```ts
    // keep the bundled flag SVGs as individual files instead of base64 data-URIs
    // bloating the JS bundle (most are tiny and would otherwise inline)
```

- [x] **Step 3: Delete asset-generator tooling** — `git rm pwa-assets.config.ts`; remove the `"generate-pwa-assets": "pwa-assets-generator",` script and the `"@vite-pwa/assets-generator": "^0.2.6",` devDep from package.json; `pnpm install`. (The generated icons are committed in `public/` and stay.)

- [x] **Step 4: Verify the kill switch builds** — `pnpm build` then `grep -c "unregister" dist/sw.js` → ≥ 1, and `grep -c "manifest.webmanifest" dist/index.html` → ≥ 1 (manifest still injected).

- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(pwa)!: self-destroying service worker (offline-first removal, phase 1)"`

---

### Task 4: Error state + Retry

**Files:**
- Modify: `src/app.ts` (state interface ~line 40, `draw()` loading branch lines 233–238, bootstrap IIFE, click handler `else if` chain ~line 587)
- Modify: `src/app.css` (append)
- Test: `src/app.test.ts` (append)

**Interfaces:**
- Consumes: fetch-only `load()` from Task 2.
- Produces: `state.loadFailed: boolean`; `bootstrap(): Promise<void>` (extracted, re-runnable); click action `data-action="retry"`. Task 5's `load()` rewrite must keep the `loadFailed` semantics shown here.

- [x] **Step 1: Write the failing test** — append to `src/app.test.ts`:

```ts
describe("load failure", () => {
  it("shows an error with Retry when nothing can be fetched, and recovers on retry", async () => {
    // every fetch fails → bootstrap can't get index or snapshot
    globalThis.fetch = vi.fn(async () => new Response("null", { headers: { "Content-Type": "application/json" } })) as typeof fetch;
    const root = document.createElement("div");
    document.body.appendChild(root);
    mounted.push(createApp(root));
    await until(() => root.querySelector(".load-error") !== null);
    expect(root.querySelector('.load-error [data-action="retry"]')).toBeTruthy();

    // network comes back → Retry loads the bracket
    installFetchStub(); // the standard INDEX/SNAP stub from beforeEach
    (root.querySelector('[data-action="retry"]') as HTMLElement).click();
    await until(() => root.querySelector(".arc") !== null);
    expect(root.querySelector(".load-error")).toBeNull();
  });
});
```

Refactor the existing `beforeEach` fetch stub into a named function so the test can re-install it:

```ts
function installFetchStub(): void {
  globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    const body = u.includes("index.json") ? INDEX
      : u.includes("roland-garros") || u.includes("wimbledon") ? SNAP : null;
    return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}
```

(Replace the inline stub in `beforeEach` with `installFetchStub();` — keep the body byte-identical to what `beforeEach` had.) Add a tiny poll helper next to `mountApp` if none exists:

```ts
async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("until(): timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}
```

(If `mountApp` already contains an equivalent wait loop, extract/reuse it instead of duplicating.)

- [x] **Step 2: Run test to verify it fails** — `pnpm exec vitest run src/app.test.ts -t "load failure"` → FAIL (no `.load-error` ever renders).

- [x] **Step 3: Implement** in `src/app.ts`:
  - State: add `loadFailed: boolean;` to the `AppState` interface (after `helpOpen`) with comment `// nothing renderable AND the last fetch failed → draw() shows Retry instead of a spinner`, and `loadFailed: false,` to the initial state literal.
  - `draw()` loading branch — replace lines 233–238 with:

```ts
    const snap = state.year ? state.snapshots[snapKey(state.tour, state.year, state.slam)] : undefined;
    if (!snap) {
      root.innerHTML =
        renderControls(controlsOpts()) +
        (state.loadFailed
          ? `<div class="stage"><div class="loading load-error"><p>Couldn’t load the draw — check your connection.</p>` +
            `<button class="retry" data-action="retry">Retry</button></div></div>`
          : `<div class="stage"><div class="loading">Loading ${state.tour} draw…</div></div>`);
      return;
    }
```

  - `load()` — mark failure only when the current view has nothing to show:

```ts
  const load = async (tour: Tour, year: number, slam: string) => {
    const k = snapKey(tour, year, slam);
    const fresh = await fetchSnapshot(tour, year, slam);
    const isCurrent = snapKey(state.tour, state.year, state.slam) === k;
    if (fresh) {
      state.snapshots[k] = fresh;
      if (isCurrent) { state.loadFailed = false; draw(); }
    } else if (isCurrent && !state.snapshots[k]) {
      state.loadFailed = true; draw();
    }
  };
```

  - Bootstrap: extract the existing IIFE body into a named re-runnable function and mark failure when the index never arrives. Replace `void (async () => { … })();` with:

```ts
  const bootstrap = async () => {
    state.loadFailed = false;
    state.index = (await fetchIndex()) ?? undefined;
    if (state.index) {
      // Resolve the URL's candidate view against the manifest (stale/partial/"/" → default),
      // then canonicalize the URL in place so it honestly names the resolved view and a
      // copy-paste shares exactly that. No new history entry.
      const r = resolveRoute(initial);
      state.tour = r.tour; state.year = r.year; state.slam = r.slam;
      // colorDim/seedSort were seeded from the URL at construction and may have just been changed
      // by a lens click during the loading window — don't clobber them with the mount-time candidate.
      if (state.year) history.replaceState(null, "", buildUrl());
    }
    if (!state.year) { state.loadFailed = true; draw(); return; } // no manifest → Retry state
    await load(state.tour, state.year, state.slam);
    // Warm the other tour's same-or-default slam in the background.
    const other: Tour = state.tour === "ATP" ? "WTA" : "ATP";
    if (state.index) {
      const slots = availableYears(state.index, other).length ? slamsForYear(state.index, state.year, other) : [];
      const otherSel = slots.find((s) => s.entry && s.slam === state.slam)
        ? { year: state.year, slam: state.slam }
        : pickDefaultSlam(state.index, other);
      if (otherSel) void load(other, otherSel.year, otherSel.slam);
    }
  };
  void bootstrap();
```

  (`draw();` stays immediately before it for the initial loading state.)
  - Click handler: insert after the `a === "panel-expand"` branch:

```ts
    } else if (a === "retry") {
      state.loadFailed = false;
      draw(); // back to the spinner while we refetch
      if (!state.year) void bootstrap();
      else void load(state.tour, state.year, state.slam);
```

- [x] **Step 4: Style it** — append to `src/app.css` (after the `.loading` rule at line 244):

```css
.load-error { flex-direction: column; gap: 12px; text-align: center; padding: 0 24px; }
.load-error p { margin: 0; }
.load-error .retry {
  font: inherit; color: var(--text); background: var(--panel);
  border: 1px solid var(--line); border-radius: 8px; padding: 8px 22px; cursor: pointer;
}
.load-error .retry:hover { border-color: var(--accent); }
```

- [x] **Step 5: Run test to verify it passes** — `pnpm exec vitest run src/app.test.ts` → PASS (whole file, not just the new test).

- [x] **Step 6: Commit** — `git add -A && git commit -m "feat(app): explicit load-failure state with Retry"`

---

### Task 5: Change detection, visibility refetch, live polling

**Files:**
- Modify: `src/app.ts` (`load()`, `visibilitychange` handler lines 819–821, new interval after it, import from `./slams`)
- Test: `src/app.test.ts` (append)

**Interfaces:**
- Consumes: `statusFor` (Task 1), `load()`/`loadFailed` (Task 4).
- Produces: `LIVE_POLL_MS = 90_000`; `isLiveView(): boolean`; `lastLoadMs: number` module-level tracking. `load()` now skips `draw()` when `generatedAt` is unchanged — Task 6's refresh chip relies on that (it draws explicitly around the call).

- [x] **Step 1: Write the failing test** — append to `src/app.test.ts`:

```ts
describe("live polling", () => {
  const LIVE_INDEX: SlamIndex = {
    ...INDEX,
    slams: [{ ...INDEX.slams[0], status: "live" as const }, INDEX.slams[1]],
  };

  function installLiveFetchStub(snap: () => unknown): () => number {
    const fn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      const body = u.includes("index.json") ? LIVE_INDEX
        : u.includes("roland-garros") || u.includes("wimbledon") ? snap() : null;
      return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    });
    globalThis.fetch = fn as unknown as typeof fetch;
    return () => fn.mock.calls.filter(([u]) => String(u).includes("roland-garros")).length;
  }

  it("refetches the live slam every 90s and redraws only when generatedAt changes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let served: unknown = SNAP;
    const snapCalls = installLiveFetchStub(() => served);
    const root = await mountApp();
    const before = snapCalls();

    // unchanged data: a tick fetches but must not rebuild the DOM
    const marker = root.querySelector(".chart")!;
    await vi.advanceTimersByTimeAsync(90_000);
    expect(snapCalls()).toBeGreaterThan(before);
    expect(root.querySelector(".chart")).toBe(marker); // same node → no innerHTML swap

    // changed data: next tick redraws
    served = { ...SNAP, generatedAt: new Date(Date.now() + 60_000).toISOString() };
    await vi.advanceTimersByTimeAsync(90_000);
    expect(root.querySelector(".chart")).not.toBe(marker);
    vi.useRealTimers();
  });

  it("does not poll while the tab is hidden", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const snapCalls = installLiveFetchStub(() => SNAP);
    await mountApp();
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    const before = snapCalls();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(snapCalls()).toBe(before);
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    vi.useRealTimers();
  });
});
```

(If `document.hidden` is already stubbed elsewhere in the file, reuse that pattern. `afterEach` must restore `document.hidden` to false — add the `Object.defineProperty(document, "hidden", { value: false, configurable: true });` line there.)

- [x] **Step 2: Run test to verify it fails** — `pnpm exec vitest run src/app.test.ts -t "live polling"` → FAIL (no refetch happens).

- [x] **Step 3: Implement** in `src/app.ts`:
  - Import: add `statusFor` to the existing `./slams` import.
  - `load()` — add change detection + `lastLoadMs` (full replacement):

```ts
  let lastLoadMs = 0; // last completed snapshot fetch for the CURRENT view (visibility refetch throttle)
  const load = async (tour: Tour, year: number, slam: string) => {
    const k = snapKey(tour, year, slam);
    const fresh = await fetchSnapshot(tour, year, slam);
    const isCurrent = snapKey(state.tour, state.year, state.slam) === k;
    if (isCurrent) lastLoadMs = Date.now();
    if (fresh) {
      const prev = state.snapshots[k];
      state.snapshots[k] = fresh;
      if (isCurrent) {
        state.loadFailed = false;
        // redraw only when the data actually moved — polling must not wipe panel scroll /
        // in-flight interactions every 90s just to repaint identical bytes
        if (!prev || prev.generatedAt !== fresh.generatedAt) draw();
      }
    } else if (isCurrent && !state.snapshots[k]) {
      state.loadFailed = true; draw();
    }
  };
```

  - Add next to it:

```ts
  const LIVE_POLL_MS = 90_000;
  const isLiveView = (): boolean =>
    statusFor(state.index, state.tour, state.year, state.slam) === "live";
```

  - `visibilitychange` handler — replace lines 819–821 with:

```ts
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    // a returning tab wants fresh scores, not just fresh labels — but don't hammer the CDN
    // on quick tab flips (half a poll interval since the last completed fetch)
    if (isLiveView() && Date.now() - lastLoadMs > LIVE_POLL_MS / 2) void load(state.tour, state.year, state.slam);
    if (Date.now() - lastDrawMs > 60_000) draw();
  }, { signal });
```

  - Polling interval — insert right after that handler:

```ts
  // Live polling: while the manifest says the viewed slam is in play, refetch on a fixed tick.
  // draw() only fires when generatedAt moves (see load), so an idle tick costs one ~304 fetch.
  const pollTimer = window.setInterval(() => {
    if (document.hidden || !isLiveView()) return;
    void load(state.tour, state.year, state.slam);
  }, LIVE_POLL_MS);
  signal.addEventListener("abort", () => clearInterval(pollTimer));
```

- [x] **Step 4: Run tests to verify they pass** — `pnpm exec vitest run src/app.test.ts` → PASS (all — the redraw-skip must not break the existing mount/interaction tests).

- [x] **Step 5: Commit** — `git add -A && git commit -m "feat(app): live-gated 90s polling + visibility refetch with generatedAt change detection"`

---

### Task 6: Tappable freshness chip

**Files:**
- Modify: `src/app.ts` (state interface, status line ~line 392, click handler)
- Modify: `src/app.css` (append)
- Test: `src/app.test.ts` (append)

**Interfaces:**
- Consumes: change-detecting `load()` from Task 5 (which is why refresh draws explicitly itself).
- Produces: click action `data-action="refresh"`; `state.refreshing: boolean`.

- [x] **Step 1: Write the failing test** — append to `src/app.test.ts`:

```ts
describe("freshness chip", () => {
  it("refetches the current snapshot when clicked", async () => {
    const root = await mountApp();
    const fetches = (globalThis.fetch as ReturnType<typeof vi.fn>).mock;
    const before = fetches.calls.filter(([u]) => String(u).includes("roland-garros")).length;
    (root.querySelector('[data-action="refresh"]') as HTMLElement).click();
    await until(() =>
      fetches.calls.filter(([u]) => String(u).includes("roland-garros")).length > before);
    expect(root.querySelector('[data-action="refresh"]')).toBeTruthy(); // chip survives the redraw
  });
});
```

- [x] **Step 2: Run test to verify it fails** — `pnpm exec vitest run src/app.test.ts -t "freshness chip"` → FAIL (no `[data-action="refresh"]` in the DOM).

- [x] **Step 3: Implement** in `src/app.ts`:
  - State: add `refreshing: boolean;` to `AppState` (comment: `// a manual refresh is in flight — the chip shows "updating…"`) and `refreshing: false,` to the initial literal.
  - Status line — replace the `staleLabel` IIFE segment in `draw()` (line 392) so the label becomes a button:

```ts
      `<div class="status">${snap.tournament.name}${(() => {
        const s = state.refreshing ? "updating…" : staleLabel(snap.generatedAt, Date.now());
        return ` · <button class="status-refresh" data-action="refresh" title="Refresh now">${s || "refresh"} <span aria-hidden="true">↻</span></button>`;
      })()}` +
```

  - Click handler — insert after the `retry` branch:

```ts
    } else if (a === "refresh") {
      if (state.refreshing) return;
      state.refreshing = true;
      draw(); // show "updating…" immediately
      void load(state.tour, state.year, state.slam)
        .finally(() => { state.refreshing = false; draw(); });
```

- [x] **Step 4: Style it** — append to `src/app.css`:

```css
.status-refresh {
  font: inherit; color: inherit; background: none; border: 0; padding: 2px 4px; margin: -2px 0;
  cursor: pointer; text-decoration: underline dotted transparent; text-underline-offset: 3px;
}
.status-refresh:hover { color: var(--text); text-decoration-color: var(--dim); }
```

- [x] **Step 5: Run tests** — `pnpm exec vitest run src/app.test.ts` → PASS.

- [x] **Step 6: Commit** — `git add -A && git commit -m "feat(app): freshness label is a tap-to-refresh control"`

---

### Task 7: Preconnect + copy updates

**Files:**
- Modify: `index.html`, `README.md`, `src/help.ts:4`, `package.json:4`

- [x] **Step 1: Preconnect** — in `index.html`, add inside `<head>` (after the existing meta tags):

```html
    <link rel="preconnect" href="https://raw.githubusercontent.com" crossorigin />
```

- [x] **Step 2: README** — four edits:
  - Line 3: replace `A live, offline-first **radial bracket** PWA` with `A live **radial bracket** web app` (rest of the sentence unchanged).
  - Line 18: replace the sentence `…and works fully offline once installed (service-worker precache + IndexedDB cache).` with `…and refetches it live (90 s polling while a slam is in play).` Keep the flat-path-rewrite sentence, but change its justification to `so clients running the old (now self-destroying) service worker never 404`.
  - Line 53: replace `installable + offline-capable` with `installable (the offline layer was removed 2026-07; a self-destroying service worker cleans up old installs)`.
  - Line 64: replace `` `app.ts` (offline-first loop). `store.ts` (idb-keyval) + `api.ts` (fetch) feed the loop `` with `` `app.ts` (live-first loop). `api.ts` (fetch) feeds the loop ``.

- [x] **Step 3: help.ts comment** — line 3–4: drop `, and it works fully offline` from the comment.

- [x] **Step 4: package.json description** — line 4: `"Live radial-bracket web app for Grand Slam tennis (ATP + WTA)"`.

- [x] **Step 5: Verify + commit** — `pnpm test && pnpm typecheck`, then `git add -A && git commit -m "docs: live-first copy — retire offline-first claims; preconnect to data host"`

---

### Task 8: End-to-end verification

- [x] **Step 1: Full suite** — `pnpm test` → all green. `pnpm build` → succeeds; `grep -c unregister dist/sw.js` ≥ 1.
- [x] **Step 2: Live run** — `pnpm preview`, open the served URL: bracket loads; status line shows the `↻` chip; clicking it flips to "updating…" and back; DevTools → Application → Service Workers on a previously-visited origin shows the SW unregistering. Simulate failure (DevTools offline, hard reload) → "Couldn't load the draw" + Retry; going online + Retry recovers.
- [x] **Step 3: Push + PR** — `git push -u origin feat/live-first-client`, open PR titled `feat: live-first client — offline layer removal (phase 1) + live polling`.
