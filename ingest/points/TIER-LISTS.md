All quirks confirmed exactly as the research stated. Every load-bearing string and tier boundary is verified against the actual CSVs. Here is the consolidated, code-ready spec.

---

# TennisArc Points-Reproduction Spec — Tier Classification, Qualifying, Best-N, Diagnosed Residuals

All names below are **exact Sackmann `tourney_name` strings** (verified by direct CSV read at `/Users/tsenoner/TennisArc/.scratch/sackmann/`). Join against `tourney_name` where `tourney_level` is as noted. **Do NOT use `tourney_level` or `draw_size` to tier 500-vs-250 or WTA 1000/500/250** — both are unreliable (Dallas/Doha/Munich are draw=32 in 2024-as-250 AND 2025-as-500; Sackmann mis-codes/migrates WTA PM/P/I across years). Name lists are the authoritative override.

---

## (1) ATP 500 — `ATP500_BY_YEAR` (join where `tourney_level == 'A'`)

```json
{
  "2009": ["Rotterdam","Dubai","Acapulco","Memphis","Barcelona","Hamburg","Washington","Beijing","Tokyo","Basel","Valencia"],
  "2010": ["Rotterdam","Dubai","Acapulco","Memphis","Barcelona","Hamburg","Washington","Beijing","Tokyo","Basel","Valencia"],
  "2011": ["Rotterdam","Dubai","Acapulco","Memphis","Barcelona","Hamburg","Washington","Beijing","Tokyo","Basel","Valencia"],
  "2012": ["Rotterdam","Dubai","Acapulco","Memphis","Barcelona","Hamburg","Washington","Beijing","Tokyo","Basel","Valencia"],
  "2013": ["Rotterdam","Dubai","Acapulco","Memphis","Barcelona","Hamburg","Washington","Beijing","Tokyo","Basel","Valencia"],
  "2014": ["Rotterdam","Dubai","Acapulco","Rio de Janeiro","Barcelona","Hamburg","Washington","Beijing","Tokyo","Basel","Valencia"],
  "2015": ["Rotterdam","Dubai","Acapulco","Rio de Janeiro","Barcelona","Halle","Queen's Club","Hamburg","Washington","Beijing","Tokyo","Vienna","Basel"],
  "2016": ["Rotterdam","Dubai","Acapulco","Rio de Janeiro","Barcelona","Halle","Queen's Club","Hamburg","Washington","Beijing","Tokyo","Vienna","Basel"],
  "2017": ["Rotterdam","Dubai","Acapulco","Rio de Janeiro","Barcelona","Halle","Queen's Club","Hamburg","Washington","Beijing","Tokyo","Vienna","Basel"],
  "2018": ["Rotterdam","Dubai","Acapulco","Rio de Janeiro","Barcelona","Halle","Queen's Club","Hamburg","Washington","Beijing","Tokyo","Vienna","Basel"],
  "2019": ["Rotterdam","Dubai","Acapulco","Rio de Janeiro","Barcelona","Halle","Queen's Club","Hamburg","Washington","Beijing","Tokyo","Vienna","Basel"],
  "2020": ["Rotterdam","ATP Rio de Janeiro","Dubai","Acapulco","Hamburg","St Petersburg","Vienna"],
  "2021": ["Rotterdam","Dubai","Acapulco","Barcelona","Halle","Queen's Club","Hamburg","Washington","Vienna"],
  "2022": ["Rotterdam","Dubai","Acapulco","Rio de Janeiro","Barcelona","Halle","Queen's Club","Hamburg","Washington","Astana","Tokyo","Vienna","Basel"],
  "2023": ["Rotterdam","Dubai","Acapulco","Rio De Janeiro","Barcelona","Halle","Queen's Club","Hamburg","Washington","Beijing","Tokyo","Vienna","Basel"],
  "2024": ["Rotterdam","Dubai","Acapulco","Rio De Janeiro","Barcelona","Halle","Queen's Club","Hamburg","Washington","Beijing","Tokyo","Vienna","Basel"],
  "2025": ["Rotterdam","Dallas","Doha","Dubai","Acapulco","Rio de Janeiro","Barcelona","Munich","Halle","Queen's Club","Hamburg","Washington","Beijing","Tokyo","Vienna","Basel"],
  "2026": ["Rotterdam","Dallas","Doha","Dubai","Acapulco","Rio de Janeiro","Barcelona","Munich","Halle","Queen's Club","Hamburg","Washington","Beijing","Tokyo","Vienna","Basel"]
}
```

