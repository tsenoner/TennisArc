// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeSyntheticSnapshot } from "./fixtures/synthetic";
import type { SlamIndex, Snapshot } from "./model";

import { createApp } from "./app";

const SNAP = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 3 });
// the ATP slam the synthetic snapshot describes (the bootstrap default), plus a second
// switchable slam ("upcoming" — pickDefaultSlam never prefers it) so tests can exercise
// slam switching (resetSelection, year/slam grammar)
const INDEX: SlamIndex = {
  schemaVersion: 1,
  generatedAt: "2026-06-07T00:00:00.000Z",
  slams: [{
    tour: "ATP", year: 2026, slam: "roland-garros", name: "Roland Garros",
    surface: "Clay", status: "complete", generatedAt: "2026-06-07T00:00:00.000Z", drawSize: 8,
  }, {
    tour: "ATP", year: 2026, slam: "wimbledon", name: "Wimbledon",
    surface: "Grass", status: "upcoming", generatedAt: "2026-06-07T00:00:00.000Z", drawSize: 8,
  }],
};
// INDEX with the first slam flipped live — every live-gated flow (polling, /api/live overlay,
// the both-contenders highlight) shares this one copy.
const LIVE_INDEX: SlamIndex = { ...INDEX, slams: [{ ...INDEX.slams[0], status: "live" as const }, INDEX.slams[1]] };
/** Flashscore's "Surname F." short-name shape — what the /api/live name-join parses. */
const short = (full: string) => { const t = full.split(" "); return `${t[t.length - 1]} ${t[0][0]}.`; };

/** This jsdom build exposes no localStorage (Node's experimental global shadows it); theme.ts
 *  reads it at mount, so install a fresh in-memory Storage shim on every test. */
function installStorage(): void {
  const store = new Map<string, string>();
  const ls: Storage = {
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
  for (const target of [globalThis, window] as Array<Record<string, unknown>>) {
    Object.defineProperty(target, "localStorage", { value: ls, configurable: true, writable: true });
  }
}

beforeEach(() => {
  installStorage();
  // jsdom ships no CSS.escape; highlightPath needs it. It only escapes for use INSIDE a quoted
  // attribute selector (`[data-occupant="…"]`), so backslash-escaping any non-identifier char is
  // sufficient here — production relies on the browser's spec-correct native CSS.escape.
  if (!(globalThis as { CSS?: { escape?: unknown } }).CSS?.escape) {
    (globalThis as unknown as { CSS: { escape(s: string): string } }).CSS = {
      escape: (s: string) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`),
    };
  }
  // This jsdom build ships no document.elementFromPoint; the touch-drag highlight hit-tests with
  // it. Default to null so the handler falls back to e.target (matching desktop hover, which all
  // existing pointermove tests assert); the touch-capture test overrides it to the under-finger arc.
  if (typeof document.elementFromPoint !== "function") {
    (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () => null;
  }
  installFetchStub();
});

/** The standard network: manifest + the two synthetic slams, overridable per test (a live
 *  manifest, a snapshot body re-read per request). Tests that simulate outages overwrite
 *  globalThis.fetch and call this to bring the network back. Returns a counter of
 *  roland-garros snapshot fetches (the live-score endpoint's own query string names the slam
 *  too, e.g. "/api/live?tour=atp&slam=roland-garros" — excluded so it isn't double-counted). It
 *  answers /api/live with an empty overlay so live-gated tests here don't spuriously redraw. */
function installFetchStub(overrides: { index?: () => unknown; snap?: () => unknown } = {}): () => number {
  const index = overrides.index ?? (() => INDEX);
  const snap = overrides.snap ?? (() => SNAP);
  const fn = vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("/api/live")) return { ok: true, status: 200, json: async () => ({ matches: [] }) } as Response;
    const body = u.includes("index.json") ? index()
      : u.includes("roland-garros") || u.includes("wimbledon") ? snap() : null;
    return { ok: body != null, status: body != null ? 200 : 404, json: async () => body } as Response;
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return () => fn.mock.calls.filter(([u]) => String(u).includes("roland-garros") && !String(u).includes("/api/live")).length;
}

// Dispose every app mounted during a test (createApp returns a disposer that detaches its
// window/document/root listeners), so no handler leaks across mounts; then reset shared globals.
const mounted: Array<() => void> = [];
afterEach(async () => {
  vi.useRealTimers();                       // a failed fake-timer test must not starve the drain below
  Object.defineProperty(document, "hidden", { value: false, configurable: true }); // polling gate reset
  for (const dispose of mounted) dispose();
  mounted.length = 0;
  // A prior test's REAL history.back() fires popstate on a later macrotask; dispose has already
  // detached every app's listener, so draining a few ticks here lets that stray traversal land in
  // the void instead of in the NEXT test (where the view-aware popstate would clobber its draw).
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  document.body.innerHTML = "";
  delete document.documentElement.dataset.theme;
  vi.restoreAllMocks();                     // history spies must never leak across tests
  history.replaceState(null, "", "/");      // …nor a hash/path a test pushed
});

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}
function touch(el: Element): void {
  el.dispatchEvent(new Event("touchstart", { bubbles: true }));
}
/** An occupied, match-bearing arc (skips empty/projected arcs and the reset hub). */
function pickArc(root: HTMLElement): HTMLElement {
  return [...root.querySelectorAll<HTMLElement>(".sunburst path.arc[data-occupant][data-match]")]
    .find((a) => a.dataset.occupant && SNAP.matches[a.dataset.match ?? ""])!;
}
const pinnedRows = (root: HTMLElement) => root.querySelectorAll(".row-pinned");
const litArcs = (root: HTMLElement) => root.querySelectorAll(".sunburst path.arc-hl");
/** Switch to a colour lens by its control button. The centre pill shows a DECIDED result on every
 *  lens; a PROJECTION (live slam) or the all-TBD section-title fallback only on Seed. */
const setLens = (root: HTMLElement, dim: string) =>
  click(root.querySelector<HTMLElement>(`[data-action="colordim"][data-dim="${dim}"]`)!);

/** Mount the app and wait for the bracket (async bootstrap: fetch index → snapshot → draw). */
async function mountApp(): Promise<HTMLElement> {
  document.body.innerHTML = `<div id="app"></div>`;
  const root = document.getElementById("app")!;
  mounted.push(createApp(root));
  await vi.waitFor(() => {
    if (!root.querySelector(".sunburst path.arc")) throw new Error("bracket not rendered yet");
  }, { timeout: 2000 });
  return root;
}

describe("click handler — pin vs nested action precedence", () => {
  it("credits the duration source in the status line (CC BY-NC-SA attribution)", async () => {
    const root = await mountApp();
    const status = root.querySelector(".status")!;
    expect(status.innerHTML).toContain("tennisabstract.com");
    expect(status.textContent).toContain("Tennis Abstract");
  });

  it("names the current tournament in document.title", async () => {
    await mountApp();
    expect(document.title).toBe(`${SNAP.tournament.name} — TennisArc`);
  });

  it("lets a [data-action] nested inside a pin row win over pinning", async () => {
    const root = await mountApp();
    expect(document.documentElement.dataset.theme).toBe("dark");

    // A future interactive control inside a leaderboard row must not be swallowed by pin-on-row.
    const row = root.querySelector<HTMLElement>(".leaderboard [data-hl-path][data-occupant]")!;
    const btn = document.createElement("button");
    btn.setAttribute("data-action", "theme");
    row.appendChild(btn);

    click(btn);

    // the nested action ran (theme toggled) and no pin was set
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(root.querySelector(".row-pinned")).toBeNull();
    expect(root.querySelector(".sunburst path.arc-hl")).toBeNull();
  });
});

describe("tap-to-pin on panel rows", () => {
  it("pins a leaderboard row's player (lit path + readout) and unpins on a second tap", async () => {
    const root = await mountApp();
    const lbRow = root.querySelector<HTMLElement>(".leaderboard [data-hl-path][data-occupant]")!;
    const occ = lbRow.dataset.occupant!;
    const name = lbRow.querySelector(".lb-who")!.textContent!;

    click(lbRow);
    const pinned = root.querySelector<HTMLElement>(`[data-hl-path][data-occupant="${occ}"]`)!;
    expect(pinned.classList.contains("row-pinned")).toBe(true);
    expect(litArcs(root).length).toBeGreaterThan(0);
    expect(root.querySelector(".readout .ro-name")!.textContent).toBe(name);

    click(root.querySelector<HTMLElement>(`[data-hl-path][data-occupant="${occ}"]`)!);
    expect(pinnedRows(root).length).toBe(0);
    expect(litArcs(root).length).toBe(0);
  });
});

describe("arc tap → pin + match strip (one grammar on every input)", () => {
  it("touch: a SINGLE tap pins the player AND opens the strip (no second-tap dance)", async () => {
    const root = await mountApp();
    const arc = pickArc(root);

    touch(arc); click(arc);
    expect(litArcs(root).length).toBeGreaterThan(0);                       // pinned path lit
    expect(root.querySelector(".sunburst .match-strip")).not.toBeNull();   // strip open on the FIRST tap
    expect(root.querySelector(".mi-detail")).toBeNull();                   // detail tier stays collapsed
  });

  it("desktop: a click pins the player AND opens the strip", async () => {
    const root = await mountApp();
    const arc = pickArc(root);

    click(arc);
    expect(root.querySelector(".match-strip")).not.toBeNull();     // the click opens the strip
    const lit = litArcs(root).length;
    expect(lit).toBeGreaterThan(0);                                // the player's path is lit
    root.dispatchEvent(new Event("pointerleave"));                 // a mere hover-preview would clear here…
    expect(litArcs(root).length).toBe(lit);                        // …but a pin keeps it lit → the click stuck
  });

  it("strip dead-space taps don't release the pin (unpin is scoped to .chart)", async () => {
    const root = await mountApp();
    click(pickArc(root));
    const lit = litArcs(root).length;
    expect(lit).toBeGreaterThan(0);

    click(root.querySelector(".match-strip")!);          // padding/score area: no [data-action]
    expect(litArcs(root).length).toBe(lit);              // pin survives
    expect(root.querySelector(".match-strip")).not.toBeNull();

    click(root.querySelector(".chart svg")!);            // truly-empty chart region still unpins
    expect(litArcs(root).length).toBe(0);
  });
});

describe("selecting an in-play match lights BOTH contenders' paths", () => {
  /** Round 0 decided, later rounds scheduled — then flip the first semifinal in-play, so the
   *  selected arc has two REAL contenders while its occupant is only the projected favourite. */
  function inPlaySnap(status: "live" | "suspended" = "live") {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 3, completedRounds: 1 });
    const m = s.matches["1-0"];
    m.status = status;
    m.score = [{ p1: 4, p2: 3 }];
    m.live = { set: 1, game: "30-15", server: "p1" };
    return s;
  }
  const litFor = (root: HTMLElement, pid: string) =>
    root.querySelectorAll(`.sunburst path.arc-hl[data-occupant="${pid}"]`).length;
  /** Serve `s`, mount, and select the semifinal by tapping its arc. */
  async function mountAndSelect(s = inPlaySnap()) {
    installFetchStub({ snap: () => s });
    const root = await mountApp();
    click(root.querySelector<HTMLElement>('.sunburst path.arc[data-match="1-0"]')!);
    return { root, m: s.matches["1-0"] };
  }

  for (const status of ["live", "suspended"] as const) {
    it(`${status}: an arc tap lights the paths of both players, not just the ELO favourite's`, async () => {
      const { root, m } = await mountAndSelect(inPlaySnap(status));
      expect(root.querySelector(".match-strip")).not.toBeNull();
      expect(litFor(root, m.p1!)).toBeGreaterThan(0);
      expect(litFor(root, m.p2!)).toBeGreaterThan(0);
    });
  }

  it("hovering the selected in-play arc keeps both paths (no collapse to the favourite)", async () => {
    const { root, m } = await mountAndSelect();
    // the pointer is still ON the arc just clicked — the very next move must not drop a path
    root.querySelector<HTMLElement>('.sunburst path.arc[data-match="1-0"]')!
      .dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    expect(litFor(root, m.p1!)).toBeGreaterThan(0);
    expect(litFor(root, m.p2!)).toBeGreaterThan(0);
  });

  it("hovering elsewhere previews that player alone; leaving restores both contenders", async () => {
    const { root, m } = await mountAndSelect();
    const other = [...root.querySelectorAll<HTMLElement>(".sunburst path.arc[data-occupant]")]
      .find((a) => a.dataset.occupant && a.dataset.occupant !== m.p1 && a.dataset.occupant !== m.p2)!;
    other.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    expect(litFor(root, other.dataset.occupant!)).toBeGreaterThan(0); // hover preview: that player only
    expect(litFor(root, m.p1!) + litFor(root, m.p2!)).toBe(0);

    root.dispatchEvent(new Event("pointerleave"));                    // off-target: the selection re-lights
    expect(litFor(root, m.p1!)).toBeGreaterThan(0);
    expect(litFor(root, m.p2!)).toBeGreaterThan(0);
  });

  it("a DECIDED match keeps the single-path highlight (the loser's run is over)", async () => {
    const root = await mountApp();                       // default SNAP: fully played
    const arc = pickArc(root);
    click(arc);
    const occs = new Set([...litArcs(root)].map((a) => (a as HTMLElement).dataset.occupant));
    expect(occs).toEqual(new Set([arc.dataset.occupant]));
  });

  it("a data-lag match (winner set, status still 'live') counts as decided: single path", async () => {
    const s = inPlaySnap();
    s.matches["1-0"].winner = "p1"; // SofaScore sets the winner before flipping the status code
    const { root, m } = await mountAndSelect(s);
    const occs = new Set([...litArcs(root)].map((a) => (a as HTMLElement).dataset.occupant));
    expect(occs).toEqual(new Set([m.p1])); // the decided arc pins its winner — loser stays unlit
  });

  it("re-pinning a NON-contender row while the in-play match stays selected lights only them", async () => {
    const { root, m } = await mountAndSelect();
    const row = [...root.querySelectorAll<HTMLElement>(".leaderboard [data-hl-path][data-occupant]")]
      .find((r) => r.dataset.occupant !== m.p1 && r.dataset.occupant !== m.p2)!;
    click(row);

    expect(root.querySelector(".match-strip")).not.toBeNull(); // the selection survives the re-pin
    const occs = new Set([...litArcs(root)].map((a) => (a as HTMLElement).dataset.occupant));
    expect(occs).toEqual(new Set([row.dataset.occupant]));     // …but only the new pin's path lights
  });

  it("the /api/live overlay path (production shape) lights both contenders too", async () => {
    // The raw snapshot still says "scheduled"; only the Flashscore overlay (applyLivePatch in
    // draw) flips the match live — pinnedPathIds must read the PATCHED snapshot, not the raw one.
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 3, completedRounds: 1 });
    const m = s.matches["1-0"];
    // real names so the Flashscore name-join is unambiguous (fixture names all collapse to "player:p")
    s.players[m.p1!] = { ...s.players[m.p1!], name: "Novak Djokovic" };
    s.players[m.p2!] = { ...s.players[m.p2!], name: "Rafael Nadal" };
    const rec = { id: "fs1", stage: 2, home: short(s.players[m.p1!].name), away: short(s.players[m.p2!].name), setsWon: [1, 0], sets: [[6, 4]] };
    // the standard stub answers /api/live with an empty overlay — layer just that route on top
    // of it (installPbpNet's pattern), delegating everything else to the base stub
    installFetchStub({ index: () => LIVE_INDEX, snap: () => s });
    const base = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/api/live")) return { ok: true, status: 200, json: async () => ({ matches: [rec] }) } as Response;
      return base(url);
    }) as unknown as typeof fetch;

    const root = await mountApp();
    await vi.waitFor(() => { // the mount-time loadLive() has applied the overlay once the arc hatches
      if (!root.querySelector('.sunburst path.arc.live[data-match="1-0"]')) throw new Error("overlay not applied yet");
    }, { timeout: 2000 });

    click(root.querySelector<HTMLElement>('.sunburst path.arc[data-match="1-0"]')!);
    expect(litFor(root, m.p1!)).toBeGreaterThan(0);
    expect(litFor(root, m.p2!)).toBeGreaterThan(0);
  });
});

