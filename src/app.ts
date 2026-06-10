import { buildSunburst, timeOnCourt, timeLeaderboard, labelAnchors, surfaceElo, seedProgress, countryBreakdown, matchInsight, ageOn, birthdayInWindow, formatBirthday, type PlayerTime } from "./state";
import { layout } from "./layout";
import { colorScale, type ColorDim } from "./color";
import {
  renderSunburst, renderControls, renderLegend, renderLeaderboard, renderReadout,
  renderSeedPanel, renderCountryPanel, renderMatchInsight, type ReadoutInfo,
} from "./render";
import { flagEmoji } from "./flags";
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
  focusId: string | undefined;
  selectedMatchId: string | undefined;
  selectedNodeId: string | undefined;
  selectedCountry: string | undefined;
  theme: Theme;
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
    colorDim: "time", focusId: undefined, selectedMatchId: undefined, selectedNodeId: undefined, selectedCountry: undefined, theme,
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

  const controlsOpts = () => ({
    tour: state.tour, colorDim: state.colorDim, theme: state.theme,
    index: state.index, year: state.year || undefined, slam: state.slam || undefined,
  });

  const draw = () => {
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
    const color = colorScale(state.colorDim, snap, time, state.selectedCountry);
    const anchors = labelAnchors(tree);
    anchors.delete(tree.id); // champion is named by the centre readout — skip its cramped on-arc label
    const labelText = (occ: string) =>
      state.colorDim === "country"
        ? flagEmoji(snap.players[occ]?.country ?? "")
        : surname(snap.players[occ]?.name ?? occ);
    const panel = state.selectedMatchId && snap.matches[state.selectedMatchId]
      ? (() => {
          const mm = snap.matches[state.selectedMatchId!];
          const ins = matchInsight(snap, state.selectedMatchId!, time)!;
          const u = sofascoreMatchUrl(mm, mm.p1 ? snap.players[mm.p1] ?? null : null, mm.p2 ? snap.players[mm.p2] ?? null : null);
          return renderMatchInsight(ins, u, state.selectedNodeId ?? "r", snap.rounds);
        })()
      : state.colorDim === "seed" ? renderSeedPanel(seedProgress(snap), snap.rounds)
      : state.colorDim === "country" ? renderCountryPanel(countryBreakdown(snap), state.selectedCountry, snap.rounds)
      : renderLeaderboard(timeLeaderboard(snap, time), color);
    const focusOcc = state.focusId ? arcs.find((a) => a.id === state.focusId)?.occupant ?? null : null;
    const defaultId = focusOcc ?? tree.occupant ?? null;
    ctx = { snap, time, defaultId, champId: tree.occupant, champProjected: tree.projected };

    root.innerHTML =
      renderControls(controlsOpts()) +
      `<div class="stage">` +
        `<div class="sunburst">${renderSunburst(arcs, color, SIZE, { anchors, text: labelText })}` +
          renderReadout(buildReadout(snap, time, defaultId, tree.occupant, tree.projected)) + `</div>` +
        panel +
      `</div>` +
      renderLegend(state.colorDim) +
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
    if (a === "tour" && el.dataset.tour) {
      selectForTour(el.dataset.tour as Tour);
    } else if (a === "slam" && el.dataset.slam) {
      state.slam = el.dataset.slam;
      state.focusId = undefined; state.selectedMatchId = undefined; state.selectedNodeId = undefined; state.selectedCountry = undefined;
      draw(); void load(state.tour, state.year, state.slam);
    } else if (a === "year" && el.dataset.year) {
      const y = Number(el.dataset.year);
      if (Number.isFinite(y) && state.index) {
        const slots = slamsForYear(state.index, y, state.tour);
        const keep = slots.find((s) => s.entry && s.slam === state.slam);
        state.year = y;
        state.slam = (keep ?? slots.find((s) => s.entry))?.slam ?? state.slam;
        state.focusId = undefined; state.selectedMatchId = undefined; state.selectedNodeId = undefined; state.selectedCountry = undefined;
        draw(); void load(state.tour, state.year, state.slam);
      }
    } else if (a === "colordim" && el.dataset.dim) {
      state.colorDim = el.dataset.dim as ColorDim;
      if (state.colorDim !== "country") state.selectedCountry = undefined;
      state.selectedMatchId = undefined; state.selectedNodeId = undefined;
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
  });

  root.addEventListener("pointermove", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-occupant]");
    updateReadout(el?.dataset.occupant || null);
  });
  root.addEventListener("pointerleave", () => updateReadout(null), true);

  // Escape closes the match detail (incl. the mobile bottom sheet), else un-zooms a focused section.
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (state.selectedMatchId) { state.selectedMatchId = undefined; state.selectedNodeId = undefined; draw(); }
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
