// yElo reproduction, CORRECT model (Sackmann "Repurposing Elo for streaks, seasons…", 2021-03-16):
//   "we give her a newbie's rating of 1500 and a history of zero matches. Then we run the Elo algorithm
//    to update her rating over the course of her [N] matches. First she faces [opponent] (with her ACTUAL
//    rating at the time of 1817)…"
// So yElo for player X = reset X to 1500/n=0, replay X's current-year matches in order; each opponent sits
// at their REAL (full-Elo) rating at match time, and ONLY X updates. Computed one player at a time.
//
// Two passes:
//   1. FULL-ELO TIMELINE — a standard forward Elo over all counted matches (both sides update, career n),
//      recording each player's pre-match overall rating. This is the "actual rating at the time" field.
//   2. yElo — per listed player, reset to 1500/n=0 and replay their season vs the recorded opponent rating.
//
//   npx tsx ingest/elo-reverse/yelo-fit.ts ATP            # summary over all boards
//   npx tsx ingest/elo-reverse/yelo-fit.ts ATP --board 20260112
//   npx tsx ingest/elo-reverse/yelo-fit.ts ATP --pgrid    # K/D/seed grid
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadMatches, nameIndex, fullKey, keepForElo, roundRank, dayNum, type Match } from "./lib";
import { parseBoard } from "./parse-boards";
import type { YeloBoard } from "./parse-yelo";

const ANCHOR = !process.argv.includes("--noanchor"); // anchor opponent timeline to TA's full-Elo boards

type Tour = "ATP" | "WTA";
const tour = (process.argv[2] as Tour) ?? "ATP";
const ONE = process.argv.includes("--board") ? Number(process.argv[process.argv.indexOf("--board") + 1]) : null;
const TRACE = process.argv.includes("--trace") ? process.argv[process.argv.indexOf("--trace") + 1] : null;

interface Cfg { D: number; kNum: number; kOff: number; kShape: number; seed: number; tlSeed: number; tlStart: number }
const BASE: Cfg = { D: 400, kNum: 250, kOff: 5, kShape: 0.4, seed: 1500, tlSeed: 1500, tlStart: 2008 };

const winP = (rA: number, rB: number, D: number) => 1 / (1 + 10 ** ((rB - rA) / D));
const kOf = (n: number, c: Cfg) => c.kNum / (n + c.kOff) ** c.kShape;

const boards: YeloBoard[] = JSON.parse(
  readFileSync(resolve(process.cwd(), "ingest/elo-reverse/yelo-boards.json"), "utf8"),
)[tour];
const allMatches = loadMatches(tour, 2006);
const { keyToId } = nameIndex(allMatches);
// TA's yElo scope (page prose): tour-level + TOUR-LEVEL qualifying + challenger MAIN DRAW + ITF $50K+.
// So challenger/ITF QUALIFYING is NOT counted (only G/M/A/F qualifying is). --allqual disables this test.
// "Tour level" (where qualifying counts): ATP G/M/A/F, WTA G/PM/P/I/F. Challenger (C) + ITF (numeric)
// qualifying is NOT counted; their MAIN draw is.
// WTA additionally counts WTA-125 (level C) QUALIFYING — verified against the boards (e.g. Canberra-125 quallies
// reconcile only when counted). ATP does NOT count challenger (C) qualifying (Karol's TA page: yElo 21 = 57
// chall − 36 quallies). Neither tour counts numeric-ITF (W50/W75/W100) qualifying. So the set below lists the
// levels whose QUALIFYING counts; everything else's qualifying is dropped.
const TOUR = new Set(tour === "ATP" ? ["G", "M", "A", "F"] : ["G", "PM", "P", "I", "F", "C"]);
const isQual = (round: string): boolean => /^Q[1-4]$/.test(round); // Q1/Q2/Q3 — NOT QF (quarterfinal)
const yeloScope = (m: Match): boolean =>
  !(isQual(m.round) && !TOUR.has(m.level)); // drop ITF (+ ATP challenger) qualifying; keep tour-level (+WTA-125) qualifying
const ALLQUAL = process.argv.includes("--allqual");
const counted = allMatches
  .filter((m) => keepForElo(m) && (ALLQUAL || yeloScope(m)))
  .sort((a, b) => a.date - b.date || roundRank(a.round) - roundRank(b.round) || a.idx - b.idx);

/** TA's own published full-Elo boards (dense weekly captures in data/wayback/raw-full), as the opponent
 *  "actual rating at the time" reference. name→id via keyToId; dedup by lastUpdate (deepest). */