describe("match detail tier (Details ▾)", () => {
  it("expands behind the strip and ESC unwinds one layer per press: detail → strip", async () => {
    const root = await mountApp();
    click(pickArc(root));
    expect(root.querySelector(".mi-detail")).toBeNull();                   // strip-first: collapsed by default
    click(root.querySelector<HTMLElement>(".ms-more")!);
    expect(root.querySelector(".mi-detail")).not.toBeNull();
    expect(root.querySelector(".mi-scrim")).not.toBeNull();                // phone scrim exists only while expanded

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); // rung 1: collapse the tier
    expect(root.querySelector(".mi-detail")).toBeNull();
    expect(root.querySelector(".match-strip")).not.toBeNull();             // strip survives

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); // rung 2: close the strip
    expect(root.querySelector(".match-strip")).toBeNull();
  });

  it("the sheet's own chrome (✕/grip/scrim) collapses only the tier, keeping the strip", async () => {
    const root = await mountApp();
    click(pickArc(root));
    click(root.querySelector<HTMLElement>(".ms-more")!);
    expect(root.querySelector(".mi-detail")).not.toBeNull();

    click(root.querySelector<HTMLElement>(".mi-detail .sheet-close")!);
    expect(root.querySelector(".mi-detail")).toBeNull();
    expect(root.querySelector(".match-strip")).not.toBeNull();
  });

  it("manages keyboard focus: dialog region on expand, back to the Details toggle on collapse and ESC", async () => {
    const root = await mountApp();
    click(pickArc(root));
    click(root.querySelector<HTMLElement>(".ms-more")!);                   // expand
    // jsdom computes no layout, so offsetParent is null — the desktop branch (display:none
    // .sheet-bar): focus lands on the region itself, never silently dropping to <body>
    expect((document.activeElement as HTMLElement).classList.contains("mi-detail")).toBe(true);

    click(root.querySelector<HTMLElement>(".mi-detail .sheet-close")!);    // click-collapse
    expect(document.activeElement).toBe(root.querySelector('.match-strip [data-action="detail-expand"]'));

    click(root.querySelector<HTMLElement>(".ms-more")!);                   // re-expand
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); // ESC-collapse
    expect(root.querySelector(".mi-detail")).toBeNull();
    expect(document.activeElement).toBe(root.querySelector('.match-strip [data-action="detail-expand"]'));

    click(root.querySelector<HTMLElement>(".ms-close")!);                  // ✕ closes the match
    expect((document.activeElement as HTMLElement).classList.contains("chart")).toBe(true); // focus lands, not <body>
  });

  it("on mobile (sheet laid out) expand focuses the sheet ✕ — the offsetParent-truthy branch", async () => {
    const root = await mountApp();
    // jsdom reports offsetParent=null for everything (no layout), so the desktop branch is all
    // the other test can reach. Emulate a VISIBLE bottom sheet by making offsetParent truthy,
    // then assert focus lands on the sheet's ✕ (not the region). Restore the descriptor after so
    // no other test's display:none assumptions leak.
    const orig = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");
    Object.defineProperty(HTMLElement.prototype, "offsetParent", { configurable: true, get() { return document.body; } });
    try {
      click(pickArc(root));
      click(root.querySelector<HTMLElement>(".ms-more")!);                 // expand → mobile branch
      expect(document.activeElement).toBe(root.querySelector(".mi-detail .sheet-close"));
    } finally {
      if (orig) Object.defineProperty(HTMLElement.prototype, "offsetParent", orig);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetParent;
    }
  });

  it("closing the match clears detailExpanded — the next match opens collapsed", async () => {
    const root = await mountApp();
    click(pickArc(root));
    click(root.querySelector<HTMLElement>(".ms-more")!);                   // expand
    expect(root.querySelector(".mi-detail")).not.toBeNull();

    click(root.querySelector<HTMLElement>(".ms-close")!);                  // ✕ closes strip AND detail
    expect(root.querySelector(".match-strip")).toBeNull();
    expect(root.querySelector(".mi-detail")).toBeNull();

    click(pickArc(root));                                                  // reopen a match
    expect(root.querySelector(".match-strip")).not.toBeNull();
    expect(root.querySelector(".mi-detail")).toBeNull();                   // …collapsed, not pre-expanded
  });
});

