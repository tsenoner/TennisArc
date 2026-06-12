import { hierarchy, partition } from "d3-hierarchy";
import type { SunNode } from "./state";

export interface LayoutArc {
  id: string;
  matchId: string;
  occupant: string | null;
  projected: boolean;
  depth: number;
  x0: number; x1: number;     // angles in radians [0, 2π]
  y0: number; y1: number;     // radii [0, radius]
}

const TAU = 2 * Math.PI;

/**
 * Radial partition over the sunburst tree.
 * @param focusId  if given, that subtree is rescaled to fill the full circle (zoom).
 */
export function layout(root: SunNode, radius: number, focusId?: string): LayoutArc[] {
  const h = hierarchy<SunNode>(root, (d) => d.children).count();
  const rootNode = partition<SunNode>().size([TAU, radius])(h);
  const nodes = rootNode.descendants();

  let fx0 = 0, fx1 = TAU, fy0 = 0;
  if (focusId) {
    const f = nodes.find((n) => n.data.id === focusId);
    if (f) { fx0 = f.x0; fx1 = f.x1; fy0 = f.y0; }
  }
  const dx = fx1 - fx0;
  const kx = dx > 1e-9 ? TAU / dx : 1; // guard degenerate (zero-width) focus
  // rescale radii so the focused subtree fills the full radius; guard fy0 <= 0 (no-op) and fy0 ≈ radius (degenerate)
  const ky = fy0 > 0 && fy0 < radius - 1e-9 ? radius / (radius - fy0) : 1;

  return nodes
    .map((n) => {
      const x0 = Math.max(0, Math.min(TAU, (n.x0 - fx0) * kx));
      const x1 = Math.max(0, Math.min(TAU, (n.x1 - fx0) * kx));
      // shift radii so the focused node's inner edge → 0; ancestors clamp to 0 and are dropped by the filter
      const y0 = Math.max(0, (n.y0 - fy0) * ky);
      const y1 = Math.max(0, (n.y1 - fy0) * ky);
      return {
        id: n.data.id, matchId: n.data.matchId, occupant: n.data.occupant,
        projected: n.data.projected, depth: n.depth, x0, x1, y0, y1,
      };
    })
    .filter((a) => a.x1 > a.x0 + 1e-9 && a.y1 > a.y0 + 1e-9);
}
