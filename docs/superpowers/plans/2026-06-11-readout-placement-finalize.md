# Readout Placement Finalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finalize the approved corner-readout design: remove the `?ro=` demo scaffolding, lock in the corner layout + finalist pill, add regression tests, verify visually, open a PR.

**Architecture:** The feature is already implemented behind a `?ro=` URL switch on branch `feat/readout-placement` (see spec `docs/superpowers/specs/2026-06-11-readout-placement-design.md`). Finalization deletes the variant machinery so corner is the only desktop layout, then hardens with tests.

**Tech Stack:** Vite + vanilla TS, Vitest (jsdom), Playwright (visual verification).

---

### Task 1: Remove the `?ro=` switch (corner becomes the only layout)

**Files:**
- Modify: `src/app.ts` (RO const, tooltip JS, markup conditionals)
- Modify: `src/app.css` (variant block → unconditional corner rules)

- [ ] **Step 1: Delete the RO const and `data-ro` attribute in `src/app.ts`** (the block right after `applyTheme(theme)`). Remove the `RO === "side"` ternaries in the `root.innerHTML` template — the float card is always a direct child of `.sunburst`, the `.side` wrapper always holds just `${panel}`. Remove the `if (RO === "tooltip") {...}` block from the pointermove handler.

- [ ] **Step 2: In `src/app.css`,** replace the `@media (min-width: 721px)` variant block with:

```css
/* the float card waits at the chart's top-left corner on desktop; idle (nothing hovered,
   nothing pinned) it would only duplicate the finalist pill, so it blanks out */
@media (min-width: 721px) {
  .ro-float { top: 10px; left: 10px; transform: none; }
  .ro-float.ro-idle { visibility: hidden; }
}
```

(Deletes the `html[data-ro="center"] .center-id` hide and the tooltip/strip/side rules.)

- [ ] **Step 3: Run checks** — `pnpm exec tsc --noEmit && pnpm exec vitest run` → all pass.

- [ ] **Step 4: Commit** — `feat(viz): finalist pill at the centre, hovered/pinned card in the corner`

### Task 2: Regression tests

**Files:**
- Modify: `src/app.test.ts` (app-level behaviors)
- Modify: `src/render.test.ts` (renderCenterId unit)

- [ ] **Step 1: Add app-level tests** (use existing `mountApp`, `pickArc`, `touch`, `click`, `litArcs` helpers):

```ts
describe("finalist pill + corner readout", () => {
  it("keeps naming the finalist in the centre while another player is pinned", async () => {
    const root = await mountApp();
    const champ = root.querySelector<HTMLElement>('path.arc[data-id="r"]')!.dataset.occupant!;
    const arc = [...root.querySelectorAll<HTMLElement>("path.arc[data-occupant]")]
      .find((a) => a.dataset.occupant && a.dataset.occupant !== champ)!;
    touch(arc); click(arc); // phone flow: tap pins
    const pill = root.querySelector(".center-id")!;
    expect(pill.textContent).not.toBe("");                       // finalist still named
    expect(root.querySelector(".readout .ro-name")).not.toBeNull(); // strip names the pin
    expect(pill.textContent).not.toBe(root.querySelector(".readout .ro-name")!.textContent);
  });

  it("idles the float card until a hover resolves someone other than the finalist", async () => {
    const root = await mountApp();
    expect(root.querySelector(".ro-float.ro-idle")).not.toBeNull(); // idle at mount
    const champ = root.querySelector<HTMLElement>('path.arc[data-id="r"]')!.dataset.occupant!;
    const arc = [...root.querySelectorAll<HTMLElement>("path.arc[data-occupant]")]
      .find((a) => a.dataset.occupant && a.dataset.occupant !== champ)!;
    arc.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    expect(root.querySelector(".ro-float.ro-idle")).toBeNull();    // hover wakes it
  });

  it("hovering an arc lights that player's path", async () => {
    const root = await mountApp();
    const arc = pickArc(root);
    arc.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    expect(litArcs(root).length).toBeGreaterThan(0);
  });

  it("keeps the lens panel when a match opens (insight stacks below)", async () => {
    const root = await mountApp();
    click(pickArc(root));
    expect(root.querySelector(".side .match-insight")).not.toBeNull();
    expect(root.querySelector(".side .leaderboard")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Add a renderCenterId unit test** in `src/render.test.ts`:

```ts
it("renderCenterId: pill carries flag + name; empty name renders nothing", () => {
  expect(renderCenterId("SRB", "Djokovic", false)).toContain("Djokovic");
  expect(renderCenterId("SRB", "Djokovic", true)).toContain("projected");
  expect(renderCenterId("SRB", "", false)).toBe("");
});
```

- [ ] **Step 3: Run** `pnpm exec vitest run` → all pass (fix code if any legitimately fail).

- [ ] **Step 4: Commit** — `test(viz): pill persistence, idle float, arc hover highlight, stacked insight`

### Task 3: Comment accuracy pass

**Files:**
- Modify: `src/app.ts` (`anchors.delete(tree.id)` comment → "centre pill"; header comment of the readout block)
- Modify: `src/app.css` (the "centre readout overlay" comment above `.sunburst`)

- [ ] **Step 1: Update the two comments** to describe the pill + corner-card split.
- [ ] **Step 2: Commit** — `docs(code): comments follow the pill/corner readout split`

### Task 4: Visual verification (memory-mandated sweep)

- [ ] **Step 1:** Dev server up; Playwright shots: desktop 1280×800 dark + light, Time/Seed/Country lenses, hover + pinned states; zoomed outer ring legibility.
- [ ] **Step 2:** iPhone-15 WebKit (project Playwright, not Chromium resize): pill + strip + pinned path; light theme too.
- [ ] **Step 3:** Read every screenshot; check pill legibility on busy arcs, halo uniformity, corner card vs. controls overlap. Fix and re-shoot if needed. Share final shots with the user.

### Task 5: Review + PR

- [ ] **Step 1:** Remove stray screenshot PNGs from the repo root (`rm desktop-*.png mobile-*.png`).
- [ ] **Step 2:** Adversarial code review of the full branch diff (Workflow: parallel reviewers + verify), fix confirmed findings.
- [ ] **Step 3:** `git push -u origin feat/readout-placement`; `gh pr create` with summary, spec link, screenshots.
