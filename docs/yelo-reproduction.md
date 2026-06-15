# Season yElo — reverse-engineered & reproduced (issue #25, 2026-06-15)

Companion to [`elo-investigation-findings.md`](elo-investigation-findings.md). This documents Tennis
Abstract's **season "yElo"** boards (`{atp,wta}_season_yelo_ratings.html`), the definitive model behind them
(from Sackmann's own writing + the archived boards), our reproduction, and the data/tooling.

## What yElo is (DEFINITIVE — Sackmann's "Repurposing Elo for streaks, seasons…", 2021-03-16)

yElo is **single-season Elo computed one player at a time**, quoting the source verbatim:

> "Take Muguruza. Instead of starting the year with a rating of 1981 … we give her **a newbie's rating of
> 1500 and a history of zero matches**. Then we run the Elo algorithm to update her rating over the course
> of her 22 matches. **First she faces Kristina Mladenovic (with her actual rating at the time of 1817)**,
> and improves to 1605. Then she beats Aliaksandra Sasnovich (**and her rating of 1805**)…"

So, for each player **X**:
1. **Reset X to 1500, match-count `n = 0`** on January 1.
2. Replay X's **current-calendar-year** matches in play order.
3. Each **opponent stays at their REAL (full-Elo) rating at match time** — NOT reset.
4. **Only X updates** (it is X's private "what if a newbie ran this exact season" rating).
5. Same update rule as the full board: `E = 1/(1+10^((rOpp−rX)/400))`, **D = 400**,
   **K = 250/(n+5)^0.4** (n = X's *this-season* match count, so K is large early and shrinks).

yElo therefore **rewards beating strong opponents** (their real Elo is high → big gain) and discounts beating
weak ones — which is why two 5–0 players can sit 160 Elo apart (e.g. an ATP-250 champion vs a Challenger
champion). A flat-1500 *pool* (everyone reset) is **wrong** and collapses that spread — opponents at real
strength is the whole point.

**Listing threshold:** a player appears once they have **≥ 5 wins** in the current year (board columns are
`Rank | Player | Wins | Losses | yElo`).

## Inclusion scope (verified against the boards + TA player pages)

- **Counted:** tour-level main draw (ATP G/M/A/F, WTA G/PM/P/I/F) + **tour-level qualifying** +
  **Challenger / WTA-125 MAIN DRAW** (level `C`) + **ITF $50K+ main draw** + **retirements** (see below).
- **WTA also counts WTA-125 (level `C`) QUALIFYING; ATP does NOT count Challenger qualifying.** This tour
  asymmetry was missed at first (it's the second-largest W/L source). For ATP it's provable from Milos Karol's
  2025 player page (57 Challenger matches, 36 qualifying → board shows 9–12 = 21 = 57 − 36, *main draw only*).
  For WTA the 125 quallies reconcile only when counted (e.g. Canberra-125 Q rows). **Neither tour counts
  numeric-ITF (W50/W75/W100) qualifying** — adding it regresses ~120 players per 2024 WTA board (adversarially
  verified). So: drop a qualifying match only when its level is neither tour-level nor (WTA) `C`.
- **Retirements / defaults COUNT — but only from a spring-2025 recompute onward (ERA-dependent).** The
  contested/not discriminator is *were any games played* — does the score string contain a digit. `6-3 4-6 2-1
  RET`, `… DEF`, `… ABD` are contested and have a winner; `W/O` / `Walkover` / empty are not. **Pure walkovers
  are never counted.** Retirements, however, TA only began counting at a **one-time recompute around April
  2025**: every yElo board captured from ~2025-04 on counts RET for the *whole* season (proven by Djokovic's
  2026 AO — board `5-1` requires his QF win over Musetti's `RET`; his R16 `W/O` is not counted), while every
  board before — all 2021–2024 boards *and* the Jan–Mar 2025 boards — excludes it. The flip is razor-sharp and
  identical on both tours (W/L-exact: RET-off wins every board ≤ 2025-03-17, RET-on wins every board ≥
  2025-05-26; e.g. ATP `20241104` is **494/507 with RET off** vs 201 on, ATP `20260223` is **265/265 with RET
  on** vs 188 off). So RET inclusion is gated **per board by capture date** (`lib.ts:RET_ERA_START`, midpoint
  of the un-captured 2025-03-17 → 2025-05-26 window), *not* by match date — the recompute was retroactive. This
  one finding lifted ATP W/L-exact from 65% to **95%** across all years and reconciles the earlier full-board
  note ("RET/WO not counted", derived from 2016–2024 data) with the 2026 boards.
- **NOT counted:** Challenger/ITF *qualifying* (except WTA-125 qual), pure walkovers, sub-$50K ITF, Olympics.
- A season is attributed by a tournament's **end year**, so late-December season-openers (United Cup,
  Brisbane, Hong Kong) count in the **new** year, as TA does.

**Feed de-duplication.** Sackmann's WTA qualifying/challenger feed re-lists every level-`C` (WTA-125) match
**twice** (1343 byte-identical rows in 2026; ATP has ~14 total). `loadMatches` now drops duplicates keyed by
`tourneyId|round|winnerId|loserId|score` — mandatory once 125 qualifying is in scope, a safe no-op elsewhere
(a draw pairs two players at most once per round, so the key never collides legitimately).

## How we reproduce it

`ingest/elo-reverse/yelo-fit.ts` (`npx tsx … ATP|WTA`):

1. **Opponent rating = TA's published full-Elo, interpolated to match date.** The opponent's "actual rating at
   the time" (Sackmann's phrase) is read straight off TA's own dense ~weekly full-Elo board captures —
   **`oppRatingAt` linearly interpolates by calendar date between the two captured boards that bracket the
   match** and that both list the opponent (carry-forward/back to a single side; only players below the
   board's ~1100 display floor fall through to an anchored forward-Elo pass, `tlSeed=1500`). Reading opponents
   off the *board* — not a free-running forward Elo — is what removed the old uniform positive bias; the
   interpolation then removes most of the residual *negative* bias from reading a stale prior board (opponents
   climb between weekly captures). See "What was wrong" below.
2. **yElo (pass 2).** For each listed player: reset to 1500/n=0, replay their season (whole-tournament
   `endDate` gating, tournament end-year season), opponents at their interpolated rating at match time, only
   the target updates. Compare W/L and yElo to the published board.

A grid over (D, K-numerator, K-shape) confirms **D=400, K=250/(n+5)^0.4** is the optimum — **yElo uses the
identical update rule as the full board**, no special parameters. (The negative residual is *insensitive* to D
and K, which is what proved it was an opponent-rating-staleness problem, not a parameter problem.)

## Results (after the 2026-06-15-later fixes)

- **yElo ratings**, scored on players whose W/L we reproduce exactly (a W/L mismatch means a different match
  set, so its Δ isn't a rating error): per-board **median |Δ| ≈ 5 Elo (ATP) / 6 (WTA)** with **byte-exact on
  the latest boards** (ATP `20260223` median 5.2; WTA `20260420` 6.1). Aggregate **median-of-medians 7.0 (ATP)
  / 8.4 (WTA)** (was 8.6 / 9.9 before interpolation) with byte-exact counts ~doubled (ATP 24→44, WTA 5→22).
  Carlos Alcaraz's 2026 season is **byte-exact** (2124 vs 2124.4 read straight off the boards). Points hug the
  diagonal in `pnpm elo:scatter` (yElo mode).
- **W/L tally** (which matches counted): aggregate **ATP 95% (10201/10730), WTA 68% (8609/12690)**, by season:

  | season | ATP W/L-exact | WTA W/L-exact |
  |---|---|---|
  | 2021 | 92% | 44% |
  | 2022 | 94% | 85% |
  | 2023 | 100% | 98% |
  | 2024 | 93% | 66% |
  | 2025 | 97% | 67% |
  | 2026 | 100% | 77% |

  ATP is essentially solved (the residual is the trailing in-progress-event boundary + a few corrupt captures).
  WTA's lower figure is **entirely the ITF/WTA-125 journeywomen** and is largely irreducible: on WTA `20250908`
  **48 of 160 misses are mathematically impossible** (the board's W or L exceeds the player's whole-season
  match count under *any* scope — TA revised its match DB after these snapshots were frozen), and the rest need
  counting ITF qualifying/sub-$50K, which the adversarial verifier proved regresses ~120 players per 2024 board.
  Top-of-board WTA players reproduce as cleanly as ATP.

### What was wrong, and the irreducible floor

The investigation (a dynamic 6-agent workflow, each finding adversarially re-verified on boards it did *not*
optimise on) decomposed the residual into three independent pieces and fixed two; the third is a data limit:

1. **Retirements weren't counted, then were over-counted on old boards** → the biggest W/L lever. Counting RET
   makes 2025–2026 boards near-perfect but *over*-counts 2021–2024 boards, because TA only began counting RET
   at a retroactive spring-2025 recompute (see scope). Gating RET per board by capture date took aggregate ATP
   W/L from 65% → 95% (latest ATP board 188 → 265/265) and was the key to reconciling every season at once.
2. **Opponents were read at the *nearest-prior* board** (or, earlier, a drifting forward pass). The prior board
   is up to ~30 days stale and opponents *climb* through the season, so a target's later wins were
   under-credited — a negative bias that is ~0 in January and grows to ~−11 by November, **insensitive to D/K**
   (the tell). Calendar **interpolation between bracketing boards** halves it on every board (30/30 ATP, 33/33
   WTA improve; W/L set provably unchanged). The *remaining* ~−5 on dense mid-season boards is **irreducible**:
   a title run jumps an opponent 50+ Elo in days, which linear interpolation between weekly captures cannot
   reproduce. (A red herring we ruled out: the seed-1500 fallback does **not** over-rate off-board opponents —
   they're mid-strength ~1400, not weak-near-floor, and the target wins ~80% of those, so *lowering* the seed
   makes it worse. The apparent "+bias on off-board players" was an artifact of a diagnostic that used a flat
   1500 floor instead of the real forward-pass fallback.)
3. **The latest WTA board's remaining W/L misses are TA *data revision*, not our error.** The `20260420`
   capture's footer says "Last update 2026-04-20" but it was archived 2026-04-26 against a since-revised match
   DB: **26 of its 75 under-counters are mathematically impossible** (the board's W or L exceeds the player's
   entire-season match count under *any* scope/cutoff — e.g. Ristic board 15-12 vs a 2026 max of 13-15), and 66
   are unreachable at any cutoff. The achievable ceiling on that frozen board is ~258/307, and we hit it.

**A few Wayback captures are also outright corrupted** (WTA `20211227`, `20240101` show *doubled* W/L counts —
Muguruza 84-32 = 2× her real 42-16 — so they score W/L-ok 0); bad source captures, not model error.

## Bonus: the dense captures make the FULL-board replay near-exact

Fetching every distinct Wayback capture (not just monthly) gave 338 ATP / 240 WTA distinct full-Elo board
dates (median gap **7 days**). Re-running the board-to-board replay (`replay.ts --clean`) against this dense
set, plus the round-order + era-aware-RET + de-dup fixes, gives a per-transition **median-of-medians of 0.11
(ATP) / 0.07 (WTA)** — **271/332 (ATP) and 181/230 (WTA) transitions reproduce to ≤1 Elo** (was median 3.0/1.4
on monthly boards). Weekly anchoring leaves almost no room for boundary noise to accumulate. `replay.ts` gates
RET by the same spring-2025 recompute date, so it stays consistent with the yElo era model.

⚠️ **Honest qualifier:** that 0.10/0.04 is an **all-players (idle-inclusive)** statistic — ~half of each
board is idle players whose predicted value is just the carried-forward prior rating (residual trivially ~0).
Restricted to players who **actually played** a window match, the per-transition median-of-medians is
**~1.4 (ATP) / ~1.0 (WTA)** and ~34% of transitions are ≤1 Elo. So "near byte-exact" is true for the board as
a whole; for the players the rule actually *moves*, it's ~1 Elo/transition — still far tighter than the 3.0/1.4
monthly figure, and byte-exact on genuinely clean windows.

## A bug worth recording: match ORDER within a tournament

Sackmann lists a tournament's matches **final-first** (match_num F is highest, R32 lowest). Processing in CSV
order makes a champion "beat" opponents still sitting at the seed (every 5–0 player collapses to one value).
Both the yElo and full-board replays now sort by `(date, roundRank, idx)` (qualifying → R128 → … → F);
`lib.ts:roundRank`. This alone improved the full-board replay median 3.0 → 2.64 before densification.

## Tooling & data

```bash
npx tsx ingest/elo-reverse/fetch-wayback.ts           # (re)download every distinct Wayback capture (network)
npx tsx ingest/elo-reverse/parse-yelo.ts              # raw-full → yelo-boards.json
npx tsx ingest/elo-reverse/yelo-fit.ts ATP            # reproduce + score (per board)
npx tsx ingest/elo-reverse/yelo-fit.ts ATP --board 20260112   # one board, detailed W/L + Δ
npx tsx ingest/elo-reverse/yelo-fit.ts ATP --pgrid    # confirm D/K
npx tsx ingest/elo-reverse/yelo-fit.ts ATP --cutfit   # per-board best data-cutoff (boundary ceiling)
pnpm elo:scatter                                       # Elo + yElo computed-vs-retrieved scatter (toggle)
```

- **Captures:** `data/wayback/raw-full/` (gitignored) — 412 ATP + 271 WTA full-Elo + 34 ATP + 36 WTA yElo
  distinct-content captures (the 793/542/42/42 totals collapse to these; the rest are byte-identical
  re-archives). yElo boards span **2021–2026** (none earlier on Wayback).
- TA player pages (`cgi-bin/player-classic.cgi?p=<Name>`) embed a `var matchmx` array of every match — a
  per-player ground truth for the inclusion check (tournament-date granularity only).
