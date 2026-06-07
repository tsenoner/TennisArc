import { arc as d3arc } from "d3-shape";
import type { LayoutArc } from "./layout";
import type { ColorFn } from "./color";
import { COLOR_DIMS, type ColorDim } from "./color";
import type { Match, MatchStats, Player, Tour } from "./model";
import type { Theme } from "./theme";
import type { LeaderRow } from "./state";

const PAD_ANGLE = 0.004;   // radians of gap between adjacent arcs
const PAD_RADIUS = 60;     // d3 reference radius for converting padAngle → linear gap

const arcGen = d3arc<LayoutArc>()
  .startAngle((a) => a.x0)
  .endAngle((a) => a.x1)
  .innerRadius((a) => a.y0)
  .outerRadius((a) => a.y1)
  .padAngle(PAD_ANGLE)
  .padRadius(PAD_RADIUS);

/** Render the sunburst as a self-contained SVG string (centred). */
export function renderSunburst(arcs: LayoutArc[], color: ColorFn, size: number): string {
  const c = size / 2;
  const paths = arcs
    .map((a) => {
      const d = arcGen(a) ?? "";
      const cls = a.projected ? "arc projected" : "arc";
      return `<path class="${cls}" d="${d}" fill="${color(a.occupant)}" ` +
        `data-action="zoom" data-id="${a.id}" data-match="${a.matchId}"></path>`;
    })
    .join("");
  return (
    `<svg viewBox="0 0 ${size} ${size}" preserveAspectRatio="xMidYMid meet" ` +
    `role="img" aria-label="Tournament bracket sunburst">` +
    `<g transform="translate(${c},${c})" data-action="reset">${paths}</g></svg>`
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

export function renderControls(opts: { tour: Tour; colorDim: ColorDim; theme: Theme }): string {
  const tours: Tour[] = ["ATP", "WTA"];
  const tourBtn = (t: Tour) =>
    `<button class="ctrl${opts.tour === t ? " active" : ""}" data-action="tour" data-tour="${t}">${t}</button>`;
  const dimBtn = (d: ColorDim) =>
    `<button class="ctrl${opts.colorDim === d ? " active" : ""}" data-action="colordim" data-dim="${d}">${DIM_LABELS[d]}</button>`;
  return (
    `<header class="controls">` +
    `<div class="seg" role="group" aria-label="Tour">${tours.map(tourBtn).join("")}</div>` +
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
        `<span class="lb-name">${escapeHtml(r.name)} <span class="lb-ctry">${escapeHtml(r.country)}</span></span>` +
        `<span class="lb-bar"><span aria-hidden="true" style="width:${w}%;background:${color(r.playerId)}"></span></span>` +
        `<span class="lb-time">${formatDuration(r.sec)}${r.provisional ? "*" : ""}</span>` +
        `</li>`
      );
    })
    .join("");
  return `<aside class="leaderboard"><h2>Most time on court</h2><ol class="lb-list">${items}</ol></aside>`;
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
