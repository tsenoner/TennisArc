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
  vi.restoreAllMocks();                     // history spies must never leak across tests
  history.replaceState(null, "", "/");      // …nor a focus hash a test pushed
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
    expect(push).toHaveBeenLastCalledWith({ f: "r.0.0" }, "", "#r.0.0");

    click(qArc(root));                                       // hub → out one level (still focused)
    expect(push).toHaveBeenCalledTimes(1);                   // a level CHANGE never adds an entry
    expect(replace).toHaveBeenLastCalledWith({ f: "r.0" }, "", "#r.0");

    click(root.querySelector<HTMLElement>('.crumb[data-id=""]')!); // ‹ Full draw
    expect(back).toHaveBeenCalledTimes(1);                   // gave our entry back…
    esc(); esc(); esc();                                     // unwind everything else
    expect(back).toHaveBeenCalledTimes(1);                   // …exactly once — nothing left to pop
  });

  it("a tour switch scrubs the hash in place — no new entry, no back()", async () => {
    const root = await mountApp();
    const back = mockBack();
    click(qArc(root)); click(qArc(root));                    // focused
    expect(location.hash).toBe("#r.0.0");
    const push = vi.spyOn(history, "pushState");
    click(root.querySelector<HTMLElement>('[data-action="tour"][data-tour="ATP"]')!);
    expect(location.hash).toBe("");                          // scrubbed via replaceState
    expect(push).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
    expect(root.querySelector(".crumbs")).toBeNull();        // focus cleared with the old draw
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
});

// ---- two-finger pinch/pan magnifier helpers ----
// jsdom has no getScreenCTM, so the app's svgPt falls back to raw clientX/Y — the
// coordinates below ARE viewBox units. Up/cancel land on window, like real releases.
function pointer(el: EventTarget, type: string, id: number, x: number, y: number): void {
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: id, clientX: x, clientY: y }));
}
/** A horizontal two-finger spread on the chart: exact ×2 about the midpoint (350,350) →
 *  view {k:2, x:−300, y:−350}, then both fingers released. */
function pinchSpread(root: HTMLElement): void {
  const svg = root.querySelector(".sunburst svg")!;
  pointer(svg, "pointerdown", 1, 300, 350);
  pointer(svg, "pointerdown", 2, 400, 350);
  pointer(svg, "pointermove", 2, 500, 350);
  pointer(window, "pointerup", 2, 500, 350);
  pointer(window, "pointerup", 1, 300, 350);
}
/** A realistic tap: pointerdown precedes click (as on-device), so a previous pinch's
 *  sticky click-suppression flag is disarmed exactly as it would be in a browser. */
function tap(el: Element): void {
  pointer(el, "pointerdown", 9, 10, 10);
  pointer(window, "pointerup", 9, 10, 10);
  click(el);
}
const zoomLayer = (root: HTMLElement) => root.querySelector(".zoom-layer")!;
const isZoomed = (root: HTMLElement) => root.querySelector(".sunburst")!.classList.contains("zoomed");