describe("readout hiding while a match is selected (has-match)", () => {
  it("survives the pointermove outerHTML readout swap and lifts on close", async () => {
    const root = await mountApp();
    const arc = pickArc(root);
    click(arc);
    expect(root.querySelector(".readout.has-match")).not.toBeNull();

    // hover someone ELSE: updateReadout rewrites the element via outerHTML — roCls owns
    // the class, so the rewrite must re-emit it (a draw()-time class would be dropped here)
    const pinnedOcc = arc.dataset.occupant!;
    const other = [...root.querySelectorAll<HTMLElement>(".sunburst path.arc[data-occupant]")]
      .find((a) => a.dataset.occupant && a.dataset.occupant !== pinnedOcc)!;
    other.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    expect(root.querySelector(".readout.has-match")).not.toBeNull();

    click(root.querySelector<HTMLElement>(".ms-close")!);                  // close the match
    expect(root.querySelector(".readout.has-match")).toBeNull();           // readout returns
  });
});

describe("pin lifecycle", () => {
  it("a tour/slam switch (resetSelection) clears the pin", async () => {
    const root = await mountApp();
    click(root.querySelector<HTMLElement>(".leaderboard [data-hl-path][data-occupant]")!);
    expect(litArcs(root).length).toBeGreaterThan(0);

    click(root.querySelector<HTMLElement>('[data-action="tour"][data-tour="ATP"]')!);
    expect(pinnedRows(root).length).toBe(0);
    expect(litArcs(root).length).toBe(0);
  });

  it("Escape releases a pinned path", async () => {
    const root = await mountApp();
    click(root.querySelector<HTMLElement>(".leaderboard [data-hl-path][data-occupant]")!);
    expect(litArcs(root).length).toBeGreaterThan(0);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(pinnedRows(root).length).toBe(0);
    expect(litArcs(root).length).toBe(0);
  });

  it("a context switch closes the match AND its detail tier (closeMatch in every branch)", async () => {
    const root = await mountApp();
    // (a) tour switch (resetSelection)
    click(pickArc(root));
    click(root.querySelector<HTMLElement>(".ms-more")!);
    expect(root.querySelector(".mi-detail")).not.toBeNull();
    click(root.querySelector<HTMLElement>('[data-action="tour"][data-tour="ATP"]')!);
    expect(root.querySelector(".match-strip")).toBeNull();
    expect(root.querySelector(".mi-detail")).toBeNull();
    // (b) lens switch (the colordim branch)
    click(pickArc(root));
    click(root.querySelector<HTMLElement>(".ms-more")!);
    click(root.querySelector<HTMLElement>('[data-action="colordim"][data-dim="country"]')!);
    expect(root.querySelector(".match-strip")).toBeNull();
    expect(root.querySelector(".mi-detail")).toBeNull();
    // (c) detailExpanded must not have leaked: the next match opens collapsed
    click(root.querySelector<HTMLElement>('[data-action="colordim"][data-dim="time"]')!);
    click(pickArc(root));
    expect(root.querySelector(".match-strip")).not.toBeNull();
    expect(root.querySelector(".mi-detail")).toBeNull();
  });
});

describe("mobile bottom-sheet invariant", () => {
  it("a closed drawer always reopens at peek, never expanded", async () => {
    const root = await mountApp();
    const panel = () => root.querySelector(".leaderboard")!;

    click(root.querySelector<HTMLElement>(".panel-fab")!);           // open (peek)
    expect(panel().classList.contains("open")).toBe(true);
    click(root.querySelector<HTMLElement>(".sheet-grip")!);          // expand
    expect(panel().classList.contains("expanded")).toBe(true);
    expect(root.querySelector(".lens-scrim")!.classList.contains("open")).toBe(true);
    click(root.querySelector<HTMLElement>(".sheet-close")!);         // close

    click(root.querySelector<HTMLElement>(".panel-fab")!);           // reopen
    expect(panel().classList.contains("open")).toBe(true);
    expect(panel().classList.contains("expanded")).toBe(false);      // back at peek
    expect(root.querySelector(".lens-scrim")!.classList.contains("open")).toBe(false);
  });
});

describe("country lens — nation select vs player pin", () => {
  it("a nation header selects the country; an expanded player pins", async () => {
    const root = await mountApp();
    click(root.querySelector<HTMLElement>('[data-action="colordim"][data-dim="country"]')!);

    // tapping the nation header selects (expands) it — it must NOT pin a player
    click(root.querySelector<HTMLElement>(".country-panel .ct-row")!);
    expect(root.querySelector(".country-panel .ct-row.on")).not.toBeNull();
    expect(pinnedRows(root).length).toBe(0);

    // tapping an expanded player pins their path
    click(root.querySelector<HTMLElement>(".country-panel .ct-pl[data-hl-path][data-occupant]")!);
    expect(pinnedRows(root).length).toBeGreaterThan(0);
    expect(litArcs(root).length).toBeGreaterThan(0);
  });

  it("a selected nation owns the float readout with its summary card (#7)", async () => {
    const root = await mountApp();
    setLens(root, "country");

    click(root.querySelector<HTMLElement>(".country-panel .ct-row")!);
    const card = root.querySelector(".readout.ro-float")!;
    expect(card.classList.contains("ro-nation")).toBe(true);
    expect(card.textContent).toMatch(/\d+ of \d+ still in|all \d+ out/);

    // deselecting the nation hands the slot back to the player card
    click(root.querySelector<HTMLElement>(".country-panel .ct-row.on")!);
    expect(root.querySelector(".readout.ro-float.ro-nation")).toBeNull();
  });
});

describe("country lens — ARC tap grammar (branch order: hub zoom-out before nation toggle)", () => {
  it("an arc tap toggles the nation on/off — never pins, never opens the strip, never zooms", async () => {
    const root = await mountApp();
    click(root.querySelector<HTMLElement>('[data-action="colordim"][data-dim="country"]')!);
    click(pickArc(root));
    expect(root.querySelector(".ct-row.on")).not.toBeNull();   // nation selected…
    expect(root.querySelector(".match-strip")).toBeNull();     // …no match strip
    expect(pinnedRows(root).length).toBe(0);                   // …no pin
    click(pickArc(root));                                      // re-tap the same arc (fresh node post-draw)
    expect(root.querySelector(".ct-row.on")).toBeNull();       // it keeps toggling…
    expect(root.querySelector(".crumbs")).toBeNull();          // …it does NOT zoom (no selectedNodeId here)
  });

  it("the focused hub still zooms out on the country lens (checked before the nation branch)", async () => {
    const root = await mountApp();
    mockBack();
    click(root.querySelector<HTMLElement>('[data-action="colordim"][data-dim="country"]')!);
    click(root.querySelector<HTMLElement>(".q-owner")!);       // corner label focuses r.0.0
    expect(root.querySelector(".crumb.cur")!.textContent).toMatch(/'s quarter$/);
    click(root.querySelector<HTMLElement>('path.arc[data-id="r.0.0"]')!); // tap the focused hub
    expect(root.querySelector(".crumb.cur")!.textContent).toBe("Top half"); // stepped out one level…
    expect(root.querySelector(".ct-row.on")).toBeNull();       // …without selecting a nation
  });
});

describe("createApp lifecycle", () => {
  it("dispose() detaches the app's window/document listeners", async () => {
    document.body.innerHTML = `<div id="app"></div>`;
    const root = document.getElementById("app")!;
    const dispose = createApp(root);
    await vi.waitFor(() => {
      if (!root.querySelector(".sunburst path.arc")) throw new Error("bracket not rendered yet");
    }, { timeout: 2000 });

    click(root.querySelector<HTMLElement>(".leaderboard [data-hl-path][data-occupant]")!);
    expect(litArcs(root).length).toBeGreaterThan(0);   // pinned

    dispose();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    // a disposed app's window-keydown handler must not fire — the pin stays lit
    expect(litArcs(root).length).toBeGreaterThan(0);
  });
});

describe("finalist pill + corner readout", () => {
  it("shows a finished slam's champion (flag + surname) in the centre on all three lenses", async () => {
    const root = await mountApp();                            // default SNAP is a fully-played slam → decided champion
    for (const dim of ["time", "seed", "country"]) {
      setLens(root, dim);
      const pill = root.querySelector(".center-id");
      expect(pill, `pill on ${dim}`).not.toBeNull();
      expect(pill!.classList.contains("projected"), `decided (full-weight) on ${dim}`).toBe(false);
      expect(pill!.querySelector(".flag, img.flag"), `flag on ${dim}`).not.toBeNull();
      expect(pill!.textContent!.trim(), `surname on ${dim}`).not.toBe("");
    }
  });

  it("shows the final's schedule in the centre — never a predicted champion — while the slam is in progress", async () => {
    // final unplayed → no champion yet; the centre names the final's slot on EVERY lens,
    // never a projected favourite (predictions were removed from the pill entirely)
    const live = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 3, completedRounds: 1 });
    const final = Object.values(live.matches).find((m) => !m.nextMatchId)!;
    final.scheduledStart = Math.floor(Date.now() / 1000) + 3 * 86400; // 3 days out: unflagged nominal stamp
    installFetchStub({ snap: () => live });
    const root = await mountApp();
    for (const dim of ["time", "seed", "country"]) {
      setLens(root, dim);
      expect(root.querySelector(".center-id.projected"), `no projected pill on ${dim}`).toBeNull();
      const sched = root.querySelector("text.arc-center");
      expect(sched, `final sched tag on ${dim}`).not.toBeNull();
      expect(sched!.textContent, `dates + times the final on ${dim}`).toMatch(/\d{2}:\d{2}/);
    }
    // SVG <text> inside role="img" is presentational to AT — the slot must also reach the
    // chart's accessible name.
    expect(root.querySelector('svg[role="img"]')!.getAttribute("aria-label")).toMatch(/final .*\d{2}:\d{2}/);
  });

  it("includes the provisional time in the centre tag for a far-future (8-day) slot", async () => {
    const live = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 3, completedRounds: 1 });
    const final = Object.values(live.matches).find((m) => !m.nextMatchId)!;
    final.scheduledStart = Math.floor(Date.now() / 1000) + 8 * 86400;
    // SofaScore's provisional showpiece slots arrive flagged like this; display no longer depends
    // on the flag (it governs hide rules only — the trust-at-any-distance rule is state.test.ts's).
    final.scheduledPrecise = true;
    installFetchStub({ snap: () => live });
    const root = await mountApp();
    expect(root.querySelector("text.arc-center")!.textContent).toMatch(/\d{2}:\d{2}$/);
  });

  it("keeps the centre empty while the final is undecided AND unscheduled", async () => {
    const live = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 3, completedRounds: 1 });
    installFetchStub({ snap: () => live });
    const root = await mountApp();
    for (const dim of ["time", "seed", "country"]) {
      setLens(root, dim);
      expect(root.querySelector(".center-id"), `clean centre on ${dim}`).toBeNull();
      expect(root.querySelector("text.arc-center"), `no sched tag on ${dim}`).toBeNull();
    }
  });

  it("keeps naming the finalist in the centre while another player is pinned", async () => {
    const root = await mountApp();                           // finished slam → decided champion pill shows on every lens
    const champ = root.querySelector<HTMLElement>('path.arc[data-id="r"]')!.dataset.occupant!;
    const arc = [...root.querySelectorAll<HTMLElement>("path.arc[data-occupant]")]
      .find((a) => a.dataset.occupant && a.dataset.occupant !== champ)!;
    touch(arc); click(arc);                                  // tap pins + opens the strip…
    click(root.querySelector<HTMLElement>(".ms-close")!);    // …close the strip; the pin survives
    const pill = root.querySelector(".center-id")!;
    const strip = root.querySelector(".readout.ro-float .ro-name")!;
    expect(pill.textContent).not.toBe("");                  // finalist still named at the centre
    expect(strip.textContent).not.toBe("");                 // readout names the pinned player
    expect(pill.textContent).not.toBe(strip.textContent);   // …and they are different players
  });

  it("idles the float card until a hover resolves someone other than the finalist", async () => {
    const root = await mountApp();
    expect(root.querySelector(".ro-float.ro-idle")).not.toBeNull(); // idle at mount
    const champ = root.querySelector<HTMLElement>('path.arc[data-id="r"]')!.dataset.occupant!;
    const arc = [...root.querySelectorAll<HTMLElement>("path.arc[data-occupant]")]
      .find((a) => a.dataset.occupant && a.dataset.occupant !== champ)!;
    arc.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    expect(root.querySelector(".ro-float.ro-idle")).toBeNull();     // hover wakes it
    root.dispatchEvent(new Event("pointerleave"));
    expect(root.querySelector(".ro-float.ro-idle")).not.toBeNull(); // leave restores idle
  });

  it("hovering an arc lights that player's path", async () => {
    const root = await mountApp();
    const arc = pickArc(root);
    arc.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    expect(litArcs(root).length).toBeGreaterThan(0);
  });

  it("follows the finger to the arc under the pointer, not the touchstart arc (touch capture)", async () => {
    const root = await mountApp();
    const startArc = pickArc(root);
    const otherArc = [...root.querySelectorAll<HTMLElement>(".sunburst path.arc[data-occupant]")]
      .find((a) => a.dataset.occupant && a.dataset.occupant !== startArc.dataset.occupant)!;

    // On a touchscreen the pointer is implicitly captured to the pointerdown arc, so every
    // pointermove arrives with e.target pinned to startArc even as the finger slides over
    // otherArc. The handler must hit-test the element actually under the finger by coordinates.
    // pointerType:"touch" — only touch/pen take the elementFromPoint branch (a mouse keeps e.target).
    const spy = vi.spyOn(document, "elementFromPoint").mockReturnValue(otherArc);
    startArc.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "touch", clientX: 10, clientY: 10 }));
    spy.mockRestore();

    const lit = [...litArcs(root)] as HTMLElement[];
    expect(lit.length).toBeGreaterThan(0);                                       // a path is lit…
    expect(lit.every((a) => a.dataset.occupant === otherArc.dataset.occupant))   // …the under-finger
      .toBe(true);                                                               // player's, not startArc's
  });

  it("keeps the lens panel in the side column when a match opens (strip lives above the wheel)", async () => {
    const root = await mountApp();
    click(pickArc(root));
    expect(root.querySelector(".sunburst .match-strip")).not.toBeNull(); // strip in the wheel column…
    expect(root.querySelector(".side .leaderboard")).not.toBeNull();     // …lens panel untouched beside it
    expect(root.querySelector(".side .match-strip")).toBeNull();         // nothing stacks in .side anymore
  });
});

