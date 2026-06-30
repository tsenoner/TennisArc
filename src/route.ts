import type { Tour } from "./model";
import { SLAM_ORDER } from "./slams";
import { COLOR_DIMS, type ColorDim } from "./color";
import type { SeedSort } from "./state";

/**
 * A fully-resolved, shareable view. The path carries the resource (which draw);
 * the query carries the view options (which lens / seed sort). Zoom/focus is NOT
 * part of a Route — it rides the URL hash as session-only state (see app.ts).
 */
export interface Route {
  tour: Tour;
  year: number;
  slam: string;
  view: ColorDim; // lens / "tab"  → state.colorDim
  sub: SeedSort;  // seed sort / "subtab" → state.seedSort
}

/**
 * Tolerant parse of `location.pathname` + `location.search` into whatever fields
 * are present and pass a syntactic whitelist. Never throws and never applies
 * defaults or consults the slam manifest — that validation belongs to the caller,
 * which has the index. Unknown/malformed fields are simply omitted.
 */
export function parseRoute(pathname: string, search: string): Partial<Route> {
  const out: Partial<Route> = {};

  // Path: /{tour}/{year}/{slam}. Parsed positionally and independently, so one bad
  // segment never poisons the others; leading/trailing slashes and extras are dropped.
  const [tourSeg, yearSeg, slamSeg] = pathname.split("/").filter(Boolean);
  if (tourSeg) {
    const t = tourSeg.toUpperCase();
    if (t === "ATP" || t === "WTA") out.tour = t;
  }
  if (yearSeg && /^\d{4}$/.test(yearSeg)) out.year = Number(yearSeg);
  if (slamSeg && (SLAM_ORDER as readonly string[]).includes(slamSeg)) out.slam = slamSeg;

  // Query: order-independent, unknown keys ignored. `sub` is captured even under a
  // non-seed view (inert) — buildRoute drops it on the next canonicalization.
  const params = new URLSearchParams(search);
  const view = params.get("view");
  if (view && (COLOR_DIMS as string[]).includes(view)) out.view = view as ColorDim;
  const sub = params.get("sub");
  if (sub === "seed" || sub === "elo") out.sub = sub;

  return out;
}

/**
 * Canonical relative URL (path + query, no hash) for a fully-resolved view.
 * Lowercases the tour; omits the default view (`time`) and the default/inert sub
 * so the bare path means the default view. Query keys are emitted view-before-sub
 * for stable, cache-friendly URLs.
 */
export function buildRoute(r: Route): string {
  const path = `/${r.tour.toLowerCase()}/${r.year}/${r.slam}`;
  const params = new URLSearchParams();
  if (r.view !== "time") params.set("view", r.view);
  if (r.view === "seed" && r.sub === "elo") params.set("sub", r.sub);
  const q = params.toString();
  return q ? `${path}?${q}` : path;
}
