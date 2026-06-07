import { arc as d3arc } from "d3-shape";
import type { LayoutArc } from "./layout";
import type { ColorFn } from "./color";

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