function loadFullEloBoards(): { lastUpdate: number; overall: Map<string, number> }[] {
  const dir = resolve(process.cwd(), "data/wayback/raw-full");
  const byDate = new Map<number, { players: { name: string; overall: number }[]; depth: number }>();
  for (const f of readdirSync(dir).filter((f) => new RegExp(`^${tour.toLowerCase()}_elo_ratings_\\d{14}\\.html$`).test(f))) {
    const b = parseBoard(readFileSync(resolve(dir, f), "utf8"), tour, 0);
    if (!b) continue;
    const cur = byDate.get(b.lastUpdate);
    if (!cur || b.players.length > cur.depth) byDate.set(b.lastUpdate, { players: b.players.map((p) => ({ name: p.name, overall: p.overall })), depth: b.players.length });
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([lastUpdate, v]) => {
      const overall = new Map<string, number>();
      for (const p of v.players) { const id = keyToId.get(fullKey(p.name)); if (id) overall.set(id, p.overall); }
      return { lastUpdate, overall };
    });
}
const FULL_BOARDS = ANCHOR ? loadFullEloBoards() : [];

/** Opponent's "actual rating at the time" (Sackmann's phrase), estimated by LINEARLY INTERPOLATING the
 *  opponent's full-Elo between the two published boards that bracket the match date and that both list them.
 *
 *  Why interpolate rather than read the nearest-PRIOR board: a frozen prior-board value is up to ~30 days stale,
 *  and through the season opponents CLIMB, so a target's later matches face opponents whose true rating is above
 *  their last published board → the target is under-credited and the error accumulates (a negative bias that is
 *  ~0 in January and grows to ~−11 by November, insensitive to D/K). Interpolation tracks the climb between
 *  weekly captures and ~halves that bias across every board (verified: ATP/WTA med-of-medians 8.6/9.9 → 7.0/8.5,
 *  byte-exact players ~+50%, and — because it only changes the opponent RATING, never the counted match set —
 *  it cannot flip any W/L-exact player). Reading opponents straight off the board (not a forward Elo pass) is
 *  what first made Alcaraz byte-exact (2124.4 vs 2124); interpolation refines the between-capture estimate.
 *
 *  Residual after this: non-linear title-run jumps (50+ Elo in days) can't be reproduced by linear interpolation
 *  between weekly boards — a hard data-granularity limit, not a model error. Players below the board's display
 *  floor (~1100, mostly deep ITF/Challenger) are on no board → fall back to the anchored forward-pass timeline
 *  (tlSeed 1500 is the least-biased there — those opponents are mid-strength ~1400, not weak-near-floor). */
function oppRatingAt(oppId: string, date: number, fallback: number): number {
  if (!ANCHOR) return fallback;
  let pi = -1, ni = -1;
  for (let i = 0; i < FULL_BOARDS.length; i++) {
    if (!FULL_BOARDS[i].overall.has(oppId)) continue;
    if (FULL_BOARDS[i].lastUpdate <= date) pi = i;
    else { ni = i; break; }
  }
  const pv = pi >= 0 ? FULL_BOARDS[pi].overall.get(oppId)! : undefined;
  const nv = ni >= 0 ? FULL_BOARDS[ni].overall.get(oppId)! : undefined;
  if (pv !== undefined && nv !== undefined) {
    const t0 = dayNum(FULL_BOARDS[pi].lastUpdate), t1 = dayNum(FULL_BOARDS[ni].lastUpdate);
    const f = Math.max(0, Math.min(1, (dayNum(date) - t0) / (t1 - t0)));
    return pv + f * (nv - pv);
  }
  return pv ?? nv ?? fallback; // single-side carry-forward/back, else off-board → timeline fallback
}

/** PASS 1 — full-Elo overall timeline. Forward Elo over all counted matches (career n, both sides update);
 *  when ANCHOR, re-sync every board-listed player to TA's published overall as each board date is passed,
 *  so opponents track TA's real ratings to within one weekly board. Records each side's pre-match rating. */
