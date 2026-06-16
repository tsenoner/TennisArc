// Parse every archived TA SEASON yElo board (data/wayback/raw-full/{atp,wta}_season_yelo_ratings_*.html)
// into a structured dataset (ingest/elo-reverse/yelo-boards.json, gitignored).
//
// yElo schema is a single, stable 5-cell era across 2021-2026:
//   Rank | Player | Wins | Losses | yElo
// Per the page's own prose, yElo "only considers current year results for each player, as if we had no
// previous information to draw upon" — a fresh per-CALENDAR-YEAR Elo. Listing threshold = >=5 wins in the
// current year over the SAME inclusion scope as the full board (tour-level + tour-level qualifying +
// challengers + ITF $50K+). The Wins/Losses columns give each player's EXACT counted match record this
// year — a direct check on our inclusion scope.
//   npx tsx ingest/elo-reverse/parse-yelo.ts
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { dedupeByDateKeepDeepest } from "./lib";

const SRC = resolve(process.cwd(), "data/wayback/raw-full");
const OUT = resolve(process.cwd(), "ingest/elo-reverse/yelo-boards.json");

export interface YeloPlayer {
  rank: number;
  name: string;
  wins: number;
  losses: number;
  yelo: number;
}
export interface YeloBoard {
  tour: "ATP" | "WTA";
  captureTs: string; // full Wayback timestamp of the deepest capture for this date
  lastUpdate: number; // YYYYMMDD from "Last update:"
  year: number;
  players: YeloPlayer[];
}

const num = (s: string): number | null => {
  const v = Number.parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(v) ? v : null;
};

export function parseYelo(html: string, tour: "ATP" | "WTA", captureTs: string): YeloBoard | null {
  const m = html.match(/Last update:\s*(\d{4})-(\d{2})-(\d{2})/i);
  if (!m) return null;
  const lastUpdate = Number(`${m[1]}${m[2]}${m[3]}`);
  const players: YeloPlayer[] = [];
  for (const tr of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
    const c = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) =>
      x[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/ /g, " ").trim());
    if (c.length < 5) continue;
    const rank = num(c[0]);
    const name = c[1];
    const wins = num(c[2]);
    const losses = num(c[3]);
    const yelo = num(c[4]);
    if (rank === null || !Number.isInteger(rank) || !name || !/[A-Za-z]/.test(name)) continue;
    if (wins === null || losses === null || yelo === null || yelo < 600 || yelo > 3000) continue;
    players.push({ rank, name, wins, losses, yelo });
  }
  if (players.length < 10) return null;
  return { tour, captureTs, lastUpdate, year: Math.floor(lastUpdate / 10000), players };
}

function build(): void {
  if (!existsSync(SRC)) throw new Error(`${SRC} missing — run ingest/elo-reverse/fetch-wayback.ts first`);
  mkdirSync(resolve(process.cwd(), "ingest/elo-reverse"), { recursive: true });
  const out: { ATP: YeloBoard[]; WTA: YeloBoard[] } = { ATP: [], WTA: [] };
  for (const f of readdirSync(SRC).filter((f) => /_season_yelo_ratings_\d{14}\.html$/.test(f))) {
    const mt = f.match(/^(atp|wta)_season_yelo_ratings_(\d{14})\.html$/);
    if (!mt) continue;
    const tour = mt[1].toUpperCase() as "ATP" | "WTA";
    const b = parseYelo(readFileSync(resolve(SRC, f), "utf8"), tour, mt[2]);
    if (b) out[tour].push(b);
  }
  // Dedup by lastUpdate: keep the DEEPEST board (most players) per as-of date.
  for (const t of ["ATP", "WTA"] as const)
    out[t] = dedupeByDateKeepDeepest(out[t], (b) => b.lastUpdate, (b) => b.players.length);
  writeFileSync(OUT, JSON.stringify(out));
  for (const t of ["ATP", "WTA"] as const) {
    const bs = out[t];
    const years = [...new Set(bs.map((b) => b.year))].sort();
    console.log(`${t}: ${bs.length} yElo boards  ${bs[0]?.lastUpdate}..${bs[bs.length - 1]?.lastUpdate}  years ${years.join(",")}  depth ${Math.min(...bs.map((b) => b.players.length))}-${Math.max(...bs.map((b) => b.players.length))}`);
  }
  console.log(`wrote ${OUT}`);
}

if (import.meta.url === `file://${process.argv[1]}`) build();
