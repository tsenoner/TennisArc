<!--
  TennisArc in-app Help — SINGLE SOURCE OF TRUTH.
  This file is rendered verbatim inside the app (bundled via Vite `?raw`) and reads as a
  normal document on GitHub. The app and this file can never drift — they are the same bytes.

  KEEP IT CURRENT. Update this file whenever:
    • the Elo formula or its constants change  (cross-check docs/elo-formula.md + src/state.ts),
    • a data source, URL, or license changes,
    • a new symbol or concept appears in the UI.

  Structure contract: each top-level "## " heading becomes one collapsible section in the
  app (the leading H1 and this comment are stripped before rendering). Keep sections short.
-->

# TennisArc — Help

## About

TennisArc shows the live draw of a Grand Slam as a radial bracket: the centre is the
final, and each ring outward is an earlier round. It covers both the men's (**ATP**) and
women's (**WTA**) tours. Tap any player to trace their path, open the match, and see the
Elo head-to-head.

## Elo ratings

**Elo** is a single number for a player's strength. Win and it rises, lose and it falls —
and beating a strong opponent moves it far more than beating a weak one. Newcomers start
in the low 1200s; the all-time greats peak above 2500.

TennisArc reproduces [Tennis Abstract's Elo](https://www.tennisabstract.com/blog/2019/12/03/an-introduction-to-tennis-elo/).
After each match, a player's rating updates by:

```
expected = 1 / (1 + 10^((opponentElo - myElo) / 400))
myElo    = myElo + K * (result - expected)      # result = 1 if won, 0 if lost
K        = 250 / (matchesPlayed + 5)^0.4        # fewer matches played -> bigger swings
```

We also keep a separate rating per **surface** (hard / clay / grass). The figure shown for
a surface blends the two halves equally:

```
surfaceElo = 0.5 * overallElo + 0.5 * (rating built from that surface only)
```

That's why a clay specialist's "Clay ELO" can sit well above their hard-court number.

→ Live ratings: [ATP board](https://tennisabstract.com/reports/atp_elo_ratings.html) ·
[WTA board](https://tennisabstract.com/reports/wta_elo_ratings.html)

## Win probability

From two surface-Elo ratings, the chance player A beats player B is a simple logistic
curve:

```
P(A beats B) = 1 / (1 + 10^((eloB - eloA) / 400))
```

A 100-point edge is about a 64% chance; a 200-point edge about 76%. This is exactly what
the match readout means — e.g. *"Clay-ELO favoured Sinner 65% (+109)"* says Sinner's clay
Elo is 109 points higher, giving him a 65% chance before the match.

## Upsets & the ⚡

The **favourite** is whichever player has the higher surface Elo. When the favourite
**loses**, that's an **upset**, and TennisArc marks it with a ⚡:

- next to a beaten player in the **Seeds** panel, and
- on the Elo line in the **match detail**, which is highlighted for an upset.

The larger the Elo gap the favourite lost from, the bigger the surprise.

## Tennis terms

- **Surface** — courts play differently: **hard**, **clay** (slower), **grass** (faster).
  Strength is tracked separately on each.
- **Seed** — before play, the strongest entrants are ranked into the draw (1, 2, 3 …) so
  they can't meet early. A *lower* seed number means a stronger expected player — the
  No. 1 seed is the top entrant.
- **Rounds** — the field halves each round: **R128 → R64 → R32 → R16 → QF**
  (quarterfinal) **→ SF** (semifinal) **→ F** (final) **→ W** (champion).
- **Bye** — a free pass past a first-round match, usually granted to top seeds.
- **Qualifying** — pre-tournament rounds that decide the final main-draw places.
- **Tour level** — the main tour spans the **Grand Slams** (the four majors) and the
  season-ending **Tour Finals** at the top, through **Masters 1000 / WTA 1000** and
  **ATP & WTA 250–500** events, plus **team events** (Davis Cup, Billie Jean King Cup).
  Below the main tour sit **Challenger** (men), **WTA 125** (women), and **ITF** events.
- **Ranking points** — separate from Elo: each event awards official points by how far a
  player advances, and those points set the world ranking.
- **W–L** — a win–loss record. **Walkovers** (W/O — opponent withdraws before play) and
  **retirements** (RET — quitting mid-match) generally don't count toward Elo.
- **Olympics** — Olympic matches don't count toward a player's Elo (they're left out of
  the ratings).

## Data & credit

TennisArc is built on open tennis data, with full credit to its sources:

- **[Jeff Sackmann / Tennis Abstract](https://github.com/JeffSackmann)** — historical
  match results, scores, durations, and player data (the `tennis_atp` and `tennis_wta`
  datasets), licensed **CC BY-NC-SA 4.0**. The Elo method and reference boards come from
  [Tennis Abstract](https://www.tennisabstract.com/).
- **[SofaScore](https://www.sofascore.com/)** — live draws and scores for the current slam.
- **[Wayback Machine](https://web.archive.org/)** — archived historical Elo boards, used to
  calibrate the ratings.
- **ATP / WTA points tables** — official per-round ranking points.

Our Elo figures are a faithful *reproduction* of Tennis Abstract's public method, not a
copy of its database; an exact match isn't possible because TA's own rating code isn't
public. Spot something wrong? [Open an issue](https://github.com/tsenoner/TennisArc/issues).

*Help last updated 2026-06-16.*
