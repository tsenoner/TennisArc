// Reverse-engineering TA's Elo from the BOARDS THEMSELVES (issue #25, fresh approach 2026-06-15).
// Parse every archived TA board (data/wayback/raw, auto-extracted from the committed tarball) into a
// structured, full-depth dataset (ingest/elo-reverse/boards.json, gitignored).
// Each board is TA's own published rating state on its "Last update" date; consecutive boards (~monthly)
// let us read the month-to-month update rule (K, seed, dock, eligibility) directly.
//
//   npx tsx ingest/elo-reverse/parse-boards.ts   (or `pnpm elo:scatter` which runs the whole pipeline)
//
// Schema eras (overall is ALWAYS cells[3], name cells[1], age cells[2]):
//   8  cells (2016):  Rank Player Age Elo | PeakMatch PeakAge PeakElo
//   12 cells (2019):  Rank Player Age Elo | Hard Clay Grass | PeakMatch PeakAge PeakElo
//   16 cells (2024):  Rank Player Age Elo | HardRaw ClayRaw GrassRaw | hElo cElo gElo | PeakMatch PeakAge PeakElo
//   17 cells (2026):  EloRank Player Age Elo | hRank hElo cRank cElo gRank gElo | PeakElo PeakMonth | TourRank LogDiff
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// Raw archived boards live (gitignored) in data/wayback/raw, extracted from the COMMITTED tarball
// data/wayback/ta-elo-boards-2016-2026.tar.gz. We auto-extract on first run so a clean checkout works.
const SRC = resolve(process.cwd(), "data/wayback/raw");
const SRC_FULL = resolve(process.cwd(), "data/wayback/raw-full"); // dense weekly captures (fetch-wayback.ts)
const TARBALL = resolve(process.cwd(), "data/wayback/ta-elo-boards-2016-2026.tar.gz");
const OUT = resolve(process.cwd(), "ingest/elo-reverse/boards.json");

/** Ensure SRC holds the raw board HTML, extracting the committed tarball if the dir is empty. */
function ensureRaw(): void {
  const hasHtml = existsSync(SRC) && readdirSync(SRC).some((f) => f.endsWith(".html"));
  if (hasHtml) return;
  if (!existsSync(TARBALL)) throw new Error(`no raw boards in ${SRC} and tarball missing at ${TARBALL}`);
  mkdirSync(SRC, { recursive: true });
  execFileSync("tar", ["-xzf", TARBALL, "-C", SRC]);
  console.log(`extracted ${readdirSync(SRC).filter((f) => f.endsWith(".html")).length} boards from the tarball`);
}

export interface BoardPlayer {
  rank: number;
  name: string;
  age: number | null;
  overall: number;
  hardRaw: number | null;
  clayRaw: number | null;
  grassRaw: number | null;
  hElo: number | null; // blended (50/50) where the era publishes it
  cElo: number | null;
  gElo: number | null;
  peakElo: number | null;
}

export interface Board {
  tour: "ATP" | "WTA";
  captureDate: number; // YYYYMMDD from the Wayback filename
  lastUpdate: number; // YYYYMMDD from the page's "Last update:" (the true as-of date)
  cells: number; // schema-era cell count (diagnostic)
  players: BoardPlayer[];
}

const num = (s: string): number | null => {
  const v = Number.parseFloat(s);
  return Number.isFinite(v) ? v : null;
};
const okElo = (v: number | null): v is number => v !== null && v > 800 && v < 3000;

