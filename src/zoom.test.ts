import { describe, it, expect } from "vitest";
import { IDENTITY, pinchUpdate, panUpdate, type View } from "./zoom";

const pt = (x: number, y: number) => ({ x, y });

describe("pinchUpdate", () => {
  it("zooms about the pinch midpoint: the content under the fingers stays put", () => {
    // fingers spread ×2 around a fixed midpoint (350,350)
    const v = pinchUpdate(IDENTITY, pt(300, 350), pt(400, 350), pt(250, 350), pt(450, 350));
    expect(v.k).toBe(2);
    // the content point (350,350) must still render at (350,350): k·w + t = m1
    expect(v.k * 350 + v.x).toBeCloseTo(350);
    expect(v.k * 350 + v.y).toBeCloseTo(350);
  });

  it("compounds from the gesture-start view, not from identity", () => {
    const start: View = { k: 2, x: -350, y: -350 };
    // same fingers spread ×2 again → k 4, the (350,350) anchor still fixed
    const v = pinchUpdate(start, pt(300, 350), pt(400, 350), pt(250, 350), pt(450, 350));
    expect(v.k).toBe(4);
    // content point under the start midpoint: w = (350−(−350))/2 = 350 → t = 350 − 4·350
    expect(v.x).toBe(-1050);
  });

  it("clamps k to 4 no matter how far the fingers spread", () => {
    const v = pinchUpdate(IDENTITY, pt(340, 350), pt(360, 350), pt(0, 350), pt(700, 350));
    expect(v.k).toBe(4);
  });

  it("never zooms below 1 — pinching in at identity is inert", () => {
    const v = pinchUpdate(IDENTITY, pt(300, 350), pt(400, 350), pt(340, 350), pt(360, 350));
    expect(v).toEqual(IDENTITY);
  });

  it("snaps to exact identity below k = 1.05 (no imperceptible residual zoom)", () => {
    const start: View = { k: 1.2, x: -100, y: -50 };
    // fingers close to 85% of their spread: k = 1.2 × 0.85 = 1.02 < 1.05
    const v = pinchUpdate(start, pt(300, 350), pt(400, 350), pt(307.5, 350), pt(392.5, 350));
    expect(v).toEqual(IDENTITY);
  });

  it("clamps the pan so the scaled square always covers the viewBox (x,y ∈ [size(1−k), 0])", () => {
    // a ×2 pinch anchored beyond the bottom-right corner pushes t past the floor
    const v = pinchUpdate(IDENTITY, pt(750, 750), pt(850, 850), pt(700, 700), pt(900, 900));
    expect(v.k).toBeCloseTo(2);
    expect(v.x).toBe(700 * (1 - v.k));
    expect(v.y).toBe(700 * (1 - v.k));
  });

  it("parallel fingers (constant spread) pan at constant k", () => {
    const start: View = { k: 2, x: -300, y: -300 };
    const v = pinchUpdate(start, pt(300, 300), pt(400, 300), pt(250, 280), pt(350, 280));
    expect(v).toEqual({ k: 2, x: -350, y: -320 }); // midpoint moved (−50, −20)
  });

  it("guards a zero start distance (coincident fingers): ratio degrades to 1", () => {
    const v = pinchUpdate({ k: 2, x: -100, y: -100 }, pt(350, 350), pt(350, 350), pt(300, 350), pt(400, 350));
    expect(v.k).toBe(2);
  });

  it("respects a custom viewBox size for the pan clamp", () => {
    const v = pinchUpdate(IDENTITY, pt(90, 90), pt(110, 110), pt(80, 80), pt(120, 120), 100);
    expect(v.k).toBeCloseTo(2);
    expect(v.x).toBe(100 * (1 - v.k)); // anchored at the (100,100) corner → exactly the floor
  });
});

describe("panUpdate", () => {
  it("translates by the midpoint delta at constant k", () => {
    const v = panUpdate({ k: 2, x: -100, y: -100 }, pt(300, 300), pt(350, 250));
    expect(v).toEqual({ k: 2, x: -50, y: -150 });
  });

  it("clamps each axis independently", () => {
    const v = panUpdate({ k: 2, x: -100, y: -100 }, pt(0, 0), pt(900, -900));
    expect(v.x).toBe(0);    // +900 past the ceiling → 0
    expect(v.y).toBe(-700); // −900 past the floor → 700(1−2)
  });

  it("an unzoomed view cannot pan — stays identity", () => {
    expect(panUpdate(IDENTITY, pt(0, 0), pt(100, 100))).toEqual(IDENTITY);
  });
});
