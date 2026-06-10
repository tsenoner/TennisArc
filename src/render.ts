import { arc as d3arc } from "d3-shape";
import type { LayoutArc } from "./layout";
import type { ColorFn } from "./color";
import { COLOR_DIMS, type ColorDim } from "./color";
import type { Tour } from "./model";
import type { Round, SlamIndex } from "./model";
import type { Theme } from "./theme";
import { flagEmoji } from "./flags";
import type { LeaderRow, SeedProgress, NationRow, InsightSide, MatchInsight } from "./state";
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

export interface SunburstLabels { anchors: Set<string>; text: (occupant: string) => string; }
/** A round name pinned to a ring's mid-radius, drawn as a faint axis at 12 o'clock. */
export interface RingLabel { y: number; label: string; }

/** Render the sunburst as a self-contained SVG string (centred), with optional write-once curved labels. */
export function renderSunburst(
  arcs: LayoutArc[], color: ColorFn, size: number, labels?: SunburstLabels, rings?: RingLabel[],
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
        const label = labels.text(a.occupant);
        const rc = (a.y0 + a.y1) / 2;
        const span = a.x1 - a.x0;
        const fs = Math.min(13, Math.max(8, (a.y1 - a.y0) * 0.42));
        // gate: only label when the arc's chord can hold the text
        if (label && rc * span >= label.length * fs * 0.55) {
          const mid = (a.x0 + a.x1) / 2;
          const rev = mid > Math.PI / 2 && mid < 3 * Math.PI / 2;
          const big = span > Math.PI ? 1 : 0;
          const pad = Math.min(0.03, span * 0.12);
          const s0 = a.x0 + pad, s1 = a.x1 - pad;
          const pid = `lp${a.id.replace(/[^a-z0-9]/gi, "")}`;
          const dPath = rev
            ? `M${pt(rc, s1)} A${rc},${rc} 0 ${big} 0 ${pt(rc, s0)}`
            : `M${pt(rc, s0)} A${rc},${rc} 0 ${big} 1 ${pt(rc, s1)}`;
          defs.push(`<path id="${pid}" d="${dPath}"></path>`);
          texts.push(
            `<text class="arc-label" font-size="${fs.toFixed(1)}">` +
            `<textPath href="#${pid}" startOffset="50%" text-anchor="middle">${escapeHtml(label)}</textPath></text>`,
          );
        }
      }
      return `<path class="${cls}" d="${d}" fill="${color(a)}" ` +
        `data-action="inspect" data-id="${a.id}" data-match="${a.matchId}" data-occupant="${escapeHtml(a.occupant ?? "")}"></path>`;
    })
    .join("");

  return (
    `<svg viewBox="0 0 ${size} ${size}" preserveAspectRatio="xMidYMid meet" ` +
    `role="img" aria-label="Tournament bracket sunburst">` +
    `<g transform="translate(${c},${c})" data-action="reset">` +
    `<defs>${defs.join("")}</defs>${paths}${texts.join("")}${ringTexts}</g></svg>`
  );
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
}): string {
  const tours: Tour[] = ["ATP", "WTA"];
  const tourBtn = (t: Tour) =>
    `<button class="ctrl${opts.tour === t ? " active" : ""}" data-action="tour" data-tour="${t}" aria-pressed="${opts.tour === t}">${t}</button>`;
  const dimBtn = (d: ColorDim) =>
    `<button class="ctrl${opts.colorDim === d ? " active" : ""}" data-action="colordim" data-dim="${d}" aria-pressed="${opts.colorDim === d}">${DIM_LABELS[d]}</button>`;

  let switcher = "";
  if (opts.index && opts.year != null) {
    const years = availableYears(opts.index, opts.tour);
    const i = years.indexOf(opts.year);
    const prevY = i >= 0 && i + 1 < years.length ? years[i + 1] : "";
    const nextY = i > 0 ? years[i - 1] : "";
    const yearStep = (delta: number, target: number | "") =>
      `<button class="ctrl yr-step" data-action="year" data-year="${target}"${target === "" ? " disabled" : ""} aria-label="${delta < 0 ? "Previous" : "Next"} year">${delta < 0 ? "◀" : "▶"}</button>`;
    const slots = slamsForYear(opts.index, opts.year, opts.tour)
      .map((s) => {
        const on = opts.slam === s.slam ? " active" : "";
        const off = s.entry ? "" : " disabled";
        const live = s.entry?.status === "live" ? " live" : "";
        return `<button data-action="slam" data-slam="${s.slam}" class="ctrl slam${on}${live}"${off ? " disabled" : ""}${on ? ' aria-current="true"' : ""} data-surface="${s.surface}" title="${s.entry ? escapeHtml(s.entry.name) : s.slam + " — not available"}">${s.abbr}</button>`;
      })
      .join("");
    switcher =
      `<div class="seg slam-switch" role="group" aria-label="Grand Slam">` +
      yearStep(-1, prevY) + `<span class="yr">${opts.year}</span>` + yearStep(1, nextY) +
      slots + `</div>`;
  }

  return (
    `<header class="controls">` +
    `<a class="brand" href="/" aria-label="TennisArc home">` +
    `<img class="brand-mark" src="/logo.svg" width="28" height="28" alt="" />` +
    `<span class="brand-name">Tennis<span>Arc</span></span></a>` +
    `<div class="seg tour-seg" role="group" aria-label="Tour">${tours.map(tourBtn).join("")}</div>` +
    switcher +
    `<div class="seg lens-seg" role="group" aria-label="Colour by">${COLOR_DIMS.map(dimBtn).join("")}</div>` +
    `<button class="ctrl theme" data-action="theme" aria-label="Toggle theme">${opts.theme === "dark" ? "☀" : "☾"}</button>` +
    `</header>`
  );
}