describe("float card never hides what the user is pointing at (idle = input state)", () => {
  it("shows the finalist's card when their own arc is hovered", async () => {
    const root = await mountApp();
    const disc = root.querySelector<HTMLElement>('path.arc[data-id="r"]')!;
    disc.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    expect(root.querySelector(".ro-float.ro-idle")).toBeNull();
    expect(root.querySelector(".ro-float .ro-name")).not.toBeNull();
  });

  it("previews the finalist over a pinned card instead of blanking it", async () => {
    const root = await mountApp();
    click(root.querySelector<HTMLElement>(".leaderboard [data-hl-path][data-occupant]")!); // pin someone
    const disc = root.querySelector<HTMLElement>('path.arc[data-id="r"]')!;
    disc.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    expect(root.querySelector(".ro-float.ro-idle")).toBeNull(); // champion preview, not a blank
    root.dispatchEvent(new Event("pointerleave"));
    expect(root.querySelector(".ro-float.ro-idle")).toBeNull(); // pinned card returns
  });

});

// the depth-2 arc "r.0.0" of the 8-draw fixture: a quarter — non-leaf, never the root
const qArc = (root: HTMLElement) => root.querySelector<HTMLElement>('path.arc[data-id="r.0.0"]')!;
const esc = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
// jsdom's history.back() traverses asynchronously — mock it so focus exits stay deterministic
const mockBack = () => vi.spyOn(history, "back").mockImplementation(() => {});

