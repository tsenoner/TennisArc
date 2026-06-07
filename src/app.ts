import { makeSyntheticSnapshot } from "./fixtures/synthetic";
import { buildSunburst, timeOnCourt } from "./state";
import { layout } from "./layout";
import { colorScale } from "./color";
import { renderSunburst } from "./render";
import type { Snapshot } from "./model";

const SIZE = 700; // SVG viewBox units; CSS scales to container

interface AppState { snapshot: Snapshot; focusId: string | undefined; }

export function createApp(root: HTMLElement): void {
  // Plan 3 swaps this synthetic snapshot for live data via api.ts.
  const state: AppState = {
    snapshot: makeSyntheticSnapshot({ tour: "ATP", drawSize: 128, seed: 7, completedRounds: 4 }),
    focusId: undefined,
  };

  const draw = () => {
    const tree = buildSunburst(state.snapshot);
    const arcs = layout(tree, SIZE / 2 - 8, state.focusId);
    const color = colorScale("time", state.snapshot, timeOnCourt(state.snapshot));
    root.innerHTML = `<div class="sunburst">${renderSunburst(arcs, color, SIZE)}</div>`;
  };

  // event delegation: click an arc → focus it; click the centre group → reset
  root.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!el) return;
    if (el.dataset.action === "zoom" && el.dataset.id) {
      state.focusId = state.focusId === el.dataset.id ? undefined : el.dataset.id;
      draw();
    } else if (el.dataset.action === "reset") {
      if (state.focusId) { state.focusId = undefined; draw(); }
    }
  });

  draw();
}
