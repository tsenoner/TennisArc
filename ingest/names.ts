// Shared name-join primitives now live in src/names.ts (client + ingest share one impl). This module
// keeps the Sackmann-specific tourney/round maps and re-exports the primitives so durations / finals /
// seeds / historical-elo keep importing them from "./names" unchanged.
export { nameTokens, fullKey, sigKey, pairKey, flashSigKey } from "../src/names.js"; // .js ext: reached by the /api/live Vercel ESM function (see api/live.ts)

// Sackmann tourney_name variants per slam key (compared lowercased; 2024 files say "Us Open").
export const TOURNEY: Record<string, string[]> = {
  "australian-open": ["australian open"],
  "roland-garros": ["roland garros", "french open"],
  wimbledon: ["wimbledon"],
  "us-open": ["us open"],
};
export const ROUND: Record<string, number> = { R128: 0, R64: 1, R32: 2, R16: 3, QF: 4, SF: 5, F: 6 };