describe("tap-again zoom + hub zoom-out (focus grammar)", () => {
  it("re-tapping the selected non-leaf arc focuses that section; strip flips to Reset zoom", async () => {
    const root = await mountApp();
    mockBack();
    click(qArc(root));                                                // tap 1: select (pin + strip)
    expect(root.querySelector(".match-strip")).not.toBeNull();
    expect(root.querySelector(".crumbs")).toBeNull();                 // not focused yet
    click(qArc(root));                                                // tap 2: zoom to its own section
    expect(root.querySelector(".crumbs")).not.toBeNull();             // focused…
    expect(root.querySelector('path.arc[data-id="r"]')).toBeNull();   // …arcs outside the section gone
    expect(root.querySelector(".match-strip")).not.toBeNull();        // selection survives the zoom
    const zoomBtn = root.querySelector<HTMLElement>(".ms-zoom")!;
    expect(zoomBtn.textContent).toBe("Reset zoom");
    expect(zoomBtn.dataset.id).toBe("");                              // routed through setFocus(undefined)…
    click(zoomBtn);
    expect(root.querySelector(".crumbs")).toBeNull();                 // …which exits the zoom
    expect(root.querySelector(".match-strip")).not.toBeNull();        // but is NOT the nuclear reset:
    expect(litArcs(root).length).toBeGreaterThan(0);                  // match + pin both survive
  });

  it("re-tapping a selected LEAF zooms to its parent (a leaf's section IS its match)", async () => {
    const root = await mountApp();
    const leaf = () => root.querySelector<HTMLElement>('path.arc[data-id="r.0.0.0"]')!;
    click(leaf()); click(leaf());
    expect(root.querySelector(".crumbs")).not.toBeNull();
    expect(root.querySelector('path.arc[data-id="r.0.0"]')).not.toBeNull(); // parent is the new hub
    expect(root.querySelector('path.arc[data-id="r.0"]')).toBeNull();       // grandparent is outside
    expect(leaf()).not.toBeNull();                                          // the tapped leaf stays in view
  });

  it("tapping the hub zooms out one level at a time, down to the full draw", async () => {
    const root = await mountApp();
    mockBack();
    click(qArc(root)); click(qArc(root));                             // focus r.0.0
    click(qArc(root));                                                // hub tap → out to r.0
    expect(root.querySelector(".crumb.cur")!.textContent).toBe("Top half");
    expect(root.querySelector('path.arc[data-id="r.0.1"]')).not.toBeNull(); // sibling back in view
    click(root.querySelector<HTMLElement>('path.arc[data-id="r.0"]')!);     // hub again → full draw
    expect(root.querySelector(".crumbs")).toBeNull();
    expect(root.querySelector('path.arc[data-id="r"]')).not.toBeNull();
  });

  it("keeps '⊕ Zoom' (drill-in) for a match selected while focused ELSEWHERE — never a surprise reset", async () => {
    const root = await mountApp();
    mockBack();
    const half = () => root.querySelector<HTMLElement>('path.arc[data-id="r.0"]')!;
    click(half()); click(half());                                     // focus the Top half
    expect(root.querySelector(".ms-zoom")!.textContent).toBe("Reset zoom"); // at its own section
    click(root.querySelector<HTMLElement>('path.arc[data-id="r.0.0.0"]')!); // select a match deeper in
    const zoom = root.querySelector<HTMLElement>(".ms-zoom")!;
    expect(zoom.textContent).toBe("⊕ Zoom");                          // NOT inverted to "Reset zoom"
    expect(zoom.dataset.id).toBe("r.0.0");                            // targets the match's own section
    click(zoom);                                                      // …and drills into it
    expect(root.querySelector(".crumb.cur")!.textContent).toMatch(/'s quarter$/);
    // the still-selected leaf now sits INSIDE the focused quarter: there is nothing deeper to
    // zoom into, and a "Reset zoom" here would eject to the full draw — so the button is gone
    // (crumbs/hub handle the step-out). See the dedicated leaf-inside-focus case below.
    expect(root.querySelector(".ms-zoom")).toBeNull();
  });

  it("hides the zoom control for a leaf selected INSIDE its already-focused section (no eject-to-full-draw)", async () => {
    const root = await mountApp();
    mockBack();
    click(qArc(root)); click(qArc(root));                             // focus the quarter r.0.0
    expect(root.querySelector(".ms-zoom")!.textContent).toBe("Reset zoom"); // AT the focused node itself
    click(root.querySelector<HTMLElement>('path.arc[data-id="r.0.0.0"]')!);  // select a leaf inside it
    expect(root.querySelector(".match-strip")).not.toBeNull();       // strip still names the leaf's match…
    expect(root.querySelector(".crumbs")).not.toBeNull();            // …still focused on the quarter…
    expect(root.querySelector(".ms-zoom")).toBeNull();               // …but no surprise "Reset zoom" to eject with
  });

  it("focusing the root is a no-op: setFocus('r') normalizes to no focus, no history entry", async () => {
    const root = await mountApp();
    const push = vi.spyOn(history, "pushState");
    click(root.querySelector<HTMLElement>('path.arc[data-id="r"]')!); // select the final (hub arc)
    const zoom = root.querySelector<HTMLElement>(".ms-zoom")!;
    expect(zoom.dataset.id).toBe("r");                                // the root section IS the full draw
    click(zoom);
    expect(root.querySelector(".crumbs")).toBeNull();                 // no crumbs…
    expect(root.querySelector(".ms-zoom")!.textContent).toContain("Zoom"); // …still unfocused
    expect(push).not.toHaveBeenCalled();                              // …and no entry pushed
  });
});

describe("focus crumbs", () => {
  it("renders ‹ Full draw + tappable ancestors + the current section name", async () => {
    const root = await mountApp();
    click(qArc(root)); click(qArc(root));                             // focus the quarter r.0.0
    const chips = [...root.querySelectorAll<HTMLElement>(".crumbs .crumb")];
    expect(chips[0].textContent).toBe("‹ Full draw");
    expect(chips[0].dataset.id).toBe("");
    expect(chips[1].textContent).toBe("Top half");                    // ancestor chip
    expect(chips[1].dataset.id).toBe("r.0");
    expect(root.querySelector(".crumb.cur")!.textContent).toMatch(/'s quarter$/);
  });

  it("the empty-id 'Full draw' crumb clears focus (guard accepts data-id='')", async () => {
    const root = await mountApp();
    mockBack();
    click(qArc(root)); click(qArc(root));
    expect(root.querySelector(".crumbs")).not.toBeNull();
    click(root.querySelector<HTMLElement>('.crumb[data-id=""]')!);
    expect(root.querySelector(".crumbs")).toBeNull();
    expect(root.querySelector('path.arc[data-id="r"]')).not.toBeNull(); // full draw restored
  });

  it("an ancestor chip jumps to that level (no extra history entry)", async () => {
    const root = await mountApp();
    const push = vi.spyOn(history, "pushState");
    click(qArc(root)); click(qArc(root));                             // focus r.0.0 (1 push)
    click(root.querySelector<HTMLElement>('.crumb[data-id="r.0"]')!); // jump up to the half
    expect(root.querySelector(".crumb.cur")!.textContent).toBe("Top half");
    expect(push).toHaveBeenCalledTimes(1);                            // level change replaced, not pushed
  });

  it("builds a multi-ancestor trail (2+ tappable ancestors) when focused 3 levels deep", async () => {
    // the default 8-draw only reaches depth 2 (one ancestor chip); a 32-draw lets us focus a
    // depth-3 section so the trail-building slice(1,-1) must emit BOTH ancestor chips
    const deep = makeSyntheticSnapshot({ tour: "ATP", drawSize: 32, seed: 3 });
    installFetchStub({ snap: () => deep });
    const root = await mountApp();
    mockBack();
    const arc = () => root.querySelector<HTMLElement>('path.arc[data-id="r.0.0.0"]')!; // depth-3 node WITH children
    click(arc()); click(arc());                                        // re-tap → focus r.0.0.0
    const chips = [...root.querySelectorAll<HTMLElement>('.crumbs .crumb[data-action="focus"]')];
    // ‹ Full draw (id="") + Top half (r.0) + the quarter (r.0.0) — two real ancestors, in order
    expect(chips.map((c) => c.dataset.id)).toEqual(["", "r.0", "r.0.0"]);
    expect(root.querySelector(".crumb.cur[aria-current]")).not.toBeNull(); // current section, inert + marked
  });
});

describe("focus history discipline (V1-simple: one entry per focus session)", () => {
  it("pushes ONE entry on entry, replaces on level change, pops exactly once on clear", async () => {
    const root = await mountApp();
    const push = vi.spyOn(history, "pushState");
    const replace = vi.spyOn(history, "replaceState");
    const back = mockBack();

    click(qArc(root));                                       // select only —
    expect(push).not.toHaveBeenCalled();                     // selection is not focus
    click(qArc(root));                                       // re-tap → enter focus
    expect(push).toHaveBeenCalledTimes(1);
    // the focus hash rides on the FULL view URL (path + query), not a bare "#…"
    expect(push).toHaveBeenLastCalledWith({ f: "r.0.0" }, "", "/atp/2026/roland-garros#r.0.0");

    click(qArc(root));                                       // hub → out one level (still focused)
    expect(push).toHaveBeenCalledTimes(1);                   // a level CHANGE never adds an entry
    expect(replace).toHaveBeenLastCalledWith({ f: "r.0" }, "", "/atp/2026/roland-garros#r.0");

    click(root.querySelector<HTMLElement>('.crumb[data-id=""]')!); // ‹ Full draw
    expect(back).toHaveBeenCalledTimes(1);                   // gave our entry back…
    esc(); esc(); esc();                                     // unwind everything else
    expect(back).toHaveBeenCalledTimes(1);                   // …exactly once — nothing left to pop
  });

  it("re-entering focus after a clear PUSHES a fresh entry (ownsEntry reset on clear)", async () => {
    const root = await mountApp();
    const push = vi.spyOn(history, "pushState");
    mockBack();
    click(qArc(root)); click(qArc(root));                    // enter focus → push #1
    expect(push).toHaveBeenCalledTimes(1);
    click(root.querySelector<HTMLElement>('.crumb[data-id=""]')!); // clear focus (pin + selection survive)
    expect(root.querySelector(".crumbs")).toBeNull();
    click(qArc(root));                                       // selection survived → re-tap re-enters focus
    expect(root.querySelector(".crumbs")).not.toBeNull();
    expect(push).toHaveBeenCalledTimes(2);                   // a FRESH push, not a replace — ownsEntry was reset
  });

  it("a tour switch while focused pushes the un-zoomed view, leaving the zoomed entry behind", async () => {
    const root = await mountApp();
    const back = mockBack();
    click(qArc(root)); click(qArc(root));                    // focused
    expect(location.hash).toBe("#r.0.0");
    const push = vi.spyOn(history, "pushState");
    click(root.querySelector<HTMLElement>('[data-action="tour"][data-tour="ATP"]')!);
    expect(location.hash).toBe("");                          // exited zoom — the hash is gone…
    expect(push).toHaveBeenCalledTimes(1);                   // …via a NEW view entry (Back returns to the zoom)…
    expect(push).toHaveBeenLastCalledWith(null, "", "/atp/2026/roland-garros");
    expect(back).not.toHaveBeenCalled();                     // …never popped (no async back()/pushState race)
    expect(root.querySelector(".crumbs")).toBeNull();        // focus cleared with the old draw
  });

  it("a tour switch with NO focus owned does not touch history (back stays untouched)", async () => {
    const root = await mountApp();
    const back = mockBack();
    const push = vi.spyOn(history, "pushState");
    click(qArc(root));                                       // select only — never entered focus
    click(root.querySelector<HTMLElement>('[data-action="tour"][data-tour="ATP"]')!);
    expect(push).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();                     // nothing owned → no pop
  });

  it("popstate routes through setFocus + draw: Forward re-enters, Back exits, stale ids drop", async () => {
    const root = await mountApp();
    const push = vi.spyOn(history, "pushState");
    window.dispatchEvent(new PopStateEvent("popstate", { state: { f: "r.0" } })); // Forward into focus
    expect(root.querySelector(".crumb.cur")!.textContent).toBe("Top half");
    expect(push).not.toHaveBeenCalled();                     // adopt the entry, never re-push it
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));         // Back to base
    expect(root.querySelector(".crumbs")).toBeNull();        // focus exits in one step
    window.dispatchEvent(new PopStateEvent("popstate", { state: { f: "r.0.0.0.0" } })); // deeper than the draw
    expect(root.querySelector(".crumbs")).toBeNull();        // unresolvable id → no focus
  });
});

describe("startup history scrub (no deep-link restore — the URL must not lie)", () => {
  it("scrubs a pre-existing #focus hash/state so a later clear can never re-enter focus", async () => {
    // simulate reloading (or opening a shared link to) a focused URL
    history.replaceState({ f: "r.0.0" }, "", "/#r.0.0");
    const root = await mountApp();
    expect(location.hash).toBe("");                       // the URL no longer claims a focus…
    expect(history.state).toBeNull();                     // …and the entry carries no stale {f}
    expect(root.querySelector(".crumbs")).toBeNull();     // (deep-link restore is deliberately absent)

    // focus then clear with jsdom's REAL (async) history.back(): it lands on the scrubbed
    // entry, whose popstate must normalize to "no focus" — before the scrub, the stale
    // hash/{f} would have silently turned the clear into "zoom back to a stale section"
    click(qArc(root)); click(qArc(root));
    expect(location.hash).toBe("#r.0.0");
    click(root.querySelector<HTMLElement>('.crumb[data-id=""]')!);
    await vi.waitFor(() => { if (location.hash) throw new Error("entry not popped yet"); });
    expect(root.querySelector(".crumbs")).toBeNull();     // the clear stayed a clear
  });
});

