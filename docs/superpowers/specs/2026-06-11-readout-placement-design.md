# Readout placement & desktop pin — design

Date: 2026-06-11 · Branch: `feat/readout-placement` (based on `main`, includes PR #14 mobile-touch)
Status: approved by user after interactive variant comparison (real implementations + screenshots).

## Problem

1. **Phone:** the single readout element docks as a strip above the chart; when a player
   is pinned, the finalist/champion's name + flag vanish entirely (nothing else names
   them — their on-arc label is deliberately skipped, `app.ts` `anchors.delete(tree.id)`).
2. **Desktop:** hovering any arc hijacked the centre card, so the finalist's identity
   flickered away on every hover ("nice and disturbing"). Hover also did NOT light the
   player's path (that worked only on panel rows), and a click jumped straight to the
   match sheet with no pin.
3. **Desktop:** the match insight replaced the lens panel (top-10 leaderboard) instead
   of coexisting with it.

## Decisions (user-approved)

- **Centre = finalist pill.** A minimal flag + surname pill (`.center-id`) holds the
  chart centre on BOTH desktop and phone. No rich card in the middle: the finalist's
  full details appear in the float readout on hover, like any other player. Pill is
  `pointer-events: none` (taps/clicks pass through to the centre disc → opens the final);
  italic surname while the champion is projected ("title contender").
- **Hovered/pinned card = top-left corner (desktop).** The float readout (`.ro-float`,
  the existing 158px frosted card) sits at the chart's top-left corner. It hides
  (`.ro-idle`, `visibility: hidden`) when it would only duplicate the pill (nothing
  hovered, nothing pinned). Chosen over tooltip-at-cursor / strip-above-chart /
  top-of-side-panel after comparing real screenshots of all four.
- **Desktop interaction = hover preview + one-click pin & inspect.** Hovering any arc
  or panel row lights that player's full path (opacity contrast, as before). A click on
  an arc pins the player AND opens that arc's match insight in one click (hover already
  provides the preview that the phone's first tap supplies). Unpin: background click,
  Esc (insight closes first, then pin — existing Esc layering), or the centre hub.
  Country lens keeps arc-click = select nation.
- **Match insight stacks below the lens panel** in a `.side` column on desktop
  (leaderboard on top, insight card below, independent scrolling). On phones the insight
  stays a fixed bottom sheet; the `.side` wrapper is `display: contents` there so the
  drawer/FAB/sheet positioning is unchanged.
- **Phone interaction unchanged** (tap-to-pin, second tap opens sheet). The pill is the
  only addition.

## Architecture

- `render.ts`
  - `renderReadout(info, cls?)` — existing card, now takes an instance class
    (`"ro-float"` + optional `"ro-idle"`).
  - `renderCenterId(iso3, name, projected)` — the pill (bundled SVG flag via `flagImg`,
    never emoji — WebKit/textPath constraint does not apply here, but consistency and
    Windows flags do).
- `app.ts`
  - `draw()` markup: `.sunburst > .chart(svg + .center-id) + .readout.ro-float`, panels
    wrapped in `.side`. Lens panel always rendered; match insight appended when a match
    is selected (FAB suppressed while a match is open, as before).
  - `floatCls(resolved)` — computes `ro-idle` (idle = nothing resolved, or resolved is
    the unpinned champion).
  - `updateReadout()` targets `.readout.ro-float` and preserves the instance class on
    its `outerHTML` swap; the `roCurrent` pointermove cache is unchanged.
  - pointermove: `highlightPath(hovered ?? pinned)` for arcs AND rows.
  - click on arc (non-touch): `pinnedId = occ` + `selectedMatchId = …` together.
- `app.css`
  - `.chart { position: relative; flex: 1 }` inside `.sunburst` (flex column) so the
    pill centres on the circle, not the container.
  - `.side` column rules (desktop) / `display: contents` (phone); mobile drawer
    selectors updated `.stage > …` → `.side > …`.
  - `.center-id` base styles (frosted pill, same chrome as `.readout.filled`).
  - `.ro-float` corner placement under `@media (min-width: 721px)`.

## Cleanup to finalize (remove the demo scaffolding)

- Remove the `?ro=` URL switch and `html[data-ro]` attribute; corner becomes the only
  desktop layout (delete tooltip/strip/side CSS rules, the now-unconditional
  `data-ro`-scoped selectors, and the tooltip pointermove JS).

## Edge cases

- Final TBD (no occupant): no pill, float card renders empty/`aria-hidden` as before.
- Projected champion: pill italic; float card keeps "title contender" label.
- Focus/zoom: float's idle default remains `pinned ?? focusOcc ?? champion`.
- Narrow desktop (721–900px): corner card may overlap outer arcs of a large chart —
  acceptable; it only shows while hovering/pinned and the chart re-emerges on leave.

## Testing

- Unit (jsdom): pill present and naming the finalist while another player is pinned
  (the original phone bug); float card gets `ro-idle` when idle and loses it on hover;
  desktop click pins + opens insight (updated existing test); insight coexists with the
  leaderboard in `.side`; pill absent when the final is TBD.
- Visual (Playwright, before PR): desktop 1280×800 + iPhone-15 WebKit descriptor; dark
  and light themes; Time/Seed/Country lenses; zoomed outer ring; screenshots shared.
