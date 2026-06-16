// SEEDED MINI-REPLAY: the decisive test of the reverse-engineered update rule.
// For each consecutive board pair (prev -> cur), seed engine state from TA's OWN published ratings
// (latest board value per player at/<=prev; carry-forward for players off the current board; entrant
// seed for never-seen), replay the window's matches with a candidate (D, K, seed) rule, then compare
// predicted overall to the ACTUAL cur board for listed players. Aggregates residuals across all
// transitions. No burn-in, no 1968 history — board(T) IS the starting truth.
//
//   npx tsx ingest/elo-reverse/replay.ts ATP            # baseline (prior params, freeze)
//   npx tsx ingest/elo-reverse/replay.ts ATP --clean    # exclude recompute boundaries
//   npx tsx ingest/elo-reverse/replay.ts ATP --grid     # small grid over K numerator/seed
import { loadBoards, loadMatches, nameIndex, fullKey, keepForElo, retInEra, priorMatchCounter, replayWindow, isRecomputeBoundary, medianUpper, winProbabilityD, kFactorP, BOARD_REPLAY } from "./lib";

type Tour = "ATP" | "WTA";
const tour = (process.argv[2] as Tour) ?? "ATP";
const GRID = process.argv.includes("--grid");

interface Cfg { D: number; kNum: number; kOff: number; kShape: number; seed: number; maxGap: number }
const BASE: Cfg = { D: 400, kNum: 250, kOff: 5, kShape: 0.4, seed: BOARD_REPLAY.seed, maxGap: BOARD_REPLAY.maxGap };
const CLEAN = process.argv.includes("--clean"); // exclude recompute-boundary transitions

const boards = loadBoards()[tour];
const allMatches = loadMatches(tour, 2010);
const { keyToId } = nameIndex(allMatches); // name->id index from the FULL set (RET/WO players still need ids)
const matches = allMatches.filter(keepForElo); // TA's verified inclusion scope: drop walkovers + sub-$50K ITF
// Retirements are era-dependent: TA only counts them from the spring-2025 recompute. A board pair (prev→cur)
// is scored against cur's published values, so a window counts RET iff cur is post-recompute (shared retInEra).

// board player name -> id, per board (cache)
const boardIds = boards.map((b) => new Map(b.players.map((p) => [keyToId.get(fullKey(p.name)) ?? "", p] as const).filter(([id]) => id)));

// per-id sorted career match dates, for prior-count n via binary search (shared lib helper)
const priorCount = priorMatchCounter(matches);

function evaluate(cfg: Cfg) {
  const absAll: number[] = [];
  const perTransition: { date: number; meanAbs: number; medAbs: number; median: number; n: number; boundary: boolean }[] = [];

  // PARAMETRIC replay: cfg's D/K/seed/maxGap + the RET-era gate (eraGate). The shared windower carries-forward
  // TA's own board values and applies the window's matches; we score residuals against cur's published values.
  for (const { i, st, cur, latest } of replayWindow(boards, boardIds, matches, priorCount, {
    seed: cfg.seed, maxGap: cfg.maxGap, winProb: (a, b) => winProbabilityD(a, b, cfg.D), kFactor: (n) => kFactorP(n, cfg), eraGate: retInEra,
  })) {
    // residual on players listed on BOTH prev and cur (idle players: predicted = seeded = prev value)
    const errs: number[] = [];
    const idleErrs: number[] = []; // players with NO window match: error = prev - cur (idle drift detector)
    for (const [id, p] of boardIds[i]) {
      const predicted = st.get(id)?.ov ?? latest.get(id);
      if (predicted == null) continue;
      // only score players we had a prior rating for (on a prior board) — fair test of the update
      if (!latest.has(id)) continue;
      const e = predicted - p.overall;
      errs.push(e);
      if (!st.has(id)) idleErrs.push(e); // never created state -> played 0 window matches
    }
    if (errs.length) {
      const abs = errs.map(Math.abs).sort((a, b) => a - b);
      const meanAbs = abs.reduce((s, x) => s + x, 0) / abs.length;
      // boundary = a board-wide rescale/recompute: idle players (0 matches) shifted by a big median.
      const boundary = isRecomputeBoundary(idleErrs);
      perTransition.push({ date: cur.lastUpdate, meanAbs, medAbs: medianUpper(abs), median: medianUpper(errs), n: errs.length, boundary });
      if (!(CLEAN && boundary)) absAll.push(...abs);
    }
  }
  absAll.sort((a, b) => a - b);
  const meanAbs = absAll.reduce((s, x) => s + x, 0) / absAll.length;
  return { meanAbs, p50: absAll[absAll.length >> 1], p90: absAll[Math.floor(absAll.length * 0.9)], obs: absAll.length, perTransition };
}

if (!GRID) {
  const r = evaluate(BASE);
  const scored = r.perTransition.filter((t) => !(CLEAN && t.boundary));
  const medAbsList = scored.map((t) => t.medAbs).sort((a, b) => a - b);
  const medOfMed = medAbsList[medAbsList.length >> 1];
  console.log(`${tour} baseline (D=400,K=250/(n+5)^0.4,seed=1200,freeze)${CLEAN ? " [recompute boundaries EXCLUDED]" : ""}:`);
  console.log(`  per-player-transition: meanAbs ${r.meanAbs.toFixed(2)}  p50 ${r.p50.toFixed(2)}  p90 ${r.p90.toFixed(2)}  (${r.obs} obs)`);
  console.log(`  per-transition median|err|: median-of-medians ${medOfMed.toFixed(2)} over ${scored.length} transitions`);
  const bands = [1, 2, 5, 10].map((b) => `${medAbsList.filter((x) => x <= b).length}/${medAbsList.length} <=${b}`);
  console.log(`  transitions by median|err|: ${bands.join(", ")}`);
  console.log(`  recompute boundaries flagged: ${r.perTransition.filter((t) => t.boundary).map((t) => t.date).join(", ") || "none"}`);
  console.log(`  worst (by median|err|, non-boundary):`);
  scored.sort((a, b) => b.medAbs - a.medAbs).slice(0, 8).forEach((t) => console.log(`    ${t.date}: median|err| ${t.medAbs.toFixed(1)} meanAbs ${t.meanAbs.toFixed(1)} (n=${t.n})`));
} else {
  console.log(`${tour} grid (meanAbs over player-transitions):`);
  for (const seed of [1100, 1200, 1300]) {
    for (const kNum of [200, 225, 250, 275]) {
      const r = evaluate({ ...BASE, seed, kNum });
      console.log(`  seed=${seed} kNum=${kNum}: meanAbs ${r.meanAbs.toFixed(2)} p50 ${r.p50.toFixed(2)}`);
    }
  }
}
