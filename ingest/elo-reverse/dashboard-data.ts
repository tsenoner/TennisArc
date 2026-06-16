// Emit the Elo + yElo timeline dataset for the dashboard (ingest/elo-reverse/render.ts consumes it).
// Unlike scatter.ts (last-8 transitions only), this emits EVERY snapshot we have — all full-Elo board
// transitions (ATP 338 / WTA 240) and all season-yElo boards — each with a per-|Δ|-bucket breakdown so the
// dashboard can draw a stacked-bar timeline, plus the full per-player points for the linked scatter.
//   npx tsx ingest/elo-reverse/dashboard-data.ts   →  ingest/elo-reverse/dashboard-data.json
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadBoards, loadMatches, nameIndex, fullKey, keepForElo, winProbability as winP, kFactor as kOf, round1, priorMatchCounter, replayWindow, isRecomputeBoundary, BOARD_REPLAY } from "./lib";

const SEED = BOARD_REPLAY.seed;

// status codes for the compact point form [nameIdx, ret, comp, m, statusCode]
//  0 played · 1 idle · 2 new/debut (Elo) · 3 W/L≠TA (yElo)
// Names are interned per (mode,tour) into a string table (`names`) — a few hundred uniques are referenced
// by ~200k point rows, so referencing by index instead of repeating the string is a large size win.
type Status = "played" | "idle" | "new" | "wl";
const SCODE: Record<Status, number> = { played: 0, idle: 1, new: 2, wl: 3 };
type CompactPt = [number, number, number, number, number];

interface RawPt { name: string; ret: number; comp: number; d: number; m: number; status: Status }
interface Snap {
  date: number; prevDate: number; gap: number; boundary: boolean;
  stats: { n: number; exact: number; medAbs: number; w5: number; w10: number; special: number };
  buckets: { le2: number; le10: number; le30: number; gt30: number; special: number };
  pts: CompactPt[];
}

/** Bucket a snapshot's points by |Δ|; the `special` group is debut (Elo) / W/L-mismatch (yElo) — its Δ is
 *  not a rating error, so it is excluded from the accuracy buckets and counted on its own. */
function bucketise(pts: RawPt[], specialStatus: Status): Omit<Snap, "date" | "prevDate" | "gap" | "boundary" | "pts"> {
  const scored = pts.filter((p) => p.status !== specialStatus);
  const abs = scored.map((p) => Math.abs(p.d)).sort((a, b) => a - b);
  const le2 = abs.filter((x) => x <= 2).length;
  const le10 = abs.filter((x) => x > 2 && x <= 10).length;
  const le30 = abs.filter((x) => x > 10 && x <= 30).length;
  const gt30 = abs.filter((x) => x > 30).length;
  const special = pts.length - scored.length;
  return {
    stats: {
      n: scored.length,
      exact: abs.filter((x) => x <= 0.1).length,
      medAbs: round1(abs[abs.length >> 1] ?? 0),
      w5: abs.length ? Math.round((100 * abs.filter((x) => x <= 5).length) / abs.length) : 0,
      w10: abs.length ? Math.round((100 * abs.filter((x) => x <= 10).length) / abs.length) : 0,
      special,
    },
    buckets: { le2, le10, le30, gt30, special },
  };
}

/** Per-dataset name interner: maps a name to a stable index into a string table. */
function makeInterner() {
  const names: string[] = [];
  const idx = new Map<string, number>();
  const compact = (p: RawPt): CompactPt => {
    let i = idx.get(p.name);
    if (i === undefined) { i = names.length; names.push(p.name); idx.set(p.name, i); }
    return [i, p.ret, p.comp, p.m, SCODE[p.status]];
  };
  return { names, compact };
}

interface Dataset { names: string[]; snaps: Snap[] }

// ---------------- Elo: full-board replay, EVERY transition (boundaries flagged, not dropped) ----------------
function buildElo(tour: "ATP" | "WTA"): Dataset {
  const { names, compact } = makeInterner();
  const boards = loadBoards()[tour];
  const all = loadMatches(tour, 2010);
  const { keyToId } = nameIndex(all);
  const matches = all.filter(keepForElo);
  const boardIds = boards.map((b) =>
    new Map(b.players.map((p) => [keyToId.get(fullKey(p.name)) ?? "", p] as const).filter(([id]) => id)));
  const prior = priorMatchCounter(matches);

  const out: Snap[] = [];
  // fixed-param replay: SEED=1200, 45-day gap, library win-prob/K, no RET-era gate (see lib.replayWindow).
  for (const { i, prev, cur, gap, st, mcount, latest } of
    replayWindow(boards, boardIds, matches, prior, { seed: SEED, maxGap: BOARD_REPLAY.maxGap, winProb: winP, kFactor: kOf })) {
    const pts: RawPt[] = [];
    for (const [id, p] of boardIds[i]) {
      const had = latest.has(id);
      const comp = st.get(id)?.ov ?? latest.get(id) ?? SEED;
      const status: Status = !had ? "new" : st.has(id) ? "played" : "idle";
      pts.push({ name: p.name, ret: round1(p.overall), comp: round1(comp), d: round1(comp - p.overall), m: mcount.get(id) ?? 0, status });
    }
    if (pts.length) {
      // recompute-boundary heuristic: idle players shifted en masse (kept, flagged for the timeline)
      const boundary = isRecomputeBoundary(pts.filter((p) => p.status === "idle").map((p) => p.d));
      out.push({ date: cur.lastUpdate, prevDate: prev.lastUpdate, gap, boundary, ...bucketise(pts, "new"), pts: pts.map(compact) });
    }
  }
  return { names, snaps: out };
}

// ---------------- yElo: load the per-board scatter JSON (yelo-fit.ts --scatter), all boards ----------------
function buildYelo(tour: "ATP" | "WTA"): Dataset {
  const { names, compact } = makeInterner();
  const p = resolve(process.cwd(), `ingest/elo-reverse/yelo-scatter-${tour}.json`);
  if (!existsSync(p)) return { names, snaps: [] };
  const boards = (JSON.parse(readFileSync(p, "utf8")) as { date: number; prevDate: number; gap: number; pts: RawPt[] }[])
    .slice().sort((a, b) => a.date - b.date); // chronological for the timeline (the scatter JSON is newest-first)
  const snaps = boards.map((b) => {
    const pts = b.pts.map((q) => ({ ...q, status: (q.status ?? "played") as Status }));
    return { date: b.date, prevDate: b.prevDate ?? 0, gap: b.gap ?? 0, boundary: false, ...bucketise(pts, "wl"), pts: pts.map(compact) };
  });
  return { names, snaps };
}

const data = {
  elo: { ATP: buildElo("ATP"), WTA: buildElo("WTA") },
  yelo: { ATP: buildYelo("ATP"), WTA: buildYelo("WTA") },
};

const OUT = resolve(process.cwd(), "ingest/elo-reverse/dashboard-data.json");
const json = JSON.stringify(data);
writeFileSync(OUT, json);
const kb = (s: unknown) => Math.round(JSON.stringify(s).length / 1024);
for (const m of ["elo", "yelo"] as const)
  for (const t of ["ATP", "WTA"] as const) {
    const ds = data[m][t];
    console.log(`${m} ${t}: ${ds.snaps.length} snapshots, ${ds.snaps.reduce((s, x) => s + x.pts.length, 0)} pts, ${ds.names.length} names, ${kb(ds)} KB`);
  }
console.log(`wrote ${OUT} (${Math.round(json.length / 1024)} KB total)`);
