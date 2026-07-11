import { buildSunburst, timeOnCourt, timeLeaderboard, labelAnchors, surfaceElo, seedProgress, countryBreakdown, nationOf, matchInsight, ageOn, birthdayInWindow, formatBirthday, sectionTitle, quarterOwners, eliminatedSet, scheduledInfo, msToVenueMidnight, type NationRow, type PlayerTime, type SeedSort, type SunNode } from "./state";
import { layout } from "./layout";
import { colorScale, type ColorDim } from "./color";
import {
  renderSunburst, renderControls, renderLegend, renderLeaderboard, renderReadout, renderNationReadout, renderCenterId,
  renderCenterSection, renderCrumbs, renderQuarterFocusButtons,
  renderSeedPanel, renderCountryPanel, renderMatchStrip, renderMatchDetail, roundAbbrev, renderPanelFab, formatScheduledArc, startOfLocalDay, type ArcSched, type ReadoutInfo,
} from "./render";
import { flagAssetUrl } from "./flags";
import { loadTheme, saveTheme, applyTheme, nextTheme, type Theme } from "./theme";
import { fetchSnapshot, fetchIndex } from "./api";
import { pickDefaultSlam, availableYears, slamsForYear, statusFor } from "./slams";
import type { Match, Player, SlamIndex, Snapshot, Tour } from "./model";
import { sofascoreMatchUrl } from "./deeplink";
import { parseRoute, buildRoute, type Route } from "./route";
import { fetchLive, fetchPbp, overlayLive, applyLivePatch, samePatch, type CurrentGame } from "./live";
import { deriveContext, pointState, bestOfForTour, CHIP_LABEL } from "./points";

const SIZE = 700;
const snapKey = (tour: Tour, year: number, slam: string) => `${tour}:${year}:${slam}`;

interface AppState {
  tour: Tour;
  year: number;
  slam: string;
  index: SlamIndex | undefined;
  snapshots: Record<string, Snapshot>;
  livePatch: Record<string, Record<string, Partial<Match>>>; // snapKey → matchId → live overlay
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
  helpOpen: boolean;        // the Help modal (sourced from docs/HELP.md) — global overlay
  loadFailed: boolean;      // nothing renderable AND the last fetch failed → draw() shows Retry, not a spinner
  refreshing: string | undefined;    // snapKey of the view whose manual refresh is in flight — its chip shows "updating…"
  refreshFailed: string | undefined; // snapKey of the view whose last manual refresh got no data — its chip says so
}