function buildTimeline(cfg: Cfg): { wBefore: Map<number, number>; lBefore: Map<number, number> } {
  const elo = new Map<string, number>();
  const cnt = new Map<string, number>();
  const wBefore = new Map<number, number>(), lBefore = new Map<number, number>();
  let bi = 0;
  for (const m of counted) {
    while (ANCHOR && bi < FULL_BOARDS.length && FULL_BOARDS[bi].lastUpdate <= m.date) {
      for (const [id, ov] of FULL_BOARDS[bi].overall) elo.set(id, ov); // re-anchor to TA's published board
      bi++;
    }
    const rw = elo.get(m.winnerId) ?? cfg.tlSeed, rl = elo.get(m.loserId) ?? cfg.tlSeed;
    wBefore.set(m.idx, rw); lBefore.set(m.idx, rl);
    const nw = cnt.get(m.winnerId) ?? 0, nl = cnt.get(m.loserId) ?? 0;
    const e = winP(rw, rl, cfg.D);
    elo.set(m.winnerId, rw + kOf(nw, cfg) * (1 - e));
    elo.set(m.loserId, rl + kOf(nl, cfg) * (0 - (1 - e)));
    cnt.set(m.winnerId, nw + 1); cnt.set(m.loserId, nl + 1);
  }
  return { wBefore, lBefore };
}
const TL = buildTimeline(BASE);

interface St { yelo: number; n: number; wins: number; losses: number }

// per-id matches (in play order) so yeloFor doesn't rescan the full corpus per player/board.
const byId = new Map<string, Match[]>();
for (const m of counted) {
  (byId.get(m.winnerId) ?? byId.set(m.winnerId, []).get(m.winnerId)!).push(m);
  (byId.get(m.loserId) ?? byId.set(m.loserId, []).get(m.loserId)!).push(m);
}

const addD = (date: number, n: number): number => {
  const y = Math.floor(date / 10000), mo = (Math.floor(date / 100) % 100) - 1, d = date % 100;
  const dt = new Date(Date.UTC(y, mo, d) + n * 86_400_000);
  return dt.getUTCFullYear() * 10000 + (dt.getUTCMonth() + 1) * 100 + dt.getUTCDate();
};

/** PASS 2 — yElo for ONE player id over a season up to asOf (whole-tournament gating, end-year season). */
function yeloFor(id: string, year: number, asOf: number, cfg: Cfg, tl = TL): St {
  const ms = (byId.get(id) ?? []).filter(
    (m) => Math.floor(m.endDate / 10000) === year && m.endDate <= asOf,
  );
  let yelo = cfg.seed, n = 0, wins = 0, losses = 0;
  for (const m of ms) {
    const isW = m.winnerId === id;
    const oppId = isW ? m.loserId : m.winnerId;
    const oppReal = oppRatingAt(oppId, m.date, isW ? tl.lBefore.get(m.idx)! : tl.wBefore.get(m.idx)!);
    const e = winP(yelo, oppReal, cfg.D);
    yelo += kOf(n, cfg) * ((isW ? 1 : 0) - e);
    n++; if (isW) wins++; else losses++;
    if (TRACE && fullKey(TRACE) === fullKey(isW ? m.winnerName : m.loserName))
      console.log(`  ${m.date} ${m.tourneyName.slice(0, 18).padEnd(18)} ${m.round.padEnd(4)} ${isW ? "W" : "L"} vs ${(isW ? m.loserName : m.winnerName).slice(0, 18).padEnd(18)} opp(real) ${oppReal.toFixed(0)} E ${(isW ? e : 1 - e).toFixed(3)} → ${yelo.toFixed(1)}`);
  }
  return { yelo, n, wins, losses };
}

interface Resid { name: string; dY: number; wlOk: boolean; rW: number; cW: number; rL: number; cL: number; rY: number; cY: number }
function scoreBoard(b: YeloBoard, cfg: Cfg): { resids: Resid[]; unmatched: number } {
  const resids: Resid[] = [];
  let unmatched = 0;
  for (const p of b.players) {
    const id = keyToId.get(fullKey(p.name));
    if (!id) { unmatched++; continue; }
    const s = yeloFor(id, b.year, b.lastUpdate, cfg);
    resids.push({
      name: p.name, dY: Math.round((s.yelo - p.yelo) * 10) / 10, wlOk: s.wins === p.wins && s.losses === p.losses,
      rW: p.wins, cW: s.wins, rL: p.losses, cL: s.losses, rY: p.yelo, cY: Math.round(s.yelo * 10) / 10,
    });
  }
  return { resids, unmatched };
}

const med = (a: number[]) => (a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : 0);