describe("URL routing (shareable deep links)", () => {
  const url = () => location.pathname + location.search;
  const slamActive = (root: HTMLElement) =>
    root.querySelector<HTMLElement>('[data-action="slam"].slam.active')?.dataset.slam;

  it("cold-loads the full view from a deep URL (tour/slam + lens + sub) and canonicalizes it", async () => {
    history.replaceState(null, "", "/atp/2026/wimbledon?view=seed&sub=elo");
    const root = await mountApp();
    expect(slamActive(root)).toBe("wimbledon");                                   // path → slam
    expect(root.querySelector(".seed-panel")).not.toBeNull();                     // ?view=seed → seed lens
    expect(root.querySelector('[data-action="seed-sort"][data-sort="elo"].active')).not.toBeNull(); // &sub=elo
    expect(url()).toBe("/atp/2026/wimbledon?view=seed&sub=elo");                  // already canonical → unchanged
  });

  it("cold-loads '/' to the current tournament and canonicalizes the URL", async () => {
    history.replaceState(null, "", "/");
    const root = await mountApp();
    expect(slamActive(root)).toBe("roland-garros");                              // pickDefaultSlam (most-recent complete)
    expect(root.querySelector(".leaderboard")).not.toBeNull();                   // default lens (time)
    expect(url()).toBe("/atp/2026/roland-garros");                               // "/" rewritten to the concrete view
  });

  it("falls back to the default for a stale/invalid path and canonicalizes", async () => {
    history.replaceState(null, "", "/atp/1999/wimbledon?view=bogus"); // 1999 not in the manifest; bogus lens
    const root = await mountApp();
    expect(slamActive(root)).toBe("roland-garros");                              // unavailable year → default
    expect(url()).toBe("/atp/2026/roland-garros");                               // junk dropped on canonicalize
  });

  it("falls back to the other tour when the requested tour is absent from the manifest", async () => {
    history.replaceState(null, "", "/wta/2026/wimbledon"); // manifest is ATP-only → no WTA draw exists
    const root = await mountApp();
    expect(slamActive(root)).toBe("wimbledon");                                   // resolveRoute: WTA missing → same draw on ATP
    expect(url()).toBe("/atp/2026/wimbledon");                                    // canonicalized onto the real (ATP) draw
  });

  it("scrubs a cold-load focus hash but keeps the path + query view", async () => {
    history.replaceState({ f: "r.0.0" }, "", "/atp/2026/wimbledon?view=country#r.0.0");
    const root = await mountApp();
    expect(location.hash).toBe("");                                              // zoom is session-only → scrubbed
    expect(root.querySelector(".crumbs")).toBeNull();                            // …not restored into focus
    expect(slamActive(root)).toBe("wimbledon");                                  // …but the shared VIEW survives
    expect(root.querySelector(".country-panel")).not.toBeNull();
    expect(url()).toBe("/atp/2026/wimbledon?view=country");
  });

  it("a slam switch pushes a new canonical entry (Back undoes it)", async () => {
    const root = await mountApp();
    const push = vi.spyOn(history, "pushState");
    click(root.querySelector<HTMLElement>('[data-action="slam"][data-slam="wimbledon"]')!);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenLastCalledWith(null, "", "/atp/2026/wimbledon");
    expect(slamActive(root)).toBe("wimbledon");
  });

  it("a lens switch pushes ?view=… (Back undoes it)", async () => {
    const root = await mountApp();
    const push = vi.spyOn(history, "pushState");
    setLens(root, "seed");
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenLastCalledWith(null, "", "/atp/2026/roland-garros?view=seed");
  });

  it("re-selecting the active tour (no view change) adds no history entry", async () => {
    const root = await mountApp();
    const push = vi.spyOn(history, "pushState");
    click(root.querySelector<HTMLElement>('[data-action="tour"][data-tour="ATP"]')!);
    expect(push).not.toHaveBeenCalled();                                         // URL unchanged → no redundant entry
  });

  it("popstate restores the whole view from the URL (Back to a prior lens)", async () => {
    const root = await mountApp();
    setLens(root, "seed");                                                       // push ?view=seed
    expect(root.querySelector(".seed-panel")).not.toBeNull();
    // simulate the browser Back to the base entry: it moves location, then fires popstate
    history.replaceState(null, "", "/atp/2026/roland-garros");
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    expect(root.querySelector(".seed-panel")).toBeNull();                        // lens restored to the default…
    expect(root.querySelector(".leaderboard")).not.toBeNull();                   // …the time lens
  });

  it("popstate to a different slam swaps the draw (cached snapshot)", async () => {
    const root = await mountApp();
    click(root.querySelector<HTMLElement>('[data-action="slam"][data-slam="wimbledon"]')!); // now on wimbledon
    expect(slamActive(root)).toBe("wimbledon");
    history.replaceState(null, "", "/atp/2026/roland-garros");                   // Back to the original draw
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    expect(slamActive(root)).toBe("roland-garros");
  });

  it("a lens switch made WHILE zoomed survives exiting the zoom (no silent revert)", async () => {
    const root = await mountApp();                          // roland-garros, time lens
    mockBack();
    click(qArc(root)); click(qArc(root));                   // zoom into the quarter r.0.0
    setLens(root, "seed");                                  // recolour the zoomed view → seed (replace, keeps zoom)
    expect(root.querySelector(".seed-panel")).not.toBeNull();
    expect(root.querySelector(".crumbs")).not.toBeNull();   // still zoomed
    // exit the zoom via the "Full draw" crumb → setFocus(undefined) (replaceState scrub + back())
    click(root.querySelector<HTMLElement>('.crumb[data-id=""]')!);
    // the real browser now lands on the pre-zoom entry, whose URL still encodes the OLD time lens
    history.replaceState(null, "", "/atp/2026/roland-garros");
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    expect(root.querySelector(".crumbs")).toBeNull();        // zoom exited…
    expect(root.querySelector(".seed-panel")).not.toBeNull(); // …and the seed lens the user chose stuck
  });

  it("a lens click during the loading window is kept and writes no malformed /atp/0 URL", async () => {
    let release: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    globalThis.fetch = vi.fn(async (u: string | URL | Request) => {
      const s = String(u);
      if (s.includes("index.json")) { await gate; return { ok: true, status: 200, json: async () => INDEX } as Response; }
      const body = s.includes("roland-garros") || s.includes("wimbledon") ? SNAP : null;
      return { ok: body != null, status: body != null ? 200 : 404, json: async () => body } as Response;
    }) as typeof fetch;
    document.body.innerHTML = `<div id="app"></div>`;
    const root = document.getElementById("app")!;
    mounted.push(createApp(root));
    // loading state: the lens buttons render before the manifest resolves (year still 0)
    await vi.waitFor(() => { if (!root.querySelector('[data-action="colordim"][data-dim="seed"]')) throw new Error("controls not up"); });
    expect(root.querySelector(".sunburst path.arc")).toBeNull();   // still loading
    setLens(root, "seed");                                          // click a lens mid-load
    expect(location.pathname.startsWith("/atp/0")).toBe(false);     // no malformed /atp/0/ pushed
    release!();                                                     // let the manifest (then snapshot) resolve
    await vi.waitFor(() => { if (!root.querySelector(".sunburst path.arc")) throw new Error("bracket not up"); });
    expect(root.querySelector(".seed-panel")).not.toBeNull();      // the mid-load lens choice survived
  });
});

describe("ESC ladder (one layer per press, focus last)", () => {
  it("unwinds menu → detail tier → strip → drawer → pin → focus, in that order", async () => {
    const root = await mountApp();
    mockBack();
    click(qArc(root)); click(qArc(root));                                          // pin + strip + focus
    click(root.querySelector<HTMLElement>(".ms-more")!);                           // expand the detail tier
    click(root.querySelector<HTMLElement>(".panel-fab")!);                         // open the lens drawer
    click(root.querySelector<HTMLElement>('[data-action="toggle-menu"][data-menu="slam"]')!); // open a menu

    esc(); expect(root.querySelector(".dd-pop")).toBeNull();                       // 1: menu
    expect(root.querySelector(".mi-detail")).not.toBeNull();
    esc(); expect(root.querySelector(".mi-detail")).toBeNull();                    // 2: detail tier
    expect(root.querySelector(".match-strip")).not.toBeNull();
    esc(); expect(root.querySelector(".match-strip")).toBeNull();                  // 3: strip
    esc(); expect(root.querySelector(".leaderboard.open")).toBeNull();             // 4: drawer
    expect(litArcs(root).length).toBeGreaterThan(0);
    esc(); expect(litArcs(root).length).toBe(0);                                   // 5: pin
    expect(root.querySelector(".crumbs")).not.toBeNull();
    esc(); expect(root.querySelector(".crumbs")).toBeNull();                       // 6: focus — last resort
  });
});

describe("quarter-owner corner labels", () => {
  it("renders four tappable handles that focus their quarter; hidden entirely while focused", async () => {
    const root = await mountApp();
    mockBack();
    const labels = root.querySelectorAll<HTMLElement>(".sunburst .q-owner");
    expect(labels).toHaveLength(4);
    expect(labels[0].dataset.id).toBe("r.0.0");

    click(labels[0]);                                                  // tap = focus that quarter
    expect(root.querySelector(".crumbs")).not.toBeNull();
    expect(root.querySelector(".crumb.cur")!.textContent).toMatch(/'s quarter$/);
    expect(root.querySelector(".q-owner")).toBeNull();                 // corners vacate in focus mode
    esc();                                                             // focus is the only layer up
    expect(root.querySelectorAll(".q-owner")).toHaveLength(4);         // back with the full draw
  });

  it("focuses on the country lens too (labels aren't arcs — no nation-toggle override)", async () => {
    const root = await mountApp();
    mockBack();
    click(root.querySelector<HTMLElement>('[data-action="colordim"][data-dim="country"]')!);
    click(root.querySelector<HTMLElement>(".q-owner")!);
    expect(root.querySelector(".crumbs")).not.toBeNull();              // the tap navigated…
    expect(root.querySelector(".ct-row.on")).toBeNull();               // …it never selected a nation
  });

  it("keeps the lit player's own corner at full opacity (.q-hl) while dim-mode engages", async () => {
    const root = await mountApp();
    const label = [...root.querySelectorAll<HTMLElement>(".q-owner")].find((l) => l.dataset.occupant)!;
    const occ = label.dataset.occupant!;
    const arc = root.querySelector<HTMLElement>(`.sunburst path.arc[data-occupant="${occ}"]`)!;
    arc.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    expect(root.querySelector(".sunburst")!.classList.contains("arc-dim-mode")).toBe(true);
    expect(label.classList.contains("q-hl")).toBe(true);               // their corner never self-dims
    root.dispatchEvent(new Event("pointerleave"));
    expect(label.classList.contains("q-hl")).toBe(false);              // cleared with the highlight
  });

  it("exposes 4 sr-only keyboard twins — the svg is role=img, so its labels are presentational", async () => {
    const root = await mountApp();
    mockBack();
    const btns = root.querySelectorAll<HTMLElement>(".sunburst button.q-owner-btn");
    expect(btns).toHaveLength(4);
    expect(btns[0].dataset.id).toBe("r.0.0");
    click(btns[0]);                                                    // keyboard-reachable entry into focus
    expect(root.querySelector(".crumbs")).not.toBeNull();
    expect(root.querySelector(".q-owner-btn")).toBeNull();             // gone while focused, like the labels
  });
});

describe("centre pill while focused", () => {
  it("restores the pill naming the focused occupant (their on-arc hub label is dropped) and idles the card", async () => {
    const root = await mountApp();                                    // finished slam → decided focus occupant shows on every lens
    mockBack();
    click(qArc(root)); click(qArc(root));                             // focus the quarter
    const occ = qArc(root).dataset.occupant!;                         // focused hub's occupant
    const name = SNAP.players[occ].name.split(" ").slice(-1)[0];
    expect(root.querySelector(".center-id")!.textContent).toContain(name);  // pill restored in focus mode
    // the pill carries the name — the hub must not also label it on-arc (anchors.delete(focusId))
    expect([...root.querySelectorAll(".arc-label")].map((t) => t.textContent)).not.toContain(name);
    esc(); esc();                                                     // close strip, unpin (focus stays)
    expect(root.querySelector(".crumbs")).not.toBeNull();
    expect(root.querySelector(".center-id")).not.toBeNull();          // pill still names the occupant…
    expect(root.querySelector(".ro-float.ro-idle")).not.toBeNull();   // …so the idle card never doubles it
  });

  it("falls back to the section-title pill when the focused node has no occupant (all-TBD)", async () => {
    // an unplayed draw whose r.0.0 subtree is fully TBD: both round-0 entrants nulled
    const tbd = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 3, completedRounds: 0 });
    tbd.matches["0-0"].p1 = null;
    tbd.matches["0-0"].p2 = null;
    installFetchStub({ snap: () => tbd });
    const root = await mountApp();
    setLens(root, "seed");                                               // the all-TBD section-title fallback is Seed-only
    click(root.querySelector<HTMLElement>('.q-owner[data-id="r.0.0"]')!); // caption-only, still tappable
    const pill = root.querySelector(".center-id.center-sec")!;
    expect(pill).not.toBeNull();
    expect(pill.textContent).toBe("QF section");                      // sectionTitle's round fallback
    // …but the section-title fallback (no occupant) is Seed-only — Time/Country keep a clean centre
    for (const dim of ["time", "country"]) {
      setLens(root, dim);
      expect(root.querySelector(".center-id"), `section pill hidden on ${dim}`).toBeNull();
    }
  });

  it("shows a DECIDED focused occupant's pill on all three lenses (finished slam)", async () => {
    const root = await mountApp();                                    // default SNAP fully played → focus occupant decided
    mockBack();
    click(qArc(root)); click(qArc(root));                             // focus the quarter
    const name = SNAP.players[qArc(root).dataset.occupant!].name.split(" ").slice(-1)[0];
    for (const dim of ["time", "seed", "country"]) {
      setLens(root, dim);
      const pill = root.querySelector(".center-id");
      expect(pill, `pill on ${dim}`).not.toBeNull();
      expect(pill!.classList.contains("projected"), `decided on ${dim}`).toBe(false);
      expect(pill!.textContent, `name on ${dim}`).toContain(name);
    }
  });

  it("names the SECTION — not a projected favourite — when a focused occupant is undecided (Seed only)", async () => {
    // nothing played → the focused quarter (r.0.0) has a projected-favourite occupant, not a decided
    // one. Predictions are gone from the pill: Seed falls back to the section title instead.
    const live = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 3, completedRounds: 0 });
    installFetchStub({ snap: () => live });
    const root = await mountApp();
    mockBack();
    click(qArc(root)); click(qArc(root));                            // focus the unplayed (projected) quarter
    setLens(root, "seed");
    expect(root.querySelector(".center-id.projected")).toBeNull();     // no predicted player, ever
    const pill = root.querySelector(".center-id.center-sec");
    expect(pill).not.toBeNull();                                       // section title instead
    expect(pill!.textContent!.trim()).not.toBe("");
    for (const dim of ["time", "country"]) {
      setLens(root, dim);
      expect(root.querySelector(".center-id"), `centre stays clean on ${dim}`).toBeNull();
    }
  });
});

