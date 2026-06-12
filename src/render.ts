import { arc as d3arc } from "d3-shape";
import type { LayoutArc } from "./layout";
import type { ColorFn } from "./color";
import { COLOR_DIMS, type ColorDim } from "./color";
import type { Tour } from "./model";
import type { Round, SlamIndex } from "./model";
import type { Theme } from "./theme";
import { flagEmoji, flagAssetUrl } from "./flags";
import type { LeaderRow, SeedProgress, SeedSort, NationRow, InsightSide, MatchInsight } from "./state";
import { roundAbbrev } from "./state";
export { roundAbbrev } from "./state"; // moved to state.ts (sectionTitle needs it); re-exported so callers keep importing from here
import { availableYears, slamsForYear } from "./slams";

const PAD_ANGLE = 0.004;   // radians of gap between adjacent arcs
const PAD_RADIUS = 60;     // d3 reference radius for converting padAngle → linear gap

const arcGen = d3arc<LayoutArc>()
  .startAngle((a) => a.x0)
  .endAngle((a) => a.x1)
  .innerRadius((a) => a.y0)
  .outerRadius((a) => a.y1)
  .padAngle(PAD_ANGLE)
  .padRadius(PAD_RADIUS);

export interface SunburstLabels {
  anchors: Set<string>;
  text: (occupant: string) => string;
  /** When set (Country lens), arcs draw this bundled SVG flag as an <image> at the arc
   *  centroid instead of a textPath label — WebKit never paints colour emoji on a
   *  textPath, and Windows has no flag emoji at all (#6). Null falls back to text. */
  image?: (occupant: string) => string | null;
}

/** Inline flag <img> from the bundled flag-icons set (identical on every platform);
 *  falls back to the emoji pair for codes outside the asset set. flag-icons are 4:3.
 *  Pass `alt` where no country text sits beside the flag (e.g. match insight) —
 *  everywhere else the adjacent ISO code carries the meaning and alt stays empty. */
export function flagImg(iso3: string, h: number, alt = ""): string {
  const url = flagAssetUrl(iso3);
  if (!url) return flagEmoji(iso3);
  return `<img class="flag" src="${escapeHtml(url)}" width="${((h * 4) / 3).toFixed(1)}" height="${h}" alt="${escapeHtml(alt)}" />`;
}
/** A round name pinned to a ring's mid-radius, drawn as a faint axis at 12 o'clock. */
export interface RingLabel { y: number; label: string; }

/** Pre-resolved quarter-owner corner label (the app maps state's QuarterOwner to display
 *  fields). Order matters: index 0-3 → TR/BR/BL/TL corner and the Q1-Q4 caption. */
export interface QuarterLabel {
  nodeId: string;          // r.0.0 (TR), r.0.1 (BR), r.1.0 (BL), r.1.1 (TL)
  playerId: string | null; // null = all-TBD quarter → caption-only label, still tappable
  surname: string;         // "" when there is no owner
  country: string;
  seed: number | null;
  out: boolean;            // eliminated owner: .q-out dims the name; "out" lives in the aria-label only
}

// Quarter-owner corner geometry (centre-relative offsets from the viewBox half-extent c).
// The circle-in-square corners are dead space — the disc (radius c−8, 342 in the 700 box)
// touches the box only at the cardinal points — and each quarter's mid-angle (π/4, 3π/4 …)
// points exactly at "its" corner, so the handles live there at zero radius cost.
// INVARIANT: the transparent hit rect must NEVER intersect the disc — it paints above the
// arcs, so any overlap would silently steal R128 arc taps. The rect's nearest point to the
// centre is its inner corner (c−150, c−56) = (200, 294) at c=350: |(200, 294)| ≈ 355.6 > 342.
// To grow the tap target, extend ALONG the box edges (toward the cardinal points), never
// inward. A render test asserts this invariant.
// Text: columns at x = ±(c−14); the caption hugs the edge (|y| = c−28), the name sits
// disc-side (baseline |y| = c−44 = 306) — circle half-width there is √(342²−306²) ≈ 153,
// so a 14px surname reaching ~130px inward clears the disc comfortably.
const Q_HIT_W = 150, Q_HIT_H = 56;     // hit rect hugging the corner (see invariant above)
const Q_PAD_X = 14;                    // text column inset from the box edge
const Q_NAME_PAD = 44, Q_CAP_PAD = 28; // name / caption baseline insets from the edge
const Q_FLAG_W = 10, Q_FLAG_H = 7.5;   // flag-icons are 4:3

const quarterCap = (q: QuarterLabel, i: number) => `Q${i + 1}${q.seed != null ? ` · seed ${q.seed}` : ""}`;
const quarterAria = (q: QuarterLabel, i: number) =>
  q.playerId ? `${q.surname}'s quarter · ${quarterCap(q, i)}${q.out ? " · out" : ""}` : `Quarter ${i + 1}`;

/** The four tappable quarter-owner corner labels — quiet cartographic annotations, not
 *  buttons: surname (the .ring-label halo recipe via CSS), a "Q1 · seed 1" caption, and a
 *  flag <image> (NEVER emoji — WebKit won't paint them on SVG text). data-action="focus"
 *  zooms the quarter on tap (labels aren't arcs, so this works on every lens — country
 *  included) and data-occupant plugs into the existing hover highlight/readout pipeline.
 *  Font sizes live in CSS, not attributes, so the ≤720px media bump works. */