export function renderLegend(dim: ColorDim): string {
  if (dim === "country") return `<div class="legend">Colour: nationality</div>`;
  const label = dim === "time" ? "fresh → most court time" : "unseeded → top seed";
  const grad = dim === "seed" ? "legend-grad seed" : "legend-grad";
  return `<div class="legend"><span class="${grad}" aria-hidden="true"></span><span>${label}</span></div>`;
}

export function renderLeaderboard(rows: LeaderRow[]): string {
  const max = Math.max(1, ...rows.map((r) => r.sec));
  const items = rows
    .map((r, i) => {
      const w = Math.round((r.sec / max) * 100);
      return (
        `<li class="lb-row">` +
        `<span class="lb-rank">${i + 1}</span>` +
        `<span class="lb-name">${escapeHtml(r.name)} <span class="lb-ctry">${flagEmoji(r.country)} ${escapeHtml(r.country)}</span></span>` +
        `<span class="lb-bar"><span aria-hidden="true" style="width:${w}%"></span></span>` +
        `<span class="lb-time">${formatDuration(r.sec)}${r.provisional ? "*" : ""}</span>` +
        `</li>`
      );
    })
    .join("");
  return `<aside class="leaderboard"><h2>Most time on court</h2><ol class="lb-list">${items}</ol></aside>`;
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

/** The always-legible centre card naming the hovered/focused player. */
export function renderReadout(info: ReadoutInfo | null): string {
  if (!info) return `<div class="readout" aria-hidden="true"></div>`;
  const rank = info.ranking != null ? `#${info.ranking}` : "";
  const seed = info.seed != null ? `seed ${info.seed}` : "";
  const meta1 = [rank, seed].filter(Boolean).join(" · ");
  const time = info.sec > 0 ? `${formatDuration(info.sec)}${info.provisional ? " (live)" : ""} on court` : "";
  const meta2 = [info.roundLabel, time].filter(Boolean).join(" · ");
  return (
    `<div class="readout filled${info.projected ? " projected" : ""}">` +
    `<div class="ro-ctry">${flagEmoji(info.country)} ${escapeHtml(info.country)}</div>` +
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
  const path = `${roundAbbrev(side.roundReached, rounds)}${side.sec > 0 ? ` · ${formatDuration(side.sec)}` : ""}`;
  const bd = side.age != null ? ` · ${side.age}y${side.birthdayNear ? ` 🎂 ${escapeHtml(side.birthday)}` : ""}` : "";
  return (
    `<div class="mi-pl${win ? " mi-win" : ""}">` +
    `<span class="mi-fl">${flagEmoji(side.country)}</span>` +
    `<span class="mi-who"><b>${escapeHtml(side.name)}</b>${win ? ' <span class="mi-chk">✓</span>' : ""}` +
    `<small>${escapeHtml(tag)} · ${escapeHtml(path)}${bd}</small></span></div>`
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

/** Rich match insight rendered in the panel column (replaces the lens panel while a match is selected). */
export function renderMatchInsight(ins: MatchInsight, sofaUrl: string | null, nodeId: string, rounds: Round[]): string {
  const badges = ins.badges
    .map((b) => `<span class="mi-bdg${b === "Upset" ? " up" : ""}">${escapeHtml(b)}</span>`)
    .join("");
  const dur = ins.durationSec != null
    ? `⏱ ${formatDuration(ins.durationSec)}${ins.durationProvisional ? " (live)" : ""}` : "";
  const link = sofaUrl
    ? `<a class="mi-link" href="${sofaUrl}" target="_blank" rel="noopener noreferrer">Open in SofaScore ↗</a>` : "";
  return (
    // Scrim is inert on desktop; on phones it dims the bracket behind the bottom-sheet
    // and tapping it closes the detail (same action as the back button).
    `<div class="mi-scrim" data-action="close-detail" aria-hidden="true"></div>` +
    `<aside class="panel match-insight" role="dialog" aria-label="Match insight">` +
    `<div class="mi-hd"><button class="mi-back" data-action="close-detail">‹ back</button>` +
    `<span class="mi-rnd">${escapeHtml(ins.roundName)} · ${escapeHtml(ins.surface)}</span></div>` +
    `<div class="mi-mu">${insightPlayer(ins.p1, ins.winner === "p1", rounds)}` +
    `<div class="mi-score">${insightScore(ins)}</div>` +
    `${insightPlayer(ins.p2, ins.winner === "p2", rounds)}</div>` +
    (badges ? `<div class="mi-badges">${badges}</div>` : "") +
    statBar("Aces", ins.aces) + statBar("Double faults", ins.doubleFaults) +
    (ins.eloLine ? `<div class="mi-elo">${escapeHtml(ins.eloLine)}${ins.upset ? " — upset" : ""}</div>` : "") +
    (dur ? `<div class="mi-dur">${dur}</div>` : "") +
    `<div class="mi-acts">${link}<button class="mi-focus" data-action="focus" data-id="${escapeHtml(nodeId)}">⊕ Focus this section</button></div>` +
    `</aside>`
  );
}

/** Seed lens panel: every seed and how far they got (deepest run first), not the giant-killers. */
export function renderSeedPanel(prog: SeedProgress, rounds: Round[]): string {
  const pct = prog.seedsTotal ? Math.round((prog.seedsRemaining / prog.seedsTotal) * 100) : 0;
  const rows = prog.rows
    .map((r) => {
      const champ = r.roundReached >= rounds.length;
      const label = roundAbbrev(r.roundReached, rounds);
      const where = champ
        ? `<span class="sp-rd champ">🏆 Champion</span>`
        : r.alive
        ? `<span class="sp-rd alive">in · ${escapeHtml(label)}</span>`
        : `<span class="sp-rd">out · ${escapeHtml(label)}</span>`;
      const bolt = r.upset ? ` <span class="sp-bolt" role="img" aria-label="upset — lost as the favourite">⚡</span>` : "";
      return (
        `<li class="sp-row${r.alive ? " on" : ""}">` +
        `<span class="sp-seed">${r.seed}</span>` +
        `<span class="sp-name">${escapeHtml(r.name)}${bolt}</span>` +
        where +
        `</li>`
      );
    })
    .join("");
  return (
    `<aside class="panel seed-panel">` +
    `<div class="seeds-in"><div class="seeds-top"><span>Seeds still in</span><b>${prog.seedsRemaining} / ${prog.seedsTotal}</b></div>` +
    `<div class="seeds-track"><span style="width:${pct}%"></span></div></div>` +
    (rows ? `<div class="panel-sub">Seed progress</div><ol class="sp-list">${rows}</ol>` : `<div class="panel-empty">No seeds in this draw</div>`) +
    `</aside>`
  );
}

/** Short round label from a player's furthest-reached round index. */
export function roundAbbrev(reached: number, rounds: Round[]): string {
  if (reached >= rounds.length) return "Champion";
  const name = rounds[reached]?.name ?? `R${reached}`;
  return name
    .replace(/^Round of\s*/i, "R")
    .replace(/^Quarterfinal.*/i, "QF")
    .replace(/^Semifinal.*/i, "SF")
    .replace(/^Final$/i, "F");
}

export function renderCountryPanel(rows: NationRow[], selected: string | undefined, rounds: Round[]): string {
  const items = rows
    .map((r) => {
      const on = selected === r.country;
      const head =
        `<li class="ct-row${on ? " on" : ""}" data-action="country" data-country="${escapeHtml(r.country)}">` +
        `<span class="ct-flag">${flagEmoji(r.country)}</span>` +
        `<span class="ct-name">${escapeHtml(r.country)}</span>` +
        `<span class="ct-cnt"><b>${r.stillIn}</b>/${r.entrants}</span></li>`;
      if (!on) return head;
      const expand = r.players
        .map((p) =>
          `<div class="ct-pl"><b>${escapeHtml(p.name)}</b>` +
          `<span class="ct-rd${p.alive ? " alive" : ""}">${p.alive ? "in · " : ""}${roundAbbrev(p.roundReached, rounds)}</span></div>`)
        .join("");
      return head + `<li class="ct-expand">${expand}</li>`;
    })
    .join("");
  return `<aside class="panel country-panel"><div class="panel-sub">Nations — still in</div><ol class="ct-list">${items}</ol></aside>`;
}
