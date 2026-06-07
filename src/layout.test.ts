import { describe, it, expect } from "vitest";
import { makeSyntheticSnapshot } from "./fixtures/synthetic";
import { buildSunburst } from "./state";
import { layout } from "./layout";

describe("layout", () => {
  it("produces one arc per tree node within the radius", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const arcs = layout(buildSunburst(s), 100);
    // 8-draw nodes: 1 + 2 + 4 + 8 = 15
    expect(arcs).toHaveLength(15);
    for (const a of arcs) {
      expect(a.x0).toBeGreaterThanOrEqual(0);
      expect(a.x1).toBeLessThanOrEqual(2 * Math.PI + 1e-9);
      expect(a.y1).toBeLessThanOrEqual(100 + 1e-9);
      expect(a.x1).toBeGreaterThanOrEqual(a.x0);
    }
  });

  it("full circle: outer leaves span the whole 2π", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const arcs = layout(buildSunburst(s), 100);
    const maxDepth = Math.max(...arcs.map((a) => a.depth));
    const leaves = arcs.filter((a) => a.depth === maxDepth).sort((a, b) => a.x0 - b.x0);
    expect(leaves[0].x0).toBeCloseTo(0, 5);
    expect(leaves[leaves.length - 1].x1).toBeCloseTo(2 * Math.PI, 5);
  });

  it("focus rescales the focused subtree to fill the circle", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const root = buildSunburst(s);
    const focusNode = root.children[0]; // a finalist subtree
    const arcs = layout(root, 100, focusNode.id);
    const focused = arcs.find((a) => a.id === focusNode.id)!;
    expect(focused.x0).toBeCloseTo(0, 5);
    expect(focused.x1).toBeCloseTo(2 * Math.PI, 5);
  });
});