// NOTE: "centered" subtracts each board's signed-median offset, isolating the per-player SPREAD from a
// uniform per-board shift. It is NOT seed-invariant (changing the target seed changes E non-linearly since
// opponents are at fixed real ratings) — it's just a cleaner fit metric. The --pgrid holds seed at 1500.
function summarize(cfg: Cfg, verbose: boolean): void {
  const perBoardMed: number[] = [], perBoardC: number[] = [];
  let totJoin = 0, totWl = 0, totExact = 0;
  for (const b of boards) {
    const { resids } = scoreBoard(b, cfg);
    const ok = resids.filter((r) => r.wlOk);
    const abs = ok.map((r) => Math.abs(r.dY));
    const off = med(ok.map((r) => r.dY));
    const absC = ok.map((r) => Math.abs(r.dY - off));
    perBoardMed.push(med(abs)); perBoardC.push(med(absC));
    totJoin += resids.length; totWl += ok.length; totExact += abs.filter((x) => x <= 0.05).length;
    if (verbose)
      console.log(`  ${b.lastUpdate}: n=${resids.length} W/L-ok ${ok.length}, med|Δy| ${med(abs).toFixed(2)}, signed ${off.toFixed(1)}, centered ${med(absC).toFixed(2)}, exact ${abs.filter((x) => x <= 0.05).length}`);
  }
  console.log(`${tour} seed=${cfg.seed} tlSeed=${cfg.tlSeed} K=${cfg.kNum}/(n+${cfg.kOff})^${cfg.kShape} D=${cfg.D}:`);
  console.log(`  W/L-exact ${totWl}/${totJoin}  yElo med-of-medians ${med(perBoardMed).toFixed(2)} (byte-exact ${totExact}) | centered ${med(perBoardC).toFixed(2)}`);
}

