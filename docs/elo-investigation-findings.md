# Elo Investigation — Full Findings Log (issue #25)

This is the durable research record behind TennisArc's Elo engine. For the concise "how it works," see
[`elo-methodology.md`](elo-methodology.md). This document captures **everything investigated** — verified
parameters, empirical experiments, dead-ends we tried and rejected, and the bounded limitations — so the
reasoning isn't lost.

**Goal of issue #25:** reproduce Tennis Abstract's (TA) published singles Elo board
(`tennisabstract.com/reports/{atp,wta}_elo_ratings.html`) from Jeff Sackmann's match CSVs, as closely as
public data allows. **Verdict: byte-exact is provably impossible; we reproduce the top of the board within
~5–10 Elo median, with documented limitations for injury-history players and the deep historical scale.**

Investigation date: 2026-06-14. All numbers measured against TA as-of 2026-06-08 unless noted.

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
| Injury/absence | dock on **return** only (≈100 @ 8wk → 150 @ ~1yr; K×1.5 decaying over 20 matches). **Currently-absent listed players are published FROZEN/un-docked.** Cause-blind (injury = suspension = rest). | 2018 "Handling Injuries" + 2025-11-28 posts (0.97 on cause-blindness; 0.85 on frozen-display) |
| Board eligibility | listed iff ≥10 counting matches in a **trailing 52-week** window (rolling count, not a last-match clock). Doubles excluded. | report-page footnote, verbatim |
| History start | not documented; data-bounded (tour-level 1968+, Challengers 2008+, qualifying 2011+) | (0.5) |

## 3. Why byte-exact is impossible

Three unrecoverable unknowns: (a) the **per-level/gender entrant seed** (only "low 1200s" is published);
(b) the **injury-dock curve + the in-career docks** baked into TA's history; (c) whether K was re-tuned
since 2016. The generation code itself is private. So the ±1–2 / "ideally exact" goal from the brief is
**retired**; we target a calibrated approximation.

## 4. Our implementation & calibration

Engine: `ingest/historical-elo.ts`. Per-tour config: `ingest/elo-config.ts`. Calibration harness:
`ingest/calibrate-elo.ts` (runs the engine to "today", scrapes the live board via `ingest/elo.ts`,
**dominant-id join**, grid-searches the seed to minimise median |overall error| over the top-50).

**Fitted seeds** (2026-06-14): ATP `seedTour 1500 / seedSub 1170`; WTA `1400 / 1090`. Sub-tour =
Challenger (`level C`) or qualifying (`round Q*`). ATP's 1500 lands exactly on TA's documented tour-level
tradition; WTA seeds lower (consistent with the gender note).

**Coupling that matters:** adding Challengers while seeding at 1500 inflates the pool by ~+260 Elo; the
low-1200s reseed cancels that. **Inclusion and seed must change together.** Likewise WTA's $60K ITF tier
slightly *helps* once the seed is re-fit (it's part of TA's ≥$50K scope).

**Achieved accuracy** (dominant-id join, top-50): **ATP overall meanAbs ~20 (median −1), WTA ~10 (median
+2)**; the top-18 reproduce within **~8 (ATP) / ~5 (WTA)** median. The median ≪ meanAbs because a few
injury-history players are large outliers (see §5).

## 5. The injury/absence dock saga (tried, then removed) — and the per-individual analysis

This consumed the most effort and ended in a **removal**, which is the correct, research-validated state.

**What we tried, in order:**
1. **On-return dock** (dock when a player returns from a ≥8wk gap). → **Deflated the whole pool by ~820.**
   A match-gap can't distinguish a genuine injury from a sparse/part-time schedule, so it tanks every
   irregular-schedule journeyman, dragging the opponent pool (and thus everyone) down. Even with an
   off-season-excluding "active layoff" window, it still deflated ~820. **Not viable.**
2. **Extraction-time dock** (dock players inactive ≥8wk *as of the cutoff*). Targeted only currently-absent
   players, no historical deflation. It *appeared* to help ATP (meanAbs 20.1→14.5 by fixing Alcaraz/Draper)
   but hurt WTA (10.0→16.5). We briefly added a `layoffScale` (ATP 1.0, WTA 0.5, then 0).