function quarterCorners(quarters: QuarterLabel[], c: number): string {
  return quarters
    .slice(0, 4)
    .map((q, i) => {
      const sx = i < 2 ? 1 : -1;              // r.0.* fills the right half (angle 0 at 12 o'clock, clockwise)
      const sy = i === 0 || i === 3 ? -1 : 1; // TR (r.0.0) and TL (r.1.1) are the top corners
      const end = sx > 0;                     // right corners read toward the edge → anchor end; left mirrored
      const anchor = end ? ' text-anchor="end"' : "";
      const tx = sx * (c - Q_PAD_X);
      const nameY = sy * (c - Q_NAME_PAD);
      const capY = sy * (c - Q_CAP_PAD);      // always nearer the edge than the name
      const cap = quarterCap(q, i);
      // NOTE: the svg root is role="img", which makes this aria-label PRESENTATIONAL to AT —
      // the .sr-only q-owner-btn twins (renderQuarterFocusButtons) carry the real a11y.
      const aria = quarterAria(q, i);
      const name = q.surname
        ? `<text class="q-name${q.surname.length > 16 ? " q-name-sm" : ""}" x="${tx}" y="${nameY}"${anchor}>${escapeHtml(q.surname)}</text>`
        : "";
      // the flag sits in the corner padding strip beyond the text column, level with the name
      const flagUrl = q.playerId ? flagAssetUrl(q.country) : null;
      const flag = flagUrl
        ? `<image class="q-flag" href="${escapeHtml(flagUrl)}" x="${end ? tx + 2 : tx - 2 - Q_FLAG_W}" ` +
          `y="${(nameY - 5 - Q_FLAG_H / 2).toFixed(2)}" width="${Q_FLAG_W}" height="${Q_FLAG_H}"></image>`
        : "";
      return (
        `<g class="q-owner${q.out ? " q-out" : ""}" data-action="focus" data-id="${escapeHtml(q.nodeId)}" ` +
        `data-occupant="${escapeHtml(q.playerId ?? "")}" aria-label="${escapeHtml(aria)}">` +
        `<rect class="q-hit" x="${end ? c - Q_HIT_W : -c}" y="${sy > 0 ? c - Q_HIT_H : -c}" ` +
        `width="${Q_HIT_W}" height="${Q_HIT_H}" fill="transparent"></rect>` +
        flag + name +
        `<text class="q-cap" x="${tx}" y="${capY}"${anchor}>${escapeHtml(cap)}</text>` +
        `</g>`
      );
    })
    .join("");
}

/** Visually-hidden HTML twins of the corner handles. The chart svg is role="img", so
 *  everything inside it — including the .q-owner groups and their aria-labels — is
 *  presentational to AT and unreachable by keyboard; without these, focus mode had NO
 *  keyboard entry at all. The .sr-only buttons ride the same data-action="focus"
 *  delegation (zero new JS) and the app renders them beside the chart whenever the
 *  corner labels show (i.e. never while already focused). */
export function renderQuarterFocusButtons(quarters: QuarterLabel[]): string {
  return quarters.slice(0, 4)
    .map((q, i) =>
      `<button class="sr-only q-owner-btn" data-action="focus" data-id="${escapeHtml(q.nodeId)}">${escapeHtml(quarterAria(q, i))}</button>`)
    .join("");
}

/** Render the sunburst as a self-contained SVG string (centred), with optional write-once
 *  curved labels, a 12-o'clock round axis, and quarter-owner corner handles. */
