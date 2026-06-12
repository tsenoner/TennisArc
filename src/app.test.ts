// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeSyntheticSnapshot } from "./fixtures/synthetic";
import type { SlamIndex } from "./model";

// In-memory store so the bootstrap never touches IndexedDB (absent in jsdom).
vi.mock("./store", () => ({
  createStore: async () => {
    let index: SlamIndex | null = null;
    const snaps = new Map<string, unknown>();
    return {
      getSnapshot: async (t: string, y: number, s: string) => snaps.get(`${t}:${y}:${s}`) ?? null,
      setSnapshot: async (t: string, y: number, s: string, v: unknown) => { snaps.set(`${t}:${y}:${s}`, v); },
      getIndex: async () => index,
      setIndex: async (i: SlamIndex) => { index = i; },
    };
  },
}));

import { createApp } from "./app";

const SNAP = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 3 });
// the single ATP slam the synthetic snapshot describes, so the bootstrap selects it
const INDEX: SlamIndex = {
  schemaVersion: 1,
  generatedAt: "2026-06-07T00:00:00.000Z",
  slams: [{
    tour: "ATP", year: 2026, slam: "roland-garros", name: "Roland Garros",
    surface: "Clay", status: "complete", generatedAt: "2026-06-07T00:00:00.000Z", drawSize: 8,
  }],
};

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
  globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    const body = u.includes("index.json") ? INDEX : u.includes("roland-garros") ? SNAP : null;
    return { ok: body != null, status: body != null ? 200 : 404, json: async () => body } as Response;
  }) as typeof fetch;
});

// Dispose every app mounted during a test (createApp returns a disposer that detaches its
// window/document/root listeners), so no handler leaks across mounts; then reset shared globals.
const mounted: Array<() => void> = [];
afterEach(() => {
  for (const dispose of mounted) dispose();
  mounted.length = 0;
  document.body.innerHTML = "";
  delete document.documentElement.dataset.theme;
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
  it("keeps naming the finalist in the centre while another player is pinned", async () => {
    const root = await mountApp();
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

  it("keeps the focused section's occupant named (the pill is dropped while zoomed)", async () => {
    const root = await mountApp();
    click(pickArc(root));                                              // pin + open the match strip
    click(root.querySelector<HTMLElement>('[data-action="focus"]')!);  // ⊕ Zoom to that section
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); // close the strip
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); // unpin
    expect(root.querySelector(".center-id")).toBeNull();        // pill dropped while zoomed
    expect(root.querySelector(".ro-float.ro-idle")).toBeNull(); // card stays, naming the occupant
  });
});
