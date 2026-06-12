import { buildSunburst, timeOnCourt, timeLeaderboard, labelAnchors, surfaceElo, seedProgress, countryBreakdown, matchInsight, ageOn, birthdayInWindow, formatBirthday, sectionTitle, quarterOwners, type PlayerTime, type SeedSort, type SunNode } from "./state";
import { layout } from "./layout";
import { colorScale, type ColorDim } from "./color";
import {
  renderSunburst, renderControls, renderLegend, renderLeaderboard, renderReadout, renderCenterId,
  renderCenterSection, renderCrumbs,
  renderSeedPanel, renderCountryPanel, renderMatchStrip, renderMatchDetail, roundAbbrev, renderPanelFab, type ReadoutInfo,
} from "./render";
import { flagAssetUrl } from "./flags";
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
  detailExpanded: boolean;  // match detail tier (strip's "Details ▾"): in-flow on desktop, bottom sheet on phones
  selectedCountry: string | undefined;
  theme: Theme;
  openMenu: "slam" | "lens" | undefined;
  panelOpen: boolean;
  panelExpanded: boolean;   // mobile bottom sheet: peek (false) vs tall (true)
  pinnedId: string | undefined; // tap/click-pinned player: path stays lit, readout names them
}

function staleLabel(generatedAt: string | undefined, nowMs: number): string {
  if (!generatedAt) return "";
  const ageMin = Math.round((nowMs - Date.parse(generatedAt)) / 60000);
  if (!Number.isFinite(ageMin) || ageMin < 0) return "";
  if (ageMin < 1) return "updated just now";
  if (ageMin < 60) return `updated ${ageMin} min ago`;
  return `updated ${Math.round(ageMin / 60)}h ago`;
}

