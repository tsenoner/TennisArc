# Elo methodology

> **Canonical summary: [docs/issue-25-findings.md](issue-25-findings.md).** This file is kept as the detailed investigation log for issue #25; some intermediate values below were later corrected — trust the canonical summary where they differ.


> **Just want the math?** See the one-page [`elo-formula.md`](elo-formula.md).

TennisArc ships surface-aware Elo on every player, recomputed from [Jeff Sackmann's](https://github.com/JeffSackmann) match CSVs and **frozen at each slam's start date** (a 2016 draw shows 2016 Elo, not today's). The engine lives in `ingest/historical-elo.ts`; the per-tour fitted parameters in `ingest/elo-config.ts`; the calibration harness in `ingest/calibrate-elo.ts`; the regression guard in `ingest/historical-elo.fixture.test.ts`.

The goal is to reproduce [Tennis Abstract's published board](https://tennisabstract.com/reports/atp_elo_ratings.html) as closely as public data allows. This investigation (issue #25, 2026-06-14) verified TA's methodology against Sackmann's own blog/code and **measured** the result against the live board.

> **⚠ 2026-06-15 — this page describes the SHIPPED from-scratch engine; several items below are SUPERSEDED.**
> A board-replay reverse-engineering of TA's own published monthly boards (full record
> [`elo-investigation-findings.md`](elo-investigation-findings.md) §0, one-pager [`elo-formula.md`](elo-formula.md))
> reproduces TA to median-of-medians ~3 (ATP) / ~1.4 (WTA), **byte-exact in clean windows**, and corrected:
> (a) the entrant **seed** is a single ~1155 (ATP) / ~1200 (WTA), no split — the 1550/1170 & 1400/1090 below are
> burn-in calibration artifacts; (b) **walkovers/retirements are NOT counted** (overturns the paragraph below);
> (c) the **injury dock** is a discrete round-number display overlay dropped on return, not a history-baked
> curve + K-recovery; (d) **K=250/(n+5)^0.4 is CONFIRMED** (exponent 0.4, not "0.72"). The engine has not yet
> been migrated to those corrections; the rows below document what it currently ships.

## From-scratch byte-exact is hard; board-replay is byte-exact in clean windows

Sackmann's own repo (`tennis_viz/players_weekly_elo.py`) states verbatim: *"(historical ratings and code to generate ratings are not public)."* The generation **code** is not public — but the **rule** is now recovered. Replaying TA's published boards forward (board[prev] + the window's matches → board[cur]) reproduces TA **byte-exact in clean windows** (median-of-medians ~3 ATP / ~1.4 WTA), so the seed (~1155 ATP / ~1200 WTA), K law (250/(n+5)^0.4), surface blend (0.5), and inclusion scope are all pinned. What remains genuinely unrecoverable is TA's **semi-manual round-number injury dock schedule** (which absent player it docks/refunds on which board) and the exact handling at the 2018 history-recompute boundary. The *from-scratch* 1968 reconstruction the engine currently ships is the weaker path (meanAbs ~11/~7) and cannot hit byte-exact; migrating the engine to the board-replay rule is pending.

For the **current** slam, the exact published numbers remain available by scraping (`ingest/elo.ts`, byte-correct). The recompute exists only to *rewind* to historical events on the same scale.

## The parameters

| Driver | Value we use | Source / confidence |
|---|---|---|
| Win expectation | `1 / (1 + 10^((rB − rA) / 400))` | TA "Introduction to Tennis Elo" — verbatim. Exact. |
| K-factor | `250 / (n + 5)^0.4` (per player, own prior counted-match count; no cap; one law both tours) | **CONFIRMED** by 2026-06-15 board replay: 250 maximizes byte-exact windows (an implied ~272 read was rejected), exponent 0.4. Exact. |
| Margin-of-victory | **none** (binary win/loss) | TA 2025-11-28: *"Elo looks at match results — period."* Exact (0.97). |
| Surface Elo | flat `0.5·overall + 0.5·pureSurface`, every surface, every sample size; `null` if 0 surface matches | TA report page + Heavy Topspin 2017/2019: *"50/50 worked for each surface."* (0.92) |
| Match inclusion | ATP: G/M/A/F/D + Challengers (C) + qualifying. WTA: G/PM/P/I/F/D + qualifying + ITF **≥ $50K only** (sub-$50K excluded). **Walkovers/retirements NOT counted; Olympics (O) appear uncounted.** | **Board-replay CONFIRMED** (RET/WO players move 12%/24% vs 78–79% for completed). ⚠ Overturns the prior "counted" claim; the shipped engine still counts WO/RET (pending). |
| Entrant seed | **TA's actual seed: single ~1155 (ATP) / ~1200 (WTA) per tour, NO Challenger/qualifying split** (its "low 1200s"). | ⚠ The shipped engine instead uses fitted **burn-in calibration artifacts** (ATP 1550/1170, WTA 1400/1090, split) from the 1968 reconstruction — NOT TA's seed; single-seed migration pending. (board replay, 0.85) |
| Injury/absence model | **TA's actual mechanism: a discrete round (multiple-of-5) DISPLAY dock** (~−100, range −90…−115) on a *currently-absent* player rated ≥1900, applied once ~8wk idle; usually one-time (occasionally a round step toward ~−150); **reversed by a round +100/+105 around return or simply dropped once active**; frozen between. No history-baked curve, no K-recovery, no combine-and-differential. COVID 2020-03…2021-12 suspended. | ⚠ Concept (≥1900 gate, ~−100, ~8wk) confirmed; the *mechanism* overturns the prior model. The shipped engine still runs the old curve + ×1.5-K-recovery + combine-and-differential `TA_LAYOFF_DOCK` (pending). (board replay, 0.88) |
| History start | **1968** (full Sackmann history) | Tour-level exists 1968+ (Challengers 2008+, qualifying 2011+, so the deep past is tour-level only). The deeper burn-in matures the scale; the seed is re-fit for this start. |

**Walkover/retirement handling — now corrected (primary source found).** Earlier we kept counting them because no primary source said otherwise. TA's own published boards ARE that primary source: in the 2026-06-15 board replay, walkover/retirement players move only 12% (ATP) / 24% (WTA) vs 78–79% for completed matches — **TA does NOT count walkovers or retirements** (Olympics also appear uncounted). The shipped engine still counts them (Sackmann's CSVs list a winner); excluding them is a pending engine correction.

## Calibration & achieved accuracy

`ingest/calibrate-elo.ts` runs the engine forward to "today" (full 1968+ history, **dock ON**), scrapes the live TA board, joins by the **dominant-id** key (same as production), grid-searches the entrant seed to minimize median |overall error| over the top-50 TA players, and — the metric you actually need — **reports the single largest |deviation| and the worst-12 offenders**, not just the mean (a few injury-history players dominate the tail, so the mean hides them). Fitted 2026-06-15 vs TA as-of 2026-06-14:

| Tour | seedTour | seedSub | overall (median / meanAbs) | hard | clay | grass | within ±40 | worst |
|---|---|---|---|---|---|---|---|---|
| ATP | 1550 | 1170 | +2 / **11** | 12 | 13 | **90** | 47/50 | Draper +88 |
| WTA | 1400 | 1090 | +2 / **7** | 8 | 9 | 65 | 49/50 | Pliskova −79 |

> **The table above is the SHIPPED from-scratch engine vs the live board — the weaker path.** The
> authoritative reproduction is the **board-replay**: per-transition median-of-medians **3.0 (ATP) / 1.4 (WTA)**,
> **byte-exact in clean windows** (see [`elo-formula.md`](elo-formula.md) / findings §0). The from-scratch
> numbers (meanAbs 11/7, the Draper/Pliskova outliers below) are artifacts of reconstructing from 1968 with
> the old injury model — they are NOT an intrinsic TA-vs-us gap.

The full injury model **appeared to fix the active injury-returnees** the simple extraction dock could not (Djokovic +114→reasonable, Fritz +100→−12, Anisimova +112→+26, Zheng +95→+17). But the board replay shows the *true* cause of TA's depression of recently-returned players is its **discrete round-number display dock on currently-absent ≥1900 players, dropped/refunded around return** — not an ×1.5-K recovery or combine-and-differential (those are the shipped engine's approximation, pending correction). Couplings that move the from-scratch fit together: Challenger inclusion vs the low-1200s reseed (~+260); history-start 2000→1968 (~+40); and the injury model vs the seed.

## Per-individual residuals — what's left, and why

Per-individual analysis shows the field is well-fit (most players ~5–10 Elo; ATP 47/50 and WTA 49/50 within ±40). The few remaining outliers are **individual, not generalizable** — they deviate in *opposite* directions, so no single curve change fixes them:

1. **Chronic / serial-injury absentees, under-docked (Draper +88, Korda +79, ATP).** Currently-absent players whose cumulative TA dock exceeds our combined-curve cap (≈150). Their *historical* fit is excellent (Draper 2024–25 within ±9); only the current open absence is short.
2. **Declining veterans, over-docked (Pliskova −79, WTA).** TA's per-player accounting docks them less than the curve.
3. These reflect TA's **private per-player injury state** (which specific layoffs it counted, the rating at each, the comeback results) — not recoverable from public data, and chasing them would overfit. Bounded, documented.
4. **Historical scale (time-varying).** 2016–17 run ~−90 (all-time Big-Four/Serena peak compression + burn-in). A discrete step at **mid-2018** is now explained: TA performed a **one-time full-history recompute** (~−82 median, ~−230 at top) when it expanded inclusion — an era boundary the from-scratch model can't reproduce, not a dock effect. The **COVID era (2020–21) is suspended** (TA suspended the penalty board-wide).
5. **ATP thin-grass samples** — large per-surface grass errors for players with few grass matches; small overall impact.

**Data sources:** Sackmann remains the single source of truth. atptour.com is Cloudflare-blocked; wtatennis.com's JSON API is open but its ToS forbids automated harvesting *and* it agrees with Sackmann to the day — so it adds legal/maintenance risk for zero gain (use only for occasional manual identity spot-checks, e.g. disambiguating Veronika vs Polina Kudermetova). Duplicate Sackmann `player_id`s (a maintainer-tracked multi-feed artifact, not a juniors/pro split) are handled by the dominant-id join.

## Re-deriving

```bash
npx tsx ingest/calibrate-elo.ts                 # re-fit the seed vs the live board (network)
# transcribe the winning seeds into ingest/elo-config.ts
pnpm backfill-elo && pnpm reindex               # recompute all snapshots (network), rebuild the index
ELO_FIXTURE=1 TZ=UTC npx vitest run ingest/historical-elo.fixture.test.ts   # opt-in regression guard
```

TA updates ~weekly, so the fixture reference (`ingest/fixtures/ta-elo-reference.json`) is pinned with its `asOf` date and re-captured deliberately via `.scratch/capture-ta-reference.ts`. Acceptance sanity check (issue #20): RG 2016 frozen → Djokovic #1 overall **and** #1 clay, Nadal #2 clay.

## Storage note

The frozen Elo is currently embedded per-snapshot. A planned normalized build-time store (`docs/superpowers/plans/2026-06-14-data-storage-normalization.md`) would lift it into a derived artifact and replay history once instead of per-snapshot — independent of this Elo work.
