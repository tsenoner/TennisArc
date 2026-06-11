import { buildSunburst, timeOnCourt, timeLeaderboard, labelAnchors, surfaceElo, seedProgress, countryBreakdown, matchInsight, ageOn, birthdayInWindow, formatBirthday, type PlayerTime, type SeedSort } from "./state";
import { layout } from "./layout";
import { colorScale, type ColorDim } from "./color";
import {
  renderSunburst, renderControls, renderLegend, renderLeaderboard, renderReadout,
  renderSeedPanel, renderCountryPanel, renderMatchInsight, roundAbbrev, renderPanelFab, type ReadoutInfo,
} from "./render";
import { flagEmoji, flagAssetUrl } from "./flags";
import { loadTheme, saveTheme, applyTheme, nextTheme, type Theme } from "./theme";
import { createStore, type Store } from "./store";
import { fetchSnapshot, fetchIndex } from "./api";
import { pickDefaultSlam, availableYears, slamsForYear } from "./slams";
import type { Player, SlamIndex, Snapshot, Tour } from "./model";
import { sofascoreMatchUrl } from "./deeplink";

const SIZE = 700;
const snapKey = (tour: Tour, year: number, slam: string) => `${tour}:${year}:${slam}`;

interface AppState {
  tour: Tour;
  year: number;
  slam: string;
  index: SlamIndex | undefined;
  snapshots: Record<string, Snapshot>;
  colorDim: ColorDim;
  seedSort: SeedSort;
  focusId: string | undefined;
  selectedMatchId: string | undefined;
  selectedNodeId: string | undefined;
  selectedCountry: string | undefined;
  theme: Theme;
  openMenu: "slam" | "lens" | undefined;
  panelOpen: boolean;
}

function staleLabel(generatedAt: string | undefined, nowMs: number): string {
  if (!generatedAt) return "";
  const ageMin = Math.round((nowMs - Date.parse(generatedAt)) / 60000);
  if (!Number.isFinite(ageMin) || ageMin < 0) return "";
  if (ageMin < 1) return "updated just now";
  if (ageMin < 60) return `updated ${ageMin} min ago`;
  return `updated ${Math.round(ageMin / 60)}h ago`;
}

