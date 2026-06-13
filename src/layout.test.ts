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
    expect(focusNode).toBeDefined();
    const arcs = layout(root, 100, focusNode.id);
    const focused = arcs.find((a) => a.id === focusNode.id)!;
    expect(focused.x0).toBeCloseTo(0, 5);
    expect(focused.x1).toBeCloseTo(2 * Math.PI, 5);
  });

  it("focus rescales the focused subtree to fill the full radius", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 32, seed: 1 });
    const root = buildSunburst(s);
    // exercise both a half (r.0) and a quarter (r.0.0) focus
    for (const focus of [root.children[0], root.children[0].children[0]]) {
      expect(focus).toBeDefined();
      const arcs = layout(root, 342, focus.id);
      const focused = arcs.find((a) => a.id === focus.id)!;
      expect(focused.y0).toBeCloseTo(0, 6);
      // the deepest descendants reach the full radius, not 1 - fy0/radius of it…
      expect(Math.max(...arcs.map((a) => a.y1))).toBeCloseTo(342, 6);
      // …and NEVER overshoot it — float error in ky must not leak past the rim (strict bound)
      for (const a of arcs) expect(a.y1).toBeLessThanOrEqual(342);
      // rings stay uniform: every depth band has the same thickness
      const thicknesses = [...new Set(arcs.map((a) => (a.y1 - a.y0).toFixed(6)))];
      expect(thicknesses).toHaveLength(1);
    }
  });

  it("unfocused layout is unchanged by the rescale (ky = 1 when fy0 = 0)", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const root = buildSunburst(s);
    const plain = layout(root, 100);
    // 8-draw → 4 depth bands of 25 each; the rescale must not perturb them
    for (const a of plain) {
      expect(a.y0).toBeCloseTo(a.depth * 25, 6);
      expect(a.y1).toBeCloseTo((a.depth + 1) * 25, 6);
    }
    // focusing the root (fy0 = 0) is identical to no focus at all
    const rootFocused = layout(root, 100, root.id);
    expect(rootFocused).toEqual(plain);
  });

  it("degenerate: zero radius with focus yields no arcs and no non-finite values", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const root = buildSunburst(s);
    const arcs = layout(root, 0, root.children[0].id);
    expect(arcs).toEqual([]);
  });

  it("degenerate: fy0 within epsilon of the radius falls back to ky = 1", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const root = buildSunburst(s);
    // pick a max-depth leaf: with radius 1e-9 its y0 leaves < 1e-9 of headroom, tripping the guard
    let leaf = root;
    while (leaf.children.length) leaf = leaf.children[0];
    const arcs = layout(root, 1e-9, leaf.id);
    for (const a of arcs) {
      expect(Number.isFinite(a.y0)).toBe(true);
      expect(Number.isFinite(a.y1)).toBe(true);
    }
  });

  it("falls back to the full view when focusId matches no node", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const arcs = layout(buildSunburst(s), 100, "does-not-exist");
    expect(arcs).toHaveLength(15);
  });

  it("focusing a subtree shows fewer arcs than the full view", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const root = buildSunburst(s);
    const focusNode = root.children[0];
    expect(focusNode).toBeDefined();
    const full = layout(root, 100);
    const focused = layout(root, 100, focusNode.id);
    expect(focused.length).toBeLessThan(full.length);
  });
});