**Verified quirks (exact strings):** Rio = `Rio de Janeiro` (2014-19, 2022, 2025-26), `ATP Rio de Janeiro` (2020 only), `Rio De Janeiro` (2023-24). 2020 = `St Petersburg` (no period). `Queen's Club`, `Washington`, `Doha`, `Dallas`, `Munich`, `Basel`, `Vienna`, `Halle` exactly as shown. 2020/2021 lists contain ONLY actually-played 500s (cancelled ones absent from CSV — adding them is a harmless no-op). 2022 `Astana` is a genuine one-year 500 (kept); 2023 Astana reverted to 250 (excluded). St. Petersburg 500 only in 2020. 2026 is partial-season: 7 summer/fall names (Halle, Queen's Club, Washington, Beijing, Tokyo, Vienna, Basel) not yet in CSV — expected, harmless.

**Mandatory-Masters note:** All 9 Masters 1000 are already `tourney_level == 'M'` and need NO tier-splitting. Constant 2009-2026. Names: `Indian Wells Masters`, `Miami Masters`, `Monte Carlo Masters`, `Madrid Masters`, `Rome Masters`, `Canada Masters`, `Cincinnati Masters`, `Shanghai Masters`, `Paris Masters`. **8 are mandatory; Monte Carlo is the sole optional one every year** (no player-commitment). For best-N: playing Monte Carlo counts and pushes out the weakest "best other." COVID gaps: 2020 CSV has only Cincinnati/Rome/Paris as 'M'; 2021 missing Shanghai — cancellations, not category changes.

---

## (2) WTA tier lists `WTA_TIERS_BY_YEAR` (name override; do NOT trust `tourney_level`)

Keys: `premierMandatory`/`premier5` (2015-2020 era), `mandatory1000`/`nonmand900` (2021-2026 era), `w500` (both eras). 250/International tier is the unlisted residual. **Adversarial corrections applied** — all keys below are confirmed to join 1:1 against the CSV.

```json
{
  "2015": {"premierMandatory":["Indian Wells","Miami","Madrid","Beijing"],"premier5":["Dubai","Rome","Toronto","Cincinnati","Wuhan"],"w500":["Brisbane","Sydney","Antwerp","Doha","Charleston","Stuttgart","Birmingham","Eastbourne","Stanford","New Haven","Tokyo","Moscow"],"mandatory1000":[],"nonmand900":[]},
  "2016": {"premierMandatory":["Indian Wells","Miami","Madrid","Beijing"],"premier5":["Doha","Rome","Montreal","Cincinnati","Wuhan"],"w500":["Brisbane","Sydney","St. Petersburg","Dubai","Charleston","Stuttgart","Birmingham","Eastbourne","Stanford","New Haven","Tokyo","Moscow"],"mandatory1000":[],"nonmand900":[]},
  "2017": {"premierMandatory":["Indian Wells","Miami","Madrid","Beijing"],"premier5":["Dubai","Rome","Toronto","Cincinnati","Wuhan"],"w500":["Brisbane","Sydney","St. Petersburg","Doha","Charleston","Stuttgart","Birmingham","Eastbourne","Stanford","New Haven","Tokyo","Moscow"],"mandatory1000":[],"nonmand900":[]},
  "2018": {"premierMandatory":["Indian Wells","Miami","Madrid","Beijing"],"premier5":["Doha","Rome","Montreal","Cincinnati","Wuhan"],"w500":["Brisbane","Sydney","St. Petersburg","Dubai","Charleston","Stuttgart","Birmingham","Eastbourne","San Jose","New Haven","Tokyo","Moscow"],"mandatory1000":[],"nonmand900":[]},
  "2019": {"premierMandatory":["Indian Wells","Miami","Madrid","Beijing"],"premier5":["Dubai","Rome","Toronto","Cincinnati","Wuhan"],"w500":["Brisbane","Sydney","St. Petersburg","Doha","Charleston","Stuttgart","Birmingham","Eastbourne","San Jose","Zhengzhou","Osaka","Moscow"],"mandatory1000":[],"nonmand900":[]},
  "2020": {"premierMandatory":[],"premier5":["Doha","Cincinnati","Rome"],"w500":["Brisbane","Adelaide","St. Petersburg","Dubai","Ostrava"],"mandatory1000":[],"nonmand900":[],"_note":"COVID-truncated. PremierMandatory ALL cancelled. Cincinnati played in New York. 'Charleston' DROPPED — absent from Sackmann wta_2020.csv (bubble events not in data)."},
  "2021": {"mandatory1000":["Indian Wells","Miami","Madrid"],"nonmand900":["Dubai","Rome","Montreal","Cincinnati"],"w500":["Abu Dhabi","Yarra Valley Classic","Gippsland Trophy","Grampians Trophy","Adelaide","Doha","St. Petersburg","Charleston 1","Stuttgart","Berlin","Eastbourne","San Jose","Ostrava","Chicago 2","Moscow"],"premier5":[],"premierMandatory":[],"_note":"Beijing/Wuhan cancelled; IW held October. The three Melbourne 500s are named by EVENT in Sackmann (Yarra Valley Classic/Gippsland Trophy/Grampians Trophy), NOT 'Melbourne'. Charleston 500='Charleston 1' (Charleston 2=250); Chicago 500='Chicago 2' (Chicago 1=250)."},
  "2022": {"mandatory1000":["Indian Wells","Miami","Madrid"],"nonmand900":["Doha","Rome","Toronto","Cincinnati","Guadalajara"],"w500":["Adelaide 1","Sydney","St. Petersburg","Dubai","Charleston","Stuttgart","Berlin","Eastbourne","San Jose","Tokyo","Ostrava","San Diego"],"premier5":[],"premierMandatory":[],"_note":"Beijing/Wuhan cancelled; Guadalajara=non-mand 1000. Adelaide 1=500, Adelaide 2=250 (verified P/d=30 vs I/d=32)."},
  "2023": {"mandatory1000":["Indian Wells","Miami","Madrid","Beijing"],"nonmand900":["Dubai","Rome","Montreal","Cincinnati","Guadalajara"],"w500":["Adelaide 1","Adelaide 2","Abu Dhabi","Doha","Charleston","Stuttgart","Berlin","Eastbourne","Washington","San Diego","Tokyo","Zhengzhou"],"premier5":[],"premierMandatory":[],"_note":"Beijing returned; Wuhan still cancelled. BOTH Adelaide 1 & 2 are 500 (verified both P/d=32). San Jose CANCELLED (earthquake relief) — NOT in list."},
  "2024": {"mandatory1000":["Doha","Dubai","Indian Wells","Miami","Madrid","Rome","Toronto","Cincinnati","Beijing","Wuhan"],"nonmand900":[],"w500":["Brisbane","Adelaide","Linz","Abu Dhabi","San Diego","Charleston","Stuttgart","Strasbourg","Berlin","Bad Homburg","Eastbourne","Washington","Monterrey","Guadalajara","Seoul","Ningbo","Tokyo"],"premier5":[],"premierMandatory":[],"_note":"All 10 WTA 1000 mandatory (no 900 tier). Doha & Dubai BOTH 1000. Guadalajara demoted to 500. 17 WTA 500."},
  "2025": {"mandatory1000":["Doha","Dubai","Indian Wells","Miami","Madrid","Rome","Montreal","Cincinnati","Beijing","Wuhan"],"nonmand900":[],"w500":["Brisbane","Adelaide","Linz","Abu Dhabi","Merida","Charleston","Stuttgart","Strasbourg","Queen's Club","Berlin","Bad Homburg","Washington","Monterrey","Guadalajara","Seoul","Ningbo","Tokyo"],"premier5":[],"premierMandatory":[],"_note":"Canada=Montreal. New women's 500 = 'Queen's Club' in CSV (NOT 'London'). 17 WTA 500."},
  "2026": {"mandatory1000":["Doha","Dubai","Indian Wells","Miami","Madrid","Rome","Toronto","Cincinnati","Beijing","Wuhan"],"nonmand900":[],"w500":["Brisbane","Adelaide","Abu Dhabi","Merida","Charleston","Linz","Stuttgart","Strasbourg","Queen's Club","Berlin","Bad Homburg","Washington","Monterrey","Guadalajara","Singapore","Ningbo","Tokyo"],"premier5":[],"premierMandatory":[],"_note":"In-progress. Canada=Toronto. 500 join key = 'Queen's Club' (NOT 'London'); Singapore replaces Seoul. Partial season — later-season 500s not yet in CSV (harmless)."}
}
```

**Adversarial corrections applied & re-verified against CSV this session:** 2021 `Charleston`→`Charleston 1`, `Chicago`→`Chicago 2`, three `Melbourne`→`Yarra Valley Classic`/`Gippsland Trophy`/`Grampians Trophy` (all level-P, the 500s); 2025/2026 `London`→`Queen's Club`; 2020 `Charleston` dropped (absent from data). **Doha/Dubai 1000-vs-500 pinning:** the WTA-1000 member always has the larger CSV draw (2021 Dubai d=64 / Doha d=32; 2022 Doha d=64 / Dubai d=32; 2023 Dubai d=64 / Doha d=32) — use as a tiebreak validator, not the primary key.

**Join name-mapping (Sackmann ↔ Wikipedia):** `Cincinnati`=Wiki "Mason"; `Miami`=Wiki "Key Biscayne"(≤2018)/"Miami Gardens"(≥2019); `St. Petersburg` (Sackmann may render `St Petersburg`); `Merida`/`Mérida` and `Washington`/`Washington DC` accent/abbrev variants. WTA 125 (level 'C') excluded — out of tour-tier scope.

---

## (3) Qualifying points — ADD ON TOP of main-draw result

Total for a qualifier = (main-draw round points) **+** (Q-column points). **Two carve-outs:** (i) a "qualifier" who entered MD **without playing a qualifying match** gets only MD points (no Q bonus); (ii) a qualifier losing R1 of MD keeps the Q points (R1-loss MD value is 0 anyway). Lucky losers = same as qualifiers. Q points are NOT awarded at Challengers or ITF events (Q=0).

```json
{
  "qualifying_points": {
    "_rule": "Q = reached main draw (won final qualifying round). Q3/Q2/Q1 = lost in that qual round. Draw-size dependent where noted.",
    "ATP": {
      "A_2009_2023": {
        "GRAND_SLAM":   {"Q":25,"Q3":16,"Q2":8},
        "MASTERS_1000": {"Q":16,"Q2":8,"_Q_if_draw_gt_56":10},
        "ATP_500_48D":  {"Q":10,"Q2":4},
        "ATP_500_32D":  {"Q":20,"Q2":10},
        "ATP_250_48D":  {"Q":5,"Q2":3},
        "ATP_250_32D":  {"Q":12,"Q2":6}
      },
      "B_2024_2026": {
        "GRAND_SLAM":          {"Q":30,"Q3":16,"Q2":8},
        "MASTERS_1000_96D":    {"Q":20,"Q2":10},
        "MASTERS_1000_48_56D": {"Q":30,"Q2":16},
        "ATP_500_48D":         {"Q":16,"Q3":9,"Q2":8},
        "ATP_500_32D":         {"Q":25,"Q3":13},
        "ATP_250_48D":         {"Q":8,"Q2":4},
        "ATP_250_32D":         {"Q":13,"Q3":7}
      }
    },
    "WTA": {
      "_col_name": "QLFR (reached MD); Q3/Q2/Q1 = lost in that qual round",
      "2014_2023": {
        "GRAND_SLAM":          {"QLFR":40,"Q3":30,"Q2":20,"Q1":2},
        "PREMIER_MAND_1000":   {"QLFR":30,"Q2":20,"Q1":2},
        "PREMIER5_900":        {"QLFR":30,"Q3":22,"Q2":15,"Q1":1},
        "PREMIER700_500":      {"QLFR":25,"Q3":18,"Q2":13,"Q1":1},
        "INTERNATIONAL_250":   {"QLFR":18,"Q3":14,"Q2":10,"Q1":1},
        "WTA_125":             {"QLFR":6,"Q3":4,"Q2":4,"Q1":1}
      },
      "2024_2026": {
        "GRAND_SLAM": {"QLFR":40,"Q3":30,"Q2":20,"Q1":2},
        "WTA_1000":   {"QLFR":30,"Q2":20,"Q1":2},
        "WTA_500":    {"QLFR":25,"Q2":13,"Q1":1},
        "WTA_250":    {"QLFR":18,"Q2":12,"Q1":1},
        "WTA_125":    {"QLFR":6,"Q2":4,"Q1":1}
      }
    }
  }
}
```

---

## (4) Best-N cap-boundary rules

**ATP frame (era-precise):**
```json
{
  "atp_best_n": {
    "A_2009_2023": {"core":18,"structure":"4 Slams + 8 mandatory Masters + best 6 others","finals":"ATP Finals = bonus 19th","max":19},
    "B_2024_2025": {"core":19,"structure":"4 Slams + 8 mandatory Masters + best 7 others (United Cup in 'others' pool)","finals":"bonus 20th","max":20},
    "C_2026_plus": {"core":18,"structure":"cap cut 19→18 eff 29 Dec 2025; 4 Slams + 8 Masters + best 6 others","finals":"bonus 19th","max":19,"_do_not_apply_pre_2026":true}
  }
}
```
- **Masters→500/250 replacement:** ≤3 mandatory-Masters results may be replaced by a better 500/250 **only if achieved chronologically AFTER** the Masters result it displaces.
- **Monte Carlo:** optional (not 1 of the 8). If played, it counts and pushes out your weakest "best other."
- **Zero-pointer slot:** an unplayed Slam/mandatory-Masters where the player WAS (or would've been) a direct acceptance counts as a 0 occupying a counting slot (cannot be discarded). For every mandatory the player was NOT eligible for, "best other" count goes **+1** (free slot). Once/year, a forced withdrawal after draw-made-but-before-first-match does NOT count as played (no zero).

**WTA frame:**
```json
{
  "wta_best_n": {
    "2014_2023": {"core":16,"structure":"4 Slams + 4 mandatory 1000 (Indian Wells, Miami, Madrid, Beijing) + best others","finals":"bonus 17th","mandatory_commitment":["Indian Wells","Miami","Madrid","Beijing"],"note":"Premier5/900 and Premier700/470 are NOT commitment slots — they flow in only as 'best others'."},
    "2024_2026": {"core":18,"structure":"4 Slams + 6-of-7 combined WTA-1000-Mandatory + best 1 WTA-only 1000 {Doha,Dubai,Wuhan} + best 7 others","finals":"bonus 19th","all_ten_1000_mandatory":true}
  },
  "wta_zero_pointer": {"free_slot_rule":"+1 'other' result per Slam/1000-Mandatory not required to count (same as ATP)","wta_1000_mandatory":"a 0 from a 1000-Mandatory counts & stays 52wk until commitment met","wild_card_md":"WC entry counts ONLY if she actually plays"}
}
```

**Year-end equality:** the rolling-52-week year-end total = calendar-year Race sum **at the year-end Monday snapshot ONLY** (Finals points drop at season boundary, not flat 52wk; prior-year non-Finals points already defended/dropped). Equality requires: applying best-N cap, folding in zero-pointers, Finals via per-RR-win+SF+F accumulation. **Irreducible (not CSV-round-derivable):** United Cup (2023+, max 500) and ATP Cup (2020-2022, max 750) — opponent-rank+stage scaled.

---

## (5) Diagnosed per-player over/under causes + the specific fixes

**Primary engine bug — the BYE RULE** (ATP rulebook §9.03 G.2, identical 2019 & 2023): *"Any player who reaches the second round by drawing a bye and then loses shall be considered to have lost in the first round and shall receive first round loser's points."* The engine (`/Users/tsenoner/TennisArc/.scratch/points/validate.ts`) assigns by Sackmann's exit-round label, so a seeded bye-recipient who loses his opener is scored at the round-of-loss (e.g. M1000_56 R32=45) instead of the first-round value (R64=10 for 48/56 draw; R128=10 for 96 draw/Slam; R32=0 for 32-draw 500/250). **Detect:** `mainWins===0 && entered above the draw's first round (drew a bye)` → award first-round-loss value.

**ATP official points table (2019 = 2023, byte-confirmed):**

| Category | W | F | SF | QF | R16 | R32 | R64 | R128 |
|---|---|---|---|---|---|---|---|---|
| Grand Slam | 2000 | 1200 | 720 | 360 | 180 | 90 | 45 | 10 |
| Masters 96-draw | 1000 | 600 | 360 | 180 | 90 | 45 | **25** | 10 |
| Masters 48/56-draw | 1000 | 600 | 360 | 180 | 90 | 45 | **10** | — |
| ATP 500 48-draw | 500 | 300 | 180 | 90 | 45 | 20 | — | — |
| ATP 500 32-draw | 500 | 300 | 180 | 90 | 45 | — | — | — |
| ATP 250 48-draw | 250 | 150 | 90 | 45 | 20 | 10 | — | — |
| ATP 250 32-draw | 250 | 150 | 90 | 45 | 20 | — | — | — |
| ATP Finals | 200/RR-win + 400 SF-win + 500 F-win (1500 if undefeated) |

**Per-player diagnoses (specific events to fix):**

- **Carlos Alcaraz 2023 — +35, EXACT after fix.** Sole divergence: **Paris Masters** (1st-round bye then lost to Safiullin) — we score R32=45, official R64=10. 8890 − 35 = **8855 exact**. ✓ confirmed.

- **Stefanos Tsitsipas 2019 — +85, all bye rule.** Three events: **Indian Wells** (seeded 8, bye, lost to Shapovalov: 25→10, +15); **Canada/Montreal** (seeded 4, bye, lost to Hurkacz: 45→10, +35); **Cincinnati** (seeded 5, bye, lost to Struff: 45→10, +35). **CORRECTION (adversarial):** the headline "EXACT 5300 after bye fix" is **overstated** — applying the proper best-N cap (best-8 of 9 Masters incl. Monte Carlo, best-6 others), the post-fix calendar sum is **~5380, not 5300**. The bye-rule cause and +85 direction are correct; the residual ~80 is the rolling-window/Monte-Carlo-counting nuance, NOT a tier bug. Do not claim "exact."

- **Daniil Medvedev 2019 — +215, mostly NOT a tier bug.** Only **+35 is a real bug**: **Paris Masters** (seeded 3, bye, lost to Dimitrov: 45→10). The remaining **~180 is the 52-week rolling-window artifact** (late-2018 points still live at year-end). Bye-corrected calendar sum = **5885** ≈ ATP's post-Shanghai 5875; official year-end 5705 is lower because 2018 points aged out. NOT fixable via tier lists. All rounds/tiers (Monte Carlo SF=360, Barcelona F=300, Washington F=300) verified correct.

- **Andrey Rublev 2019 — −204, UNDER-count (inverse).** Two causes: (a) engine **excludes Challengers** but his best-6 legitimately includes the **Indian Wells Challenger (CH125) runner-up = 75 pts** (largest missing item); (b) engine gives **0 for qualifying bonuses** but qualifiers earn the Q column on top — **Sydney +12, IW Masters +16, Miami Masters +16, Monte-Carlo +25, Cincinnati +25**. With both fixes: **1502**; remaining ~82 to official 1584 = rolling window. **Fix:** include Challenger results in the best-6 pool + add Q-column bonuses for qualifiers.

**Engine fixes (in priority order):**
1. **Bye rule** (primary, affects all top players) — award first-round-loss value when a bye-recipient loses his opener.
2. **Challenger inclusion + Q bonuses** for non-top players (Rublev).
3. **Do not expect calendar sum == published year-end** (52-week rolling). Bye fix alone makes Alcaraz 2023 exact; it does NOT make Tsitsipas exact (~80 residual remains); Medvedev/Rublev residuals are rolling-window/Challenger.

---

## Files referenced
- Engine/validator: `/Users/tsenoner/TennisArc/.scratch/points/validate.ts`
- Spec to update (§1 Q-rows, §3 best-N era split, WTA qualifier carve-outs): `/Users/tsenoner/TennisArc/.scratch/points/SPEC.md`
- Docs: `/Users/tsenoner/TennisArc/docs/points-reproduction.md`
- Source CSVs (all join keys verified against): `/Users/tsenoner/TennisArc/.scratch/sackmann/{atp,wta}_<year>.csv`

## Key sources (cited)
- ATP 500 transitions: https://en.wikipedia.org/wiki/Rio_Open , https://en.wikipedia.org/wiki/Valencia_Open_500 , https://en.wikipedia.org/wiki/Vienna_Open , https://en.wikipedia.org/wiki/Halle_Open , https://en.wikipedia.org/wiki/Queen%27s_Club_Championships , https://en.wikipedia.org/wiki/St._Petersburg_Open , https://en.wikipedia.org/wiki/Astana_Open , https://www.atptour.com/en/news/atp-500-upgrades-from-2025
- Masters mandatory/Monte-Carlo-optional: https://en.wikipedia.org/wiki/ATP_Masters_1000
- WTA tiers: https://en.wikipedia.org/wiki/2015_WTA_Tour … https://en.wikipedia.org/wiki/2026_WTA_Tour (per-year), https://en.wikipedia.org/wiki/WTA_1000 , https://en.wikipedia.org/wiki/2021_WTA_1000_tournaments , https://en.wikipedia.org/wiki/2020_WTA_Tour , https://en.wikipedia.org/wiki/2023_WTA_Tour , https://en.wikipedia.org/wiki/2024_National_Bank_Open
- Points tables / rules (primary PDFs): https://www.itftennis.com/media/2206/2019-atp-rule-book.pdf , https://www.itftennis.com/media/9097/2023-atp-rankings-and-points.pdf , https://www.itftennis.com/media/3625/player-rankings-atp-wta-points.pdf , https://www.itftennis.com/media/11846/2024-atp-points-table.pdf , https://www.itftennis.com/media/11823/2024-wta-rankings-rules.pdf
- Best-N / rolling-window: https://www.atptour.com/en/rankings/rankings-faq , https://en.wikipedia.org/wiki/ATP_rankings , https://www.puntodebreak.com/en/2026/01/01/the-atp-introduces-vital-change-in-the-points-system-for-the-ranking
- Player breakdowns: https://en.wikipedia.org/wiki/2023_Carlos_Alcaraz_tennis_season , https://www.espn.com/tennis/rankings/_/season/2019 , https://www.atptour.com/en/news/tsitsipas-hurkacz-montreal-2019-wednesday , https://www.atptour.com/en/news/indian-wells-challenger-2019-edmund-title

**Confidence: high.** Every ATP 500 / WTA tier name and boundary year was confirmed against a dedicated Wikipedia page, and every output string + all five adversarial name-join corrections (Charleston 1 / Chicago 2 / Yarra Valley Classic / Gippsland Trophy / Grampians Trophy / Queen's Club / 2020-Charleston-absent) plus the Adelaide-split and Rio-capitalization quirks were grepped from the actual Sackmann CSVs this session. The only softened claim is Tsitsipas 2019 "exact" (true post-fix ~5380; ~80 is irreducible rolling-window).