export function createApp(root: HTMLElement): void {
  const theme = loadTheme();
  applyTheme(theme);
  const state: AppState = {
    tour: "ATP", year: 0, slam: "", index: undefined, snapshots: {},
    colorDim: "time", seedSort: "seed", focusId: undefined, selectedMatchId: undefined, selectedNodeId: undefined, selectedCountry: undefined, theme,
    openMenu: undefined, panelOpen: false,
  };
  let store: Store | undefined;

  // Updated each draw so the (frequent) hover handler can build a readout without a full re-render.
  let ctx: { snap: Snapshot; time: Map<string, PlayerTime>; defaultId: string | null; champId: string | null; champProjected: boolean } | undefined;

  const surname = (name: string) => name.split(" ").slice(-1)[0] || name;

  const buildReadout = (
    snap: Snapshot, time: Map<string, PlayerTime>, playerId: string | null,
    champId: string | null, champProjected: boolean,
  ): ReadoutInfo | null => {
    if (!playerId) return null;
    const p: Player | undefined = snap.players[playerId];
    if (!p) return null;
    const t = time.get(playerId);
    const elo = surfaceElo(p, snap.tournament.surface);
    const reached = t?.roundReached ?? 0;
    const isChamp = playerId === champId && snap.rounds.length > 0;
    const roundLabel = isChamp
      ? (champProjected ? "title contender" : "champion")
      : (snap.rounds[reached]?.name ?? "");
    return {
      name: p.name, country: p.country, ranking: p.ranking, seed: p.seed,
      eloLabel: elo != null ? `${snap.tournament.surface} ELO ${Math.round(elo)}` : "",
      roundLabel, sec: t?.sec ?? 0, provisional: t?.provisional ?? false,
      projected: isChamp && champProjected,
      age: ageOn(p.birthdate, snap.generatedAt),
      birthday: formatBirthday(p.birthdate),
      birthdayNear: birthdayInWindow(p.birthdate, snap.generatedAt),
    };
  };

  const updateReadout = (playerId: string | null) => {
    if (!ctx) return;
    const el = root.querySelector(".readout");
    if (!el) return;
    const info = buildReadout(ctx.snap, ctx.time, playerId ?? ctx.defaultId, ctx.champId, ctx.champProjected);
    el.outerHTML = renderReadout(info);
  };

  // Highlight every sunburst arc a player occupies (their path through the draw) without re-rendering.
  // The cache holds the currently-lit arc nodes so leave/move can clear them without re-querying;
  // it is dropped at the top of draw() so the innerHTML swap never leaves detached references behind.
  let hlNodes: Element[] = [];
  const highlightPath = (playerId: string | null) => {
    const sb = root.querySelector<HTMLElement>(".sunburst");
    for (const n of hlNodes) n.classList.remove("arc-hl");
    hlNodes = [];
    if (!playerId || !sb) { sb?.classList.remove("arc-dim-mode"); return; }
    // playerId comes from a row's data-occupant, read back DECODED (the browser undoes the escapeHtml
    // applied when the arc was written). CSS.escape escapes that decoded value for the selector, so the
    // two escapers act on different layers (HTML serialization vs CSS selector) and need not match byte-for-byte.
    hlNodes = [...root.querySelectorAll(`.sunburst path.arc[data-occupant="${CSS.escape(playerId)}"]`)];
    for (const n of hlNodes) n.classList.add("arc-hl");
    sb.classList.toggle("arc-dim-mode", hlNodes.length > 0);
  };

  // Top-bar dropdown menu helpers (mobile): the trigger button, and the focusable (non-disabled) menu items.
  const ddTrigger = (m: "slam" | "lens") =>
    root.querySelector<HTMLElement>(`.dd [data-action="toggle-menu"][data-menu="${m}"]`);
  const ddItems = () =>
    [...root.querySelectorAll<HTMLElement>('.dd-pop [role^="menuitem"]:not([disabled])')];

  const controlsOpts = () => ({
    tour: state.tour, colorDim: state.colorDim, theme: state.theme,
    index: state.index, year: state.year || undefined, slam: state.slam || undefined,
    open: state.openMenu,
  });

  const draw = () => {
    hlNodes = []; // root.innerHTML is about to be replaced — drop refs to the now-detached arc nodes
    const snap = state.year ? state.snapshots[snapKey(state.tour, state.year, state.slam)] : undefined;
    if (!snap) {
      root.innerHTML =
        renderControls(controlsOpts()) +
        `<div class="stage"><div class="loading">Loading ${state.tour} draw…</div></div>`;
      return;
    }
    const time = timeOnCourt(snap);
    const tree = buildSunburst(snap);
    const arcs = layout(tree, SIZE / 2 - 8, state.focusId);
    const color = colorScale(state.colorDim, snap, state.selectedCountry, state.seedSort, state.theme);
    // Round axis (R128 … Final), one per ring, derived from the laid-out arcs so it follows focus/zoom.
    const ringSeen = new Map<number, { y0: number; y1: number }>();
    for (const a of arcs) if (a.depth >= 1 && !ringSeen.has(a.depth)) ringSeen.set(a.depth, { y0: a.y0, y1: a.y1 });
    const rings = [...ringSeen.entries()].map(([depth, r]) => ({
      y: (r.y0 + r.y1) / 2, label: roundAbbrev(snap.rounds.length - depth, snap.rounds),
    }));
    const anchors = labelAnchors(tree);
    anchors.delete(tree.id); // champion is named by the centre readout — skip its cramped on-arc label
    const labelText = (occ: string) =>
      state.colorDim === "country"
        ? flagEmoji(snap.players[occ]?.country ?? "") // text fallback for codes without a bundled SVG
        : surname(snap.players[occ]?.name ?? occ);
    // Country lens labels are bundled SVG flags drawn as <image> — emoji on a textPath
    // never paint in WebKit (iOS) and letter-box on Windows (#6).
    const labelImage = state.colorDim === "country"
      ? (occ: string) => flagAssetUrl(snap.players[occ]?.country ?? "")
      : undefined;
    const isMatch = !!(state.selectedMatchId && snap.matches[state.selectedMatchId]);
    let panel: string;
    if (isMatch) {
      const mm = snap.matches[state.selectedMatchId!];
      const ins = matchInsight(snap, state.selectedMatchId!, time)!;
      const u = sofascoreMatchUrl(mm, mm.p1 ? snap.players[mm.p1] ?? null : null, mm.p2 ? snap.players[mm.p2] ?? null : null);
      panel = renderMatchInsight(ins, u, state.selectedNodeId ?? "r", snap.rounds);
    } else {
      const lens = state.colorDim === "seed" ? renderSeedPanel(seedProgress(snap, state.seedSort), snap.rounds)
        : state.colorDim === "country" ? renderCountryPanel(countryBreakdown(snap), state.selectedCountry, snap.rounds)
        : renderLeaderboard(timeLeaderboard(snap, time));
      // The lens panel doubles as a mobile bottom drawer; `.open` (state.panelOpen) slides it in,
      // the scrim dims the bracket behind it. Both are inert on desktop (CSS).
      const drawer = state.panelOpen ? lens.replace('class="', 'class="open ') : lens;
      panel = `<div class="lens-scrim${state.panelOpen ? " open" : ""}" data-action="panel" aria-hidden="true"></div>` +
        drawer + renderPanelFab(state.colorDim, state.seedSort);
    }
    const focusOcc = state.focusId ? arcs.find((a) => a.id === state.focusId)?.occupant ?? null : null;
    const defaultId = focusOcc ?? tree.occupant ?? null;
    ctx = { snap, time, defaultId, champId: tree.occupant, champProjected: tree.projected };

    root.innerHTML =
      renderControls(controlsOpts()) +
      `<div class="stage">` +
        `<div class="sunburst">${renderSunburst(arcs, color, SIZE, { anchors, text: labelText, image: labelImage }, rings)}` +
          renderReadout(buildReadout(snap, time, defaultId, tree.occupant, tree.projected)) + `</div>` +
        panel +
      `</div>` +
      renderLegend(state.colorDim, state.seedSort) +
      `<div class="status">${snap.tournament.name}${(() => { const s = staleLabel(snap.generatedAt, Date.now()); return s ? ` · ${s}` : ""; })()}</div>`;
  };

  const load = async (tour: Tour, year: number, slam: string) => {
    const k = snapKey(tour, year, slam);
    if (store && !state.snapshots[k]) {
      const cached = await store.getSnapshot(tour, year, slam);
      if (cached) { state.snapshots[k] = cached; if (snapKey(state.tour, state.year, state.slam) === k) draw(); }
    }
    const fresh = await fetchSnapshot(tour, year, slam);
    if (fresh) {
      state.snapshots[k] = fresh;
      void store?.setSnapshot(tour, year, slam, fresh);
      if (snapKey(state.tour, state.year, state.slam) === k) draw();
    }
  };

  // Switch to the best available slam for a tour, keeping the current year if that tour has it.
  const selectForTour = (tour: Tour) => {
    if (!state.index) return;
    const slots = state.year ? slamsForYear(state.index, state.year, tour) : [];
    const keepYear = slots.some((s) => s.entry && s.slam === state.slam);
    if (!keepYear) {
      const def = pickDefaultSlam(state.index, tour);
      if (def) { state.year = def.year; state.slam = def.slam; }
    }
    state.tour = tour;
    state.focusId = undefined; state.selectedMatchId = undefined; state.selectedNodeId = undefined; state.selectedCountry = undefined;
    draw(); void load(state.tour, state.year, state.slam);
  };

  root.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!el || el.hasAttribute("disabled")) return;
    const a = el.dataset.action;
    const id = el.dataset.id;
    const menuBefore = state.openMenu;   // a selection inside an open dropdown should return focus to its trigger
    if (a === "toggle-menu" && el.dataset.menu) {
      const m = el.dataset.menu as "slam" | "lens";
      const willOpen = state.openMenu !== m;
      state.openMenu = willOpen ? m : undefined;
      draw();
      // Move focus into the just-opened menu (first item) or keep it on the trigger when it closes.
      if (willOpen) ddItems()[0]?.focus(); else ddTrigger(m)?.focus();
      return;
    }
    if (a === "panel") {
      state.panelOpen = !state.panelOpen;
      draw();
    } else if (a === "tour" && el.dataset.tour) {
      selectForTour(el.dataset.tour as Tour);
    } else if (a === "slam" && el.dataset.slam) {
      state.slam = el.dataset.slam;
      state.openMenu = undefined;
      state.focusId = undefined; state.selectedMatchId = undefined; state.selectedNodeId = undefined; state.selectedCountry = undefined;
      draw(); void load(state.tour, state.year, state.slam);
    } else if (a === "year" && el.dataset.year) {
      const y = Number(el.dataset.year);
      if (Number.isFinite(y) && state.index) {
        const slots = slamsForYear(state.index, y, state.tour);
        const keep = slots.find((s) => s.entry && s.slam === state.slam);
        state.year = y;
        state.slam = (keep ?? slots.find((s) => s.entry))?.slam ?? state.slam;
        state.openMenu = undefined;
        state.focusId = undefined; state.selectedMatchId = undefined; state.selectedNodeId = undefined; state.selectedCountry = undefined;
        draw(); void load(state.tour, state.year, state.slam);
      }
    } else if (a === "colordim" && el.dataset.dim) {
      state.colorDim = el.dataset.dim as ColorDim;
      state.openMenu = undefined;
      if (state.colorDim !== "country") state.selectedCountry = undefined;
      state.selectedMatchId = undefined; state.selectedNodeId = undefined;
      draw();
    } else if (a === "seed-sort" && el.dataset.sort) {
      // toggles the seed lens between seed order and ELO order — reorders the panel AND recolours the wheel
      state.seedSort = el.dataset.sort as SeedSort;
      draw();
    } else if (a === "country" && el.dataset.country) {
      state.selectedCountry = state.selectedCountry === el.dataset.country ? undefined : el.dataset.country;
      draw();
    } else if (a === "theme") {
      state.theme = nextTheme(state.theme); applyTheme(state.theme); saveTheme(state.theme); draw();
    } else if (a === "inspect" && el.dataset.match) {
      if (state.colorDim === "country") {
        // on the Country lens, clicking an arc selects that player's nation (highlight)
        const s = state.snapshots[snapKey(state.tour, state.year, state.slam)];
        const c = s?.players[el.dataset.occupant ?? ""]?.country;
        if (c) state.selectedCountry = state.selectedCountry === c ? undefined : c;
      } else {
        state.selectedMatchId = el.dataset.match;
        state.selectedNodeId = id;
        state.panelOpen = false;   // a selected match replaces the lens drawer with the match sheet
      }
      draw();
    } else if (a === "focus" && el.dataset.id) {
      state.focusId = el.dataset.id;
      draw();
    } else if (a === "close-detail") {
      state.selectedMatchId = undefined;
      state.selectedNodeId = undefined;
      draw();
    } else if (a === "reset" || id === "r" || (id && id === state.focusId)) {
      state.focusId = undefined; state.selectedMatchId = undefined; state.selectedNodeId = undefined; draw();
    }
    // Selecting a slam/year/lens item from inside an open dropdown closes it → restore focus to its trigger.
    if (menuBefore && state.openMenu === undefined) ddTrigger(menuBefore)?.focus();
  });

  root.addEventListener("pointermove", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-occupant]");
    updateReadout(el?.dataset.occupant || null);
    // hovering a panel row (seed, time leaderboard, country expand) lights that player's path
    // through the sunburst (the centre card names them too)
    highlightPath(el?.hasAttribute("data-hl-path") ? el.dataset.occupant || null : null);
  });
  root.addEventListener("pointerleave", () => { updateReadout(null); highlightPath(null); }, true);

  // Outside-tap closes an open top-bar dropdown (no-op when nothing is open).
  document.addEventListener("pointerdown", (e) => {
    if (!state.openMenu) return;
    if ((e.target as HTMLElement).closest(".dd")) return;
    state.openMenu = undefined; draw();
  });

  // Keyboard support for an open dropdown (ARIA menu pattern): Arrow/Home/End rove between items;
  // Tab closes the menu and returns focus to its trigger so it isn't lost when the tree re-renders.
  window.addEventListener("keydown", (e) => {
    if (!state.openMenu) return;
    if (e.key === "Tab") {
      const m = state.openMenu;
      state.openMenu = undefined; e.preventDefault(); draw(); ddTrigger(m)?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const items = ddItems();
    if (!items.length) return;
    e.preventDefault();
    const idx = items.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === "Home" ? 0
      : e.key === "End" ? items.length - 1
      : e.key === "ArrowDown" ? (idx + 1) % items.length
      : (idx - 1 + items.length) % items.length;
    items[next]?.focus();
  });

  // Escape unwinds the most recently opened layer: dropdown → match detail → lens drawer → focused section.
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (state.openMenu) { const m = state.openMenu; state.openMenu = undefined; draw(); ddTrigger(m)?.focus(); }
    else if (state.selectedMatchId) { state.selectedMatchId = undefined; state.selectedNodeId = undefined; draw(); }
    else if (state.panelOpen) { state.panelOpen = false; draw(); }
    else if (state.focusId) { state.focusId = undefined; draw(); }
  });

  draw(); // initial loading state
  void (async () => {
    store = await createStore();
    state.index = (await fetchIndex()) ?? (await store.getIndex()) ?? undefined;
    if (state.index) void store.setIndex(state.index);
    if (state.index) {
      const def = pickDefaultSlam(state.index, state.tour);
      if (def) { state.year = def.year; state.slam = def.slam; }
    }
    if (!state.year) return; // no manifest yet → stay on loading state
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
  })();
}