describe("two-finger pinch/pan magnifier", () => {
  it("a two-pointer spread writes an SVG attribute transform on .zoom-layer and flags .sunburst.zoomed", async () => {
    const root = await mountApp();
    expect(zoomLayer(root).getAttribute("transform")).toBe("translate(0,0) scale(1)"); // identity baseline
    const svg = root.querySelector(".sunburst svg")!;
    pointer(svg, "pointerdown", 1, 300, 350);
    pointer(svg, "pointerdown", 2, 400, 350);
    pointer(svg, "pointermove", 2, 500, 350);          // spread ×2 about (350,350)…
    expect(zoomLayer(root).getAttribute("transform")).toBe("translate(-300,-350) scale(2)");
    expect(isZoomed(root)).toBe(true);                 // …which shows the phone reset chip
    pointer(window, "pointerup", 2, 500, 350);
    pointer(window, "pointerup", 1, 300, 350);
    expect(zoomLayer(root).getAttribute("transform")).toBe("translate(-300,-350) scale(2)"); // sticky after release
  });

  it("suppresses the gesture's synthetic click — even a sub-threshold pinch never pins/inspects", async () => {
    const root = await mountApp();
    const arc = pickArc(root);
    // two fingers down and straight up (no travel): the browser still synthesizes a click
    // on the first finger's arc — the SECOND pointerdown alone must arm the suppression
    pointer(arc, "pointerdown", 1, 300, 350);
    pointer(arc, "pointerdown", 2, 400, 350);
    pointer(window, "pointerup", 2, 400, 350);
    pointer(window, "pointerup", 1, 300, 350);
    click(arc);
    expect(root.querySelector(".match-strip")).toBeNull();        // not inspected
    expect(litArcs(root).length).toBe(0);                         // not pinned
    tap(arc);                                                     // the NEXT real tap disarms + lands
    expect(root.querySelector(".match-strip")).not.toBeNull();
  });

  it("a geometry change (focus) resets the view; selection redraws (pin) re-apply it instead", async () => {
    const root = await mountApp();
    pinchSpread(root);
    expect(zoomLayer(root).getAttribute("transform")).toBe("translate(-300,-350) scale(2)");
    // pinning is selection, not geometry: the redraw keeps the magnifier on the fresh layer
    tap(root.querySelector<HTMLElement>(".leaderboard [data-hl-path][data-occupant]")!);
    expect(litArcs(root).length).toBeGreaterThan(0);
    expect(zoomLayer(root).getAttribute("transform")).toBe("translate(-300,-350) scale(2)");
    expect(isZoomed(root)).toBe(true);
    // focusing a quarter IS a geometry change — the view snaps back to identity
    tap(root.querySelector<HTMLElement>(".q-owner")!);
    expect(root.querySelector(".crumbs")).not.toBeNull();
    expect(zoomLayer(root).getAttribute("transform")).toBe("translate(0,0) scale(1)");
    expect(isZoomed(root)).toBe(false);
  });

  it("the hub nuclear reset drops the magnifier even when focus was already clear", async () => {
    const root = await mountApp();
    pinchSpread(root);
    expect(isZoomed(root)).toBe(true);
    tap(root.querySelector('.sunburst g[data-action="reset"]')!); // hub/gap tap: reset everything
    expect(zoomLayer(root).getAttribute("transform")).toBe("translate(0,0) scale(1)");
    expect(isZoomed(root)).toBe(false);
  });

  it("ESC clears the pinch zoom one rung above focus: strip → pin → zoom → focus", async () => {
    const root = await mountApp();
    mockBack();
    click(qArc(root)); click(qArc(root));         // select then focus (pin + strip + crumbs)
    pinchSpread(root);                            // magnify AFTER focusing (focus would reset it)
    expect(isZoomed(root)).toBe(true);

    esc(); expect(root.querySelector(".match-strip")).toBeNull(); // 1: strip
    expect(isZoomed(root)).toBe(true);                            // (redraw re-applied the view)
    esc(); expect(litArcs(root).length).toBe(0);                  // 2: pin
    expect(isZoomed(root)).toBe(true);
    esc(); expect(isZoomed(root)).toBe(false);                    // 3: pinch zoom
    expect(root.querySelector(".crumbs")).not.toBeNull();         //    focus survives that rung
    esc(); expect(root.querySelector(".crumbs")).toBeNull();      // 4: focus — still last
  });

  it("defers a mid-gesture draw and flushes it when the gesture ends", async () => {
    const root = await mountApp();
    tap(root.querySelector<HTMLElement>(".leaderboard [data-hl-path][data-occupant]")!); // pin someone
    expect(litArcs(root).length).toBeGreaterThan(0);
    const svg = root.querySelector(".sunburst svg")!;
    pointer(svg, "pointerdown", 1, 300, 350);
    pointer(svg, "pointerdown", 2, 400, 350);     // gesture in progress
    esc();                                        // clears the pin → draw() — which must WAIT
    expect(litArcs(root).length).toBeGreaterThan(0); // DOM untouched mid-gesture (no innerHTML swap)
    pointer(window, "pointerup", 2, 400, 350);    // gesture ends → the deferred draw flushes
    expect(litArcs(root).length).toBe(0);
    expect(pinnedRows(root).length).toBe(0);
    pointer(window, "pointerup", 1, 300, 350);
  });
});

describe("centre pill while focused", () => {
  it("restores the pill naming the focused occupant (their on-arc hub label is dropped) and idles the card", async () => {
    const root = await mountApp();
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
});
