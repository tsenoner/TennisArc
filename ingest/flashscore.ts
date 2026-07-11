import type { LiveRecord, Tour } from "../src/model";
import { TOURNEY } from "./names.js"; // .js ext: this module is reached by the /api/live Vercel ESM function (see api/live.ts)

const num = (v: string): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Value of a `¬`-joined `key÷value` pair, or "" when absent. */
function field(rec: string, key: string): string {
  for (const p of rec.split("¬")) {
    const i = p.indexOf("÷");
    if (i > 0 && p.slice(0, i) === key) return p.slice(i + 1);
  }
  return "";
}

/** Parse a whole `¬`-joined record into a key→value map in one pass. Used for match records (which
 *  read many fields) so the record isn't re-split once per lookup. */
function fields(rec: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of rec.split("¬")) {
    const i = p.indexOf("÷");
    if (i > 0) m.set(p.slice(0, i), p.slice(i + 1));
  }
  return m;
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
    const f = fields(rec); // a match record reads many fields — parse it once

    const stage = num(f.get("AB") ?? "");
    if (stage !== 1 && stage !== 2 && stage !== 3) continue;
    const home = f.get("AE") ?? "", away = f.get("AF") ?? "";
    if (!home || !away || home.includes("/") || away.includes("/")) continue; // "/" = doubles pair, skip defensively

    const sets: Array<[number, number]> = [];
    for (const [h, a] of SET_PAIRS) {
      const hv = f.get(h) ?? "", av = f.get(a) ?? "";
      if (hv === "" && av === "") continue;
      sets.push([num(hv), num(av)]);
    }
    const record: LiveRecord = {
      id: f.get("AA") ?? "",
      stage: stage as 1 | 2 | 3,
      home, away,
      setsWon: [num(f.get("AG") ?? ""), num(f.get("AH") ?? "")],
      sets,
    };
    // CX names the current server, but it PERSISTS on finished records (last server) — only a
    // live record's value means "serving now". Exact match against the record's own names.
    if (stage === 2) {
      const cx = f.get("CX") ?? "";
      if (cx === home) record.srv = 1;
      else if (cx === away) record.srv = 2;
    }
    out.push(record);
  }
  return out;
}

/**
 * Parse a `df_mhs_1_<mid>` current-game feed into the two sides' point values, or null when
 * no current game is present (match finished / not started / malformed). Values are the raw
 * display strings ("0" | "15" | "30" | "40" | "A"; plain digits during a tiebreak) — callers
 * render them verbatim. Structure: TS/TE-delimited blocks where each score cell is
 * `PT÷PT ¬ PV÷<playerNo> ¬ PT÷VA ¬ PV÷<value>`; a PT÷VA with no pending player (the
 * "Current game" header) must not capture. Pairing state is scoped to each block: TS/TE
 * tokens reset player and pending so values cannot span block boundaries.
 */
export function parseCurrentGame(text: string): { home: string; away: string } | null {
  let player: string | null = null;
  let pending: "player" | "value" | null = null;
  const vals: Record<string, string> = {};
  for (const p of text.split("¬")) {
    const i = p.indexOf("÷");
    if (i <= 0) continue;
    const k = p.slice(0, i), v = p.slice(i + 1);
    // Reset pairing state at structural block boundaries (TS = block start, TE = block end)
    // so drift from one block cannot leak into the next.
    if (k === "TS" || k === "TE") { player = null; pending = null; continue; }
    if (k === "PT") { pending = v === "PT" ? "player" : v === "VA" && player != null ? "value" : null; continue; }
    if (k === "PV") {
      if (pending === "player") player = v;
      else if (pending === "value" && player != null) { vals[player] = v; player = null; }
      pending = null;
    }
  }
  return vals["1"] != null && vals["2"] != null ? { home: vals["1"], away: vals["2"] } : null;
}
