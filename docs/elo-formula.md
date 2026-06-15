# Elo formula — one-page reference

How one player's rating is computed. Full rationale: [`elo-methodology.md`](elo-methodology.md) ·
[`elo-investigation-findings.md`](elo-investigation-findings.md). Engine: `ingest/historical-elo.ts`.

## Core update (per match, per player)

```
E      = 1 / (1 + 10^((rOpp − rSelf) / 400))     # win expectation
K      = 250 / (n + 5)^0.4                        # n = this player's own prior match count
rSelf += K · (S − E)                              # S = 1 win / 0 loss; walkovers & RET count
```

Applied to the **overall** rating, and — if the surface is known — again to a separate same-surface
rating (own surface count). Both players update from their *own* K. Walkovers/retirements move ratings
(Sackmann lists a winner). Replay is deterministic: sort by `(tourneyDate, input index)`.

## Surface rating (displayed)

```
surfaceElo = 0.5 · overall + 0.5 · pureSurfaceRating     # null if the player has 0 matches on it
```

## Entrant seed (first appearance)

| | tour main draw | Challenger (`level C`) or qualifying (`round Q*`) |
|---|---|---|
| **ATP** | 1550 | 1170 |
| **WTA** | 1400 | 1090 |

## Injury / absence model (TA's, `TA_LAYOFF_DOCK`)

Active-season days only (the gap's overlap with **Feb 1 – Oct 1**; offseason excluded).

```
curve(d)   = 100 + 50 · clamp01((d − 56) / (365 − 56))      # 100 @ 8wk → 150 @ ~1yr, capped
```

On a player's **return** from a gap ≥ 56 active-days, if pre-layoff rating (`overall + clusterDock`) ≥ 1900:

```
# combine-and-differential (serial layoffs within 2 yr of the last comeback combine):
if (now − lastComeback) > 2 yr:  clusterDays = 0; clusterDock = 0     # reset
clusterDays += gap
dock = curve(clusterDays) − clusterDock                              # only the marginal increase
rSelf −= dock   (overall + every surface)                           # in-state
clusterDock += dock
recoveryLeft = 20                                                    # boosted-K window opens
```

Recovery is via **results**, not time: while `recoveryLeft > 0`, `K ×= 1 + 0.5·(recoveryLeft/20)`
(×1.5 on the first match back → ×1 over 20 matches), decremented one per match. A returnee who keeps
losing stays docked.

Two overrides:
- **Currently absent** (open trailing gap ≥ 56 active-days, not yet returned): docked at extraction by
  `curve(clusterDays + openGap) − clusterDock`.
- **COVID** (2020-03-01 … 2021-12-31): no dock applied (TA suspended the penalty board-wide).

Identical for ATP and WTA — one curve, no per-gender scale.

## Scope & freezing

- **Matches:** all tour-level + tour-level qualifying + Challenger main draw (ATP); + ITF ≥ $50K (WTA).
  History from **1968** (Challengers 2008+, qualifying 2011+).
- **Board:** a player is listed with ≥ 10 counting matches in a trailing 52 weeks; singles only.
- **Frozen** at each slam's start date (a 2016 draw shows 2016 Elo). Live current-slam numbers come from
  scraping TA directly (`ingest/elo.ts`).

## Achieved vs Tennis Abstract (top-50, 2026-06)

ATP overall meanAbs **~11** (median +2), WTA **~7** (median +2); 47/50 & 49/50 within ±40. Byte-exact is
impossible (TA's seed value, dock-curve shape, and baseline K are unpublished).