// Copy for the status chip's age label; freshnessLabel (in createApp) layers refresh state on top.
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
  // Seed the view from the URL so a shared/reloaded link reopens the same view. The path
  // carries the resource (tour/year/slam — validated against the manifest once it loads, see
  // resolveRoute); the query carries the lens + seed sort, whitelisted at parse time. year
  // stays 0 until that validation, keeping the initial loading-state gate intact. Zoom/focus
  // is NOT read from the URL — it is session-only, and any cold-load hash is scrubbed below.
  const initial = parseRoute(location.pathname, location.search);
  const state: AppState = {
    tour: initial.tour ?? "ATP", year: 0, slam: "", index: undefined, snapshots: {}, livePatch: {},
    colorDim: initial.view ?? "time", seedSort: initial.sub ?? "seed", focusId: undefined, selectedMatchId: undefined, selectedNodeId: undefined, detailExpanded: false, selectedCountry: undefined, theme,
    openMenu: undefined, panelOpen: false, panelExpanded: false, pinnedId: undefined, helpOpen: false,
    loadFailed: false, refreshing: undefined, refreshFailed: undefined,
  };

  // ---- Help overlay ----
  // Help is a TRUE global overlay, so it lives in its own host node OUTSIDE root.innerHTML.
  // Two consequences fall out of that: (1) a background redraw (an in-flight load() resolving,
  // a popstate) rebuilds root but never touches the modal, so its scroll position, expanded
  // accordion sections, and keyboard focus all survive; (2) it is fully decoupled from draw()'s
  // snapshot-gated branches, so the "?" trigger works the same whether or not a draw has loaded.
  // The help module (and its markdown dependency) is code-split — imported only on first open,
  // keeping it off the cold-start critical path for the users who never open Help.
  const helpHost = document.createElement("div");
  document.body.appendChild(helpHost);
  let helpMod: Promise<typeof import("./help")> | undefined;
  const helpBtn = () => root.querySelector<HTMLElement>('.ctrl.help[data-action="toggle-help"]');
  const setHelp = (open: boolean): void => {
    state.helpOpen = open;
    // Opening over a top-bar dropdown? Dismiss it first (clear state + redraw root). Otherwise the
    // .dd-pop stays rendered behind the about-to-be-inert background, and its window keydown handler
    // stays armed — a stray Tab could then jump focus onto the (inert) trigger and need a 2nd Escape.
    // Redrawing root is safe now: Help lives in helpHost, so the swap can't disturb the dialog.
    if (open && state.openMenu) { state.openMenu = undefined; draw(); }
    // The background is genuinely inert while the dialog is up: it can't be focused, clicked, or
    // Tab-reached, and assistive tech skips it — so aria-modal is enforced, not merely asserted.
    root.toggleAttribute("inert", open);
    helpBtn()?.setAttribute("aria-expanded", String(open)); // keep the trigger's state cue honest, no redraw
    if (!open) {
      helpHost.replaceChildren();
      helpBtn()?.focus();          // return focus to the trigger — never strand it on <body>
      return;
    }
    void (helpMod ??= import("./help")).then(({ renderHelp }) => {
      // Bail if: disposed / closed again before the chunk arrived, or already shown — a rapid
      // open·close·open during the first load queues several .then callbacks on the one memoised
      // promise; the firstChild check keeps the render idempotent (close empties helpHost).
      if (signal.aborted || !state.helpOpen || helpHost.firstChild) return;
      helpHost.innerHTML = renderHelp(true);
      helpHost.querySelector<HTMLElement>(".help-sheet")?.focus();
    });
  };
  // The scrim and the ✕ both dismiss; they live in helpHost (outside root), so root's click
  // delegation never sees them — close from here.
  helpHost.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest?.('[data-action="toggle-help"]')) setHelp(false);
  }, { signal });
  // Trap Tab inside the open dialog — belt-and-suspenders with the inert background above
  // (covers any engine that doesn't fully honour `inert`). The real tab stops are the ✕, every
  // accordion <summary>, and links in an OPEN section — a collapsed <details> keeps its links in
  // the DOM but OUT of the tab order, so they must be excluded or the wrap mis-targets a hidden
  // link. Re-queried each press so expanding a section is reflected immediately.
  helpHost.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const f = [...helpHost.querySelectorAll<HTMLElement>('button:not([disabled]), summary, a[href]')]
      .filter((el) => { const d = el.closest("details"); return !d || d.open || el.tagName === "SUMMARY"; });
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === helpHost.querySelector(".help-sheet"))) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault(); first.focus();
    }
  }, { signal });

  // Updated each draw so the (frequent) hover handler can build a readout without a full re-render.
  let ctx: { snap: Snapshot; time: Map<string, PlayerTime>; defaultId: string | null; champId: string | null; champProjected: boolean; pinned: string | null; isMatch: boolean; nation: NationRow | null; nationKey: string | null } | undefined;

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
  const nationKey = (n: NationRow) => `nation:${n.country}`; // roCurrent memo key while a nation owns the card
  /** Render the nation card AND seed the memo to match — the ONE place the pair stays in
   *  lockstep, shared by draw()'s float slot and updateReadout's hover-leave restore. */
  const nationCard = (n: NationRow): string => {
    roCurrent = nationKey(n); roIdle = false;
    return renderNationReadout(n, roCls(false));
  };
  let roCurrent: string | null = null; // what the readout currently shows (a player id, or a nationKey) — skips the 60-120Hz pointermove outerHTML churn
  let roIdle = false;                  // …and whether it is blanked (same skip must see idle flips)
  const updateReadout = (playerId: string | null) => {
    if (!ctx) return;
    // A selected match hides the readout (.has-match, CSS) — the strip already names both
    // players. Skip the buildReadout + outerHTML churn on the invisible node (a touch
    // drag-to-explore fires a stream of pointermoves); highlightPath still runs separately,
    // so the lit path keeps following the hover.
    if (ctx.isMatch) return;
    // A selected nation owns the idle card (#7): hover previews players as usual, but
    // leaving restores the nation summary rather than the default player card.
    if (!playerId && ctx.nation) {
      if (roCurrent === ctx.nationKey) return; // pre-built key: no allocation on the 60-120Hz move path
      const el = root.querySelector(".readout.ro-float");
      if (!el) return;
      el.outerHTML = nationCard(ctx.nation);
      return;
    }
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
    for (const n of hlNodes) n.classList.remove("arc-hl", "q-hl");
    hlNodes = [];
    if (!playerId || !sb) { sb?.classList.remove("arc-dim-mode"); return; }
    // playerId comes from a row's data-occupant, read back DECODED (the browser undoes the escapeHtml
    // applied when the arc was written). CSS.escape escapes that decoded value for the selector, so the
    // two escapers act on different layers (HTML serialization vs CSS selector) and need not match byte-for-byte.
    // The lit player's quarter-owner corner label keeps full opacity too (.q-hl): dim-mode
    // fades all four corners with the arcs, but on touch every arc tap pins — without this
    // the lit player's own corner would sit dimmed for most of an interactive session.
    hlNodes = [...root.querySelectorAll(
      `.sunburst path.arc[data-occupant="${CSS.escape(playerId)}"], .sunburst .q-owner[data-occupant="${CSS.escape(playerId)}"]`,
    )];
    for (const n of hlNodes) n.classList.add(n.classList.contains("q-owner") ? "q-hl" : "arc-hl");
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
    open: state.openMenu, helpOpen: state.helpOpen,
  });

  let lastDrawMs = 0; // last full render, for the visibilitychange debounce below

  // The status chip's copy for the current view: manual-refresh state wins over the age label.
  // Shared by draw() and the minute ticker below so the two can never disagree.
  const freshnessLabel = (snap: Snapshot): string => {
    const k = snapKey(state.tour, state.year, state.slam);
    return state.refreshing === k ? "updating…"
      : state.refreshFailed === k ? "update failed"
      : staleLabel(snap.generatedAt, Date.now()) || "refresh";
  };

  const draw = () => {
    if (!state.panelOpen) state.panelExpanded = false; // invariant: a closed drawer always reopens at peek
    hlNodes = []; hlCurrent = null; // root.innerHTML is about to be replaced — drop refs to the now-detached arc nodes
    const k0 = snapKey(state.tour, state.year, state.slam);
    const rawSnap = state.year ? state.snapshots[k0] : undefined;
    // Overlay the live Flashscore patch ONLY while this view is live: livePatch is never cleared, so
    // applying it to a completed slam (or after a refresh / a later revisit) would let a stale live
    // score win over the authoritative snapshot for the rest of the session.
    const snap = rawSnap ? (isLiveView() ? applyLivePatch(rawSnap, state.livePatch[k0]) : rawSnap) : undefined;
    if (!snap) {
      if (document.title !== "TennisArc") document.title = "TennisArc"; // don't keep naming a tournament the screen no longer shows
      root.innerHTML =
        renderControls(controlsOpts()) +
        (state.loadFailed
          ? `<div class="stage"><div class="loading load-error"><p>Couldn’t load the draw — check your connection.</p>` +
            `<button class="retry" data-action="retry">Retry</button></div></div>`
          : `<div class="stage"><div class="loading">Loading ${state.tour} draw…</div></div>`);
      return;
    }
    // THE wall-clock reference for all scheduled-time display this render pass (never generatedAt —
    // a wedged refresh must not make stale data claim "Today"). Captured once so the strip, detail
    // and on-arc labels agree.
    const nowSec = Math.floor(Date.now() / 1000);
    lastDrawMs = nowSec * 1000;
    const time = timeOnCourt(snap);
    const tree = buildSunburst(snap);
    const arcs = layout(tree, SIZE / 2 - 8, state.focusId);
    const color = colorScale(state.colorDim, snap, state.selectedCountry, state.seedSort, state.theme);
    const eliminated = eliminatedSet(snap);                       // dim knocked-out players (.arc.out)
    const hasPending = arcs.some((a) => color.pending?.(a) ?? false); // any "not played yet" arcs → legend key
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
    // Always-on order-of-play tags for upcoming arcs (matchId-keyed — anchors/text serve decided
    // arcs only). Court is strip/detail-only; arcs stay compact. Lens-independent by design.
    // Memoised per pass: nominal rounds share one stamp per round, so a pre-tournament
    // 128 draw collapses ~127 format calls to one per unique start.
    const schedFmt = new Map<number, ArcSched>();
    const schedLabel = (matchId: string): ArcSched | null => {
      const m = snap.matches[matchId];
      const info = m ? scheduledInfo(m, nowSec, snap.tournament.slam) : null;
      if (!info) return null;
      let s = schedFmt.get(info.start);
      if (s === undefined) {
        s = formatScheduledArc(info.start, nowSec);
        schedFmt.set(info.start, s);
      }
      return s;
    };
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
    // Computed once per draw: the Country lens panel AND the nation readout below share it.
    const nations = state.colorDim === "country" ? countryBreakdown(snap) : null;
    const lens = state.colorDim === "seed" ? renderSeedPanel(seedProgress(snap, state.seedSort), snap.rounds)
      : nations ? renderCountryPanel(nations, state.selectedCountry, snap.rounds)
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
      const ins = matchInsight(snap, state.selectedMatchId!, time, nowSec)!;
      const u = sofascoreMatchUrl(mm, mm.p1 ? snap.players[mm.p1] ?? null : null, mm.p2 ? snap.players[mm.p2] ?? null : null);
      const nodeId = state.selectedNodeId ?? "r";
      // ⊕ Zoom targets the selected node's own SECTION — itself when it has children, a
      // leaf's parent match otherwise (resolved decision 2); setFocus maps the root to a no-op.
      const zoomId = arcs.some((x) => x.id.startsWith(`${nodeId}.`)) ? nodeId : nodeId.split(".").slice(0, -1).join(".");
      // Three zoom-button states, all keyed off whether the view sits AT the selected node's
      // own section (zoomId === focusId):
      //  • focused EXACTLY on the selected node (nodeId === focusId) → "Reset zoom" (un-zoom here).
      //  • selected node is a LEAF inside its already-focused parent section (zoomId === focusId
      //    but nodeId is deeper) → nothing to zoom into, and "Reset zoom" would eject to the full
      //    draw — so drop the button (noZoom). This is the re-tap-zoom end state for a leaf.
      //  • otherwise (unfocused, or focused elsewhere) → "⊕ Zoom" drills into zoomId.
      const atSection = state.focusId !== undefined && state.focusId === zoomId;
      strip = renderMatchStrip(ins, zoomId, {
          expanded: state.detailExpanded,
          focused: atSection && nodeId === state.focusId,
          noZoom: atSection && nodeId !== state.focusId,
          nowSec,
        }) +
        (state.detailExpanded ? renderMatchDetail(ins, u, snap.rounds, nowSec) : "");
    }
    const focusArc = state.focusId ? arcs.find((a) => a.id === state.focusId) : undefined;
    const focusOcc = focusArc?.occupant ?? null;
    // a pinned player owns the readout (hover still previews others; leave restores the pin)
    const pinned = state.pinnedId && snap.players[state.pinnedId] ? state.pinnedId : null;
    const defaultId = pinned ?? focusOcc ?? tree.occupant ?? null;
    // a selected nation on the Country lens owns the float card (#7) — unless a pin outranks it
    const nation = !pinned && state.selectedCountry
      ? nations?.find((r) => r.country === state.selectedCountry) ?? null
      : null;
    ctx = { snap, time, defaultId, champId: tree.occupant, champProjected: tree.projected, pinned, isMatch, nation, nationKey: nation ? nationKey(nation) : null };
    // The float card — the nation summary when a nation owns it, else the player card for
    // defaultId — with roCurrent/roIdle seeded to match, so updateReadout's memo agrees
    // with the markup rendered below.
    let roFloat: string;
    if (nation) {
      roFloat = nationCard(nation);
    } else {
      // idle = no pin (hover arrives later via updateReadout); the focused occupant is named
      // by the restored centre pill, so focus alone no longer wakes the card.
      const floatIdle = !pinned;
      roCurrent = defaultId; roIdle = floatIdle;
      roFloat = renderReadout(buildReadout(snap, time, defaultId, tree.occupant, tree.projected), roCls(floatIdle));
    }

    // The centre pill shows FACTS only: a DECIDED result (flag + surname) anchors every lens —
    // a projection is a guess and never appears here (removed 2026-07; it used to show on Seed).
    // While the final is undecided the centre instead names the final's order-of-play slot (the
    // champion disc is the one arc that can't carry an on-arc sched tag — see renderCenterSched).
    // A focused section follows the same rule: decided occupant everywhere; otherwise Seed falls
    // back to the section title and Time/Country stay clean.
    const onSeed = state.colorDim === "seed";
    let centerId = "";
    if (state.focusId) {
      const fp = focusOcc ? snap.players[focusOcc] : undefined;
      const projected = focusArc?.projected ?? false;
      if (fp && !projected) centerId = renderCenterId(fp.country, surname(fp.name));
      else if (onSeed) centerId = renderCenterSection(sectionTitle(snap, tree, state.focusId));
    } else if (tree.occupant && !tree.projected) {
      const champ = snap.players[tree.occupant];
      centerId = champ ? renderCenterId(champ.country, surname(champ.name)) : "";
    }
    // While the final is undecided its order-of-play tag is drawn INSIDE the svg by
    // renderSunburst (the root disc's sched label), so it scales with the chart.

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

    const title = `${snap.tournament.name} — TennisArc`;
    if (document.title !== title) document.title = title; // draw() runs per state change — skip the redundant DOM write
    // .chart carries tabindex="-1": a programmatic landing spot for keyboard focus after the
    // strip's ✕ removes the element that held it (never tab-reachable, no visible ring).
    // The sr-only quarter buttons are the keyboard/SR twins of the SVG corner handles —
    // the svg is role="img", so nothing inside it is reachable or announced.
    root.innerHTML =
      renderControls(controlsOpts()) +
      `<div class="stage">` +
        `<div class="sunburst">${crumbs}${strip}<div class="chart" tabindex="-1">${renderSunburst(arcs, color, SIZE, { anchors, text: labelText, image: labelImage, sched: schedLabel }, rings, qLabels, eliminated)}` +
          centerId + `</div>` + (qLabels ? renderQuarterFocusButtons(qLabels) : "") + roFloat + `</div>` +
        `<div class="side">${panel}</div>` +
      `</div>` +
      renderLegend(state.colorDim, state.seedSort, hasPending) +
      `<div class="status">${snap.tournament.name} · ` +
        `<button class="status-refresh" data-action="refresh" title="Refresh now"><span class="status-label">${freshnessLabel(snap)}</span> <span aria-hidden="true">↻</span></button>` +
        // CC BY-NC-SA: historical durations + ELO + birthdates come from Jeff Sackmann's data
        ` · <span class="credits">durations &amp; ratings: <a href="https://www.tennisabstract.com/" target="_blank" rel="noopener noreferrer">Tennis Abstract</a> · live: <a href="https://www.flashscore.com/" target="_blank" rel="noopener noreferrer">Flashscore</a></span></div>`;
    // Help is NOT part of this innerHTML — it lives in helpHost (see setHelp) so this swap
    // can't reset its scroll/accordion/focus. The "?" trigger above is re-rendered with the
    // current aria-expanded via controlsOpts().helpOpen.

    // re-light the pinned path on the freshly-rendered arcs (innerHTML swap dropped the classes)
    if (pinned) {
      highlightPath(pinned);
      root.querySelector(`[data-hl-path][data-occupant="${CSS.escape(pinned)}"]`)?.classList.add("row-pinned");
    }
    applyPbp(); // restore the last known point-by-point values into the freshly-rendered strip
  };

  let lastLoadMs = 0; // last snapshot fetch that actually RETURNED data for the current view (visibility refetch throttle)
  const inflight = new Map<string, Promise<boolean>>();
  // Single-flight per snapshot key: coincident callers (poll tick, visibility refetch, the chip,
  // Retry, view switches) share one fetch, so two responses for the same view can never resolve
  // out of order and clobber newer data. Resolves true when the fetch produced a snapshot.
  const load = (tour: Tour, year: number, slam: string): Promise<boolean> => {
    const k = snapKey(tour, year, slam);
    const pending = inflight.get(k);
    if (pending) return pending;
    const p = (async () => {
      const fresh = await fetchSnapshot(tour, year, slam);
      const isCurrent = snapKey(state.tour, state.year, state.slam) === k;
      if (!fresh) {
        if (isCurrent && !state.snapshots[k] && !state.loadFailed) {
          // only a view with nothing to show degrades to the Retry state — a failed background
          // refresh of an already-rendered draw keeps the (stale) bracket on screen, and an
          // error already on screen must not be rebuilt by every failed poll tick
          state.loadFailed = true; draw();
        }
        return false;
      }
      const prev = state.snapshots[k];
      // Never let an older payload replace newer data: api.ts falls back to the stale origin
      // seed on a transient outage, and raw CDN edges can disagree within their TTL — either
      // would flip live scores backwards for a tick.
      const regressed = prev != null && Date.parse(fresh.generatedAt) < Date.parse(prev.generatedAt);
      if (!regressed) state.snapshots[k] = fresh;
      if (state.refreshFailed === k) state.refreshFailed = undefined; // data arrived — the chip's failure note is stale
      if (isCurrent) {
        lastLoadMs = Date.now();
        state.loadFailed = false;
        // redraw only when the data actually moved — polling must not wipe panel scroll /
        // in-flight interactions every 90s just to repaint identical bytes
        if (!prev || (!regressed && prev.generatedAt !== fresh.generatedAt)) draw();
      }
      return true;
    })().finally(() => inflight.delete(k));
    inflight.set(k, p);
    return p;
  };
  /** Refetch the snapshot the user is looking at — every refresh path names the current view through here. */
  const loadCurrent = (): Promise<boolean> => load(state.tour, state.year, state.slam);

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
    if (samePatch(state.livePatch[k] ?? {}, patch)) return;
    state.livePatch[k] = patch;
    draw();
  };

  const LIVE_POLL_MS = 90_000;
  const isLiveView = (): boolean =>
    statusFor(state.index, state.tour, state.year, state.slam) === "live";
  // The gate above must not freeze at its mount-time answer: a tab left open across the
  // manifest's upcoming→live flip would never start polling, and a finished slam would poll
  // forever. Every refresh path re-reads the manifest through here (a failure keeps the old one).
  let lastIndexMs = 0;
  const refreshIndex = async (): Promise<void> => {
    const idx = await fetchIndex();
    if (idx) { state.index = idx; lastIndexMs = Date.now(); }
  };

  // EVERY dismissal of a selected match routes through here — the detail tier must never
  // survive its match (a stale detailExpanded would pre-expand the next match's sheet).
  const closeMatch = () => {
    state.selectedMatchId = undefined; state.selectedNodeId = undefined; state.detailExpanded = false;
  };

  // ---- URL ⇄ view state ----
  // The shareable view as a Route: path = resource (tour/year/slam), query = lens + seed sort.
  // Zoom/focus is appended as the URL hash but is NOT part of a Route — it is session-only.
  const currentRoute = (): Route => ({
    tour: state.tour, year: state.year, slam: state.slam, view: state.colorDim, sub: state.seedSort,
  });
  const buildUrl = (): string => buildRoute(currentRoute()) + (state.focusId ? `#${state.focusId}` : "");
  // Write the canonical URL for the current view. `push` adds a Back-able entry (a view switch);
  // otherwise it replaces in place. A no-op when the URL already matches, so a redundant click
  // (re-selecting the active tour) never piles up history. State carries the focus id (or null)
  // so a later Back/popstate lands on an honest entry. Focus enter/level/clear keep their own
  // bespoke grammar in setFocus; this drives the VIEW axis (tour/year/slam/lens/sort).
  const syncUrl = (push: boolean): void => {
    if (!state.year) return; // pre-resolution (loading state): no resolved view to write yet
    const url = buildUrl();
    if (url === location.pathname + location.search + location.hash) return;
    const st = state.focusId ? { f: state.focusId } : null;
    if (push) history.pushState(st, "", url);
    else history.replaceState(st, "", url);
  };
  // Lens/sort change: push a Back-able entry when unfocused, but REPLACE when zoomed so
  // recolouring a drilled-in section keeps the single focus entry instead of piling up Back
  // steps. (A draw switch — tour/year/slam — always pushes; that's syncUrl(true) at its sites.)
  const syncLensUrl = (): void => syncUrl(!state.focusId);

  // Validate a parsed candidate against the manifest, filling defaults. The resource
  // (tour/year/slam) must actually exist; an absent/stale/partial one falls back to the
  // tour's default slam, then to the other tour, so any link still resolves to a real draw.
  // lens/sort were whitelisted at parse, so they only need their defaults applied.
  const resolveRoute = (cand: Partial<Route>): Route => {
    const index = state.index!;
    const view = cand.view ?? "time";
    const sub = cand.sub ?? "seed";
    const pickTour = (t: Tour): { tour: Tour; year: number; slam: string } | null => {
      if (cand.year != null && cand.slam != null &&
          slamsForYear(index, cand.year, t).some((s) => s.entry && s.slam === cand.slam)) {
        return { tour: t, year: cand.year, slam: cand.slam };
      }
      const def = pickDefaultSlam(index, t);
      return def ? { tour: t, year: def.year, slam: def.slam } : null;
    };
    const want = cand.tour ?? "ATP";
    const res = pickTour(want) ?? pickTour(want === "ATP" ? "WTA" : "ATP");
    // res is null only when the manifest has no slams at all → year 0 keeps the loading gate.
    return res ? { ...res, view, sub } : { tour: want, year: 0, slam: "", view, sub };
  };

  // ---- focus + history ----
  // Zoom is a second history axis layered onto the view URL: entering focus pushes ONE entry
  // (…#r.0.0); changing level replaces it; clearing pops it via history.back() — so browser
  // Back / iOS back-swipe always exits focus in a single step. The URL it writes is the FULL
  // view URL (path + query) + the focus hash, so the shared view rides along untouched.
  let ownsEntry = false; // we pushed the focus entry we're sitting on (cleared on pop/scrub/reset)
  let exitingZoom = false; // the next popstate is our own zoom-clear back() — keep the view, drop focus

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

  // EVERY focus change FROM THE UI routes through here. Normalizes the id — "r", "" and
  // unresolvable ids all mean "no focus" — and keeps the single owned focus entry in sync,
  // writing the full view URL + hash. Callers draw() themselves. (popstate sets focus
  // directly: the browser already moved, so writing history there would duplicate the entry.)
  const setFocus = (id: string | undefined): void => {
    const next = normalizeFocus(id);
    if (next === state.focusId) return;
    state.focusId = next;
    if (next) {
      if (ownsEntry) history.replaceState({ f: next }, "", buildUrl()); // level change — still one entry
      else { history.pushState({ f: next }, "", buildUrl()); ownsEntry = true; } // entering focus
    } else if (ownsEntry) {
      // clearing: the caller draw()s the full draw synchronously, so scrub the hash NOW
      // (replaceState updates location immediately, keeping path + query) — otherwise the URL
      // still reads #<focus> for a frame. Then hand our entry back. We exit zoom to STAY on the
      // current view, but the pre-zoom entry we're about to back() onto encodes whatever lens it
      // had BEFORE the zoom (a lens/sort change while zoomed only replaced the zoom entry). Flag
      // it so back()'s popstate keeps the current view instead of restoring that stale lens.
      ownsEntry = false;
      exitingZoom = true;
      history.replaceState(null, "", location.pathname + location.search);
      history.back();
    }
  };

  // Leaving the current draw (tour/year/slam switch) drops every per-draw selection and exits
  // any focus session — state only here. The caller pushes the new view URL via syncUrl(true),
  // so a focus entry we were on simply stays behind in the back-stack (Back returns to it).
  // No history.back() teardown: popping and then pushing a new view would race the async popstate.
  const resetSelection = () => {
    state.focusId = undefined; ownsEntry = false;
    closeMatch();
    state.selectedCountry = undefined; state.pinnedId = undefined;
    state.loadFailed = false; // the Retry state is per-view: a switched-to draw starts from the spinner
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
    syncUrl(true);
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
      // A tap on the chart with no [data-action] target releases a pinned path: the inter-arc
      // gaps and the empty circle-in-square corners aren't painted, so the event target is the
      // bare <svg> (no [data-action] ancestor). Scoped to .chart (not .sunburst) so dead space
      // in the match strip above the wheel never unpins.
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
    } else if (a === "retry") {
      state.loadFailed = false;
      draw(); // back to the spinner while we refetch
      const done: Promise<unknown> = !state.year ? bootstrap() : Promise.all([refreshIndex(), loadCurrent()]);
      void done.then(() => {
        // the swap destroyed the button mid-press: if the refetch failed again, keyboard focus
        // would otherwise strand on <body> instead of the fresh Retry control
        if (state.loadFailed && document.activeElement === document.body)
          root.querySelector<HTMLElement>(".load-error .retry")?.focus();
      });
    } else if (a === "refresh") {
      const k = snapKey(state.tour, state.year, state.slam);
      if (state.refreshing === k) return;
      state.refreshing = k;
      draw(); // show "updating…" immediately
      root.querySelector<HTMLElement>(".status-refresh")?.focus(); // the swap dropped the pressed chip's focus
      void Promise.all([refreshIndex(), loadCurrent()]).then(([, ok]) => {
        if (state.refreshing !== k) return; // superseded — a newer refresh owns the chip now
        state.refreshing = undefined;
        if (!ok) state.refreshFailed = k;  // an explicit refresh must not fail silently — the chip says so
        if (snapKey(state.tour, state.year, state.slam) !== k) return; // never repaint a view this didn't refresh
        const hadFocus = document.activeElement === document.body ||
          !!(document.activeElement as HTMLElement | null)?.classList.contains("status-refresh");
        draw(); // restore the label ("updated …" / "update failed")
        if (hadFocus) root.querySelector<HTMLElement>(".status-refresh")?.focus();
      });
    } else if (a === "tour" && el.dataset.tour) {
      selectForTour(el.dataset.tour as Tour);
    } else if (a === "slam" && el.dataset.slam) {
      state.slam = el.dataset.slam;
      state.openMenu = undefined;
      resetSelection();
      syncUrl(true);
      draw(); void loadCurrent();
    } else if (a === "year" && el.dataset.year) {
      const y = Number(el.dataset.year);
      if (Number.isFinite(y) && state.index) {
        const slots = slamsForYear(state.index, y, state.tour);
        const keep = slots.find((s) => s.entry && s.slam === state.slam);
        state.year = y;
        state.slam = (keep ?? slots.find((s) => s.entry))?.slam ?? state.slam;
        state.openMenu = undefined;
        resetSelection();
        syncUrl(true);
        draw(); void loadCurrent();
      }
    } else if (a === "colordim" && el.dataset.dim) {
      state.colorDim = el.dataset.dim as ColorDim;
      state.openMenu = undefined;
      if (state.colorDim !== "country") state.selectedCountry = undefined;
      closeMatch();
      syncLensUrl();
      draw();
    } else if (a === "seed-sort" && el.dataset.sort) {
      // toggles the seed lens between seed order and ELO order — reorders the panel AND recolours the wheel
      state.seedSort = el.dataset.sort as SeedSort;
      syncLensUrl();
      draw();
    } else if (a === "country" && el.dataset.country) {
      state.selectedCountry = state.selectedCountry === el.dataset.country ? undefined : el.dataset.country;
      draw();
    } else if (a === "theme") {
      state.theme = nextTheme(state.theme); applyTheme(state.theme); saveTheme(state.theme); draw();
    } else if (a === "toggle-help") {
      // The header "?" trigger; the scrim and the ✕ close via helpHost's own listener. setHelp
      // owns the inert background, focus move, and aria-expanded — no full redraw needed, and it
      // mustn't fall through to the dropdown-focus restoration below (it would steal focus).
      setHelp(!state.helpOpen);
      return;
    } else if (a === "inspect" && el.dataset.match) {
      const prevSel = state.selectedMatchId; // kick pbpTick only when this actually changes the selection
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
        const p = s?.players[el.dataset.occupant ?? ""];
        const c = p ? nationOf(p.country) : undefined; // blank-country players toggle their "—" row
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
      // Immediate kick: don't make the user wait up to 8s to see the current game — but only when
      // this action actually changed which match is selected. Zoom taps, re-taps, and country-lens
      // taps leave selectedMatchId untouched, so they must not force an out-of-cadence /api/pbp fetch.
      if (state.selectedMatchId !== prevSel) void pbpTick();
    } else if (a === "focus" && el.dataset.id !== undefined) {
      // dataset.id may be "" — the crumbs' "‹ Full draw" chip and the strip's "Reset zoom"
      // clear focus through this same branch (setFocus(undefined) pops our history entry).
      setFocus(el.dataset.id || undefined);
      draw();
    } else if (a === "detail-expand") {
      state.detailExpanded = !state.detailExpanded;
      draw();
      // The innerHTML swap dropped the keyboard focus: move it into the just-opened tier —
      // its ✕ when actually visible (the phone sheet; offsetParent is null under
      // display:none), else the region itself (desktop hides .sheet-bar, and a focus()
      // on a hidden ✕ silently no-ops to <body>) — or back to the strip's toggle on collapse.
      if (state.detailExpanded) {
        const x = root.querySelector<HTMLElement>(".mi-detail .sheet-close");
        (x?.offsetParent ? x : root.querySelector<HTMLElement>(".mi-detail"))?.focus();
      } else root.querySelector<HTMLElement>('.match-strip [data-action="detail-expand"]')?.focus();
    } else if (a === "close-detail") {
      closeMatch();
      draw();
      // the ✕ that held keyboard focus left with the strip — land on the chart region
      root.querySelector<HTMLElement>(".chart")?.focus();
    } else if (id === "r" || (id && id === state.focusId)) {
      // Fallback reset for the rare arc the inspect branch can't service: a match-LESS arc
      // (empty data-match) that is the root or the current focus hub — drop focus, match and
      // pin together. Match-BEARING hubs zoom out one level in the inspect branch above; the
      // wheel's gaps/empty corners unpin via the !el branch (there is no data-action="reset").
      setFocus(undefined); closeMatch(); state.pinnedId = undefined; draw();
    }
    // Selecting a slam/year/lens item from inside an open dropdown closes it → restore focus to its trigger.
    if (menuBefore && state.openMenu === undefined) ddTrigger(menuBefore)?.focus();
  }, { signal });

  root.addEventListener("pointermove", (e) => {
    // Resolve the arc under the pointer. A mouse has no implicit pointer capture, so e.target is
    // already the node under the cursor — keep it (no per-move layout flush). Touch and PEN on a
    // touchscreen DO get implicit capture: the browser pins e.target to the pointerdown arc for
    // the whole drag, so the lit path would freeze there instead of following the finger. For
    // those, hit-test the node actually under the pointer by COORDINATES. (labels/flags/corners
    // are pointer-events:none, so it lands on the arc <path>; the float card is too.) The e.target
    // fallback covers a null return — point off-viewport, or a test env without elementFromPoint.
    const probe = e.pointerType === "mouse" ? null : document.elementFromPoint(e.clientX, e.clientY);
    const el = (probe ?? (e.target as Element | null))?.closest<HTMLElement>("[data-occupant]");
    updateReadout(el?.dataset.occupant || null);
    // hovering an arc or a panel row previews that player's path through the sunburst
    // (the float card names them too); off-target, a pinned path stays lit
    highlightPath(el?.dataset.occupant || state.pinnedId || null);
  }, { signal });
  root.addEventListener("pointerleave", () => { updateReadout(null); highlightPath(state.pinnedId ?? null); }, { capture: true, signal });

  // Sighted-keyboard focus indicator for the SVG-only quarter handles (WCAG 2.4.7): the
  // sr-only twin's own focus ring is clipped to 1px (invisible), so mirror focus onto the
  // matching corner label (.q-focus, CSS lights its hit-rect + text) by shared data-id. Both
  // events bubble; delegate on root so re-renders never need re-binding. Only the sr-only
  // twins are keyboard-reachable, so a stray match never adds .q-focus to a non-handle.
  const mirrorQFocus = (e: Event, on: boolean) => {
    const btn = (e.target as HTMLElement).closest?.<HTMLElement>(".q-owner-btn");
    if (!btn) return;
    root.querySelector(`.sunburst .q-owner[data-id="${CSS.escape(btn.dataset.id ?? "")}"]`)
      ?.classList.toggle("q-focus", on);
  };
  root.addEventListener("focusin", (e) => mirrorQFocus(e, true), { signal });
  root.addEventListener("focusout", (e) => mirrorQFocus(e, false), { signal });

  // Browser Back/Forward (and the history.back() setFocus issues on clearing zoom): the
  // browser has already moved, so RESTORE the whole view from the URL — never write history
  // here (that would duplicate the entry). Both axes are honoured: the path + query give the
  // resource + lens/sort, the hash (or {f} state) gives the focus. A view switch reloads the
  // snapshot if it isn't already cached; a focus id that no longer resolves normalizes away
  // and the stale hash is scrubbed so the URL stays honest. iOS back-swipe lands here too.
  window.addEventListener("popstate", (e) => {
    if (!state.index) return; // pre-bootstrap: nothing to resolve against yet
    state.openMenu = undefined; // a Back/Forward navigation dismisses any open top-bar dropdown, same as the click handlers
    if (exitingZoom) {
      // This popstate is our own zoom-clear history.back(). We stepped out to STAY on the current
      // view, so keep colorDim/seedSort/slam — only drop focus — and rewrite the landed entry's
      // URL to the current view (it held the pre-zoom lens) so the URL stays honest.
      exitingZoom = false;
      state.focusId = undefined; ownsEntry = false;
      history.replaceState(null, "", buildUrl());
      draw();
      return;
    }
    const r = resolveRoute(parseRoute(location.pathname, location.search));
    const drawChanged = r.tour !== state.tour || r.year !== state.year || r.slam !== state.slam;
    state.tour = r.tour; state.year = r.year; state.slam = r.slam;
    state.colorDim = r.view; state.seedSort = r.sub;
    if (drawChanged) { closeMatch(); state.selectedCountry = undefined; state.pinnedId = undefined; state.loadFailed = false; }
    const f = (e.state as { f?: string } | null)?.f ?? (location.hash ? location.hash.slice(1) : undefined);
    state.focusId = normalizeFocus(f);
    ownsEntry = !!state.focusId;
    if (!state.focusId && location.hash) history.replaceState(null, "", location.pathname + location.search);
    draw();
    if (drawChanged && !state.snapshots[snapKey(state.tour, state.year, state.slam)]) {
      void loadCurrent();
    }
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

  // Escape unwinds the most recently opened layer, one per press: Help modal → dropdown →
  // match detail tier → match strip → lens drawer → pinned path → focused section. Focus stays
  // the LAST rung — crumbs, the hub and browser Back are its primary exits.
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (state.helpOpen) { setHelp(false); } // setHelp tears down the overlay + restores trigger focus
    else if (state.openMenu) { const m = state.openMenu; state.openMenu = undefined; draw(); ddTrigger(m)?.focus(); }
    else if (state.detailExpanded) {
      state.detailExpanded = false; draw();
      // mirror the click-collapse restoration: keyboard focus returns to the strip's toggle
      root.querySelector<HTMLElement>('.match-strip [data-action="detail-expand"]')?.focus();
    }
    else if (state.selectedMatchId) { closeMatch(); draw(); }
    else if (state.panelOpen) { state.panelOpen = false; draw(); }
    else if (state.pinnedId) { state.pinnedId = undefined; draw(); }
    else if (state.focusId) { setFocus(undefined); draw(); }
  }, { signal });

  // Scheduled-time staleness policy: all scheduled display runs on wall-clock "now" captured per
  // draw(), so a long-lived tab must redraw when (a) it becomes visible again — the overnight-open
  // tab — and (b) a day boundary passes: the viewer's LOCAL midnight rolls "Today"/"Tmrw" over,
  // while the VENUE's midnight flips the nominal tier's hide gate (scheduledInfo; UTC midnight is
  // its fallback for an unknown slam) — the timer ticks at whichever comes first, and draws even
  // while hidden (one rebuild a day is free, and it keeps the tab honest the moment it is next
  // seen). That standing
  // freshness is what lets the visibility redraw be debounced: a quick tab flip must not wipe
  // scroll/selection/focus over a display that only moves in minutes. draw() self-guards while no
  // snapshot is loaded.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    // a returning tab wants fresh scores, not just fresh labels — but don't hammer the CDN on
    // quick tab flips (half a poll interval since the last fetch that returned data). The
    // manifest is re-read first so the live gate reflects a status flip (upcoming→live) that
    // happened while the tab was away.
    void (async () => {
      if (Date.now() - lastIndexMs > LIVE_POLL_MS / 2) await refreshIndex();
      if (isLiveView() && Date.now() - lastLoadMs > LIVE_POLL_MS / 2) void loadCurrent();
      if (isLiveView()) void loadLive();
    })();
    if (Date.now() - lastDrawMs > 60_000) draw();
  }, { signal });
  // Live polling: while the manifest says the viewed slam is in play, refetch on a fixed tick.
  // draw() only fires when generatedAt moves (see load), so an idle tick costs one cheap fetch.
  // The tick also re-reads the manifest while the status could still flip (upcoming→live→complete),
  // so the gate opens and closes on its own; archival views never tick anything.
  const pollTimer = window.setInterval(() => {
    if (document.hidden) return;
    const status = statusFor(state.index, state.tour, state.year, state.slam);
    if (status !== "live" && status !== "upcoming") return;
    void refreshIndex();
    if (status === "live") void loadCurrent();
  }, LIVE_POLL_MS);
  signal.addEventListener("abort", () => clearInterval(pollTimer));
  const liveScoreTimer = window.setInterval(() => {
    if (document.hidden) return;
    if (!isLiveView()) return;
    void loadLive();
  }, LIVE_SCORE_POLL_MS);
  signal.addEventListener("abort", () => clearInterval(liveScoreTimer));

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
    return m.status === "live" && m.flash ? m : undefined;
  };
  const applyPbp = (m = pbpTarget()): void => {
    if (!lastPbp || !m?.flash || m.flash.id !== lastPbp.mid) return;
    const gameEl = root.querySelector<HTMLElement>(".ms-game");
    if (!gameEl) return;
    const homeIsP1 = m.flash.homeIsP1;
    const pts = {
      p1: homeIsP1 ? lastPbp.game.home : lastPbp.game.away,
      p2: homeIsP1 ? lastPbp.game.away : lastPbp.game.home,
    };
    const st = pointState({ pts, serving: m.serving, ...deriveContext(m.score), bestOf: bestOfForTour(state.tour) });
    for (const side of ["p1", "p2"] as const) {
      const el = gameEl.querySelector<HTMLElement>(`.ms-pts[data-side="${side}"]`);
      if (el) el.textContent = pts[side];
    }
    const chip = gameEl.querySelector<HTMLElement>(".ms-chip");
    if (chip) {
      chip.hidden = st.chip == null;
      chip.textContent = st.chip ?? "";
      if (st.chip != null && st.chipFor != null) {
        chip.dataset.for = st.chipFor;
        chip.setAttribute("aria-label", CHIP_LABEL[st.chip]);
      } else {
        delete chip.dataset.for;
        chip.removeAttribute("aria-label");
      }
    }
    // CX rotates every two points in a tiebreak — faster than its 30s cadence — so hide the dot.
    for (const dot of root.querySelectorAll<HTMLElement>(".ms-serve")) dot.hidden = st.tb;
  };
  const pbpTick = async (): Promise<void> => {
    if (document.hidden) return;
    const m = pbpTarget();
    if (!m?.flash) return;
    const mid = m.flash.id;
    const game = await fetchPbp(mid);
    if (!game) return;                                  // keep the last shown values; retry next tick
    const cur = pbpTarget();
    if (cur?.flash?.id !== mid) return;                  // selection changed mid-fetch
    lastPbp = { mid, game };
    applyPbp(cur);
  };
  const pbpTimer = window.setInterval(() => { void pbpTick(); }, PBP_POLL_MS);
  signal.addEventListener("abort", () => clearInterval(pbpTimer));

  // The chip is the user's staleness signal, and draw() deliberately skips identical data — so
  // tick the label TEXT in place (never a full redraw) while the tab is visible, or "updated
  // 2 min ago" would freeze exactly when the upstream refresh wedges.
  const labelTimer = window.setInterval(() => {
    if (document.hidden) return;
    const label = root.querySelector(".status-refresh .status-label");
    const snap = state.snapshots[snapKey(state.tour, state.year, state.slam)];
    if (label && snap) label.textContent = freshnessLabel(snap);
  }, 60_000);
  signal.addEventListener("abort", () => clearInterval(labelTimer));
  let midnightTimer = 0;
  const armMidnight = () => {
    const now = new Date();
    const msToTick = Math.min(
      startOfLocalDay(now, 1) - now.getTime(),                                     // next local midnight
      msToVenueMidnight(now.getTime(), state.slam)                                 // next venue midnight (hide-gate flip)
        ?? (Math.floor(now.getTime() / 86_400_000) + 1) * 86_400_000 - now.getTime(), // unknown slam: UTC fallback
    );
    midnightTimer = window.setTimeout(() => { draw(); armMidnight(); }, msToTick + 1000);
  };
  armMidnight();
  signal.addEventListener("abort", () => clearTimeout(midnightTimer));

  // ZOOM deep-link restore is deliberately NOT implemented (zoom is session-only): a
  // pre-existing #focus hash (a reloaded or shared URL) would lie about the unfocused first
  // render — and worse, leave a stale entry whose hash/{f} a later clear()'s history.back()
  // would land on, silently re-entering focus. Scrub the hash IN PLACE before the first draw.
  // The PATH + QUERY (the shared view) are preserved here and honoured by resolveRoute below.
  if (location.hash || history.state) history.replaceState(null, "", location.pathname + location.search);

  draw(); // initial loading state
  // Extracted (not an IIFE) so the Retry action can re-run it after a mount-time outage.
  const bootstrap = async () => {
    await refreshIndex(); // both callers arrive with loadFailed already false (initial state / Retry)
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
    await loadCurrent();
    if (isLiveView()) void loadLive();
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

  return () => { ac.abort(); root.removeAttribute("inert"); helpHost.remove(); };
}
