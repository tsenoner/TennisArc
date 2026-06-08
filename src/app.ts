import { buildSunburst, timeOnCourt, timeLeaderboard } from "./state";
import { layout } from "./layout";
import { colorScale, type ColorDim } from "./color";
import {
  renderSunburst, renderControls, renderLegend, renderLeaderboard, renderMatchDetail,
} from "./render";
import { sofascoreMatchUrl } from "./deeplink";
import { loadTheme, saveTheme, applyTheme, nextTheme, type Theme } from "./theme";
import { createStore, type Store } from "./store";
import { fetchSnapshot } from "./api";
import type { Snapshot, Tour } from "./model";

const SIZE = 700;

interface AppState {
  tour: Tour;
  snapshots: Partial<Record<Tour, Snapshot>>;
  colorDim: ColorDim;
  focusId: string | undefined;
  selectedMatchId: string | undefined;
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
    tour: "ATP", snapshots: {}, colorDim: "time",
    focusId: undefined, selectedMatchId: undefined, theme,
  };
  let store: Store | undefined;

  const draw = () => {
    const snap = state.snapshots[state.tour];
    if (!snap) {
      root.innerHTML =
        renderControls({ tour: state.tour, colorDim: state.colorDim, theme: state.theme }) +
        `<div class="stage"><div class="loading">Loading ${state.tour} draw…</div></div>`;
      return;
    }
    const time = timeOnCourt(snap);
    const arcs = layout(buildSunburst(snap), SIZE / 2 - 8, state.focusId);
    const color = colorScale(state.colorDim, snap, time);
    const lb = timeLeaderboard(snap, time);

    let detail = "";
    const m = state.selectedMatchId ? snap.matches[state.selectedMatchId] : undefined;
    if (m) {
      const p1 = m.p1 ? snap.players[m.p1] ?? null : null;
      const p2 = m.p2 ? snap.players[m.p2] ?? null : null;
      const roundName = snap.rounds[m.roundIndex]?.name ?? "";
      detail = renderMatchDetail(m, p1, p2, sofascoreMatchUrl(m, p1, p2), roundName);
    }

    root.innerHTML =
      renderControls({ tour: state.tour, colorDim: state.colorDim, theme: state.theme }) +
      `<div class="stage">` +
        `<div class="sunburst">${renderSunburst(arcs, color, SIZE)}</div>` +
        renderLeaderboard(lb, color) +
      `</div>` +
      renderLegend(state.colorDim) +
      `<div class="status">${snap.tournament.name}${(() => { const s = staleLabel(snap.generatedAt, Date.now()); return s ? ` · ${s}` : ""; })()}</div>` +
      detail;
  };

  const load = async (tour: Tour) => {
    if (store && !state.snapshots[tour]) {
      const cached = await store.getSnapshot(tour);
      if (cached) { state.snapshots[tour] = cached; if (state.tour === tour) draw(); }
    }
    const fresh = await fetchSnapshot(tour);
    if (fresh) {
      state.snapshots[tour] = fresh;
      void store?.setSnapshot(tour, fresh);
      if (state.tour === tour) draw();
    }
  };

  root.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!el) return;
    const a = el.dataset.action;
    const id = el.dataset.id;
    if (a === "tour" && el.dataset.tour) {
      state.tour = el.dataset.tour as Tour;
      state.focusId = undefined; state.selectedMatchId = undefined;
      draw(); void load(state.tour);
    } else if (a === "colordim" && el.dataset.dim) {
      state.colorDim = el.dataset.dim as ColorDim; draw();
    } else if (a === "theme") {
      state.theme = nextTheme(state.theme); applyTheme(state.theme); saveTheme(state.theme); draw();
    } else if (a === "close-detail") {
      state.selectedMatchId = undefined; draw();
    } else if (a === "reset" || id === "r" || (id && id === state.focusId)) {
      state.focusId = undefined; state.selectedMatchId = undefined; draw();
    } else if (a === "zoom" && id) {
      state.focusId = id; state.selectedMatchId = el.dataset.match; draw();
    }
  });

  draw(); // initial loading state
  void (async () => {
    store = await createStore();
    await load("ATP");
    void load("WTA"); // warm the other tour in the background
  })();
}
