// Shared points MECHANICS — the table-independent rules common to the generalized engine (engine.ts) and the
// hardcoded-table cross-check (validate.ts). Both import these so the LOGIC lives once; each file keeps its own
// point TABLES + tier-classification ruleset (engine loads them from the spec docs; validate hardcodes 2019/2023
// inline as an independent transcription cross-check).
//
// NOT shared here, deliberately: the per-tour tier classifier. engine's atpCls/wtaCls (generalized, every era,
// year-guarded specials, RoundMap tables resolved by draw) and validate's atpTier/wtaTier (Era-A only, flat
// string-key tables) intentionally differ in code while agreeing on 2019/2023 — that divergence IS the
// cross-check, so unifying them would erase the oracle and risk byte-drift. Only the order-independent mechanics
// below (exit-round, BYE rule, best-N cap) and the tiny string helpers are genuinely identical and safe to share.
import { roundRank, type Match } from "../elo-reverse/lib";

// ---------------- tiny string helpers ----------------
/** Qualifying round? (Q1..Q4) */
export const isQ = (r: string): boolean => /^Q[1-4]$/.test(r);
/** Lower-case + collapse non-alphanumerics to single spaces. `stripTrailingNum` also drops a trailing " 1"/" 2"
 *  (engine needs it for spec-table keys; validate does not — so it's opt-in to keep both byte-identical). */
export const norm = (s: string, stripTrailingNum = false): string => {
  let r = s.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  if (stripTrailingNum) r = r.replace(/\s+\d+$/, "");
  return r.trim();
};
/** Order-insensitive name signature for the ground-truth↔Sackmann join (handles "Wang Qiang"↔"Qiang Wang"). */
export const sig = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim().split(/\s+/).filter(Boolean).sort().join(" ");

// ---------------- BYE rule first-round detection ----------------
/** The draw's first main round (shallowest non-qualifying round present) + its rank. Used by the BYE rule: a
 *  player who reaches R2 via a BYE and then loses (0 main wins, entered ABOVE this round) scores as a
 *  first-round loser. `firstRoundLabel` is "" / `firstRank` 0 for a qual-only group (no main rounds). */
export function firstMainRound(ms: Match[]): { firstRoundLabel: string; firstRank: number } {
  const mainRounds = ms.filter((m) => !isQ(m.round)).map((m) => m.round);
  const firstRoundLabel = mainRounds.sort((a, b) => roundRank(a) - roundRank(b))[0];
  const firstRank = firstRoundLabel ? roundRank(firstRoundLabel) : 0;
  return { firstRoundLabel: firstRoundLabel ?? "", firstRank };
}

// ---------------- main-draw exit round (incl. BYE rule) ----------------
export interface PlayerRec { won: Match[]; lost: Match[] }
/** The round a player EXITED a normal knockout event: "W" (won the title), the round of their deepest main-draw
 *  loss, or — by the BYE rule — the event's first main round if they won 0 main matches and entered above it.
 *  Returns null for a qual-only run (no main-draw matches at all → not in a top-N sum). `wonQual` flags a
 *  player who won ≥1 qualifying match (drives the qualifying bonus, applied by the caller with its own values). */
export function mainDrawExit(
  rec: PlayerRec,
  firstRoundLabel: string,
  firstRank: number,
): { exit: string; wonQual: boolean } | null {
  const mainLost = rec.lost.filter((m) => !isQ(m.round));
  const mainWon = rec.won.filter((m) => !isQ(m.round));
  if (mainLost.length === 0 && mainWon.length === 0) return null; // qual-only
  let exit: string;
  if (mainLost.length === 0) exit = "W";
  else {
    const lossRound = mainLost.sort((a, b) => roundRank(b.round) - roundRank(a.round))[0].round;
    exit = mainWon.length === 0 && roundRank(lossRound) > firstRank ? firstRoundLabel : lossRound;
  }
  return { exit, wonQual: rec.won.some((m) => isQ(m.round)) };
}

// ---------------- best-N cap ----------------
/** Best-N counting config: how many "other" results count, and (2024+) the best-N cap on the mandatory pool. */
export interface BestNCfg { otherSlots: number; mandTake: number | null }
/** Year-end best-N sum: all Slams + all/best-N mandatory Masters + best `otherSlots` other results + all Finals.
 *  Generic over any `{tier, pts}` event shape (engine's PE and validate's richer PE both satisfy it). */
export function bestN<E extends { tier: string; pts: number }>(events: E[], cfg: BestNCfg): number {
  const slams = events.filter((e) => e.tier === "SLAM").reduce((s, e) => s + e.pts, 0);
  const finals = events.filter((e) => e.tier === "FINALS").reduce((s, e) => s + e.pts, 0);
  const mandEv = events.filter((e) => e.tier === "MAND_M").sort((a, b) => b.pts - a.pts);
  const mand = cfg.mandTake != null
    ? mandEv.slice(0, cfg.mandTake).reduce((s, e) => s + e.pts, 0)
    : mandEv.reduce((s, e) => s + e.pts, 0);
  const others = events.filter((e) => e.tier === "OTHER").sort((a, b) => b.pts - a.pts)
    .slice(0, cfg.otherSlots).reduce((s, e) => s + e.pts, 0);
  return slams + mand + others + finals;
}
