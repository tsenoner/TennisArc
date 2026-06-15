# Elo Investigation — Full Findings Log (issue #25)

This is the durable research record behind TennisArc's Elo engine. For the one-page formula see
[`elo-formula.md`](elo-formula.md); for the concise "how it works," see
[`elo-methodology.md`](elo-methodology.md). This document captures **everything investigated** — verified
parameters, empirical experiments, dead-ends we tried and rejected, and the bounded limitations — so the
reasoning isn't lost.

**Goal of issue #25:** reproduce Tennis Abstract's (TA) published singles Elo board
(`tennisabstract.com/reports/{atp,wta}_elo_ratings.html`) from Jeff Sackmann's match CSVs, as closely as
public data allows. **Verdict: byte-exact is provably impossible; we reproduce the top of the board to
overall meanAbs ~11 (ATP) / ~7 (WTA), median ~+2, with 47/50 (ATP) and 49/50 (WTA) within ±40. History
runs from 1968. We implement TA's FULL documented injury model — on-return in-state dock + ×1.5→×1 K-
recovery over 20 matches + combine-and-differential for serial layoffs + the COVID suspension — which fixed
the active injury-returnees (Djokovic/Fritz/Anisimova/Zheng). The few remaining outliers are individual
chronic/veteran cases (TA's private per-player accounting), not a generalizable gap.**

Investigation dates: 2026-06-14 (initial) + **2026-06-15 (dock re-instated, history → 1968, max-deviation
reporting, Wayback formalized)**. "Today" numbers measured against the live TA board as-of 2026-06-14.

> **2026-06-15 — §0 below SUPERSEDES parts of §2/§5 via a stronger method.** The from-scratch
> reconstruction (§1–§11) approximated TA's board from Sackmann CSVs over deep history. A second,
> independent attack — replaying TA's *own published monthly boards* forward one window at a time
> (committed tooling [`ingest/elo-reverse/`](../ingest/elo-reverse/), `pnpm elo:scatter`) — reproduces the board to a
> few Elo per month, **byte-exact in clean windows**, and pins several parameters the reconstruction could
> only guess. Where §0 and the older sections conflict, §0 is the measured truth.

---

> **2026-06-15 (later) — TWO upgrades, see [`yelo-reproduction.md`](yelo-reproduction.md):**
> (a) **Dense captures + match-order fix → the full-board replay is now near byte-exact.** Downloading
> *every* distinct Wayback capture (not just monthly) gives 338 ATP / 240 WTA board dates (median gap 7 days);
> with matches processed in true round order (Sackmann lists finals first — see `lib.ts:roundRank`), the
> per-transition **median-of-medians drops to 0.10 (ATP) / 0.04 (WTA)** — **271/332 & 181/230 transitions
> ≤1 Elo**, vs the 3.0/1.4 below on monthly boards. (b) **Season "yElo" reproduced.** yElo = reset each player
> to 1500/n=0 and replay their current year vs opponents' REAL full-Elo (only the target updates), same
> D=400 / K=250/(n+5)^0.4, excluding challenger/ITF qualifying. Ratings reproduce to median |Δ| ~5–8 Elo.

## 0. Board-to-board reverse-engineering (2026-06-15) — the strongest evidence

**Method.** Each archived TA board (Wayback, `.scratch/wayback/all`; 77 ATP + 88 WTA, 2016–2026, depth
106–543) is TA's exact published state on its "Last update" date. Seed an engine from board(T), replay that
window's Sackmann matches, compare to board(T+1). No burn-in, no seed-guessing for existing players — board(T)
IS the truth — so each mechanism is isolated directly. Validated by a 6-finder × 6-adversarial-verifier
dynamic workflow.

**Result (full rule: E·D=400 + K=250/(n+5)^0.4 + idle-freeze + the corrected inclusion scope below, excluding
the mid-2018 recompute boundary): whole-span per-transition median |err| = median-of-medians 3.0 (ATP) /
1.4 (WTA)** — ATP 11/62 transitions ≤1 Elo, WTA **24/65 ≤1 (essentially exact), 41/65 ≤2**. **Many windows are
BYTE-EXACT** (median |err| 0.00; one quiet window froze 441/444 players to within 0.1). Far tighter than the
from-scratch meanAbs 11/7 (which was vs *today's* board only). Run `npx tsx ingest/elo-reverse/replay.ts
{ATP|WTA} --clean`.

**Confirmed directly (each adversarially re-derived):**
- `E = 1/(1+10^((rB−rA)/400))`, **D = 400** (weakly identified — flat RMSE 380–450, point ~405/430 — but
  400 inside every CI; form confirmed, base is a convention absorbed into D).
- **K = 250/(n+5)^0.4**, n = prior match count, no cap, ONE law both tours (win-side spot-checks match). A
  direct implied-K read (Δelo/(S−E) on single-window matches) suggested the numerator was ~9–15% low (~272);
  but testing num∈{272,290,312} in the full board replay made reproduction MONOTONICALLY WORSE and byte-exact
  windows are MAXIMISED at 250 — so that implied-K excess is a single-window leakage artifact (a 2nd match's
  partial effect + opponent drift inflate Δelo). **250 stands.**
- **Surface display = EXACTLY 0.5·overall + 0.5·surface-raw** — free OLS a=0.5000, b=0.5000, c≈0, R²=1.0000
  over ~75k obs. Surface raws are surface-separated; overall counts all surfaces.
- **Idle = FREEZE** between adjustments (median Δ=0, incl. the 175-day COVID gap: 72 idle players → median 0).
- **New-entrant seed ≈ low 1200s, a SINGLE value per tour, NO level/qualifying split**: ATP ~1155, WTA ~1200.
  ⇒ the §4 seeds **1550/1170 (ATP) & 1400/1090 (WTA) are burn-in calibration artifacts, not TA's seed.**
- **Inclusion** (sharp, single-category-window tests): ATP G/M/A/F/D/C + qualifying. WTA G/PM/P/I/F/D +
  qualifying + **ITF ≥ $50K only** (levels 15/25/35/40 NOT counted; 50/60/75/80/100 counted). Excluding
  sub-$50K ITF + walkovers/RET is what drops the WTA whole-span median-of-medians 7.3 → 1.4.

**Corrected / overturned vs §2 and §5:**
- **Walkovers & retirements are NOT counted** (clean OVERTURN of §2's "counted"). RET/WO single-match players
  move 12% (ATP)/24% (WTA) vs 78–79% for completed matches. Olympics (level O) also appear uncounted (thin).
- **The injury/absence DOCK — concept right (≥1900 gate, ~−100, ~8wk trigger all CONFIRMED), MECHANISM wrong.**
  It is NOT a smooth 100→150 curve baked into history with a results-based ×1.5→×1 K-recovery (§5/§5b).
  It is a **discrete, round (multiple-of-5) DISPLAY dock** on a *currently-absent* ≥~1900 player: **~−100**
  (range −90…−115) applied at a single board with zero matches once ~6–10 weeks idle; strict gate (0 docks
  below ~1900 in ~69 events); usually one-time, occasionally extended a round step toward ~−150 (Zverev −125
  then −25; Berdych −105,−10,−10); sometimes **refunded by a discrete +100/+105 around return** (rare ATP
  1/18 — Berrettini −100 then +100 back to exactly 2018.8; commoner WTA 7/21, all exact, clustered on dates),
  frozen in between. A **semi-manual round-number overlay**, not a history-baked formula. This is exactly why
  the §9 "active injury-returnee +100" outliers persisted: the reconstruction carried a residual in-state
  dock recovering slowly; TA just adds the ~+100 back at display.

**New:**
- **A mid-2018 full-history RECOMPUTE discontinuity.** When TA expanded inclusion ("20 tour-level matches" →
  "10 matches incl. Challengers/qualifying/ITF $50K+") it re-ran its whole history, shifting the entire scale
  a one-time **~−82 median (~−230 at the top)** at ATP 2018-06-11 / WTA 2018-05-28 (every player drops
  uniformly, incl. zero-match ones: Federer −235, Serena −391). An era boundary, not a monthly update. This
  also reframes §6's "2016–17 peak is −95 low": part is this recompute era, not pure burn-in.

**Engine implication (NOT yet applied — see §11):** to match TA the production engine should use seed ~1155
(ATP)/~1200 (WTA) with no level split, exclude walkovers/retirements, and replace the §5b dock+recovery model
with a currently-absent-only ~−100 round dock (≥1900) that is fully dropped once a player returns. The board-
replay tooling is the natural regression fixture. Left as a follow-up because it restructures the live
pipeline.

---

## 1. Is the formula / code public?

**No — proven.** Sackmann's own repo `JeffSackmann/tennis_viz/players_weekly_elo.py` carries the verbatim
comment **"(historical ratings and code to generate ratings are not public)"** — it only reads/plots a
pre-computed CSV. The report pages are static HTML tables with no embedded computation and no downloadable
ratings file. The only methodology source is his prose blog (Heavy Topspin).

**No public reimplementation matches the published board.** All known repos (`damienld/Tennis-predict`,
`hdai/elo_tennis`, `hongsuh7/tennis-elo`) evaluate predictive log-loss/Brier, not board agreement.
TennisArc's ~5–10 Elo median agreement is, to current evidence, the closest documented reproduction in
existence. Do **not** cite an external repo as a board-matching reference — none exists.

## 2. Verified TA methodology (what IS public)

| Driver | TA value | Source / confidence |
|---|---|---|
| Win prob | `E = 1/(1+10^((rB−rA)/400))`, D=400 | "Intro to Tennis Elo" 2019-12-03, verbatim (0.97) |
| K-factor | `K = 250/(n+5)^0.4` (538-2016 tuning; numerator 250, offset 5, shape 0.4, no cap) | settesei.it (Sackmann's translator) + tenniseloranking 2015 (0.95). **No re-tune found after 2016** (0.75). |
| Margin of victory | **none** — *"Elo looks at match results — period"* (2025-11-28) | verbatim, MOV explicitly tested & rejected (0.97) |
| Surface Elo | flat `0.5·overall + 0.5·pureSurface`, every surface, every sample size | Heavy Topspin 2017/2019 *"50/50 worked for each surface"*; **archive-confirmed** (see §6): on the 2019-12-02 board `hElo = 0.5·overall + 0.5·HardRaw` holds exactly (0.95) |
| Match inclusion | all tour-level (G/M/A/F) + Davis/team (D) + tour-level qualifying + Challenger main draw (ATP); + ITF **≥ $50K** (WTA). Walkovers/retirements **counted** (Sackmann lists a winner). | 2025-11-28 verbatim scope (0.95). Excludes ATP Futures (level S), sub-$50K ITF, exhibitions, juniors. |
| Entrant seed | new entrants seeded in the **"low 1200s"**, level- & gender-dependent — **value never published** | "Intro to Tennis Elo" 2019: *"I replaced 1500 with a number in the low 1200s (it depends a bit on tournament level and gender)"* (0.93). The low seed exists to cancel the inflation from adding Challengers/qualifying. |
| Injury/absence | **Two distinct mechanisms.** (a) An absence **dock** on the PUBLISHED board: ~100 Elo @ 8 active-season weeks → ~150 @ ~1yr, for players rated **≥1900**. (b) On **return**, a K-multiplier ×1.5 decaying to ×1 over 20 matches. Cause-blind (injury = suspension = rest). | 2018 "Handling Injuries" — endpoints + ≥1900 gate + offseason-excluded verbatim (0.9); display-time confirmed by the COVID-suspension footnote (2021-03-08) (0.92). **We implement (a); (b) is not yet simulated.** |
| Board eligibility | listed iff ≥10 counting matches in a **trailing 52-week** window (rolling count, not a last-match clock). Doubles excluded. | report-page footnote, verbatim |
| History start | TA from 1968; **we now also start 1968** (deeper burn-in matures the scale). Data-bounded: tour-level 1968+, Challengers 2008+, qualifying 2011+ (deep past is tour-level only). | (0.9) |

## 3. Why byte-exact is impossible

Three unrecoverable unknowns: (a) the **per-level/gender entrant seed** (only "low 1200s" is published);
(b) the **dock curve shape** between its two published endpoints, and the **on-return K-multiplier path**
(×1.5→×1 over 20 matches) baked into each returnee's history — path-dependent, so not reproducible by a
static extraction-time adjustment; (c) whether K was re-tuned since 2016. The generation code itself is
private. So the ±1–2 / "ideally exact" goal from the brief is **retired**; we target a calibrated
approximation. (Note what is NOW recoverable vs the prior writeup: the dock's *endpoints* and *≥1900 gate*
are published verbatim and implemented — see §5.)

## 4. Our implementation & calibration

Engine: `ingest/historical-elo.ts` (now incl. the dock — `LayoffDock` + `activeLayoffDays` + `layoffPenalty`).
Per-tour config: `ingest/elo-config.ts` (`TA_LAYOFF_DOCK`, identical both tours). Calibration harness:
`ingest/calibrate-elo.ts` (runs the engine to "today" over the full 1968+ set with the **dock ON**, scrapes
the live board via `ingest/elo.ts`, **dominant-id join**, grid-searches the seed, and reports the **single
largest |deviation| + worst-12 offenders**, not just the mean).

**Fitted seeds** (2026-06-15, 1968 history, FULL injury model): ATP `seedTour 1550 / seedSub 1170`; WTA
`1400 / 1090`. Sub-tour = Challenger (`level C`) or qualifying (`round Q*`). The meanAbs surface is now flat/
multimodal in the seed (the injury model absorbs the sensitivity), so we pick the sensible near-optimum
(tour ≈ TA's documented tradition > sub, median ≈ 0).

**Couplings that matter:** (1) adding Challengers while seeding high inflates the pool ~+260 Elo; the
low-1200s reseed cancels that. (2) extending the history start 2000→1968 inflates it ~+40. (3) the injury
model + seed. **Inclusion, history-start, seed, and the injury model all move together.** WTA's $60K ITF
tier is part of TA's ≥$50K scope.

**Achieved accuracy** (dominant-id join, top-50, full model): **ATP overall meanAbs 11.1 (median +2.2),
WTA 7.3 (median +1.9)**; **47/50 (ATP) and 49/50 (WTA) within ±40**; top-18 within ~7 (ATP) / ~9 (WTA)
median (fixture). The full injury model fixed every active injury-returnee (Djokovic +114→reasonable, Fritz
+100→−12, Anisimova +112→+26, Zheng +95→+17). Remaining outliers are individual chronic/veteran cases
(Draper +88, Korda +79 under-docked at the curve cap; Pliskova −79 over-docked) — opposite signs, so not a
generalizable gap (see §5).

## 5. The injury/absence dock saga: removed (wrong), then RE-INSTATED with the ≥1900 gate

This consumed the most effort. It first ended in a **removal** that **was wrong**, and is now correctly
**re-instated** as an extraction-time dock with a ≥1900 gate. The correction was driven by re-reading the
primary source verbatim + a COVID natural experiment + an empirical fit judged by *max deviation*, not mean.

**The full arc:**
1. **On-return dock** (dock when a player returns from a ≥8wk gap). → **Deflated the whole pool by ~820**
   (a match-gap can't tell a genuine injury from a sparse schedule, so it tanks every irregular-schedule
   journeyman). **Not viable** — and not what TA does for the published board anyway.
2. **Extraction-time dock, no gate.** Helped ATP but "hurt WTA" *by the mean* → we added a per-gender
   `layoffScale`, then removed the whole dock, concluding "TA publishes absentees FROZEN/un-docked."
   **Both moves were mistakes:** (a) judging by the WTA *mean* (dominated by one over-docked player) hid a
   per-player win; (b) the build had **no ≥1900 gate**, so it docked sub-1900 WTA players TA never docks.
3. **RE-INSTATED (2026-06-15), gated at ≥1900.** A verification workflow (4 primary-source agents + 3
   adversarial skeptics, all refuted) overturned the "frozen" reading:
   - **Verbatim, 2018:** the penalties *"bring down the current Elo ratings of the players who are in the
     middle of long breaks … giving us ranking tables that come closer to what we expect."* "Current Elo
     ratings" + "ranking tables" + "in the middle of long breaks" = the **displayed board is docked**.
     Murray (the cited −150 example) was *currently absent* when written.
   - **COVID natural experiment (decisive):** 2021-03-08 footnote — *"Because the pandemic caused all sorts
     of absences … I've suspended that penalty until things are a bit more normal."* You can't *suspend* a
     penalty that was never on the board. So the dock is normally-on at display time.
   - **Endpoints + gate + offseason are verbatim:** −100 @ 8wk, −150 @ ~1yr; players **≥1900**; "the
     eight-week threshold doesn't count the offseason." Implemented exactly (linear shape between endpoints
     is our only assumption). **Identical ATP/WTA** — no per-gender scale (that was the unprincipled knob).

**The empirical fit (judged by max deviation, the metric that matters):** docking currently-absent ≥1900
players collapses the absent cohort onto TA — 5 of 7 within ±10, where they were +48…+189 before:

| Player (absent) | frozen | wk | ≥1900? | dock | TA | resid after dock |
|---|---|---|---|---|---|---|
| Korda (ATP) | 1921 | 13 | Y | 105 | 1809 | **+7** |
| Alcaraz (ATP) | 2257 | 9 | Y | 101 | 2167 | **−10** |
| Kartal (WTA) | 1884 | 15 | n | 0 | 1874 | **+10** |
| Kudermetova (WTA) | 1842 | 19 | n | 0 | 1836 | **+6** |
| Danilovic (WTA) | 1822 | 19 | n | 0 | 1819 | **+2** |
| Draper (ATP) | 1994 | 9 | Y | 101 | 1808 | +85 (also a returnee — see §9) |
| Vondrousova (WTA) | 1955 | 19 | Y | 112 | 1907 | −65 (over-docked; N=1 above gate) |

**Lesson the user flagged:** report the **largest |deviation| per player**, never the mean. The WTA mean
"hurt" verdict that justified removal was an artifact of one over-docked point in a small absent tail.
`calibrate-elo.ts` now prints max|dev| + the worst-12 offenders.

**Per-individual root-cause classification (post-dock):**

| Cause | Examples | Status |
|---|---|---|
| **Currently absent, ≥1900** | Alcaraz, Korda (ATP) | **Mapped** by the documented dock (resid ~±10). |
| **Currently absent, <1900** | Kudermetova, Kartal, Danilovic (WTA) | **Match** — below TA's ≥1900 gate, correctly un-docked. |
| **Active injury RETURNEES** | Djokovic +114, Fritz +100 (ATP); Anisimova +112, Zheng +95 (WTA) | **Bounded limit** — TA's separate on-return K-multiplier (×1.5→×1 over 20 matches), path-dependent, not yet simulated (§9/§11). |
| **Over-docked (N=1)** | Vondrousova −65 (WTA) | TA's single curve is too steep for her; a per-gender fix would overfit. Accepted. |
| **Name fragmentation** | Mensik (was `null`) | **Fixed** — dominant-id join. |
| **ATP thin grass** | players with few grass matches | Large per-surface, small overall impact. |

### 5b. From extraction-only dock to the FULL injury model (2026-06-15, second pass)

The extraction-only dock above left the *active injury-returnees* (Djokovic +114, Fritz +100, Anisimova
+112, Zheng +95) as the largest deviations — players who are "currently playing, not injured" yet TA rates
low. A **month-by-month reconstruction** (`ingest/elo-reconstruct.ts`) + a primary-source workflow showed
these are recently-RETURNED players still inside TA's recovery window, and that the right model is richer:

1. **On-return, in-state dock + ×1.5→×1 K recovery over 20 matches.** Recovery is via *results* (winning),
   not auto-decay — a returnee who keeps losing stays docked, exactly as TA's board shows (an auto-decay
   overlay wrongly let Zheng/Hurkacz drift back up).
2. **Combine-and-differential** (verbatim: serial layoffs within 2yr combine; charge only
   `curve(combinedDays) − alreadyCharged`). This BOUNDS a multi-gap veteran near the −150 ceiling instead of
   stacking a fresh −100 per gap — the bug that first flipped Djokovic to **−97** (over-docked) before this.
3. **COVID suspension** (2020-03…2021-12): TA suspended the penalty board-wide, so we apply none in that
   window. Removed −35 dips from the 2021–22 historical boards.

Result: Djokovic/Fritz/Anisimova/Zheng all return to reasonable; ATP meanAbs 11.1, WTA 7.3. **Tried and
rejected as wrong:** (a) the in-state dock WITHOUT combine — over-docks veterans (Djokovic −97), because a
veteran's tiny K (~16/match, faithful to TA's formula) can't recover stacked docks; (b) a decaying-OUTPUT
overlay — over-recovers losers (TA keeps them docked). The combine-differential in-state model is the one
faithful to both the reconstruction and Sackmann's text. Remaining outliers (Draper/Korda under, Pliskova
over) are individual — see §9.

## 6. Historical validation against archived TA boards (Wayback) — now FORMALIZED

We enumerated **every** distinct monthly capture of both board pages on `web.archive.org` (CDX API; ~120
per tour back to Feb 2016 — none predate it) and committed the extracted top-40 (name, overall) per board
date as a fixture: **`ingest/fixtures/ta-elo-historical.json`** (ATP 77 + WTA 88 board dates, 2016–2026).
Builder: `.scratch/wayback-fixture.ts`. Validator: `.scratch/burnin.ts` replays the **production** engine
(1968 history + dock + fitted seeds) frozen at each board's own `Last update` date and reports the offset
(ours − TA) per board, aggregated by year. (Overall is `cells[3]` in every schema era — 2016 = 8 cells,
2017–18 blended, 2019+ raw+blended, current = 17.)

**Result — the 1968 start roughly halved the historical offset and stabilized 2018+ to within ±10:**

| Year | ATP median err (old 2000-start) | ATP (now, 1968+dock) | WTA (old) | WTA (now) |
|---|---|---|---|---|
| 2016 | −132 | **−101** | −142 | **−91** |
| 2017 | −131 | −103 | −127 | −96 |
| 2018 | −16 | **+6** | −18 | −96 |
| 2019 | −15 | +6 | −9 | **+12** |
| 2020–2026 | −21… | **+2 … +9** | −21… | **−4 … +7** |

From **2018 (ATP) / 2019 (WTA) onward the scale is stable within ~±10** — a clean improvement over the old
−15…−21 drift, and the dock no longer leaves absent-player holes in the historical boards.

**The residual ~−95…−100 at the 2016–17 (ATP) / 2016–18 (WTA) peak is NOT pure burn-in.** It survives even
with the full 1968 history present, and it's a *step* (−100 → +6), not a gradual convergence — so it tracks
the **all-time Big-Four / Serena-era peak compression**: TA's 2016 Djokovic was **2556.2** (an all-time
high) vs ~2320 today, and our engine under-reaches such extreme top-of-distribution peaks (regression
toward the field). It's isolated to those peak years; reproducing it would need TA's exact K behaviour at
the extreme. **Documented limitation, not chased** (inflating the seed to lift 2016 overshoots 2018+, as
the earlier 1985 experiment already showed — the offset is time-varying).

*(A committed opt-in regression test over this fixture is the natural next step if historical accuracy
becomes a priority; the fixture + validator are in place.)*

## 7. Data sources — verdict: keep Sackmann as the single source of truth

| Source | Accessible? | Licensing | Fixes anything? | Verdict |
|---|---|---|---|---|
| **atptour.com** | **No** — Cloudflare 403 on every path (harder-blocked than SofaScore) | — | — | **Reject** |
| **api.wtatennis.com** | Yes — open CloudFront JSON, rich | **ToS forbids automated harvesting** | **No** — agrees with Sackmann to the day | **Reject** as an automated source; manual identity spot-checks only |
| **TA board** | Yes | — | No — same weekly pipeline | Not a more-current alternative |

The WTA "gap" is **NOT data incompleteness** (my earlier wrong diagnosis). Sackmann's WTA file is current
(commits in sync with ATP, thru 2026-06-08) and stops exactly where each player genuinely stopped:
- **Veronika Kudermetova**: 0 singles in 2026 — **genuine post-surgery absence** (our data is correct).
- **Vondrousova**: 2 January matches then injured.
- **Kartal**: thru Indian Wells (2026-03-04), then back-injured out of the clay season.
- **Danilovic**: thru 2026-02-01.

The only real Sackmann deficiency is a ~2–3 week recency lag (irrelevant to anything keyed on multi-week
inactivity).

## 8. Player-ID fragmentation

Duplicate Sackmann `player_id`s (e.g. Mensik: 212 matches under `210150`, 11 Challenger-qualifying matches
under `210084`, all 2023 — **overlapping, not a junior/pro split**) are a known **multi-feed data-entry
artifact** (maintainer-tracked: ATP issue #154 / WTA #41 — the pipeline auto-creates a stub id when an
upload can't be matched). **Handled** by the dominant-id heuristic in `computeRatingsAsOfSorted` (resolve a
shared `fullKey` to the id with ≥4× the runner-up's match count). 19 of 8,207 ATP fullKeys collide;
2 appeared in 2026 draws (Mensik, Landaluce), both previously `null`, now correct. **Always join on id,
never bare surname.** Note also two distinct players can share a surname (Veronika vs Polina Kudermetova) —
a future explicit alias map would harden this.

## 9. Bounded limitations (what is NOT fixable from public data)

The on-return K-multiplier (the dominant residual of the first pass) is now MODELLED (§5b) — Djokovic/Fritz/
Anisimova/Zheng are fixed. What remains:

1. **Individual chronic/veteran cases (the residual floor).** Draper +88, Korda +79 (ATP, currently-absent
   chronic injuries whose cumulative TA dock exceeds our combined-curve ~150 cap); Pliskova −79 (WTA,
   over-docked declining veteran). They deviate in *opposite* directions, so no single curve change fixes
   them — they reflect TA's private per-player injury accounting (which layoffs it counted, the rating at
   each, the comeback results). Not fixable from public data; chasing them overfits.
2. **2016–17 peak scale** ~−90 low — top-of-distribution compression at the all-time Big-Four/Serena peak,
   not pure burn-in (survives the full 1968 history).
3. **Time-varying historical offset** — 2018+ settle to a uniform ~+15–20 (our combine-differential
   under-docks vs TA's larger historical per-player docks, while the seed centers the injury-heavy 2026
   board); no single seed zeroes both "today" and history.
4. **ATP thin-grass** surface noise — TA's thin-sample surface handling is the one undocumented gap.
5. **The entrant seed / dock-shape / baseline-K** — empirically fit or assumed (linear dock shape between
   the published endpoints; our own K formula for the recovery boost), not derived from TA.
6. **Two latent injury-model imprecisions (adversarial review, kept by choice).** (a) The ≥1900 gate uses
   `overall + clusterDock`, which slightly over-states a recovered player's level (clusterDock is frozen
   while results-recovery wins points back). We KEEP it: empirically it errs in the safe direction (borderline
   ~1900 players like Kartal stay on the correct side to match TA); the "correct" raw-`overall` gate wrongly
   docks declined ex-elites and destabilises the seed fit, and an exact undocked-track fix isn't worth it
   (failure modes are off-board). (b) The COVID un-dock adds back the rating subtraction but cannot reverse
   the path-dependent K-boost, so an ex-docked player reads slightly high on 2020–21 boards — a small,
   historical-only residual folded into the +15–20 offset (#3).

## 10. Tooling & re-derivation

```bash
npx tsx ingest/calibrate-elo.ts          # re-fit seed vs live board (network, 1968+full model); prints max|dev|
# transcribe winning seeds into ingest/elo-config.ts
pnpm backfill-elo && pnpm reindex         # recompute all 113 snapshots (network), rebuild the index
ELO_FIXTURE=1 TZ=UTC npx vitest run ingest/historical-elo.fixture.test.ts   # opt-in regression guard
npx tsx ingest/elo-wayback.ts [--fetch]   # (re-fetch +) rebuild ingest/fixtures/ta-elo-historical.json
npx tsx ingest/elo-burnin.ts              # burn-in offset per year vs the committed historical fixture
npx tsx ingest/elo-reconstruct.ts ATP "Novak Djokovic"   # per-player month-by-month reconstruction
```

- **Committed reference data** (`data/`, see `data/README.md`): `data/wayback/ta-elo-boards-2016-2026.tar.gz`
  (175 raw archived TA boards) → `ingest/fixtures/ta-elo-historical.json` (extracted top-40 per board date).
  The Sackmann CSVs (~217 MB) are NOT vendored — re-fetched from their canonical GitHub by the ingest code
  (cached in gitignored `ingest/.cache/elo/`).
- `ingest/fixtures/ta-elo-reference.json` pins ~30 live-TA values **with their as-of date** (re-capture via
  `.scratch/capture-ta-reference.ts` when TA drifts).
- `ELO_START_YEAR` overrides the 1968 history start in `calibrate-elo.ts`/`backfill-elo.ts`.
- Acceptance sanity (issue #20): RG 2016 frozen → Djokovic #1 overall **and** clay (Nadal now #3 clay by ~7
  Elo behind a surging Murray — 2016 was Nadal's injury-hit down year; defensible, within burn-in noise).

## 11. Open / future

- **Commit an opt-in regression test** over `ta-elo-historical.json` (assert per-year burn-in bands) — the
  fixture + `ingest/elo-burnin.ts` validator are in place; just needs a vitest wrapper.
- **Individual per-player outliers** (Draper/Korda/Pliskova) — would need TA's private injury accounting;
  an explicit per-player override map is the only way, and is overfitting unless TA publishes more.
- **Explicit player alias map** for same-surname / fragmented ids beyond the dominant-id heuristic.
- The Elo work is independent of **issue #25 Part B (storage normalization)**, which remains unstarted
  (plan: `docs/superpowers/plans/2026-06-14-data-storage-normalization.md`).