describe("quarter-focus keyboard handles (sr-only twin → visible focus surrogate)", () => {
  it("mirrors sr-only button focus onto the matching SVG corner handle (.q-focus)", async () => {
    const root = await mountApp();
    // the SVG corner is role=img/presentational; the sr-only <button> is the keyboard entry —
    // and its 1px-clipped ring is invisible, so focusing it must light the matching corner
    const btn = root.querySelector<HTMLElement>('.q-owner-btn[data-id="r.0.0"]')!;
    const corner = () => root.querySelector('.q-owner[data-id="r.0.0"]')!;
    expect(btn).not.toBeNull();
    expect(corner().classList.contains("q-focus")).toBe(false);
    btn.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(corner().classList.contains("q-focus")).toBe(true);        // lit on focus…
    btn.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    expect(corner().classList.contains("q-focus")).toBe(false);       // …cleared on blur
  });
});

describe("Help modal (sourced from docs/HELP.md)", () => {
  // The overlay lives in its own host appended to <body> (OUTSIDE #app), so a background redraw
  // can never wipe its scroll/accordion/focus; it is code-split, so opening is async (awaited
  // below via vi.waitFor). Closing is synchronous.
  const sheet = () => document.querySelector<HTMLElement>(".help-sheet");
  const awaitOpen = () => vi.waitFor(() => { if (!sheet()) throw new Error("help sheet not mounted yet"); });

  it("the header ? button opens the dialog; ✕, scrim and Escape each close it", async () => {
    const root = await mountApp();
    const helpBtn = () => root.querySelector<HTMLElement>('.ctrl.help[data-action="toggle-help"]')!;
    expect(helpBtn()).not.toBeNull();
    expect(helpBtn().getAttribute("aria-expanded")).toBe("false"); // trigger reflects closed state at boot
    expect(sheet()).toBeNull();                                    // closed at boot

    click(helpBtn());                                              // open (lazy-loads the help chunk)
    await awaitOpen();
    expect(document.querySelector('.help-sheet[role="dialog"]')).not.toBeNull();
    expect(document.querySelector(".help-sec[open]")).not.toBeNull(); // first section expanded
    expect(helpBtn().getAttribute("aria-expanded")).toBe("true");  // …and the trigger now reads expanded
    expect(root.hasAttribute("inert")).toBe(true);                 // background is inert while the dialog is up

    click(document.querySelector<HTMLElement>(".help-close")!);    // ✕ closes (synchronous)
    expect(sheet()).toBeNull();
    expect(helpBtn().getAttribute("aria-expanded")).toBe("false");
    expect(root.hasAttribute("inert")).toBe(false);                // …and the background is interactive again

    click(helpBtn());                                              // reopen, then scrim-tap closes
    await awaitOpen();
    click(document.querySelector<HTMLElement>(".help-scrim")!);
    expect(sheet()).toBeNull();

    click(helpBtn());                                              // reopen, then Escape closes (top rung)
    await awaitOpen();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(sheet()).toBeNull();
  });

  it("moves focus into the dialog, traps Tab at both ends, and returns focus on close", async () => {
    const root = await mountApp();
    const helpBtn = () => root.querySelector<HTMLElement>('.ctrl.help[data-action="toggle-help"]')!;

    click(helpBtn());
    await awaitOpen();
    const sheetEl = sheet()!;
    expect(document.activeElement).toBe(sheetEl);                 // focus moves into the dialog on open

    // Expand every section so its links join the tab order — jsdom focuses <button>/<a href>
    // reliably, so we assert wrap against those boundaries (the trap also counts <summary>).
    const host = sheetEl.parentElement!;                          // helpHost (sibling of #app, under <body>)
    host.querySelectorAll<HTMLDetailsElement>(".help-sec").forEach((d) => (d.open = true));
    const stops = [...host.querySelectorAll<HTMLElement>('button:not([disabled]), summary, a[href]')]
      .filter((el) => { const d = el.closest("details"); return !d || (d as HTMLDetailsElement).open || el.tagName === "SUMMARY"; });
    const first = stops[0], last = stops[stops.length - 1];
    expect(first.classList.contains("help-close")).toBe(true);    // the ✕ is the first stop
    expect(last.tagName).toBe("A");                               // a credit link is the last stop (sections open)

    const tab = (el: Element, shiftKey = false) => {
      const e = new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true });
      el.dispatchEvent(e);
      return e;
    };
    last.focus();
    expect(tab(last).defaultPrevented).toBe(true);                // forward Tab off the last stop…
    expect(document.activeElement).toBe(first);                   // …wraps to the first
    first.focus();
    expect(tab(first, true).defaultPrevented).toBe(true);         // shift+Tab off the first…
    expect(document.activeElement).toBe(last);                    // …wraps to the last

    click(host.querySelector<HTMLElement>(".help-close")!);
    expect(sheet()).toBeNull();
    expect(document.activeElement).toBe(helpBtn());               // focus returns to the trigger on close
  });

  it("dismisses an open top-bar dropdown when Help opens (no stale menu behind the inert modal)", async () => {
    const root = await mountApp();
    const helpBtn = () => root.querySelector<HTMLElement>('.ctrl.help[data-action="toggle-help"]')!;
    const slamTrig = root.querySelector<HTMLElement>('[data-action="toggle-menu"][data-menu="slam"]')!;

    click(slamTrig);
    expect(root.querySelector(".dd-pop")).not.toBeNull();         // the slam menu is open…

    click(helpBtn());                                             // …and opening Help must clear it
    await awaitOpen();
    // The teeth: revert the openMenu-clear in setHelp and this line fails — the .dd-pop is left
    // rendered (root isn't redrawn) behind the now-inert background.
    expect(root.querySelector(".dd-pop")).toBeNull();             // dropdown gone, not stranded behind the modal
    expect(root.hasAttribute("inert")).toBe(true);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); // Escape closes Help (no second rung needed)
    expect(sheet()).toBeNull();
  });
});

describe("load failure", () => {
  it("shows an error with Retry when nothing can be fetched, and recovers on retry", async () => {
    // every fetch fails → the bootstrap can get neither manifest nor snapshot
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => null } as Response)) as typeof fetch;
    document.body.innerHTML = `<div id="app"></div>`;
    const root = document.getElementById("app")!;
    mounted.push(createApp(root));
    await vi.waitFor(() => {
      if (!root.querySelector(".load-error")) throw new Error("error state not rendered yet");
    }, { timeout: 2000 });
    expect(root.querySelector('.load-error [data-action="retry"]')).toBeTruthy();

    // the network comes back → Retry re-runs the bootstrap and renders the bracket
    installFetchStub();
    click(root.querySelector('[data-action="retry"]')!);
    await vi.waitFor(() => {
      if (!root.querySelector(".sunburst path.arc")) throw new Error("bracket not rendered yet");
    }, { timeout: 2000 });
    expect(root.querySelector(".load-error")).toBeNull();
  });
});

