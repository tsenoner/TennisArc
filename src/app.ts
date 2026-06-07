import { makeSyntheticSnapshot } from "./fixtures/synthetic";
import { buildSunburst, timeOnCourt, timeLeaderboard } from "./state";
import { layout } from "./layout";
import { colorScale, type ColorDim } from "./color";
import {
  renderSunburst, renderControls, renderLegend, renderLeaderboard, renderMatchDetail,
} from "./render";
import { sofascoreMatchUrl } from "./deeplink";
import { loadTheme, saveTheme, applyTheme, nextTheme, type Theme } from "./theme";
import type { Snapshot, Tour } from "./model";

const SIZE = 700; // SVG viewBox units; CSS scales to container

interface AppState {
  tour: Tour;
  snapshots: Record<Tour, Snapshot>;
  colorDim: ColorDim;
  focusId: string | undefined;
  selectedMatchId: string | undefined;
  theme: Theme;
}

export function createApp(root: HTMLElement): void {
  const theme = loadTheme();
  applyTheme(theme);
  const state: AppState = {
    tour: "ATP",
    // Plan 3 swaps these synthetic snapshots for live data via api.ts.
    snapshots: {
      ATP: makeSyntheticSnapshot({ tour: "ATP", drawSize: 128, seed: 7, completedRounds: 4 }),
      WTA: makeSyntheticSnapshot({ tour: "WTA", drawSize: 128, seed: 11, completedRounds: 4 }),
    },
    colorDim: "time",
    focusId: undefined,
    selectedMatchId: undefined,
    theme,
  };

  const draw = () => {
    const snap = state.snapshots[state.tour];
    const time = timeOnCourt(snap);
    const arcs = layout(buildSunburst(snap), SIZE / 2 - 8, state.focusId);
    const color = colorScale(state.colorDim, snap, time);
    const lb = timeLeaderboard(snap, time, 10);

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
      detail;
  };

  root.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!el) return; // e.g. the SofaScore <a> link → let the browser handle it
    const a = el.dataset.action;
    const id = el.dataset.id;
    if (a === "tour" && el.dataset.tour) {
      state.tour = el.dataset.tour as Tour;
      state.focusId = undefined;
      state.selectedMatchId = undefined;
      draw();
    } else if (a === "colordim" && el.dataset.dim) {
      state.colorDim = el.dataset.dim as ColorDim;
      draw();
    } else if (a === "theme") {
      state.theme = nextTheme(state.theme);
      applyTheme(state.theme);
      saveTheme(state.theme);
      draw();
    } else if (a === "close-detail") {
      state.selectedMatchId = undefined;
      draw();
    } else if (a === "reset" || id === "r" || (id && id === state.focusId)) {
      state.focusId = undefined;
      state.selectedMatchId = undefined;
      draw();
    } else if (a === "zoom" && id) {
      state.focusId = id;
      state.selectedMatchId = el.dataset.match;
      draw();
    }
  });

  draw();
}