if (TRACE && ONE) {
  const b = boards.find((x) => x.lastUpdate === ONE)!;
  const id = keyToId.get(fullKey(TRACE))!;
  console.log(`${tour} yElo trace ${TRACE} board ${ONE}:`);
  const s = yeloFor(id, b.year, b.lastUpdate, BASE);
  const p = b.players.find((x) => fullKey(x.name) === fullKey(TRACE));
  console.log(`  FINAL comp ${s.wins}-${s.losses} yElo ${s.yelo.toFixed(1)}  | TA ${p?.wins}-${p?.losses} yElo ${p?.yelo}`);
} else if (ONE) {
  const b = boards.find((x) => x.lastUpdate === ONE)!;
  const { resids, unmatched } = scoreBoard(b, BASE);
  const ok = resids.filter((r) => r.wlOk);
  const abs = ok.map((r) => Math.abs(r.dY));
  console.log(`${tour} yElo board ${ONE}: ${resids.length} joined, W/L-ok ${ok.length}, med|Δy| ${med(abs).toFixed(2)}, byte-exact ${abs.filter((x) => x <= 0.05).length}, unmatched ${unmatched}`);
  console.log(`Top-12:`);
  for (const r of resids.slice(0, 12))
    console.log(`  ${r.name.padEnd(24)} y ${r.rY.toFixed(1)} vs ${r.cY.toFixed(1)} (Δ${r.dY > 0 ? "+" : ""}${r.dY.toFixed(1)})  W/L ${r.rW}-${r.rL} vs ${r.cW}-${r.cL}${r.wlOk ? "" : " <-- WL"}`);
  const bad = resids.filter((r) => !r.wlOk);
  const dW = bad.map((r) => r.cW - r.rW), dL = bad.map((r) => r.cL - r.rL);
  const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
  console.log(`\nW/L mismatches: ${bad.length}  | comp−ret wins: sum ${sum(dW)} (under ${dW.filter((x) => x < 0).length}, over ${dW.filter((x) => x > 0).length}); losses: sum ${sum(dL)} (under ${dL.filter((x) => x < 0).length}, over ${dL.filter((x) => x > 0).length})`);
  console.log("  -- biggest W/L deltas (comp − ret; positive = over-count): --");
  for (const r of [...bad].sort((a, b) => (b.cW + b.cL - b.rW - b.rL) - (a.cW + a.cL - a.rW - a.rL)).slice(0, 14))
    console.log(`  ${r.name.padEnd(24)} ret ${r.rW}-${r.rL}  comp ${r.cW}-${r.cL}  (Δw ${r.cW - r.rW}, Δl ${r.cL - r.rL})`);
} else if (process.argv.includes("--pgrid")) {
  console.log(`${tour} yElo PARAM grid (centered = seed-invariant model error):`);
  const res: { s: string; c: number; e: number }[] = [];
  for (const D of [350, 400, 450]) for (const kNum of [200, 250, 300]) for (const kShape of [0.4, 0.5]) {
    const cfg = { ...BASE, D, kNum, kShape };
    const pc: number[] = []; let ex = 0, jn = 0;
    for (const b of boards) {
      const ok = scoreBoard(b, cfg).resids.filter((r) => r.wlOk);
      const off = med(ok.map((r) => r.dY));
      pc.push(med(ok.map((r) => Math.abs(r.dY - off)))); ex += ok.filter((r) => Math.abs(r.dY) <= 0.05).length; jn += ok.length;
    }
    res.push({ s: `D=${D} kNum=${kNum} kShape=${kShape}`, c: med(pc), e: ex });
  }
  res.sort((a, b) => a.c - b.c);
  for (const r of res) console.log(`  ${r.s}: centered ${r.c.toFixed(2)}, byte-exact ${r.e}`);
} else if (process.argv.includes("--scatter")) {
  // Export per-board computed-vs-retrieved yElo for the scatter viz (both tours), into yelo-scatter.json.
  const out: Record<string, unknown> = {};
  for (const t of ["ATP", "WTA"] as const) {
    const bs: YeloBoard[] = JSON.parse(readFileSync(resolve(process.cwd(), "ingest/elo-reverse/yelo-boards.json"), "utf8"))[t];
    // re-run for the requested tour only (module is per-tour); guard: only emit for the CLI tour, merge later.
    if (t !== tour) { out[t] = null; continue; }
    out[t] = bs.map((b) => {
      const { resids } = scoreBoard(b, BASE);
      const ok = resids.filter((r) => r.wlOk);
      const abs = ok.map((r) => Math.abs(r.dY)).sort((a, b) => a - b);
      const pts = resids.map((r) => ({ name: r.name, ret: r.rY, comp: r.cY, d: r.dY, m: r.cW + r.cL, status: r.wlOk ? "played" : "wl" }));
      return {
        date: b.lastUpdate, prevDate: b.year * 10000 + 101, gap: 0, pts,
        stats: {
          n: ok.length, exact: abs.filter((x) => x <= 0.1).length, medAbs: Math.round((abs[abs.length >> 1] ?? 0) * 10) / 10, // <=0.1 to match the scatter legend
          w5: ok.length ? Math.round((100 * abs.filter((x) => x <= 5).length) / ok.length) : 0,
          w10: ok.length ? Math.round((100 * abs.filter((x) => x <= 10).length) / ok.length) : 0,
          debuts: resids.length - ok.length,
        },
      };
    }).reverse();
  }
  const path = resolve(process.cwd(), `ingest/elo-reverse/yelo-scatter-${tour}.json`);
  writeFileSync(path, JSON.stringify(out[tour]));
  console.log(`wrote ${path} (${(out[tour] as unknown[]).length} boards)`);
} else if (process.argv.includes("--cutfit")) {
  // For each board, find the data-cutoff offset (vs the "Last update" date) that maximises W/L-exact.
  // Reveals whether residual W/L misses are board-cutoff imprecision (a consistent best offset) vs model error.
  console.log(`${tour} per-board best cutoff offset (days vs "Last update"):`);
  let totBest = 0, totJoin = 0;
  const offsets: number[] = [];
  for (const b of boards) {
    let best = { off: 0, ok: -1, med: 0 };
    for (let off = -8; off <= 12; off++) {
      const cut = addD(b.lastUpdate, off);
      let ok = 0; const abs: number[] = [];
      for (const p of b.players) {
        const id = keyToId.get(fullKey(p.name)); if (!id) continue;
        const s = yeloFor(id, b.year, cut, BASE);
        if (s.wins === p.wins && s.losses === p.losses) { ok++; abs.push(Math.abs(s.yelo - p.yelo)); }
      }
      if (ok > best.ok) best = { off, ok, med: med(abs) };
    }
    const join = b.players.filter((p) => keyToId.get(fullKey(p.name))).length;
    totBest += best.ok; totJoin += join; offsets.push(best.off);
    console.log(`  ${b.lastUpdate}: best off ${best.off >= 0 ? "+" : ""}${best.off}d → W/L-exact ${best.ok}/${join} (${Math.round(100 * best.ok / join)}%), med|Δy| ${best.med.toFixed(2)}`);
  }
  offsets.sort((a, b) => a - b);
  console.log(`\nW/L-exact at best per-board cutoff: ${totBest}/${totJoin} (${Math.round(100 * totBest / totJoin)}%)  | median best offset ${offsets[offsets.length >> 1]}d`);
} else {
  summarize(BASE, true);
}
