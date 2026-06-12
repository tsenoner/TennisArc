/** Two-finger pinch/pan magnifier math — pure viewBox-unit geometry, no DOM.
 *
 *  A View maps the chart's content into the svg viewBox via `translate(x,y) scale(k)`,
 *  written as an SVG ATTRIBUTE on .zoom-layer (never a CSS transform — WebKit rasterizes
 *  CSS-transformed SVG and the labels blur). The view is a transient magnifier, never app
 *  state: k is clamped to [1, 4], and the pan is clamped so the k-scaled chart square
 *  always covers the viewBox (x,y ∈ [size·(1−k), 0]) — no blank gutters at any zoom. A
 *  pinch that settles below k = 1.05 snaps to exact IDENTITY so a casual two-finger graze
 *  can never leave an imperceptible residual zoom behind.
 */

export interface Pt { x: number; y: number }
export interface View { k: number; x: number; y: number }

export const IDENTITY: View = { k: 1, x: 0, y: 0 };

const K_MAX = 4;
const K_SNAP = 1.05; // below this the gesture means "back to normal" — snap, don't linger

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Clamp a candidate translate so the k-scaled size-square always covers the viewBox. */
const clamped = (k: number, x: number, y: number, size: number): View => ({
  k,
  x: clamp(x, size * (1 - k), 0),
  y: clamp(y, size * (1 - k), 0),
});

/** One pinch frame: fingers moved from (a0,b0) to (a1,b1), all in viewBox units (the svg
 *  user space OUTSIDE .zoom-layer). Scale follows the finger-distance ratio from the
 *  gesture-start view; the content point that sat under the start midpoint stays under
 *  the current midpoint (w = (m0−t0)/k0, t1 = m1 − k1·w), so the chart tracks the
 *  fingers. Parallel-moving fingers (ratio 1) degrade to a pure pan at constant k. */
export function pinchUpdate(start: View, a0: Pt, b0: Pt, a1: Pt, b1: Pt, size = 700): View {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y);
  const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  const k = clamp(start.k * (d0 > 0 ? d1 / d0 : 1), 1, K_MAX);
  if (k < K_SNAP) return IDENTITY;
  const m0x = (a0.x + b0.x) / 2, m0y = (a0.y + b0.y) / 2;
  const m1x = (a1.x + b1.x) / 2, m1y = (a1.y + b1.y) / 2;
  const wx = (m0x - start.x) / start.k;
  const wy = (m0y - start.y) / start.k;
  return clamped(k, m1x - k * wx, m1y - k * wy, size);
}

/** Two-finger drag at constant scale: the midpoint moved m0 → m1 (viewBox units). */
export function panUpdate(start: View, m0: Pt, m1: Pt, size = 700): View {
  if (start.k < K_SNAP) return IDENTITY; // unzoomed: nothing to pan (the clamp pins x,y to 0 anyway)
  return clamped(start.k, start.x + (m1.x - m0.x), start.y + (m1.y - m0.y), size);
}