export function renderSunburst(
  arcs: LayoutArc[], color: ColorFn, size: number, labels?: SunburstLabels, rings?: RingLabel[],
  quarters?: QuarterLabel[],
): string {
  const c = size / 2;
  const defs: string[] = [];
  const texts: string[] = [];
  const pt = (r: number, ang: number) => `${(r * Math.sin(ang)).toFixed(2)},${(-r * Math.cos(ang)).toFixed(2)}`;

  // Faint round axis at 12 o'clock so each ring reads as a round (R128 … Final), following focus/zoom.
  const ringTexts = (rings ?? [])
    .map((rg, i) => {
      const half = Math.min(0.42, 30 / Math.max(rg.y, 1)); // ~30px-wide tab centred on the top
      const id = `rg${i}`;
      defs.push(`<path id="${id}" d="M${pt(rg.y, -half)} A${rg.y},${rg.y} 0 0 1 ${pt(rg.y, half)}"></path>`);
      return `<text class="ring-label" font-size="9"><textPath href="#${id}" startOffset="50%" text-anchor="middle">${escapeHtml(rg.label)}</textPath></text>`;
    })
    .join("");

  const paths = arcs
    .map((a) => {
      const d = arcGen(a) ?? "";
      const cls = a.projected ? "arc projected" : "arc";
      if (labels && !a.projected && a.occupant && labels.anchors.has(a.id)) {
        // Country lens: a flag image at the arc centroid, rotated tangentially like the
        // curved labels (flipped on the bottom half so it never hangs upside-down).
        const imgUrl = labels.image?.(a.occupant) ?? null;
        if (imgUrl) {
          const rc = (a.y0 + a.y1) / 2;
          const mid = (a.x0 + a.x1) / 2;
          const chord = rc * (a.x1 - a.x0);
          const fh = Math.min((a.y1 - a.y0) * 0.62, 16, chord * 0.6);
          // sub-5px arcs draw no flag and intentionally no text fallback either: a code
          // that small is as illegible as the flag, so the arc stays clean rather than crammed.
          if (fh >= 5) {
            const fw = (fh * 4) / 3;
            const fx = rc * Math.sin(mid), fy = -rc * Math.cos(mid);
            const flip = mid > Math.PI / 2 && mid < (3 * Math.PI) / 2 ? 180 : 0;
            const deg = (mid * 180) / Math.PI - 90 + flip;
            texts.push(
              `<image class="arc-flag" href="${escapeHtml(imgUrl)}" x="${(fx - fw / 2).toFixed(1)}" y="${(fy - fh / 2).toFixed(1)}" ` +
              `width="${fw.toFixed(1)}" height="${fh.toFixed(1)}" ` +
              `transform="rotate(${deg.toFixed(1)} ${fx.toFixed(1)} ${fy.toFixed(1)})"></image>`,
            );
          }
        } else {
        const label = labels.text(a.occupant);
        if (label) {
          const rc = (a.y0 + a.y1) / 2;
          const span = a.x1 - a.x0;
          const mid = (a.x0 + a.x1) / 2;
          const radial = a.y1 - a.y0;
          const idb = a.id.replace(/[^a-z0-9]/gi, "");
          const big = span > Math.PI ? 1 : 0;
          const apad = Math.min(0.03, span * 0.12);
          const s0 = a.x0 + apad, s1 = a.x1 - apad;
          const chord = rc * (s1 - s0);               // usable tangential length for fitting
          const revT = mid > Math.PI / 2 && mid < 3 * Math.PI / 2;  // curved flips on the bottom half
          const revR = mid > Math.PI;                 // radial (spoke) flips on the left half
          const curved = (r: number, txt: string, f: number, id: string) => {
            const dPath = revT
              ? `M${pt(r, s1)} A${r},${r} 0 ${big} 0 ${pt(r, s0)}`
              : `M${pt(r, s0)} A${r},${r} 0 ${big} 1 ${pt(r, s1)}`;
            defs.push(`<path id="${id}" d="${dPath}"></path>`);
            texts.push(
              `<text class="arc-label" font-size="${f.toFixed(1)}">` +
              `<textPath href="#${id}" startOffset="50%" text-anchor="middle">${escapeHtml(txt)}</textPath></text>`,
            );
          };
          const radialAt = (ang: number, txt: string, f: number, id: string) => {
            const dPath = revR
              ? `M${pt(a.y1 - 2, ang)} L${pt(a.y0 + 2, ang)}`
              : `M${pt(a.y0 + 2, ang)} L${pt(a.y1 - 2, ang)}`;
            defs.push(`<path id="${id}" d="${dPath}"></path>`);
            texts.push(
              `<text class="arc-label arc-radial" font-size="${f.toFixed(1)}">` +
              `<textPath href="#${id}" startOffset="50%" text-anchor="middle">${escapeHtml(txt)}</textPath></text>`,
            );
          };
          const [l1, l2] = splitTwo(label);
          if (radial > rc * span) {
            // RADIAL — text runs OUTWARDS along the ring depth (R128, R64). A ring wide enough for two
            // columns (R64) gets a SECOND radial row so long names show in full without rotating to a
            // curve; the thinnest ring (R128) keeps a single spoke.
            const rf = Math.min(11, Math.max(7.5, radial * 0.24));
            const rbudget = Math.max(2, Math.floor((radial - 4) / (rf * 0.6)));
            const colW = rf * 1.05;
            if (rc * span >= 2 * colW && label.length > rbudget) {
              const off = (colW * 0.5) / rc;            // angular offset for two side-by-side columns
              // order columns by which half of the wheel we're on (matches the revR reading flip), so
              // the first row never lands above the second in the top-left / bottom-right quarters
              radialAt(revR ? mid + off : mid - off, fitLabel(l1, rbudget), rf, `lr1${idb}`);
              radialAt(revR ? mid - off : mid + off, fitLabel(l2, rbudget), rf, `lr2${idb}`);
            } else {
              radialAt(mid, fitLabel(label, rbudget), rf, `lr${idb}`);
            }
          } else {
            // CURVED — text follows the ring (R32 inward): one line → two lines (≥3 chars) → truncate.
            const fs = Math.min(13, Math.max(8, radial * 0.42));
            const budget = Math.floor(chord / (fs * 0.58));
            const f2 = Math.min(fs, 10);                // slightly smaller so two lines fit narrow rings
            const budget2 = Math.floor(chord / (f2 * 0.58));
            const fitFs = chord / (label.length * 0.58); // font size at which the whole name fills one line
            if (label.length <= budget) {
              curved(rc, label, fs, `lp${idb}`);        // fits on one line at full size
            } else if (radial >= 2.3 * f2 && l1.length >= 3 && l2.length >= 3 && l1.length <= budget2 && l2.length <= budget2) {
              const gap = f2 * 0.62;                     // two curved lines — whole name, no mid-word break
              const upper = Math.cos(mid) > 0;           // top half → first line on the outer ring
              curved(upper ? rc + gap : rc - gap, l1, f2, `la${idb}`);
              curved(upper ? rc - gap : rc + gap, l2, f2, `lb${idb}`);
            } else if (fitFs >= 8) {
              curved(rc, label, Math.min(fs, fitFs), `lp${idb}`); // shrink one line to show the full short name ("Halys")
            } else {
              curved(rc, fitLabel(label, budget), fs, `lp${idb}`); // truncate — last resort
            }
          }
        }
        } // end image/text branch
      }
      return `<path class="${cls}" d="${d}" fill="${color(a)}" ` +
        `data-action="inspect" data-id="${a.id}" data-match="${a.matchId}" data-occupant="${escapeHtml(a.occupant ?? "")}"></path>`;
    })
    .join("");

  // corner handles render AFTER the arcs — their hit rects paint on top, which is safe
  // only because they never overlap the disc (the invariant documented at Q_HIT_W above)
  const corners = quarters ? quarterCorners(quarters, c) : "";

  // .zoom-layer carries the two-finger magnifier's `translate(x,y) scale(k)` — written by
  // the app as an SVG ATTRIBUTE (never CSS: WebKit rasterizes CSS-transformed SVG and the
  // labels blur). It renders untransformed here; applyView re-aims it after every draw.
  return (
    `<svg viewBox="0 0 ${size} ${size}" preserveAspectRatio="xMidYMid meet" ` +
    `role="img" aria-label="Tournament bracket sunburst">` +
    `<g class="zoom-layer"><g transform="translate(${c},${c})" data-action="reset">` +
    `<defs>${defs.join("")}</defs>${paths}${texts.join("")}${ringTexts}${corners}</g></g></svg>`
  );
}

