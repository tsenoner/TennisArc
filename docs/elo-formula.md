# Elo formula — one-page reference

What Tennis Abstract's (TA) singles Elo actually does, reverse-engineered from TA's own published boards
(2026-06-15 board-replay — full record [`elo-investigation-findings.md`](elo-investigation-findings.md) §0,
rationale [`elo-methodology.md`](elo-methodology.md)). **CONFIRMED** items reproduce TA byte-exact in clean
windows. The shipped engine (`ingest/historical-elo.ts` + `ingest/elo-config.ts`) is a *from-scratch*
reconstruction that still differs on the items marked **⚠ engine differs** — those corrections are pending.

## Core update (per match, per player) — CONFIRMED

```
E      = 1 / (1 + 10^((rOpp − rSelf) / 400))     # win expectation, D = 400
K      = 250 / (n + 5)^0.4                        # n = own prior counted-match count; no cap; ONE law both tours
rSelf += K · (S − E)                              # S = 1 win / 0 loss
```

Both players update from their *own* K. (Board replay confirms 250, not the ~272 an implied-K read suggested,
and exponent 0.4 — do not "correct" it.) Applied to the **overall** rating, and — if the surface is known —
again to a separate same-surface rating (own surface count). Replay is deterministic: sort by
`(tourneyDate, input index)`.

## Surface rating (displayed) — CONFIRMED

```
surfaceElo = 0.5 · overall + 0.5 · pureSurfaceRating     # null if 0 matches on it
```

Exactly 0.5 (free OLS: weight 0.5000, R²=1.0). The overall rating aggregates matches on every surface; each
surface-raw stream moves only on its own surface.

## Match inclusion — CONFIRMED (walkover/RET handling corrected)

- **ATP:** slams (G), Masters (M), 250/500 (A), Finals (F), Davis/team (D), Challengers (C), tour-level qualifying.
- **WTA:** slams (G), WTA1000/Premier (PM/P), International/250 (I), Finals (F), BJK/team (D), qualifying, and
  **ITF ≥ $50K only** (sub-$50K NOT counted).
- **Completed matches only — walkovers & retirements are NOT counted** (board evidence: RET/WO players move
  12% ATP / 24% WTA vs 78–79% for completed matches). Olympics (level O) also appear uncounted.
  **⚠ engine differs:** the shipped engine still counts walkovers/retirements.

## Entrant seed (first appearance) — CONFIRMED

TA seeds a debut at a **single value per tour, no Challenger/qualifying split**: **ATP ≈ 1155, WTA ≈ 1200**
(its published "low 1200s"). **⚠ engine differs:** the shipped engine uses fitted *burn-in calibration
artifacts* (ATP 1550/1170, WTA 1400/1090, with a split) — a side-effect of reconstructing from 1968, NOT TA's seed.

## Injury / absence dock — concept confirmed, mechanism corrected

Confirmed: a dock of **~−100** on a player rated **≥ ~1900** who has been idle **~8 weeks**. The mechanism is a
**discrete, round (multiple-of-5) DISPLAY dock** on a *currently-absent* player:

- Applied once at a single board (zero matches), magnitude ~−100 (range −90…−115).
- Usually one-time; occasionally a further round step toward ~−150 for very long absences.
- **Reversed by a round +100/+105 around return** (rare on ATP, ~⅓ of WTA cases), or simply **dropped once the
  player is active again**. Frozen between adjustments. A semi-manual round-number overlay — *not* a curve
  baked into history, and there is **no** results-based K-recovery and **no** combine-and-differential.
- COVID 2020-03…2021-12: dock suspended board-wide.

**⚠ engine differs:** `TA_LAYOFF_DOCK` implements the *old* model (smooth curve 100→150 in-state + ×1.5→×1
K-recovery over 20 matches + combine-and-differential). This is why the shipped engine leaves active
injury-returnees ~+100 too low; TA simply removes the round dock at display.

## Idle, board eligibility, recompute

- **Idle = freeze**: a player who plays no matches does not move (median Δ=0 even over the 175-day COVID gap).
- **Board:** listed with ≥ 10 counting matches in a trailing 52 weeks; singles only.
- **2018 recompute:** TA re-ran its whole history once when it expanded inclusion (~−82 median / ~−230 top at
  ATP 2018-06-11 / WTA 2018-05-28) — an era boundary, not a monthly update.

## Reproduction vs Tennis Abstract

**Board-replay (board[prev] + window matches → board[cur]):** per-transition median |err| = median-of-medians
**3.0 (ATP) / 1.4 (WTA)**, **byte-exact in clean windows** (WTA 24/65 transitions ≤1 Elo). The older
from-scratch engine reaches only meanAbs ~11 (ATP) / ~7 (WTA) vs today's board — that is the weaker path, not
the achievable ceiling. Re-run: `npx tsx ingest/elo-reverse/replay.ts {ATP|WTA} --clean` (tooling +
interactive scatter in [`ingest/elo-reverse/`](../ingest/elo-reverse/); `pnpm elo:scatter` builds the scatter).