describe("live polling", () => {
  // Fake-timer base pinned to noon UTC: seeding from real-now would let the app's midnight
  // timer land inside an advanced window when the suite runs within ~91s of 00:00 UTC, swapping
  // the DOM mid-assertion — a daily flake window.
  const NOON = new Date("2026-06-15T12:00:00.000Z");

  it("refetches the live slam every 90s and redraws only when generatedAt changes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: NOON });
    let served: unknown = SNAP;
    const snapCalls = installFetchStub({ index: () => LIVE_INDEX, snap: () => served });
    const root = await mountApp();
    const before = snapCalls();

    // unchanged data: the tick fetches but must not rebuild the DOM
    const marker = root.querySelector(".chart")!;
    await vi.advanceTimersByTimeAsync(90_000);
    expect(snapCalls()).toBeGreaterThan(before);
    expect(root.querySelector(".chart")).toBe(marker); // same node → no innerHTML swap

    // changed data: the next tick redraws
    served = { ...SNAP, generatedAt: new Date(Date.now() + 60_000).toISOString() };
    await vi.advanceTimersByTimeAsync(90_000);
    await vi.waitFor(() => {
      if (root.querySelector(".chart") === marker) throw new Error("not redrawn yet");
    }, { timeout: 2000 });
  });

  it("does not poll while the tab is hidden", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: NOON });
    const snapCalls = installFetchStub({ index: () => LIVE_INDEX });
    await mountApp();
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    const before = snapCalls();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(snapCalls()).toBe(before);
  });

  it("refetches on tab return after the throttle window, not on a quick flip", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: NOON });
    const snapCalls = installFetchStub({ index: () => LIVE_INDEX });
    await mountApp();
    const before = snapCalls();
    const flip = () => {
      Object.defineProperty(document, "hidden", { value: true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "hidden", { value: false, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    };

    // quick flip right after the mount-time fetch: throttled, no refetch
    flip();
    await vi.advanceTimersByTimeAsync(50); // drain the handler's async gate
    expect(snapCalls()).toBe(before);

    // return after half a poll interval (but before the 90s tick): the handler refetches
    await vi.advanceTimersByTimeAsync(46_000);
    flip();
    await vi.waitFor(() => {
      if (snapCalls() <= before) throw new Error("no refetch on tab return yet");
    }, { timeout: 2000 });
  });
});

describe("live score overlay (/api/live)", () => {
  const NOON2 = new Date("2026-06-15T12:00:00.000Z");
  // a real synthetic match with two known players → build a matching Flashscore record. The
  // fixture names them "Player N" — nameTokens() strips the trailing digit, so EVERY player
  // collapses to the same surname-pair key ("player:p") and the join always calls it ambiguous.
  // Give this one match's pair real names (only in this describe's snapshot) so the join is
  // deterministic without touching the shared SNAP used by every other test in this file.
  const M = Object.values(SNAP.matches).find((x) => x.p1 && x.p2)!;
  const LIVE_SNAP: Snapshot = {
    ...SNAP,
    players: {
      ...SNAP.players,
      [M.p1!]: { ...SNAP.players[M.p1!], name: "Novak Djokovic" },
      [M.p2!]: { ...SNAP.players[M.p2!], name: "Rafael Nadal" },
    },
  };
  const baseRecord = {
    id: "fs1", stage: 2 as const,
    home: short(LIVE_SNAP.players[M.p1!].name), away: short(LIVE_SNAP.players[M.p2!].name),
    setsWon: [1, 0] as [number, number], sets: [[6, 4]] as Array<[number, number]>,
  };

  function installLiveNet(record: () => unknown): () => number {
    let liveCalls = 0;
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/api/live")) { liveCalls++; return { ok: true, json: async () => ({ matches: [record()] }) } as Response; }
      const body = u.includes("index.json") ? LIVE_INDEX : (u.includes("roland-garros") || u.includes("wimbledon")) ? LIVE_SNAP : null;
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
    installFetchStub(); // standard (non-live) network → the view is "complete", so the live gate stays shut
    await mountApp();
    await vi.advanceTimersByTimeAsync(30_000);
    const polledLive = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.some(([u]) => String(u).includes("/api/live"));
    expect(polledLive).toBe(false);
  });

  describe("point-by-point (/api/pbp)", () => {
    /** installLiveNet + an /api/pbp route. `game` is re-read per request; `pbpOk` can kill the route. */
    function installPbpNet(record: () => unknown, game: () => unknown, pbpOk: () => boolean = () => true) {
      const liveCalls = installLiveNet(record);
      const base = globalThis.fetch;
      let pbpCalls = 0;
      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const u = String(url);
        if (u.includes("/api/pbp")) {
          pbpCalls++;
          return { ok: pbpOk(), status: pbpOk() ? 200 : 500, json: async () => game() } as Response;
        }
        return base(url);
      }) as unknown as typeof fetch;
      const counter = (() => pbpCalls) as (() => number) & { live: () => number };
      counter.live = liveCalls;
      return counter;
    }
    const liveArc = (root: HTMLElement) => root.querySelector<HTMLElement>(`path.arc[data-match="${M.id}"]`)!;
    const ptsText = (root: HTMLElement) =>
      [...root.querySelectorAll<HTMLElement>(".ms-game .ms-pts")].map((el) => el.textContent);

    it("kicks an immediate games refetch when the points reset at a game boundary", async () => {
      // The points path (8s) sees a game end (pair resets to 0-0) long before the games path
      // (15s tick + 10s cache) — without the kick the strip shows OLD games beside NEW 0-0 points.
      vi.useFakeTimers({ shouldAdvanceTime: true, now: NOON2 });
      let game: unknown = { home: "0", away: "40" };
      const pbpCalls = installPbpNet(() => ({ ...baseRecord, srv: 1 }), () => game);
      const root = await mountApp();
      await vi.advanceTimersByTimeAsync(50);
      click(liveArc(root));
      await vi.waitFor(() => { if (ptsText(root)[1] !== "40") throw new Error("points not applied"); });
      const before = pbpCalls.live();
      game = { home: "0", away: "0" };           // game over -> points reset
      await vi.advanceTimersByTimeAsync(8_100);  // one pbp tick, still inside the 15s live tick
      expect(pbpCalls.live()).toBeGreaterThan(before);
    });

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

    it("re-tapping the already-selected live arc does not fire an extra immediate /api/pbp call", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true, now: NOON2 });
      const pbpCalls = installPbpNet(() => ({ ...baseRecord, srv: 1 }), () => ({ home: "30", away: "15" }));
      const root = await mountApp();
      await vi.advanceTimersByTimeAsync(50);
      click(liveArc(root));
      await vi.waitFor(() => { if (pbpCalls() === 0) throw new Error("no immediate pbp kick"); });
      const before = pbpCalls();
      // re-tap the same arc: selectedMatchId is unchanged (this taps the tap-again-to-zoom branch),
      // so it must not force another out-of-cadence fetch — the 8s tick still covers it.
      click(liveArc(root));
      await vi.advanceTimersByTimeAsync(50);
      expect(pbpCalls()).toBe(before);
    });

    it("shows the chip when the point is a set point, with side attribution and an accessible name", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true, now: NOON2 });
      // an actually-IN-PROGRESS set (baseRecord's 6-4 is decided → the stale-context guard
      // suppresses chips): at 5-4 p1's 40-30 wins the set 6-4 ⇒ SP for p1 (0 completed sets)
      installPbpNet(() => ({ ...baseRecord, setsWon: [0, 0], sets: [[5, 4]], srv: 1 }), () => ({ home: "40", away: "30" }));
      const root = await mountApp();
      await vi.advanceTimersByTimeAsync(50);
      click(liveArc(root));
      await vi.waitFor(() => {
        const chip = root.querySelector<HTMLElement>(".ms-chip");
        if (!chip || chip.hidden || chip.textContent !== "SP") throw new Error("no SP chip");
      });
      const chip = root.querySelector<HTMLElement>(".ms-chip")!;
      expect(chip.dataset.for).toBe("p1");
      expect(chip.getAttribute("aria-label")).toBe("set point");
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

    it("ignores an out-of-order /api/pbp response (an older request resolving after a newer one)", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true, now: NOON2 });
      installLiveNet(() => ({ ...baseRecord, srv: 1 }));
      const base = globalThis.fetch;
      // /api/pbp requests hang until the test resolves them explicitly, in any order
      const pending: Array<(g: unknown) => void> = [];
      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const u = String(url);
        if (u.includes("/api/pbp")) {
          return new Promise<Response>((resolve) => {
            pending.push((g) => resolve({ ok: true, status: 200, json: async () => g } as Response));
          });
        }
        return base(url);
      }) as unknown as typeof fetch;
      const root = await mountApp();
      await vi.advanceTimersByTimeAsync(50);
      click(liveArc(root));                                     // request #1 (immediate kick) — left hanging
      await vi.waitFor(() => { if (pending.length === 0) throw new Error("no immediate pbp kick"); });
      await vi.advanceTimersByTimeAsync(8_000);                 // request #2 (8s tick) — also hanging
      await vi.waitFor(() => { if (pending.length < 2) throw new Error("no second pbp request"); });
      pending[1]({ home: "40", away: "0" });                    // newer response lands first
      await vi.waitFor(() => { if (ptsText(root)[0] !== "40") throw new Error("newer points not applied"); });
      pending[0]({ home: "30", away: "15" });                   // then the stale one straggles in
      await vi.advanceTimersByTimeAsync(50);
      expect(ptsText(root)).toEqual(["40", "0"]);               // the stale response must not regress the display
    });

    it("re-renders placeholders (not minutes-old points) when the last pbp value outlives the live-poll cycle", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true, now: NOON2 });
      let ok = true;
      let served: unknown = { ...baseRecord, setsWon: [0, 0], sets: [[5, 4]], srv: 1 };
      const pbpCalls = installPbpNet(() => served, () => ({ home: "30", away: "15" }), () => ok);
      const root = await mountApp();
      await vi.advanceTimersByTimeAsync(50);
      click(liveArc(root));
      await vi.waitFor(() => { if (ptsText(root)[0] !== "30") throw new Error("points not applied"); });
      const before = pbpCalls();
      ok = false;                                               // upstream pbp dies for good
      await vi.advanceTimersByTimeAsync(32_000);                // ticks keep failing → lastPbp ages past 30s
      expect(pbpCalls()).toBeGreaterThan(before);
      served = { ...baseRecord, setsWon: [0, 0], sets: [[5, 5]], srv: 1 }; // overlay change → next 30s live tick redraws
      await vi.advanceTimersByTimeAsync(30_000);
      await vi.waitFor(() => { if (ptsText(root)[0] !== "–") throw new Error("stale points still shown"); });
      expect(ptsText(root)).toEqual(["–", "–"]);                // placeholders are more honest than minutes-old points
    });
  });
});

describe("freshness chip", () => {
  it("refetches the current snapshot when clicked", async () => {
    const snapCalls = installFetchStub(); // fresh counter over the standard network
    const root = await mountApp();
    const before = snapCalls();
    click(root.querySelector('[data-action="refresh"]')!);
    await vi.waitFor(() => {
      if (snapCalls() <= before) throw new Error("no refetch yet");
    }, { timeout: 2000 });
    await vi.waitFor(() => {
      if (!root.querySelector('[data-action="refresh"]')) throw new Error("chip missing after redraw");
    }, { timeout: 2000 });
  });
});