export function parseBoard(html: string, tour: "ATP" | "WTA", captureDate: number): Board | null {
  const m = html.match(/Last update:\s*(\d{4})-(\d{2})-(\d{2})/i);
  if (!m) return null;
  const lastUpdate = Number(`${m[1]}${m[2]}${m[3]}`);
  const players: BoardPlayer[] = [];
  let cells = 0;
  for (const tr of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
    const c = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) =>
      x[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim());
    if (c.length < 4) continue;
    const name = c[1];
    const overall = num(c[3]);
    if (!name || !/[A-Za-z]/.test(name) || !okElo(overall)) continue;
    cells = c.length;
    const rank = num(c[0]) ?? players.length + 1;
    const age = num(c[2]);
    let hardRaw: number | null = null, clayRaw: number | null = null, grassRaw: number | null = null;
    let hElo: number | null = null, cElo: number | null = null, gElo: number | null = null;
    let peakElo: number | null = null;
    if (c.length === 12) {
      hardRaw = num(c[5]); clayRaw = num(c[6]); grassRaw = num(c[7]); peakElo = num(c[11]);
    } else if (c.length === 16) {
      hardRaw = num(c[5]); clayRaw = num(c[6]); grassRaw = num(c[7]);
      hElo = num(c[9]); cElo = num(c[10]); gElo = num(c[11]); peakElo = num(c[15]);
    } else if (c.length === 17) {
      hElo = num(c[6]); cElo = num(c[8]); gElo = num(c[10]); peakElo = num(c[12]);
    } else if (c.length === 8) {
      peakElo = num(c[7]);
    }
    players.push({ rank, name, age, overall, hardRaw, clayRaw, grassRaw, hElo, cElo, gElo, peakElo });
  }
  if (players.length < 30) return null;
  return { tour, captureDate, lastUpdate, cells, players };
}

function build(): void {
  ensureRaw();
  mkdirSync(resolve(process.cwd(), "ingest/elo-reverse"), { recursive: true });
  const out: { ATP: Board[]; WTA: Board[] } = { ATP: [], WTA: [] };
  // (1) the committed monthly tarball set (data/wayback/raw, filename atp_YYYYMMDD.html)
  for (const f of readdirSync(SRC).filter((f) => f.endsWith(".html"))) {
    const mt = f.match(/^(atp|wta)_(\d{8})\.html$/);
    if (!mt) continue;
    const tour = mt[1].toUpperCase() as "ATP" | "WTA";
    const b = parseBoard(readFileSync(resolve(SRC, f), "utf8"), tour, Number(mt[2]));
    if (b) out[tour].push(b);
  }
  // (2) the dense weekly captures (data/wayback/raw-full, filename atp_elo_ratings_<14-digit-ts>.html) —
  //     many more board dates in recent years; deduped against (1) by lastUpdate below.
  if (existsSync(SRC_FULL)) {
    for (const f of readdirSync(SRC_FULL).filter((f) => /_elo_ratings_\d{14}\.html$/.test(f) && !/yelo/.test(f))) {
      const mt = f.match(/^(atp|wta)_elo_ratings_(\d{8})/);
      if (!mt) continue;
      const tour = mt[1].toUpperCase() as "ATP" | "WTA";
      const b = parseBoard(readFileSync(resolve(SRC_FULL, f), "utf8"), tour, Number(mt[2]));
      if (b) out[tour].push(b);
    }
  }
  // Dedup by lastUpdate (keep the deepest board per as-of date), then sort chronologically.
  for (const t of ["ATP", "WTA"] as const) {
    const byDate = new Map<number, Board>();
    for (const b of out[t]) {
      const cur = byDate.get(b.lastUpdate);
      if (!cur || b.players.length > cur.players.length) byDate.set(b.lastUpdate, b);
    }
    out[t] = [...byDate.values()].sort((a, b) => a.lastUpdate - b.lastUpdate);
  }
  writeFileSync(OUT, JSON.stringify(out));
  for (const t of ["ATP", "WTA"] as const) {
    const bs = out[t];
    const depths = bs.map((b) => b.players.length);
    console.log(`${t}: ${bs.length} boards  ${bs[0]?.lastUpdate}..${bs[bs.length - 1]?.lastUpdate}  depth ${Math.min(...depths)}-${Math.max(...depths)}`);
    // window sizes between consecutive boards (days)
    const gaps: number[] = [];
    for (let i = 1; i < bs.length; i++) {
      const d0 = bs[i - 1].lastUpdate, d1 = bs[i].lastUpdate;
      const j0 = Date.UTC(Math.floor(d0 / 10000), (Math.floor(d0 / 100) % 100) - 1, d0 % 100);
      const j1 = Date.UTC(Math.floor(d1 / 10000), (Math.floor(d1 / 100) % 100) - 1, d1 % 100);
      gaps.push(Math.round((j1 - j0) / 86_400_000));
    }
    gaps.sort((a, b) => a - b);
    console.log(`   window gaps (days): min ${gaps[0]}, median ${gaps[Math.floor(gaps.length / 2)]}, max ${gaps[gaps.length - 1]}`);
  }
  console.log(`wrote ${OUT}`);
}

if (import.meta.url === `file://${process.argv[1]}`) build();
