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

Same competitive scope as the full board, with one sharp extra rule found here:

- **Counted:** tour-level main draw (ATP G/M/A/F, WTA G/PM/P/I/F) + **tour-level qualifying** +
  **Challenger / WTA-125 MAIN DRAW** (level `C`) + **ITF $50K+ main draw**.
- **NOT counted:** **Challenger / ITF qualifying** (only *tour-level* qualifying counts), walkovers &
  retirements (no winner credit), sub-$50K ITF, and (thin-sample) Olympics.
- A season is attributed by a tournament's **end year**, so late-December season-openers (United Cup,
  Brisbane, Hong Kong) count in the **new** year, as TA does.

The challenger-qualifying exclusion was decisive and is provable from TA's own player page: Milos Karol's 2025
page lists 57 Challenger matches (36 of them qualifying); his yElo board shows **9–12 = 21 = 57 − 36** —
exactly Challenger *main draw* only. Counting Challenger qualifying over-states Challenger journeymen ~2.5×.

## How we reproduce it

`ingest/elo-reverse/yelo-fit.ts` (`npx tsx … ATP|WTA`):

1. **Opponent timeline (pass 1).** A forward full-Elo pass over all counted matches, **re-anchored to TA's
   own published full-Elo boards** at every board date (we have dense ~weekly captures — see below), so each
   opponent's rating tracks TA's real value to within one weekly board.
2. **yElo (pass 2).** For each listed player: reset to 1500/n=0, replay their season (whole-tournament
   `endDate` gating, tournament end-year season), opponents at their pass-1 rating at match time, only the
   target updates. Compare W/L and yElo to the published board.

A 3-parameter grid over (D, K-numerator, K-shape) confirms **D=400, K=250/(n+5)^0.4** is the clear optimum —
**yElo uses the identical update rule as the full board**, no special parameters.

## Results

- **yElo ratings**, scored **only on players whose W/L we reproduce exactly** (a W/L mismatch means a
  different match set was replayed, so its Δ isn't a rating error): per-board **median |Δ| ≈ 5–8 Elo (ATP),
  ~8 (WTA)**, byte-exact on dozens of player-boards, points hug the diagonal in `pnpm elo:scatter` (yElo
  mode). Over **all** joined players (including W/L mismatches) the WTA median is ~15 Elo — the conditioning
  on exact W/L matters, so quote it as conditional. The reproduction is **scale-correct** — the 5–0-champion
  spread matches TA (e.g. 2026-01-12: Medvedev +15, Hurkacz +9). A small uniform **+9…+17 positive bias**
  remains (inter-anchor opponent drift accumulating into the target over a season); it shifts every player
  the same way, so it doesn't affect the spread/ordering.
- **W/L tally** (which matches counted): ATP **74%** of player-board entries exact, WTA **54%**, and
  **~100% early in each season**. It degrades through the year because a deep-season board needs *every* one
  of ~25 events attributed to the correct board, and small per-event boundary errors **compound**
  ((1−ε)^25). The misses are off-by-one at the **latest-event boundary**, not scope errors (late-season
  mismatches are essentially all "missing the in-progress/just-finished event").

**A few Wayback captures are corrupted** (a TA/archive glitch): e.g. the WTA `20211227` and `20240101`
boards show *doubled* W/L counts (Muguruza 84-32 = 2× her real 42-16), so they score W/L-ok 0. These are bad
*source* captures, not model errors; they drag the 2021/2024-opener W/L numbers and could be filtered.

**Residual sources (data limits, not model error):** (a) Sackmann dates every match with the *tournament*
start (TA's own player pages confirm TA has only tournament-granularity dates too), so a board that lands
mid-/just-after an event can't be split to the day; (b) opponent ratings drift a few Elo between weekly
anchors and the target accumulates that over a season. Both are bounded; the **algorithm itself is exactly
reproduced** (byte-exact on clean cases), mirroring the full-board "byte-exact in clean windows" result.

## Bonus: the dense captures make the FULL-board replay near-exact

Fetching every distinct Wayback capture (not just monthly) gave 338 ATP / 240 WTA distinct full-Elo board
dates (median gap **7 days**). Re-running the board-to-board replay (`replay.ts --clean`) against this dense
set, plus the round-order fix below, drops the per-transition **median-of-medians to 0.10 (ATP) / 0.04 (WTA)**
— **271/332 (ATP) and 181/230 (WTA) transitions reproduce to ≤1 Elo** (was median 3.0/1.4 on monthly boards).
Weekly anchoring leaves almost no room for boundary noise to accumulate.

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
