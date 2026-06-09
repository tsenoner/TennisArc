import { arc as d3arc } from "d3-shape";
import type { LayoutArc } from "./layout";
import type { ColorFn } from "./color";
import { COLOR_DIMS, type ColorDim } from "./color";
import type { Match, MatchStats, Player, Tour } from "./model";
import type { SlamIndex } from "./model";
import type { Theme } from "./theme";
import { flagEmoji } from "./flags";
import type { LeaderRow, SeedInsights, NationRow } from "./state";
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

/** Render the sunburst as a self-contained SVG string (centred), with optional write-once curved labels. */
export function renderSunburst(arcs: LayoutArc[], color: ColorFn, size: number, labels?: SunburstLabels): string {
  const c = size / 2;
  const defs: string[] = [];
  const texts: string[] = [];
  const pt = (r: number, ang: number) => `${(r * Math.sin(ang)).toFixed(2)},${(-r * Math.cos(ang)).toFixed(2)}`;

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
      return `<path class="${cls}" d="${d}" fill="${color(a.occupant)}" ` +
        `data-action="zoom" data-id="${a.id}" data-match="${a.matchId}" data-occupant="${escapeHtml(a.occupant ?? "")}"></path>`;
    })
    .join("");

  return (
    `<svg viewBox="0 0 ${size} ${size}" preserveAspectRatio="xMidYMid meet" ` +
    `role="img" aria-label="Tournament bracket sunburst">` +
    `<g transform="translate(${c},${c})" data-action="reset">` +
    `<defs>${defs.join("")}</defs>${paths}${texts.join("")}</g></svg>`
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
    `<button class="ctrl${opts.tour === t ? " active" : ""}" data-action="tour" data-tour="${t}">${t}</button>`;
  const dimBtn = (d: ColorDim) =>
    `<button class="ctrl${opts.colorDim === d ? " active" : ""}" data-action="colordim" data-dim="${d}">${DIM_LABELS[d]}</button>`;

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
        return `<button data-action="slam" data-slam="${s.slam}" class="ctrl slam${on}${live}"${off ? " disabled" : ""} data-surface="${s.surface}" title="${s.entry ? escapeHtml(s.entry.name) : s.slam + " — not available"}">${s.abbr}</button>`;
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
    `<div class="seg" role="group" aria-label="Tour">${tours.map(tourBtn).join("")}</div>` +
    switcher +
    `<div class="seg" role="group" aria-label="Colour by">${COLOR_DIMS.map(dimBtn).join("")}</div>` +
    `<button class="ctrl theme" data-action="theme" aria-label="Toggle theme">${opts.theme === "dark" ? "☀" : "☾"}</button>` +
    `</header>`
  );
}

export function renderLegend(dim: ColorDim): string {
  if (dim === "country") return `<div class="legend">Colour: nationality</div>`;
  const label = dim === "time" ? "fresh → most court time" : "lower seed → top seed";
  return `<div class="legend"><span class="legend-grad" aria-hidden="true"></span><span>${label}</span></div>`;
}

