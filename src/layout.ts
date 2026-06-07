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
  partition<SunNode>().size([TAU, radius])(h);
  const nodes = h.descendants();

  let fx0 = 0, fx1 = TAU, fy0 = 0;
  if (focusId) {
    const f = nodes.find((n) => n.data.id === focusId);
    if (f) { fx0 = (f as any).x0; fx1 = (f as any).x1; fy0 = (f as any).y0; }
  }
  const kx = TAU / (fx1 - fx0);

  return nodes
    .map((n) => {
      const a = n as unknown as { x0: number; x1: number; y0: number; y1: number };
      const x0 = Math.max(0, Math.min(TAU, (a.x0 - fx0) * kx));
      const x1 = Math.max(0, Math.min(TAU, (a.x1 - fx0) * kx));
      const y0 = Math.max(0, a.y0 - fy0);
      const y1 = Math.max(0, a.y1 - fy0);
      return {
        id: n.data.id, matchId: n.data.matchId, occupant: n.data.occupant,
        projected: n.data.projected, depth: n.depth, x0, x1, y0, y1,
      };
    })
    .filter((a) => a.x1 > a.x0 + 1e-9 && a.y1 > a.y0 + 1e-9);
}