/** Truncate a label to a character budget with an ellipsis (never empty). */
function fitLabel(s: string, budget: number): string {
  if (s.length <= budget) return s;
  if (budget <= 1) return s.slice(0, 1);
  return s.slice(0, budget - 1) + "…";
}

/** Split a name into two lines, preferring a space/hyphen near the middle, else mid-word. */
function splitTwo(s: string): [string, string] {
  const mid = s.length / 2;
  let best = -1, bestDist = Infinity;
  for (let i = 1; i < s.length - 1; i++) {
    if (s[i] === " " || s[i] === "-") {
      const dist = Math.abs(i - mid);
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
  }
  if (best > 0) {
    const cut = s[best] === "-" ? best + 1 : best; // keep a hyphen on the first line, drop a space
    return [s.slice(0, cut).trim(), s.slice(best + 1).trim()];
  }
  const m = Math.ceil(s.length / 2);
  return [s.slice(0, m), s.slice(m)];
}

/** Escape text that may contain user/player data before embedding in HTML. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );
}

/** Seconds → "45m" or "2h41" (hours + zero-padded minutes). */
export function formatDuration(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

const DIM_LABELS: Record<ColorDim, string> = { time: "Time", seed: "Seed", country: "Country" };

export function renderControls(opts: {
  tour: Tour; colorDim: ColorDim; theme: Theme;
  index?: SlamIndex; year?: number; slam?: string;
  open?: "slam" | "lens";
}): string {
  const tours: Tour[] = ["ATP", "WTA"];
  const tourBtn = (t: Tour) =>
    `<button class="ctrl${opts.tour === t ? " active" : ""}" data-action="tour" data-tour="${t}" aria-pressed="${opts.tour === t}">${t}</button>`;
  // `menu` switches a button from plain group semantics (aria-pressed / aria-current) to ARIA
  // menu-item semantics, used when the same control is rendered inside a role="menu" popover.
  const dimBtn = (d: ColorDim, menu = false) => {
    const sel = opts.colorDim === d;
    const a11y = menu ? ` role="menuitemradio" aria-checked="${sel}"` : ` aria-pressed="${sel}"`;
    return `<button class="ctrl${sel ? " active" : ""}"${a11y} data-action="colordim" data-dim="${d}">${DIM_LABELS[d]}</button>`;
  };

  let switcher = "";          // inline slam switcher (desktop / .only-wide)
  let slamDD = "";            // narrow dropdown wrapping the same year/slam buttons
  if (opts.index && opts.year != null) {
    const years = availableYears(opts.index, opts.tour);
    const i = years.indexOf(opts.year);
    const prevY = i >= 0 && i + 1 < years.length ? years[i + 1] : "";
    const nextY = i > 0 ? years[i - 1] : "";
    const yearStep = (delta: number, target: number | "", menu = false) =>
      `<button class="ctrl yr-step"${menu ? ' role="menuitem"' : ""} data-action="year" data-year="${target}"${target === "" ? " disabled" : ""} aria-label="${delta < 0 ? "Previous" : "Next"} year">${delta < 0 ? "◀" : "▶"}</button>`;
    const slamsHere = slamsForYear(opts.index, opts.year, opts.tour);
    const slamBtn = (s: (typeof slamsHere)[number], menu = false) => {
      const on = opts.slam === s.slam;
      const off = s.entry ? "" : " disabled";
      const live = s.entry?.status === "live" ? " live" : "";
      const a11y = menu ? ` role="menuitemradio" aria-checked="${on}"` : (on ? ' aria-current="true"' : "");
      return `<button data-action="slam" data-slam="${s.slam}" class="ctrl slam${on ? " active" : ""}${live}"${off ? " disabled" : ""}${a11y} data-surface="${s.surface}" title="${s.entry ? escapeHtml(s.entry.name) : s.slam + " — not available"}">${s.abbr}</button>`;
    };
    const inner = (menu: boolean) =>
      yearStep(-1, prevY, menu) + `<span class="yr">${opts.year}</span>` + yearStep(1, nextY, menu) +
      slamsHere.map((s) => slamBtn(s, menu)).join("");
    switcher =
      `<div class="seg slam-switch only-wide" role="group" aria-label="Grand Slam">` + inner(false) + `</div>`;
    const cur = slamsHere.find((s) => s.slam === opts.slam);
    const slamOpen = opts.open === "slam";
    slamDD =
      `<div class="dd only-narrow">` +
      `<button class="ctrl dd-trig" data-action="toggle-menu" data-menu="slam" aria-haspopup="true" aria-expanded="${slamOpen}">` +
      `${opts.year} ${escapeHtml(cur?.abbr ?? "Slam")} <span class="dd-caret" aria-hidden="true">▾</span></button>` +
      (slamOpen ? `<div class="dd-pop dd-pop-slam" role="menu"><div class="dd-slam">${inner(true)}</div></div>` : "") +
      `</div>`;
  }

  const lensOpen = opts.open === "lens";
  const lensInline = `<div class="seg lens-seg only-wide" role="group" aria-label="Colour by">${COLOR_DIMS.map((d) => dimBtn(d)).join("")}</div>`;
  const lensDD =
    `<div class="dd dd-right only-narrow">` +
    `<button class="ctrl dd-trig" data-action="toggle-menu" data-menu="lens" aria-haspopup="true" aria-expanded="${lensOpen}">` +
    `${DIM_LABELS[opts.colorDim]} <span class="dd-caret" aria-hidden="true">▾</span></button>` +
    (lensOpen ? `<div class="dd-pop" role="menu">${COLOR_DIMS.map((d) => dimBtn(d, true)).join("")}</div>` : "") +
    `</div>`;

  return (
    `<header class="controls">` +
    `<a class="brand" href="/" aria-label="TennisArc home">` +
    `<img class="brand-mark" src="/logo.svg" width="28" height="28" alt="" />` +
    `<span class="brand-name">Tennis<span>Arc</span></span></a>` +
    `<div class="seg tour-seg" role="group" aria-label="Tour">${tours.map(tourBtn).join("")}</div>` +
    switcher + slamDD +
    lensInline + lensDD +
    `<button class="ctrl theme" data-action="theme" aria-label="Toggle theme">${opts.theme === "dark" ? "☀" : "☾"}</button>` +
    // Octicon "issue-opened"; the text label hides on phones (icon-only) to free header width
    `<a class="ctrl issues-link" href="https://github.com/tsenoner/TennisArc/issues" target="_blank" rel="noopener noreferrer" aria-label="Report an issue on GitHub">` +
    `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/><path fill="currentColor" d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"/></svg>` +
    `<span class="issues-label">Issues</span></a>` +
    `</header>`
  );
}

/** Mobile-only floating button that opens the lens drawer; its label names the active lens. */
export function renderPanelFab(dim: ColorDim, seedSort: SeedSort = "seed"): string {
  const label = dim === "time" ? "Time on court"
    : dim === "seed" ? (seedSort === "elo" ? "Top 32 · ELO" : "Seeds")
    : "Nations";
  return `<button class="panel-fab" data-action="panel" aria-label="Open ${escapeHtml(label)} panel">${escapeHtml(label)}</button>`;
}

export function renderLegend(dim: ColorDim, seedSort: SeedSort = "seed"): string {
  if (dim === "country") return `<div class="legend">Colour: nationality</div>`;
  const label = dim === "time" ? "fresh → most court time"
    : dim === "seed" && seedSort === "elo" ? "weaker → stronger (ELO)"
    : "unseeded → top seed";
  const grad = dim === "seed" ? "legend-grad seed" : "legend-grad";
  return `<div class="legend"><span class="${grad}" aria-hidden="true"></span><span>${label}</span></div>`;
}

/** Mobile bottom-sheet chrome shared by every lens panel: a grip pill that toggles
 *  peek/expanded height, and an explicit close. Display: none on desktop. */
export function sheetBar(): string {
  return (
    `<div class="sheet-bar">` +
    `<button class="sheet-grip" data-action="panel-expand" aria-label="Expand or collapse panel"><span></span></button>` +
    `<button class="sheet-close" data-action="panel" aria-label="Close panel">✕</button>` +
    `</div>`
  );
}

export function renderLeaderboard(rows: LeaderRow[]): string {
  // Fewer than 3 fully-covered players means the source has no real duration data for this event —
  // a 1-2 row "leaderboard" misleads more than it informs, so show an empty state instead of a
  // ranking. Keep the <aside> + sheet-bar (as renderSeedPanel/renderCountryPanel do): returning ""
  // would strand an opened mobile drawer with no on-screen close once the FAB hides itself.
  const sparse = rows.length < 3;
  const max = Math.max(1, ...rows.map((r) => r.sec));
  const items = sparse
    ? ""
    : rows
        .map((r, i) => {
          const w = Math.round((r.sec / max) * 100);
          return (
            `<li class="lb-row" data-hl-path data-occupant="${escapeHtml(r.playerId)}">` +
            `<span class="lb-rank">${i + 1}</span>` +
            `<span class="lb-name"><span class="lb-who">${escapeHtml(r.name)}</span>` +
            `<span class="lb-ctry">${flagImg(r.country, 10)} ${escapeHtml(r.country)}</span></span>` +
            `<span class="lb-bar"><span aria-hidden="true" style="width:${w}%"></span></span>` +
            `<span class="lb-time">${formatDuration(r.sec)}${r.provisional ? "*" : ""}</span>` +
            `</li>`
          );
        })
        .join("");
  return (
    `<aside class="leaderboard">${sheetBar()}<h2>Most time on court</h2>` +
    (sparse
      ? `<div class="panel-empty">No duration data for this event yet</div>`
      : `<ol class="lb-list">${items}</ol>`) +
    `</aside>`
  );
}

export interface ReadoutInfo {
  name: string;
  country: string;
  ranking: number | null;
  seed: number | null;
  eloLabel: string;        // e.g. "Clay ELO 2107" or "" when unknown
  roundLabel: string;      // e.g. "Quarter-final" / "out · R32" / "champion"
  sec: number;             // cumulative on-court seconds (0 if none)
  provisional: boolean;
  projected: boolean;      // subject is a projection (e.g. projected champion)
  age: number | null; birthday: string; birthdayNear: boolean;
}

/** The legible frosted card naming the hovered/pinned/focused player. The app renders one
 *  instance with cls "ro-float": the chart's top-left corner card on desktop, the docked
 *  strip above the chart on narrow viewports. Append "ro-idle" when it would only
 *  duplicate the centre finalist pill (desktop blanks it then). */
export function renderReadout(info: ReadoutInfo | null, cls = ""): string {
  const c = cls ? ` ${cls}` : "";
  if (!info) return `<div class="readout${c}" aria-hidden="true"></div>`;
  const rank = info.ranking != null ? `#${info.ranking}` : "";
  const seed = info.seed != null ? `seed ${info.seed}` : "";
  const meta1 = [rank, seed].filter(Boolean).join(" · ");
  const time = info.sec > 0 ? `${formatDuration(info.sec)}${info.provisional ? " (live)" : ""} on court` : "";
  const meta2 = [info.roundLabel, time].filter(Boolean).join(" · ");
  return (
    `<div class="readout filled${info.projected ? " projected" : ""}${c}">` +
    `<div class="ro-ctry">${flagImg(info.country, 11)} ${escapeHtml(info.country)}</div>` +
    `<div class="ro-name">${escapeHtml(info.name)}</div>` +
    (meta1 ? `<div class="ro-meta">${escapeHtml(meta1)}</div>` : "") +
    (info.eloLabel ? `<div class="ro-elo">${escapeHtml(info.eloLabel)}</div>` : "") +
    (info.age != null
      ? `<div class="ro-meta">${info.age}y${info.birthdayNear ? ` · 🎂 ${escapeHtml(info.birthday)}` : ""}</div>`
      : "") +
    (meta2 ? `<div class="ro-meta">${escapeHtml(meta2)}</div>` : "") +
    `</div>`
  );
}

/** Minimal finalist identity (flag + surname) holding the chart centre on every viewport
 *  — the constant anchor while the float readout names whoever is hovered/pinned (and the
 *  champion's only name when the readout idles or shows someone else, so it stays in the
 *  accessibility tree). Pointer-events pass through to the centre disc beneath. */
export function renderCenterId(iso3: string, name: string, projected: boolean): string {
  if (!name) return "";
  return `<div class="center-id${projected ? " projected" : ""}">` +
    `${flagImg(iso3, 12)}<span>${escapeHtml(name)}</span></div>`;
}

/** Breadcrumb chips for a focused section: "‹ Full draw" (data-id="" on purpose — the
 *  focus branch accepts the empty id as "clear"), one tappable chip per ancestor section,
 *  then the current section's name as inert text. Rendered only while a focus is active. */
export function renderCrumbs(trail: { id: string; label: string }[], current: string): string {
  const chips = trail
    .map((t) => `<button class="crumb" data-action="focus" data-id="${escapeHtml(t.id)}">${escapeHtml(t.label)}</button>`)
    .join("");
  return (
    `<nav class="crumbs" aria-label="Zoom breadcrumbs">` +
    `<button class="crumb" data-action="focus" data-id="">‹ Full draw</button>` +
    chips +
    `<span class="crumb cur">${escapeHtml(current)}</span></nav>`
  );
}

/** Centre-pill fallback while a focused section has no known occupant yet: names the
 *  section instead of a player (same pill chrome, no flag). */
export function renderCenterSection(title: string): string {
  if (!title) return "";
  return `<div class="center-id center-sec"><span>${escapeHtml(title)}</span></div>`;
}

function insightScore(ins: MatchInsight): string {
  if (!ins.score || !ins.score.length) return ins.status === "live" ? "Live" : "—";
  return ins.score
    .map((set) => {
      const sup = set.tb != null ? `<sup>${set.tb}</sup>` : "";
      return set.p1 >= set.p2 ? `${set.p1}${sup}-${set.p2}` : `${set.p1}-${set.p2}${sup}`;
    })
    .join(" ");
}

function insightPlayer(side: InsightSide, win: boolean, rounds: Round[]): string {
  const tag = side.seed != null ? `#${side.ranking ?? "?"} · seed ${side.seed}`
    : side.ranking != null ? `#${side.ranking}` : "";
  // How deep their run went. Cumulative time-on-court is deliberately NOT repeated here —
  // it already lives in the hover/pin readout.
  const path = roundAbbrev(side.roundReached, rounds);
  const bd = side.age != null ? ` · ${side.age}y${side.birthdayNear ? ` 🎂 ${escapeHtml(side.birthday)}` : ""}` : "";
  return (
    `<div class="mi-pl${win ? " mi-win" : ""}">` +
    `<span class="mi-fl">${flagImg(side.country, 14, side.country)}</span>` +
    `<span class="mi-who"><b>${escapeHtml(side.name)}</b>${win ? ' <span class="mi-chk">✓</span>' : ""}` +
    `<small>${escapeHtml([tag, path].filter(Boolean).join(" · "))}${bd}</small></span></div>`
  );
}

function statBar(label: string, v: [number, number] | null): string {
  if (!v) return "";
  const [a, b] = v, max = Math.max(1, a + b);
  return (
    `<div class="mi-stat"><span class="mi-sv">${a}</span>` +
    `<span class="mi-bar"><i style="width:${Math.round((a / max) * 100)}%"></i><i style="width:${Math.round((b / max) * 100)}%"></i></span>` +
    `<span class="mi-sv">${b}</span><span class="mi-slab">${label}</span></div>`
  );
}

/** One side of the strip's matchup row. Both name forms are always rendered — a pure CSS
 *  media query picks the full name (wide) or the surname (≤960px), so no resize JS exists.
 *  `rev` mirrors the right-hand side: name then flag, so the flags bracket the score. */
function stripSide(side: InsightSide, win: boolean, rev: boolean): string {
  const short = side.name.split(" ").slice(-1)[0] || side.name;
  const name = `<span class="ms-name"><span class="nm-full">${escapeHtml(side.name)}</span>` +
    `<span class="nm-short">${escapeHtml(short)}</span></span>`;
  const chk = win ? '<span class="mi-chk">✓</span>' : "";
  const flag = `<span class="ms-fl">${flagImg(side.country, 14, side.country)}</span>`;
  return `<span class="ms-side">${rev ? `${name}${chk}${flag}` : `${flag}${name}${chk}`}</span>`;
}

/** Slim match context strip — an in-flow summary at the top of the wheel column on EVERY
 *  viewport (the same dock pattern the readout already uses ≤960px). The wheel is never
 *  covered; the heavy tail lives one tap away behind "Details ▾" (renderMatchDetail). */
export function renderMatchStrip(ins: MatchInsight, nodeId: string, opts: { expanded: boolean; focused: boolean }): string {
  const live = ins.status === "live"
    ? ` · <span class="ms-live"><span class="ms-dot" aria-hidden="true"></span>live</span>` : "";
  // Zoom is the strip's permanent, accented action (the old ghost "Focus" button, promoted).
  // Only when the view already sits AT this match's own section does it flip to "Reset
  // zoom" — an empty data-id routed through the same focus branch (setFocus(undefined)),
  // never the nuclear reset: pin + match survive. Focused anywhere ELSE it stays "⊕ Zoom"
  // so the strip can still drill into the selected match's section.
  const zoom = opts.focused
    ? `<button class="ms-zoom" data-action="focus" data-id="">Reset zoom</button>`
    : `<button class="ms-zoom" data-action="focus" data-id="${escapeHtml(nodeId)}">⊕ Zoom</button>`;
  return (
    `<div class="match-strip" role="region" aria-label="Match insight">` +
    `<div class="ms-hd"><span class="ms-rnd">${escapeHtml(ins.roundName)} · ${escapeHtml(ins.surface)}${live}</span>` +
    `<button class="ms-more" data-action="detail-expand" aria-expanded="${opts.expanded}">Details ${opts.expanded ? "▴" : "▾"}</button>` +
    zoom +
    `<button class="ms-close" data-action="close-detail" aria-label="Close match">✕</button></div>` +
    `<div class="ms-mu">${stripSide(ins.p1, ins.winner === "p1", false)}` +
    `<div class="ms-score">${insightScore(ins)}</div>` +
    `${stripSide(ins.p2, ins.winner === "p2", true)}</div>` +
    `</div>`
  );
}

/** On-demand match detail tier (the strip's "Details ▾"): per-player meta, badges, ELO
 *  context, serve stats, duration and the SofaScore link. In-flow under the strip on
 *  desktop; a fixed bottom sheet with the standard grip/✕ chrome on phones. Every piece
 *  of its chrome (scrim, grip, ✕) collapses ONLY this tier — the strip stays. */
export function renderMatchDetail(ins: MatchInsight, sofaUrl: string | null, rounds: Round[]): string {
  // The "Upset" pill would triple-signal with the ELO line's accent — one signal only.
  const badges = ins.badges
    .filter((b) => b !== "Upset")
    .map((b) => `<span class="mi-bdg">${escapeHtml(b)}</span>`)
    .join("");
  const dur = ins.durationSec != null
    ? `⏱ ${formatDuration(ins.durationSec)}${ins.durationProvisional ? " (live)" : ""}` : "";
  const link = sofaUrl
    ? `<a class="mi-link" href="${sofaUrl}" target="_blank" rel="noopener noreferrer">Open in SofaScore ↗</a>` : "";
  return (
    // Scrim is inert on desktop; on phones it dims the bracket behind the bottom sheet
    // and tapping it collapses the detail tier (the strip and selection survive).
    `<div class="mi-scrim" data-action="detail-expand" aria-hidden="true"></div>` +
    // role="region", NOT dialog: on desktop this is an in-flow disclosure, and the phone
    // sheet has no focus containment — claiming a modal dialog would be dishonest to AT.
    // tabindex="-1" makes the region itself the programmatic focus target on expand
    // (desktop hides .sheet-bar, so focusing its ✕ there would silently no-op to <body>).
    `<aside class="mi-detail" role="region" aria-label="Match details" tabindex="-1">` +
    `<div class="sheet-bar"><button class="sheet-grip" data-action="detail-expand" aria-label="Collapse details"><span></span></button>` +
    `<button class="sheet-close" data-action="detail-expand" aria-label="Close details">✕</button></div>` +
    `<div class="mi-mu">${insightPlayer(ins.p1, ins.winner === "p1", rounds)}` +
    `${insightPlayer(ins.p2, ins.winner === "p2", rounds)}</div>` +
    (badges ? `<div class="mi-badges">${badges}</div>` : "") +
    statBar("Aces", ins.aces) + statBar("Double faults", ins.doubleFaults) +
    (ins.eloLine ? `<div class="mi-elo${ins.upset ? " upset" : ""}">${escapeHtml(ins.eloLine)}</div>` : "") +
    (dur ? `<div class="mi-dur">${dur}</div>` : "") +
    link +
    `</aside>`
  );
}

/**
 * Seed lens panel. A Seed|ELO toggle reorders the list AND recolours the wheel:
 * "seed" lists the seeds in seed order; "elo" lists (and lights) the top 32 by surface ELO,
 * flagging the unseeded contenders the seeding leaves out. How far each got, not the giant-killers.
 */
export function renderSeedPanel(prog: SeedProgress, rounds: Round[]): string {
  const pct = prog.total ? Math.round((prog.remaining / prog.total) * 100) : 0;
  const elo = prog.mode === "elo";
  const toggle =
    `<div class="seg sp-sort" role="group" aria-label="Rank by">` +
    `<button class="ctrl${!elo ? " active" : ""}" data-action="seed-sort" data-sort="seed" aria-pressed="${!elo}">Seed</button>` +
    `<button class="ctrl${elo ? " active" : ""}" data-action="seed-sort" data-sort="elo" aria-pressed="${elo}">ELO</button>` +
    `</div>`;
  const title = elo ? "Top 32 by ELO" : "Seeds still in";
  const sub = elo ? "By surface ELO" : "Seed progress";
  const rows = prog.rows
    .map((r) => {
      const champ = r.roundReached >= rounds.length;
      const label = roundAbbrev(r.roundReached, rounds);
      // The visible label is intentionally word-free ("→ R16" / "R64"); the aria-label keeps the
      // in/out distinction for screen readers, since colour alone shouldn't carry that meaning.
      const where = champ
        ? `<span class="sp-rd champ" aria-label="champion">🏆 Champion</span>`
        : r.alive
        ? `<span class="sp-rd alive" aria-label="in, reached ${escapeHtml(label)}">→ ${escapeHtml(label)}</span>`
        : `<span class="sp-rd out" aria-label="out, ${escapeHtml(label)}">${escapeHtml(label)}</span>`;
      const bolt = r.upset ? `<span class="sp-bolt" role="img" aria-label="upset — lost as the favourite">⚡</span>` : "";
      const elov = r.elo != null ? `<span class="sp-elo" title="surface ELO">${Math.round(r.elo)}</span>` : "";
      // In ELO mode, flag the contenders the seeding leaves out (the whole point of the view).
      const tag = elo && r.seed == null ? `<span class="sp-tag uns" title="not seeded">unseeded</span>` : "";
      return (
        `<li class="sp-row${r.alive ? " on" : ""}" data-hl-path data-occupant="${escapeHtml(r.playerId)}">` +
        `<span class="sp-seed">${r.rank}</span>` +
        `<span class="sp-name"><span class="nm">${escapeHtml(r.name)}</span>${tag}</span>` +
        `<span class="sp-meta">${elov}${bolt}${where}</span>` +
        `</li>`
      );
    })
    .join("");
  return (
    `<aside class="panel seed-panel">` +
    sheetBar() +
    toggle +
    `<div class="seeds-in"><div class="seeds-top"><span>${title}</span><b>${prog.remaining} / ${prog.total}</b></div>` +
    `<div class="seeds-track"><span style="width:${pct}%"></span></div></div>` +
    (rows ? `<div class="panel-sub">${sub}</div><ol class="sp-list">${rows}</ol>` : `<div class="panel-empty">No data for this draw</div>`) +
    `</aside>`
  );
}

export function renderCountryPanel(rows: NationRow[], selected: string | undefined, rounds: Round[]): string {
  const items = rows
    .map((r) => {
      const on = selected === r.country;
      const head =
        `<li class="ct-row${on ? " on" : ""}" data-action="country" data-country="${escapeHtml(r.country)}">` +
        `<span class="ct-flag">${flagImg(r.country, 13)}</span>` +
        `<span class="ct-name">${escapeHtml(r.country)}</span>` +
        `<span class="ct-cnt"><b>${r.stillIn}</b>/${r.entrants}</span></li>`;
      if (!on) return head;
      const expand = r.players
        .map((p) =>
          `<div class="ct-pl" data-hl-path data-occupant="${escapeHtml(p.id)}"><b>${escapeHtml(p.name)}</b>` +
          `<span class="ct-rd${p.alive ? " alive" : ""}">${p.alive ? "in · " : ""}${roundAbbrev(p.roundReached, rounds)}</span></div>`)
        .join("");
      return head + `<li class="ct-expand">${expand}</li>`;
    })
    .join("");
  return `<aside class="panel country-panel">${sheetBar()}<div class="panel-sub">Nations — still in</div><ol class="ct-list">${items}</ol></aside>`;
}