3. **Removed entirely.** Research (TA's 2018 + 2025 posts) established TA **publishes a currently-absent
   listed player's frozen, un-docked value** — it docks only on *return*. So docking absent players
   under-rates exactly the cohort TA shows at full strength. We now show frozen values, like TA.

**The `layoffScale` was mean-tuning, not science.** It improved the WTA *mean* by masking a misdiagnosis,
and was removed. There is **no research basis** for a per-gender dock magnitude — TA's method is identical
across tours.

**Per-individual root-cause classification of the largest deviations** (the lens that mattered — the "mean"
we'd chased was inflated by name-join artifacts; the dominant-id join cut ATP from a fake ~30 to a real ~14
once Mensik et al. joined correctly):

| Cause | Examples | Status |
|---|---|---|
| **Injury-interrupted careers** | Djokovic +107, Fritz +99, Alcaraz, Draper (ATP); Anisimova +110, Zheng +91 (WTA) | **Fundamental.** TA bakes a dock at each career return into its history; we can't (deflates the pool). Bounded, documented. |
| **Currently absent (genuine)** | Alcaraz (skipped RG); Kudermetova (surgery), Kartal/Vondrousova (injured) | **Match.** TA shows them frozen/un-docked; so do we (no dock). Confirmed genuine absences (§7), not data gaps. |
| **Name fragmentation** | Mensik (was `null`) | **Fixed** — dominant-id join → 1893. |
| **ATP thin grass** | players with few grass matches | Large per-surface, small overall impact. |

## 6. Historical validation against archived TA boards (Wayback)

We fetched archived board captures (`web.archive.org`) and diffed our **frozen** engine at each board's own
`Last update` date. Harness: `.scratch/validate-archived.ts`. Schema varies by era (overall is `cells[3]`
in all: 2016 = 8 cells/overall-only; 2017–18 = blended surfaces; 2019+ = raw + blended at `[9,10,11]`;
current = 17 cells). Coverage: **2016–2020** (TA's reports don't predate ~2016 on Wayback; the recent-year
captures are structurally broken snapshots).

**Key finding — a time-varying historical scale offset invisible in the "today" check:**

| Year | ATP median err | WTA median err |
|---|---|---|
| 2016 | **−132** | −142 |
| 2017 | −131 | −127 |
| 2018 | −16 | −18 |
| 2019 | −15 | −9 |
| 2020 | — | −21 |

**Our 2016–17 freezes run ~130 Elo low** (the *whole board*), converging to ~0 by 2019. This is the
**burn-in / history-truncation** signature: we start at 2000, TA from 1968, so by 2016 our scale hasn't
matured. Independent confirmation that TA's top sat higher then: TA's 2016 Djokovic was **2556.2** (an
all-time peak), vs ~2320 for today's #1.

**Fix attempted (extend history to 1985):** lifts 2016 (−132 → −82) but **overshoots 2018+** (−15 → +25)
and would push 2026 over TA → breaking the live calibration. The offset is *time-varying*, so no single
(start-year, seed) fixes all years. **Left as a documented limitation.** (Note: Challenger data only exists
from 2008, so pre-2008 extension is tour-level only anyway.)

This validation should be formalised (commit the extracted top-N reference values per year as a fixture) if
historical accuracy becomes a priority.

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

1. **Injury-history players** (~5 ATP / 2 WTA top-50) over-rated by +30…+110 — TA's private in-career
   docks; replicating deflates the pool.
2. **2016–17 historical scale** ~130 low — burn-in; can't fix without breaking other years.
3. **ATP thin-grass** surface noise — TA's thin-sample surface handling is the one undocumented gap.
4. **The entrant seed / K-current-value** — empirically fit, not derived.

## 10. Tooling & re-derivation

```bash
npx tsx ingest/calibrate-elo.ts          # re-fit the seed vs the live board (network); dominant-id join
# transcribe winning seeds into ingest/elo-config.ts
pnpm backfill-elo && pnpm reindex         # recompute all 113 snapshots (network), rebuild the index
ELO_FIXTURE=1 TZ=UTC npx vitest run ingest/historical-elo.fixture.test.ts   # opt-in regression guard
npx tsx .scratch/validate-archived.ts     # historical validation vs archived TA boards (scratch)
npx tsx .scratch/individuals.ts           # per-individual largest-deviation classifier (scratch)
```

- The fixture (`ingest/fixtures/ta-elo-reference.json`) pins ~30 live-TA values **with their as-of date**;
  re-capture deliberately via `.scratch/capture-ta-reference.ts` when TA drifts.
- `ELO_START_YEAR` env overrides the 2000 history start in `calibrate-elo.ts` for burn-in experiments.
- Acceptance sanity (issue #20): RG 2016 frozen → Djokovic #1 overall **and** clay, Nadal #2 clay (holds).

## 11. Open / future

- **Formalise the archived-board validation** into a committed historical fixture (extracted top-N per year)
  — the one substantive avenue left for *historical* (not "today") quality.
- **Explicit player alias map** for same-surname / fragmented ids beyond the dominant-id heuristic.
- The Elo work is independent of **issue #25 Part B (storage normalization)**, which remains unstarted
  (plan: `docs/superpowers/plans/2026-06-14-data-storage-normalization.md`).
