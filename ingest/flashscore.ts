import type { LiveRecord, Tour } from "../src/model";
import { TOURNEY } from "./names";

const num = (v: string): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Value of a `¬`-joined `key÷value` pair, or "" when absent. */
function field(rec: string, key: string): string {
  for (const p of rec.split("¬")) {
    const i = p.indexOf("÷");
    if (i > 0 && p.slice(0, i) === key) return p.slice(i + 1);
  }
  return "";
}

const SET_PAIRS: ReadonlyArray<readonly [string, string]> =
  [["BA", "BB"], ["BC", "BD"], ["BE", "BF"], ["BG", "BH"], ["BI", "BJ"]];

/**
 * Parse the Flashscore global livescore feed down to one slam's MAIN-DRAW SINGLES matches.
 * Tournaments are positional: a header record carrying `ZA` precedes its match records until the
 * next header. The `"${TOUR} - SINGLES: "` prefix excludes qualification ("- SINGLES - QUALIFICATION:"),
 * doubles ("- DOUBLES:") and juniors ("- GIRLS - SINGLES:"). Odds fields (AL/MW) are never read.
 */
export function parseLiveFeed(text: string, opts: { tour: Tour; slam: string }): LiveRecord[] {
  const wantNames = TOURNEY[opts.slam] ?? [opts.slam.replace(/-/g, " ")];
  const prefix = `${opts.tour.toLowerCase()} - singles: `;
  const out: LiveRecord[] = [];
  let inBlock = false;

  for (const rec of text.split("~")) {
    const za = field(rec, "ZA");
    if (za) {
      const label = za.toLowerCase();
      inBlock = label.startsWith(prefix) && wantNames.some((n) => label.slice(prefix.length).startsWith(n));
      continue; // a header record is never a match record
    }
    if (!inBlock || !rec.startsWith("AA÷")) continue;

    const stage = num(field(rec, "AB"));
    if (stage !== 1 && stage !== 2 && stage !== 3) continue;
    const home = field(rec, "AE"), away = field(rec, "AF");
    if (!home || !away || home.includes("/") || away.includes("/")) continue; // "/" = doubles pair, skip defensively

    const sets: Array<[number, number]> = [];
    for (const [h, a] of SET_PAIRS) {
      const hv = field(rec, h), av = field(rec, a);
      if (hv === "" && av === "") continue;
      sets.push([num(hv), num(av)]);
    }
    out.push({
      id: field(rec, "AA"),
      stage: stage as 1 | 2 | 3,
      home, away,
      setsWon: [num(field(rec, "AG")), num(field(rec, "AH"))],
      sets,
    });
  }
  return out;
}