export function renderLeaderboard(rows: LeaderRow[], color: ColorFn): string {
  const max = Math.max(1, ...rows.map((r) => r.sec));
  const items = rows
    .map((r, i) => {
      const w = Math.round((r.sec / max) * 100);
      return (
        `<li class="lb-row">` +
        `<span class="lb-rank">${i + 1}</span>` +
        `<span class="lb-name">${escapeHtml(r.name)} <span class="lb-ctry">${flagEmoji(r.country)} ${escapeHtml(r.country)}</span></span>` +
        `<span class="lb-bar"><span aria-hidden="true" style="width:${w}%;background:${color(r.playerId)}"></span></span>` +
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
    `<div class="readout${info.projected ? " projected" : ""}">` +
    `<div class="ro-ctry">${flagEmoji(info.country)} ${escapeHtml(info.country)}</div>` +
    `<div class="ro-name">${escapeHtml(info.name)}</div>` +
    (meta1 ? `<div class="ro-meta">${escapeHtml(meta1)}</div>` : "") +
    (info.eloLabel ? `<div class="ro-elo">${escapeHtml(info.eloLabel)}</div>` : "") +
    (meta2 ? `<div class="ro-meta">${escapeHtml(meta2)}</div>` : "") +
    `</div>`
  );
}

const STATUS_LABEL: Record<Match["status"], string> = {
  notstarted: "Not started", scheduled: "Scheduled", live: "Live",
  finished: "", retired: "Retired", walkover: "Walkover",
};

function renderScore(m: Match): string {
  if (m.score && m.score.length) {
    return m.score
      .map((s) => {
        const sup = s.tb != null ? `<sup>${s.tb}</sup>` : "";
        // the tiebreak points belong to the set winner (higher game count)
        return s.p1 >= s.p2 ? `${s.p1}${sup}-${s.p2}` : `${s.p1}-${s.p2}${sup}`;
      })
      .join(" ");
  }
  return STATUS_LABEL[m.status] || "—";
}

function renderStats(stats: MatchStats | null): string {
  if (!stats) return "";
  const row = (label: string, v?: [number | string, number | string]) =>
    v ? `<tr><td>${v[0]}</td><th>${label}</th><td>${v[1]}</td></tr>` : "";
  const body =
    row("Aces", stats.aces) +
    row("Double faults", stats.doubleFaults) +
    row("1st serve %", stats.firstServePct) +
    row("Service pts won %", stats.servicePointsWonPct) +
    row("Break pts won", stats.breakPointsConverted);
  return body ? `<table class="md-stats">${body}</table>` : "";
}

function renderPlayerLine(m: Match, p: Player | null, side: "p1" | "p2"): string {
  if (!p) return `<div class="md-player"><span class="md-tbd">TBD</span></div>`;
  const tag = p.seed != null ? `(${p.seed})` : p.entry ? `(${p.entry})` : "";
  const win = m.winner === side ? " md-win" : "";
  return (
    `<div class="md-player${win}">` +
    `<span class="md-name">${escapeHtml(p.name)}</span> ` +
    `<span class="md-ctry">${escapeHtml(p.country)}</span>` +
    (tag ? ` <span class="md-seed">${tag}</span>` : "") +
    `</div>`
  );
}

export function renderMatchDetail(
  m: Match, p1: Player | null, p2: Player | null, url: string | null, roundName: string,
): string {
  const dur =
    m.durationSec != null
      ? `<div class="md-dur">⏱ ${formatDuration(m.durationSec)}${m.durationProvisional ? " (live)" : ""}</div>`
      : "";
  const link = url
    ? `<a class="md-link" href="${url}" target="_blank" rel="noopener noreferrer">Open in SofaScore ↗</a>`
    : "";
  return (
    `<div class="detail" role="dialog" aria-label="Match detail">` +
    `<button class="detail-close" data-action="close-detail" aria-label="Close">✕</button>` +
    `<div class="md-round">${escapeHtml(roundName)}</div>` +
    `<div class="md-matchup">${renderPlayerLine(m, p1, "p1")}<div class="md-score">${renderScore(m)}</div>${renderPlayerLine(m, p2, "p2")}</div>` +
    dur + renderStats(m.stats) + link +
    `</div>`
  );
}

export function renderSeedPanel(ins: SeedInsights): string {
  const pct = ins.seedsTotal ? Math.round((ins.seedsRemaining / ins.seedsTotal) * 100) : 0;
  const rows = ins.upsets
    .map((u) =>
      `<li class="up-row">` +
      `<span class="up-bolt">⚡</span>` +
      `<span class="up-m"><b>${escapeHtml(u.winnerName)}</b> <small>d. ${u.loserSeed != null ? `[${u.loserSeed}] ` : ""}${escapeHtml(u.loserName)}</small></span>` +
      `<span class="up-rd">${escapeHtml(u.roundName)}</span>` +
      `</li>`)
    .join("");
  return (
    `<aside class="panel seed-panel">` +
    `<div class="seeds-in"><div class="seeds-top"><span>Seeds still in</span><b>${ins.seedsRemaining} / ${ins.seedsTotal}</b></div>` +
    `<div class="seeds-track"><span style="width:${pct}%"></span></div></div>` +
    (rows ? `<div class="panel-sub">Biggest upsets</div><ol class="up-list">${rows}</ol>` : `<div class="panel-empty">No upsets yet</div>`) +
    `</aside>`
  );
}

export function renderCountryPanel(rows: NationRow[], selected?: string): string {
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
          `<span class="ct-rd${p.alive ? " alive" : ""}">${p.alive ? "in · " : ""}R${p.roundReached}</span></div>`)
        .join("");
      return head + `<li class="ct-expand">${expand}</li>`;
    })
    .join("");
  return `<aside class="panel country-panel"><div class="panel-sub">Nations — still in</div><ol class="ct-list">${items}</ol></aside>`;
}
