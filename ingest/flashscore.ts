import type { CurrentGame, LiveRecord, Tour } from "../src/model";
import { TOURNEY } from "./names.js"; // .js ext: this module is reached by the /api/live Vercel ESM function (see api/live.ts)

const num = (v: string): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** AB=3 ("not in play") is a BUCKET, not a status: a genuine result shares it with every kind of
 *  non-result ending. These are the AC sub-stages that mean "stopped mid-match, to be resumed" —
 *  the ones that must NOT overlay as a winnerless "finished" (which blanks the arc, reading as a
 *  withdrawal). 36 = interrupted, the only member verified against the live feed (US Open 2026
 *  day 3, four matches). Postponed/cancelled/abandoned/awarded codes live in the same bucket and
 *  are still unmapped — add one here once its number is confirmed against a real record, never
 *  from a guess: mapping the wrong code would silently pause a match that actually ended. */
const HELD_OVER_SUB_STAGES = new Set([36]);

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
    // AC is the sub-stage. AB=3 covers everything "neither scheduled nor live": a genuine result
    // (AC 3), but also a match stopped mid-play and held over (HELD_OVER_SUB_STAGES). Flagging the
    // latter is what lets overlayLive tell a pause from a result. AD is the record's start, but on a
    // held-over record Flashscore REWRITES it to the resume slot (AO keeps the original) — that is
    // the resume time carried by the very source that reported the stoppage, so take it here rather
    // than hoping SofaScore's independent stamp agrees.
    if (stage === 3 && HELD_OVER_SUB_STAGES.has(num(f.get("AC") ?? ""))) {
      record.interrupted = true;
      const ad = num(f.get("AD") ?? "");
      if (ad > 0) record.resumesAt = ad;
    }
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
 * "Current game" header or a BB/SB break-/set-ball marker row) must not capture. Pairing
 * state is scoped to each block: TS/TE tokens reset player and pending so values cannot span
 * block boundaries. The LAST pair wins: an IN-PLAY feed is the current game's full point
 * progression in chronological order (0-15, 0-30, … 40-40 — verified live at the 2026
 * Wimbledon final), so the current score is the final pair. Blocks can arrive `~`-glued
 * ("¬~TS÷…"), so a leading `~` is stripped before key matching. Captured values must look
 * like point values (A or 1–2 digits); anything else means the shape drifted → null, never
 * wrong-loud.
 */
const POINT_VALUE = /^(?:A|\d{1,2})$/;
export function parseCurrentGame(text: string): CurrentGame | null {
  let player: string | null = null;
  let pending: "player" | "value" | null = null;
  const vals: Record<string, string> = {};
  for (const raw of text.split("¬")) {
    const p = raw.startsWith("~") ? raw.slice(1) : raw; // "~" glues a new sub-record to a block start
    const i = p.indexOf("÷");
    if (i <= 0) continue;
    const k = p.slice(0, i), v = p.slice(i + 1);
    // Reset pairing state at structural block boundaries (TS = block start, TE = block end)
    // so drift from one block cannot leak into the next.
    if (k === "TS" || k === "TE") { player = null; pending = null; continue; }
    if (k === "PT") { pending = v === "PT" ? "player" : v === "VA" && player != null ? "value" : null; continue; }
    if (k === "PV") {
      if (pending === "player") player = v;
      else if (pending === "value" && player != null) { vals[player] = v; player = null; } // last pair wins
      pending = null;
    }
  }
  return vals["1"] != null && POINT_VALUE.test(vals["1"]) && vals["2"] != null && POINT_VALUE.test(vals["2"])
    ? { home: vals["1"], away: vals["2"] }
    : null;
}