export function createApp(root: HTMLElement): () => void {
  // createApp owns listeners on window/document (and root) that outlive any single render.
  // Every addEventListener below passes this signal, so the returned dispose() detaches them
  // all in one call — no leak when the app is unmounted (e.g. across test mounts).
  const ac = new AbortController();
  const { signal } = ac;
  const theme = loadTheme();
  applyTheme(theme);
  const state: AppState = {
    tour: "ATP", year: 0, slam: "", index: undefined, snapshots: {},
    colorDim: "time", seedSort: "seed", focusId: undefined, selectedMatchId: undefined, selectedNodeId: undefined, detailExpanded: false, selectedCountry: undefined, theme,
    openMenu: undefined, panelOpen: false, panelExpanded: false, pinnedId: undefined,
  };
  let store: Store | undefined;

  // Updated each draw so the (frequent) hover handler can build a readout without a full re-render.
  let ctx: { snap: Snapshot; time: Map<string, PlayerTime>; defaultId: string | null; champId: string | null; champProjected: boolean; pinned: string | null; isMatch: boolean } | undefined;

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

  // The float card blanks (ro-idle) only when it has nothing to add beyond the centre
  // pill: no hover target, no pinned player. Idle is judged from that INPUT state, never
  // from the resolved player — an active hover on the champion must show their card like
  // anyone else's. A focused section's occupant is named by the centre pill (restored in
  // focus mode), so focus alone keeps the card idle — never the same player twice.
  // "has-match" hides the readout while a match strip names both players (CSS); it lives
  // HERE, not in draw(), so updateReadout's outerHTML swaps re-emit it on every rewrite.
  const roCls = (idle: boolean) => "ro-float" + (idle ? " ro-idle" : "") + (ctx?.isMatch ? " has-match" : "");
  let roCurrent: string | null = null; // who the readout currently shows — skips the 60-120Hz pointermove outerHTML churn
  let roIdle = false;                  // …and whether it is blanked (same skip must see idle flips)
  const updateReadout = (playerId: string | null) => {
    if (!ctx) return;
    const resolved = playerId ?? ctx.defaultId;
    const idle = !playerId && !ctx.pinned;
    if (resolved === roCurrent && idle === roIdle) return;
    const el = root.querySelector(".readout.ro-float");
    if (!el) return;
    roCurrent = resolved; roIdle = idle;
    const info = buildReadout(ctx.snap, ctx.time, resolved, ctx.champId, ctx.champProjected);
    el.outerHTML = renderReadout(info, roCls(idle));
  };

  // Highlight every sunburst arc a player occupies (their path through the draw) without re-rendering.
  // The cache holds the currently-lit arc nodes so leave/move can clear them without re-querying;
  // it is dropped at the top of draw() so the innerHTML swap never leaves detached references behind.
  let hlNodes: Element[] = [];
  let hlCurrent: string | null = null; // skip re-querying when pointermove repeats the same target
  const highlightPath = (playerId: string | null) => {
    if (playerId === hlCurrent) return;
    hlCurrent = playerId;
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
    if (!state.panelOpen) state.panelExpanded = false; // invariant: a closed drawer always reopens at peek
    hlNodes = []; hlCurrent = null; // root.innerHTML is about to be replaced — drop refs to the now-detached arc nodes
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
    anchors.delete(tree.id); // champion is named by the centre pill — skip its cramped on-arc label
    if (state.focusId) anchors.delete(state.focusId); // same rule for the focused hub: its pill (below) carries the name
    const labelText = (occ: string) =>
      state.colorDim === "country"
        // Unmapped nations have no bundled SVG: show the visible ISO code, never an emoji —
        // WebKit won't paint colour emoji on an SVG textPath (iOS), so it would just vanish.
        ? (snap.players[occ]?.country ?? "")
        : surname(snap.players[occ]?.name ?? occ);
    // Country lens labels are bundled SVG flags drawn as <image> — emoji on a textPath
    // never paint in WebKit (iOS) and letter-box on Windows (#6); null image → ISO code text.
    const labelImage = state.colorDim === "country"
      ? (occ: string) => flagAssetUrl(snap.players[occ]?.country ?? "")
      : undefined;
    // Quarter-owner corner labels (drawn top seed; dimmed once out — quarterOwners). Hidden
    // entirely while focused: the corners become free space and the crumbs name the section.
    const qLabels = state.focusId
      ? undefined
      : quarterOwners(snap, tree)?.map((q) => {
          const p = q.playerId ? snap.players[q.playerId] : undefined;
          return {
            nodeId: q.nodeId, playerId: q.playerId, surname: p ? surname(p.name) : "",
            country: p?.country ?? "", seed: q.seed, out: q.out,
          };
        });
    const isMatch = !!(state.selectedMatchId && snap.matches[state.selectedMatchId]);
    const lens = state.colorDim === "seed" ? renderSeedPanel(seedProgress(snap, state.seedSort), snap.rounds)
      : state.colorDim === "country" ? renderCountryPanel(countryBreakdown(snap), state.selectedCountry, snap.rounds)
      : renderLeaderboard(timeLeaderboard(snap, time));
    // The lens panel doubles as a mobile bottom drawer; `.open` (state.panelOpen) slides it in
    // at peek height, `.expanded` makes it tall. The scrim dims the bracket only when expanded —
    // at peek the chart above stays visible AND tappable. All inert on desktop (CSS).
    const drawer = state.panelOpen
      ? lens.replace('class="', `class="open${state.panelExpanded ? " expanded" : ""} `)
      : lens;
    const panel = `<div class="lens-scrim${state.panelOpen && state.panelExpanded ? " open" : ""}" data-action="panel" aria-hidden="true"></div>` +
      drawer + (state.panelOpen ? "" : renderPanelFab(state.colorDim, state.seedSort));
    // A selected match renders as a slim context strip ABOVE the wheel (all viewports) —
    // never over it. Its detail tier expands in-flow on desktop and as a bottom sheet on
    // phones; the lens panel keeps the side column / peek drawer to itself throughout.
    let strip = "";
    if (isMatch) {
      const mm = snap.matches[state.selectedMatchId!];
      const ins = matchInsight(snap, state.selectedMatchId!, time)!;
      const u = sofascoreMatchUrl(mm, mm.p1 ? snap.players[mm.p1] ?? null : null, mm.p2 ? snap.players[mm.p2] ?? null : null);
      const nodeId = state.selectedNodeId ?? "r";
      // ⊕ Zoom targets the selected node's own SECTION — itself when it has children, a
      // leaf's parent match otherwise (resolved decision 2); setFocus maps the root to a no-op.
      const zoomId = arcs.some((x) => x.id.startsWith(`${nodeId}.`)) ? nodeId : nodeId.split(".").slice(0, -1).join(".");
      strip = renderMatchStrip(ins, zoomId, { expanded: state.detailExpanded, focused: !!state.focusId }) +
        (state.detailExpanded ? renderMatchDetail(ins, u, snap.rounds) : "");
    }
    const focusArc = state.focusId ? arcs.find((a) => a.id === state.focusId) : undefined;
    const focusOcc = focusArc?.occupant ?? null;
    // a pinned player owns the readout (hover still previews others; leave restores the pin)
    const pinned = state.pinnedId && snap.players[state.pinnedId] ? state.pinnedId : null;
    const defaultId = pinned ?? focusOcc ?? tree.occupant ?? null;
    ctx = { snap, time, defaultId, champId: tree.occupant, champProjected: tree.projected, pinned, isMatch };
    // idle = no pin (hover arrives later via updateReadout); the focused occupant is named
    // by the restored centre pill, so focus alone no longer wakes the card.
    const floatIdle = !pinned;
    roCurrent = defaultId; roIdle = floatIdle; // the markup below renders the float readout for defaultId

    // The finalist holds the chart centre as a minimal flag + surname pill; their full
    // card appears in the float readout on hover, like anyone else's. While a section is
    // focused, the pill names the focused occupant instead (their on-arc hub label is
    // dropped above), falling back to the section's title when no occupant is known yet.
    let centerId = "";
    if (state.focusId) {
      const fp = focusOcc ? snap.players[focusOcc] : undefined;
      centerId = fp
        ? renderCenterId(fp.country, surname(fp.name), focusArc?.projected ?? false)
        : renderCenterSection(sectionTitle(snap, tree, state.focusId));
    } else if (tree.occupant) {
      const champ = snap.players[tree.occupant];
      centerId = champ ? renderCenterId(champ.country, surname(champ.name), tree.projected) : "";
    }
    const roFloat = renderReadout(buildReadout(snap, time, defaultId, tree.occupant, tree.projected), roCls(floatIdle));

    // Focus crumbs — the zoom's primary exit on every input: "‹ Full draw", a tappable chip
    // per ancestor section, then the current section's name. In-flow at the top of the wheel
    // column (an overlay pinned to the chart's top edge would sit on the 12-o'clock axis tab).
    let crumbs = "";
    if (state.focusId) {
      const segs = state.focusId.split(".");
      const trail = segs.slice(1, -1).map((_, i) => {
        const aid = segs.slice(0, i + 2).join(".");
        return { id: aid, label: sectionTitle(snap, tree, aid) };
      });
      crumbs = renderCrumbs(trail, sectionTitle(snap, tree, state.focusId));
    }

    root.innerHTML =
      renderControls(controlsOpts()) +
      `<div class="stage">` +
        `<div class="sunburst">${crumbs}${strip}<div class="chart">${renderSunburst(arcs, color, SIZE, { anchors, text: labelText, image: labelImage }, rings, qLabels)}` +
          centerId + `</div>` + roFloat + `</div>` +
        `<div class="side">${panel}</div>` +
      `</div>` +
      renderLegend(state.colorDim, state.seedSort) +
      `<div class="status">${snap.tournament.name}${(() => { const s = staleLabel(snap.generatedAt, Date.now()); return s ? ` · ${s}` : ""; })()}` +
        // CC BY-NC-SA: historical durations + ELO + birthdates come from Jeff Sackmann's data
        ` · <span class="credits">durations &amp; ratings: <a href="https://www.tennisabstract.com/" target="_blank" rel="noopener noreferrer">Tennis Abstract</a></span></div>`;

    // re-light the pinned path on the freshly-rendered arcs (innerHTML swap dropped the classes)
    if (pinned) {
      highlightPath(pinned);
      root.querySelector(`[data-hl-path][data-occupant="${CSS.escape(pinned)}"]`)?.classList.add("row-pinned");
    }
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

  // EVERY dismissal of a selected match routes through here — the detail tier must never
  // survive its match (a stale detailExpanded would pre-expand the next match's sheet).
  const closeMatch = () => {
    state.selectedMatchId = undefined; state.selectedNodeId = undefined; state.detailExpanded = false;
  };

  // ---- focus + history (V1-simple: ONE history entry per focus session) ----
  // Entering focus pushes exactly one entry (#r.0.0); changing level replaces it; clearing
  // pops it via history.back() — so browser Back / iOS back-swipe always exits focus in a
  // single step (never walking intermediate levels) and never exits the app while focused.
  let ownsEntry = false; // we pushed the entry we're sitting on (cleared on pop/scrub)

  // A focus id must name a real node in the CURRENT draw — stale ids (a hash popped after
  // a slam switch, hand-edited URLs) normalize to "no focus" rather than rendering crumbs
  // for a section that doesn't exist. Walked on the snapshot tree, not the DOM: a focused
  // render holds only the focused subtree.
  const inTree = (id: string): boolean => {
    const snap = state.year ? state.snapshots[snapKey(state.tour, state.year, state.slam)] : undefined;
    if (!snap) return false;
    const segs = id.split(".");
    if (segs[0] !== "r") return false;
    let node: SunNode | undefined = buildSunburst(snap);
    for (const seg of segs.slice(1)) node = node?.children[Number(seg)];
    return !!node;
  };
  const normalizeFocus = (id: string | undefined) => (!id || id === "r" || !inTree(id) ? undefined : id);

  // EVERY focus change routes through here. Normalizes the id — "r", "" and unresolvable
  // ids all mean "no focus" — and keeps the single owned history entry in sync. `adopt` is
  // the popstate path: the browser has already moved, so only mirror the entry, never write
  // (a push there would duplicate it). Callers draw() themselves.
  const setFocus = (id: string | undefined, adopt = false): void => {
    const next = normalizeFocus(id);
    if (adopt) ownsEntry = !!next;
    if (next === state.focusId) return;
    state.focusId = next;
    if (adopt) return;
    if (next) {
      if (ownsEntry) history.replaceState({ f: next }, "", `#${next}`); // level change — still one entry
      else { history.pushState({ f: next }, "", `#${next}`); ownsEntry = true; } // entering focus
    } else if (ownsEntry) {
      // clearing: give our entry back. The popstate this fires finds focusId already
      // cleared and is a no-op, so the exit never double-draws.
      ownsEntry = false;
      history.back();
    }
  };

  // Leaving the current draw (tour/year/slam switch) drops every per-draw selection. The
  // focus session dies with the draw, so the hash is scrubbed IN PLACE — replaceState only:
  // no history.back() (that would navigate) and no new entry (Back later is simply inert).
  const resetSelection = () => {
    state.focusId = undefined;
    if (ownsEntry || location.hash) history.replaceState(null, "", location.pathname + location.search);
    ownsEntry = false;
    closeMatch();
    state.selectedCountry = undefined; state.pinnedId = undefined;
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
    resetSelection();
    draw(); void load(state.tour, state.year, state.slam);
  };

  // The tapped node's own section (resolved decision 2): the node itself when it has
  // children — any rendered arc whose id extends it — else its parent (a leaf's section IS
  // its match). The DOM holds the full laid-out subtree, so the prefix probe is exact.
  const sectionOf = (id: string): string =>
    root.querySelector(`.sunburst path.arc[data-id^="${id}."]`) ? id : id.split(".").slice(0, -1).join(".");

  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const el = t.closest<HTMLElement>("[data-action]");
    // A panel row (seed / leaderboard / country player) pins that player's path — the only
    // path-highlight trigger that works on touch, and a sticky one on desktop. Tap again to unpin.
    // A [data-action] DESCENDANT of the row (e.g. a future control) takes precedence over pinning;
    // row.contains(el) gates that to descendants, so an actionable ancestor never suppresses the pin.
    const row = t.closest<HTMLElement>("[data-hl-path]");
    if (row?.dataset.occupant && !(el && el !== row && row.contains(el))) {
      state.pinnedId = state.pinnedId === row.dataset.occupant ? undefined : row.dataset.occupant;
      if (state.pinnedId) state.panelExpanded = false; // drop the sheet to peek so the lit path is visible
      draw();
      return;
    }
    if (!el) {
      // A tap on the chart with no [data-action] target releases a pinned path. This complements the
      // reset <g> (which also clears the pin): that fires on the wheel's hub/gaps, this on truly-empty
      // SVG regions where the event target is the <svg> root rather than the reset group. Scoped to
      // .chart (not .sunburst) so dead space in the match strip above the wheel never unpins.
      if (state.pinnedId && t.closest(".chart")) { state.pinnedId = undefined; draw(); }
      return;
    }
    if (el.hasAttribute("disabled")) return;
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
    } else if (a === "panel-expand") {
      state.panelExpanded = !state.panelExpanded;
      draw();
    } else if (a === "tour" && el.dataset.tour) {
      selectForTour(el.dataset.tour as Tour);
    } else if (a === "slam" && el.dataset.slam) {
      state.slam = el.dataset.slam;
      state.openMenu = undefined;
      resetSelection();
      draw(); void load(state.tour, state.year, state.slam);
    } else if (a === "year" && el.dataset.year) {
      const y = Number(el.dataset.year);
      if (Number.isFinite(y) && state.index) {
        const slots = slamsForYear(state.index, y, state.tour);
        const keep = slots.find((s) => s.entry && s.slam === state.slam);
        state.year = y;
        state.slam = (keep ?? slots.find((s) => s.entry))?.slam ?? state.slam;
        state.openMenu = undefined;
        resetSelection();
        draw(); void load(state.tour, state.year, state.slam);
      }
    } else if (a === "colordim" && el.dataset.dim) {
      state.colorDim = el.dataset.dim as ColorDim;
      state.openMenu = undefined;
      if (state.colorDim !== "country") state.selectedCountry = undefined;
      closeMatch();
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
      if (id && id === state.focusId) {
        // The focused section's own arc is the hub: tapping it zooms OUT one level (its
        // parent; setFocus maps "r" to a full clear). Checked before any lens semantics —
        // while focused, the hub is navigation chrome on every lens. This replaces the
        // nuclear-reset clause this id used to (unreachably) fall through to below.
        setFocus(id.split(".").slice(0, -1).join("."));
      } else if (state.colorDim === "country") {
        // On the Country lens an arc tap selects that player's nation (no arc pin here) — touch
        // users still pin a single player's path by tapping their row in the expanded nation list.
        const s = state.snapshots[snapKey(state.tour, state.year, state.slam)];
        const c = s?.players[el.dataset.occupant ?? ""]?.country;
        if (c) state.selectedCountry = state.selectedCountry === c ? undefined : c;
      } else if (id && id === state.selectedNodeId) {
        // Tap-again-to-zoom: re-tapping the already-selected arc focuses its own section.
        // State-based, not timing-based — no double-tap window to race. Selection and pin
        // survive, so the strip stays open and flips to "Reset zoom".
        setFocus(sectionOf(id));
      } else {
        // One grammar on every input: a single tap/click on an arc pins the player AND
        // opens the match strip. The strip never covers the wheel, so touch no longer
        // needs a pin-first second-tap dance — unpin via chart-background tap or Esc
        // (the centre hub is the final's own arc, so tapping it inspects the final).
        const occ = el.dataset.occupant || null;
        if (occ) state.pinnedId = occ;
        if (state.selectedMatchId !== el.dataset.match) state.detailExpanded = false; // a new match starts collapsed
        state.selectedMatchId = el.dataset.match;
        state.selectedNodeId = id;
      }
      draw();
    } else if (a === "focus" && el.dataset.id !== undefined) {
      // dataset.id may be "" — the crumbs' "‹ Full draw" chip and the strip's "Reset zoom"
      // clear focus through this same branch (setFocus(undefined) pops our history entry).
      setFocus(el.dataset.id || undefined);
      draw();
    } else if (a === "detail-expand") {
      state.detailExpanded = !state.detailExpanded;
      draw();
      // The innerHTML swap dropped the keyboard focus: move it into the just-opened tier
      // (its ✕ — the sheet's close on phones), or back to the strip's toggle on collapse.
      if (state.detailExpanded) root.querySelector<HTMLElement>(".mi-detail .sheet-close")?.focus();
      else root.querySelector<HTMLElement>('.match-strip [data-action="detail-expand"]')?.focus();
    } else if (a === "close-detail") {
      closeMatch();
      draw();
    } else if (a === "reset" || id === "r" || (id && id === state.focusId)) {
      setFocus(undefined); closeMatch(); state.pinnedId = undefined; draw();
    }
    // Selecting a slam/year/lens item from inside an open dropdown closes it → restore focus to its trigger.
    if (menuBefore && state.openMenu === undefined) ddTrigger(menuBefore)?.focus();
  }, { signal });

  root.addEventListener("pointermove", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-occupant]");
    updateReadout(el?.dataset.occupant || null);
    // hovering an arc or a panel row previews that player's path through the sunburst
    // (the float card names them too); off-target, a pinned path stays lit
    highlightPath(el?.dataset.occupant || state.pinnedId || null);
  }, { signal });
  root.addEventListener("pointerleave", () => { updateReadout(null); highlightPath(state.pinnedId ?? null); }, { capture: true, signal });

  // Browser Back/Forward (and the history.back() setFocus issues on clear): the browser
  // has already moved, so ADOPT the entry's focus instead of writing history; a hash that
  // no longer resolves (slam switched underneath it) normalizes away and is scrubbed so
  // the URL stays honest. iOS back-swipe lands here too — it exits focus, not the app.
  window.addEventListener("popstate", (e) => {
    const before = state.focusId;
    const f = (e.state as { f?: string } | null)?.f ?? (location.hash ? location.hash.slice(1) : undefined);
    setFocus(f, true);
    if (!state.focusId && location.hash) history.replaceState(null, "", location.pathname + location.search);
    if (state.focusId !== before) draw();
  }, { signal });

  // Outside-tap closes an open top-bar dropdown (no-op when nothing is open).
  document.addEventListener("pointerdown", (e) => {
    if (!state.openMenu) return;
    if ((e.target as HTMLElement).closest(".dd")) return;
    state.openMenu = undefined; draw();
  }, { signal });

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
  }, { signal });

  // Escape unwinds the most recently opened layer, one per press:
  // dropdown → match detail tier → match strip → lens drawer → pinned path → focused section.
  // Focus stays the LAST rung — crumbs, the hub and browser Back are its primary exits.
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (state.openMenu) { const m = state.openMenu; state.openMenu = undefined; draw(); ddTrigger(m)?.focus(); }
    else if (state.detailExpanded) { state.detailExpanded = false; draw(); }
    else if (state.selectedMatchId) { closeMatch(); draw(); }
    else if (state.panelOpen) { state.panelOpen = false; draw(); }
    else if (state.pinnedId) { state.pinnedId = undefined; draw(); }
    else if (state.focusId) { setFocus(undefined); draw(); }
  }, { signal });

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

  return () => ac.abort();
}
