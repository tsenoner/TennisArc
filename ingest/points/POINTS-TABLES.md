The data is grounded. The research and adversarial verdicts are comprehensive enough to consolidate without further fetching. Let me produce the final spec.

---

# Points-Earned Engine — Authoritative Implementation Spec

Reproduces official ATP/WTA ranking points EARNED per tournament (tier + round), summed per calendar year, from Jeff Sackmann's match CSVs. Repo history limits: **ATP ≥ 2009, WTA ≥ 2015**. All disputed values resolved per the adversarial verdicts.

---

## 1. Per-tour, per-era points tables

Value = points for REACHING (i.e. losing in) that round; `W` = champion. `Q` = qualified into main draw (added on top of the main-draw round the player then reaches). Pick the draw-size variant by the CSV `draw_size` field.

### 1A. ATP points tables

```json
{
  "_meta": {
    "tour": "ATP_singles",
    "eras": { "A": "2009-2023 inclusive", "B": "2024-2026 inclusive" },
    "covid_note": "2020-2022 per-round EARNED points are unchanged Era A; COVID changed only counting/window rules.",
    "sources": [
      "https://www.itftennis.com/media/3625/player-rankings-atp-wta-points.pdf (Era A)",
      "https://www.itftennis.com/media/11846/2024-atp-points-table.pdf (Era B)"
    ]
  },

  "GRAND_SLAM": {
    "A_2009_2023": { "W":2000,"F":1200,"SF":720,"QF":360,"R16":180,"R32":90,"R64":45,"R128":10,"Q":25,"Q3":16,"Q2":8 },
    "B_2024_2026": { "W":2000,"F":1300,"SF":800,"QF":400,"R16":200,"R32":100,"R64":50,"R128":10,"Q":30,"Q3":16,"Q2":8 }
  },

  "ATP_FINALS": {
    "_format": "round-robin accumulation, NOT a flat per-round table; stable 2009-2026",
    "ALL_2009_2026": { "per_RR_win":200, "SF_win":400, "F_win":500, "undefeated_champion_total":1500, "participation_base":0 }
  },

  "MASTERS_1000_96D": {
    "_applies": "IW, Miami (all years); Madrid, Rome (from 2023); Canada, Cincinnati, Shanghai (from 2025). 32 seeds R1 bye; 64 non-seeds play R128.",
    "A_2009_2023": { "W":1000,"F":600,"SF":360,"QF":180,"R16":90,"R32":45,"R64":25,"R128":10,"Q":16,"Q2":8 },
    "B_2024_2026": { "W":1000,"F":650,"SF":400,"QF":200,"R16":100,"R32":50,"R64":30,"R128":10,"Q":20,"Q2":10 }
  },

  "MASTERS_1000_48_56D": {
    "_applies": "Monte-Carlo (all); Canada/Cincinnati/Shanghai (2009-2024); Paris (all); Madrid/Rome pre-2023. Top seeds R1 bye; entry round R64; no R128 row.",
    "A_2009_2023": { "W":1000,"F":600,"SF":360,"QF":180,"R16":90,"R32":45,"R64":10,"Q":25,"Q2":16 },
    "B_2024_2026": { "W":1000,"F":650,"SF":400,"QF":200,"R16":100,"R32":50,"R64":10,"Q":30,"Q2":16 }
  },

  "ATP_500_48D": {
    "A_2009_2023": { "W":500,"F":300,"SF":180,"QF":90,"R16":45,"R32":20,"Q":10,"Q2":4 },
    "B_2024_2026": { "W":500,"F":330,"SF":200,"QF":100,"R16":50,"R32":25,"R64":16,"Q":8,"Q3":9 }
  },
  "ATP_500_32D": {
    "A_2009_2023": { "W":500,"F":300,"SF":180,"QF":90,"R16":45,"Q":20,"Q2":10 },
    "B_2024_2026": { "W":500,"F":330,"SF":200,"QF":100,"R16":50,"Q":25,"Q3":13 }
  },

  "ATP_250_48D": {
    "A_2009_2023": { "W":250,"F":150,"SF":90,"QF":45,"R16":20,"R32":10,"Q":5,"Q2":3 },
    "B_2024_2026": { "W":250,"F":165,"SF":100,"QF":50,"R16":25,"R32":13,"R64":8,"Q":4 }
  },
  "ATP_250_32D": {
    "A_2009_2023": { "W":250,"F":150,"SF":90,"QF":45,"R16":20,"Q":12,"Q2":6 },
    "B_2024_2026": { "W":250,"F":165,"SF":100,"QF":50,"R16":25,"Q":13,"Q3":7 }
  },

  "CHALLENGER": {
    "_note": "Excluded from top-player sums (never affects validatable subset). NO qualifying points any era. No first-round-loss points. Sub-round curve REVISED 2024 (adversarial Dispute 2): use Wikipedia category-page 2024/2025 values below, NOT the higher 2023 curve. Sackmann CSV does NOT sub-code category — needs name+year lookup.",
    "pre_2023_2018_2022": {
      "CH125": { "W":125,"F":75,"SF":45,"QF":25,"R16":10,"R32":5 },
      "CH110": { "W":110,"F":65,"SF":40,"QF":20,"R16":9,"R32":5 },
      "CH100": { "W":100,"F":60,"SF":35,"QF":18,"R16":8,"R32":5 },
      "CH90":  { "W":90,"F":55,"SF":33,"QF":17,"R16":8,"R32":5 },
      "CH80":  { "W":80,"F":48,"SF":29,"QF":15,"R16":7,"R32":3 },
      "CH50":  { "W":50,"F":30,"SF":17,"QF":9,"R16":4,"R32":3 }
    },
    "2023": {
      "CH175": { "W":175,"F":100,"SF":60,"QF":32,"R16":15,"R32":0,"R64":0 },
      "CH125": { "W":125,"F":75,"SF":45,"QF":25,"R16":11,"R32":0,"R64":0 },
      "CH100": { "W":100,"F":60,"SF":36,"QF":20,"R16":9,"R32":0,"R64":0 },
      "CH75":  { "W":75,"F":50,"SF":30,"QF":16,"R16":7,"R32":0,"R64":0 },
      "CH50":  { "W":50,"F":30,"SF":17,"QF":9,"R16":4,"R32":0,"R64":0 }
    },
    "2024_2026": {
      "_source": "https://en.wikipedia.org/wiki/ATP_Challenger_Tour_175 / _125 (2025 rulebook) — CORRECTED per adversarial Dispute 2; curve below W is LOWER than 2023",
      "CH175": { "W":175,"F":90,"SF":50,"QF":25,"R16":13,"R32":0 },
      "CH125": { "W":125,"F":64,"SF":35,"QF":16,"R16":8,"R32":0 },
      "CH100": { "W":100,"F":50,"SF":28,"QF":14,"R16":7,"R32":0 },
      "CH75":  { "W":75,"F":44,"SF":24,"QF":12,"R16":6,"R32":0 },
      "CH50":  { "W":50,"F":30,"SF":17,"QF":9,"R16":4,"R32":0 }
    }
  },

  "ITF_M25": { "_feeds_ATP": "from 5 Aug 2019; M25/M25+H same table", "from_2023": { "W":25,"F":16,"SF":8,"QF":3,"R16":1 }, "2019_aug_2022": { "W":20,"F":12,"SF":6,"QF":3,"R16":1 } },
  "ITF_M15": { "_feeds_ATP": "from 5 Aug 2019", "from_2023": { "W":15,"F":8,"SF":4,"QF":2,"R16":1 }, "2019_aug_2022": { "W":10,"F":6,"SF":4,"QF":2,"R16":1 } },

  "ZERO_POINT_EVENTS": {
    "_all_rounds_0": ["OLYMPICS (level O / name~Olympic, all 2016/2021/2024)", "DAVIS_CUP (level D)", "LAVER_CUP (by name)", "NEXTGEN_FINALS (level F, by name)"],
    "_variable_not_round_derivable": ["ATP_CUP 2020-2022 (max 750, opponent-rank scaled)", "UNITED_CUP 2023+ (max 500, opponent-rank scaled)"]
  }
}
```

### 1B. WTA points tables

```json
{
  "_meta": {
    "tour": "WTA_singles",
    "repo_scope": "WTA history starts 2015; 2009-2014 tables retained for completeness but pre-2015 is OUT of repo scope.",
    "sources": [
      "https://www.itftennis.com/media/3625/player-rankings-atp-wta-points.pdf (2014-2020 + 2021-2023 shapes)",
      "https://www.itftennis.com/media/11225/2024-ranking-points.pdf (2024+)"
    ]
  },

  "GRAND_SLAM": {
    "2009_2013": { "W":2000,"F":1400,"SF":900,"QF":500,"R16":280,"R32":160,"R64":100,"R128":5,"Q":60,"Q3":50,"Q2":40,"Q1":2 },
    "2014_2025": { "W":2000,"F":1300,"SF":780,"QF":430,"R16":240,"R32":130,"R64":70,"R128":10,"Q":40,"Q3":30,"Q2":20,"Q1":2 }
  },

  "WTA_FINALS": {
    "_format": "round-robin accumulation; undefeated champion capped 1500 every era",
    "2015": { "participation":125, "per_RR_win":160, "SF_win":330, "F_win":420, "totals_undefeated": {"W":1500,"F":1080,"SF":750} },
    "2016_2023": { "per_RR_appearance":125, "per_RR_win":125, "totals_undefeated": {"W":1500,"F":1080,"SF":750} },
    "2024_2025": { "per_RR_win":200, "SF_win":400, "F_win":500, "totals_undefeated": {"W":1500,"F":1000,"SF":600} }
  },

  "WTA_1000_MANDATORY": {
    "_W": "1000. IW/Miami/Madrid/Beijing always; all 10 from 2024. Use draw-size variant.",
    "96D_2014_2025": { "W":1000,"F":650,"SF":390,"QF":215,"R16":120,"R32":65,"R64":35,"R128":10,"Q":30,"Q2":20,"Q1":2 },
    "56_64D_2014_2025": { "W":1000,"F":650,"SF":390,"QF":215,"R16":120,"R32":65,"R64":10,"Q":30,"Q2":20,"Q1":2 }
  },

  "WTA_1000_NONMANDATORY_900": {
    "_applies": "2021-2023 ONLY (Premier-5 successors); winner 900 NOT 1000. Deleted from 2024.",
    "56D": { "W":900,"F":585,"SF":350,"QF":190,"R16":105,"R32":60,"R64":1,"Q":30,"Q2":20,"Q1":1 }
  },

  "WTA_500": {
    "_W": "470 (2014-2023) -> 500 (2024-2025). Sackmann labels this tier 'Premier 700' pre-2021.",
    "2014_2023_56_48D": { "W":470,"F":305,"SF":185,"QF":100,"R16":55,"R32":30,"R64":1,"Q":25,"Q2":13,"Q1":1 },
    "2014_2023_32D":    { "W":470,"F":305,"SF":185,"QF":100,"R16":55,"R32":1,"Q":25,"Q3":18,"Q2":13,"Q1":1 },
    "2024_2025_48_56_64D": { "W":500,"F":325,"SF":195,"QF":108,"R16":60,"R32":32,"R64":1,"Q":25,"Q2":13,"Q1":1 },
    "2024_2025_28_30_32D": { "W":500,"F":325,"SF":195,"QF":108,"R16":60,"R32":1,"Q":25,"Q2":13,"Q1":1 }
  },

  "WTA_250": {
    "_W": "280 (2014-2023) -> 250 (2024-2025). [adversarial-confirmed: 280 pre-2024, NOT 250]",
    "2014_2023_32D": { "W":280,"F":180,"SF":110,"QF":60,"R16":30,"R32":1,"Q":18,"Q3":14,"Q2":10,"Q1":1 },
    "2024_2025_32D": { "W":250,"F":163,"SF":98,"QF":54,"R16":30,"R32":1,"Q":18,"Q2":12,"Q1":1 }
  },

  "WTA_125": {
    "_note": "level C. NO first-round-loss / R32 = 1. Winner 160 -> 125 at 2021 rebrand.",
    "2015_2020": { "W":160,"F":95,"SF":57,"QF":29,"R16":15,"R32":8,"R64":1,"Q":4,"Q2":4,"Q1":1 },
    "2021_2026": { "W":125,"F":81,"SF":49,"QF":27,"R16":15,"R32":1,"Q":6,"Q2":4,"Q1":1 }
  },

  "ITF_WTT": {
    "_note": "Feeds WTA ranking down to W15. Excluded from top-player sums. Era split at the 2019 reform. +H variants share the same points except pre-2019 prize-named tiers (Sackmann does not flag +H).",
    "current_W_naming_2024_2026_32M": {
      "W100": { "W":100,"F":65,"SF":39,"QF":21,"R16":12,"QLFR":5,"Q2":3 },
      "W75":  { "W":75,"F":49,"SF":29,"QF":16,"R16":9,"QLFR":3,"Q2":2 },
      "W50":  { "W":50,"F":33,"SF":20,"QF":11,"R16":6,"QLFR":2,"Q2":1 },
      "W35":  { "W":35,"F":23,"SF":14,"QF":8,"R16":4,"QLFR":1 },
      "W15":  { "W":15,"F":10,"SF":6,"QF":3,"R16":1 }
    },
    "legacy_prize_named_thru_2019_32M": {
      "100k_H": {"W":150,"F":90,"SF":55,"QF":28,"R16":14}, "100k": {"W":140,"F":85,"SF":50,"QF":25,"R16":13},
      "80k_H": {"W":130,"F":80,"SF":48,"QF":24,"R16":12}, "80k": {"W":115,"F":70,"SF":42,"QF":21,"R16":10},
      "60k_H": {"W":100,"F":60,"SF":36,"QF":18,"R16":9}, "60k": {"W":80,"F":48,"SF":29,"QF":15,"R16":8},
      "25k_H": {"W":60,"F":36,"SF":22,"QF":11,"R16":6}, "25k": {"W":50,"F":30,"SF":18,"QF":9,"R16":5},
      "15k": {"W":10,"F":6,"SF":4,"QF":2,"R16":1}
    }
  },

  "ZERO_POINT_EVENTS": {
    "_all_rounds_0": ["OLYMPICS (level O, all 2016/2021/2024 = 0 WTA pts)", "BJK_CUP / FED_CUP (level D)"],
    "_variable_not_round_derivable": ["UNITED_CUP 2023+ (max 500, opponent-rank scaled; mixed doubles = 0)"]
  }
}
```

---

## 2. Tier-classification ruleset + event-name lists

```json
{
  "name_normalization": "trim; case-insensitive compare; strip trailing ' 1'/' 2' (Adelaide 1/2, Charleston 1/2); handle apostrophe variants ('Queen's Club', 's Hertogenbosch'); 'Rio de Janeiro' case-insensitive. NEVER trust WTA P vs PM or ATP A code to resolve tier — use the name+year lists.",

  "atp_ruleset_ordered": [
    { "if": "name ~ /laver cup|atp cup|united cup|next ?gen finals|davis cup/i", "tier": "EXCLUDE" },
    { "if": "level == 'D'", "tier": "EXCLUDE" },
    { "if": "name ~ /olympic/i OR level == 'O'", "tier": "OLYMPICS_0PTS" },
    { "if": "level == 'G'", "tier": "GRAND_SLAM" },
    { "if": "level == 'F' AND name ~ /tour finals|atp finals|masters cup|world tour finals/i", "tier": "ATP_FINALS" },
    { "if": "level == 'F'", "tier": "EXCLUDE" },
    { "if": "level == 'M'", "tier": "MASTERS_1000 (pick 96D vs 48_56D by draw_size)" },
    { "if": "level == 'A' AND normName in ATP500_BY_YEAR[year]", "tier": "ATP_500 (pick 48D vs 32D by draw_size)" },
    { "if": "level == 'A'", "tier": "ATP_250 (pick 48D vs 32D by draw_size)" },
    { "if": "level == 'C'", "tier": "CHALLENGER (category by name+year; excluded from top-player sums)" },
    { "else": true, "tier": "ATP_250" }
  ],

  "wta_ruleset_ordered": [
    { "if": "name ~ /united cup|billie jean king cup|bjk cup|fed cup|hopman/i", "tier": "EXCLUDE (United Cup is variable, not round-derivable)" },
    { "if": "level == 'D'", "tier": "EXCLUDE" },
    { "if": "name ~ /olympic/i OR level == 'O'", "tier": "OLYMPICS_0PTS" },
    { "if": "level == 'G'", "tier": "GRAND_SLAM" },
    { "if": "level == 'F'", "tier": "WTA_FINALS" },
    { "if": "level == 'C'", "tier": "WTA_125" },
    { "if": "level matches /^[0-9]/ (15/25/35/50/60/75/80/100, +H)", "tier": "ITF_WTT_<tier> (excluded from tour sum)" },
    { "if": "year >= 2024 AND normName in WTA1000_BY_YEAR[year].all_mandatory_1000", "tier": "WTA_1000_MANDATORY" },
    { "if": "2021<=year<=2023 AND normName in WTA1000_BY_YEAR[year].mandatory_1000", "tier": "WTA_1000_MANDATORY" },
    { "if": "2021<=year<=2023 AND normName in WTA1000_BY_YEAR[year].nonmandatory_900", "tier": "WTA_1000_NONMANDATORY_900" },
    { "if": "year >= 2021 AND normName in WTA500_BY_YEAR[year]", "tier": "WTA_500" },
    { "if": "year >= 2021", "tier": "WTA_250" },
    { "if": "year <= 2020 AND normName in WTA_PREMIER_MANDATORY[year]", "tier": "WTA_1000_MANDATORY (Premier Mandatory)" },
    { "if": "year <= 2020 AND normName in WTA_PREMIER5[year]", "tier": "WTA_1000_NONMANDATORY_900 (Premier 5)" },
    { "if": "year <= 2020 AND level == 'P'", "tier": "WTA_500 (Premier/Premier 700, W=470)" },
    { "if": "year <= 2020 AND level == 'I'", "tier": "WTA_250 (International)" },
    { "else": true, "tier": "WTA_250" }
  ]
}
```

```json
{
  "ATP500_BY_YEAR": {
    "_corrected": "Dallas/Doha/Munich are 250 THROUGH 2024, 500 only FROM 2025 (adversarial Dispute 1, official atptour.com/en/news/atp-500-upgrades-from-2025). The tier-map research's 2022-2024 lists that included them are WRONG; use these.",
    "2009": ["Rotterdam","Memphis","Dubai","Acapulco","Barcelona","Hamburg","Washington","Beijing","Tokyo","Valencia","Basel"],
    "2010": ["Rotterdam","Memphis","Dubai","Acapulco","Barcelona","Hamburg","Washington","Beijing","Tokyo","Valencia","Basel"],
    "2011": ["Rotterdam","Memphis","Dubai","Acapulco","Barcelona","Hamburg","Washington","Beijing","Tokyo","Valencia","Basel"],
    "2012": ["Rotterdam","Memphis","Dubai","Acapulco","Barcelona","Hamburg","Washington","Beijing","Tokyo","Valencia","Basel"],
    "2013": ["Rotterdam","Memphis","Dubai","Acapulco","Barcelona","Hamburg","Washington","Beijing","Tokyo","Valencia","Basel"],
    "2014": ["Rotterdam","Dubai","Rio de Janeiro","Acapulco","Barcelona","Hamburg","Washington","Beijing","Tokyo","Valencia","Basel"],
    "2015": ["Rotterdam","Memphis","Dubai","Rio de Janeiro","Acapulco","Barcelona","Queen's Club","Halle","Hamburg","Washington","Beijing","Tokyo","Vienna","Valencia","Basel"],
    "2016": ["Rotterdam","Dubai","Rio de Janeiro","Acapulco","Barcelona","Queen's Club","Halle","Hamburg","Washington","Beijing","Tokyo","Vienna","Basel"],
    "2017": ["Rotterdam","Dubai","Rio de Janeiro","Acapulco","Barcelona","Queen's Club","Halle","Hamburg","Washington","Beijing","Tokyo","Vienna","Basel"],
    "2018": ["Rotterdam","Dubai","Rio de Janeiro","Acapulco","Barcelona","Queen's Club","Halle","Hamburg","Washington","Beijing","Tokyo","Vienna","Basel"],
    "2019": ["Rotterdam","Dubai","Rio de Janeiro","Acapulco","Barcelona","Queen's Club","Halle","Hamburg","Washington","Beijing","Tokyo","Vienna","Basel"],
    "2020": ["Rotterdam","Dubai","Rio de Janeiro","Acapulco","Hamburg","Vienna","St Petersburg"],
    "2021": ["Rotterdam","Dubai","Acapulco","Barcelona","Halle","Queen's Club","Hamburg","Washington","Vienna","St Petersburg"],
    "2022": ["Rotterdam","Rio de Janeiro","Dubai","Acapulco","Barcelona","Halle","Queen's Club","Hamburg","Washington","Tokyo","Vienna","Basel","Astana"],
    "2023": ["Rotterdam","Rio de Janeiro","Dubai","Acapulco","Barcelona","Halle","Queen's Club","Hamburg","Washington","Beijing","Tokyo","Vienna","Basel","Astana"],
    "2024": ["Rotterdam","Rio de Janeiro","Dubai","Acapulco","Barcelona","Halle","Queen's Club","Hamburg","Washington","Beijing","Tokyo","Vienna","Basel"],
    "2025": ["Dallas","Doha","Rotterdam","Rio de Janeiro","Dubai","Acapulco","Munich","Barcelona","Halle","Queen's Club","Hamburg","Washington","Beijing","Tokyo","Vienna","Basel"],
    "2026": ["Dallas","Doha","Rotterdam","Rio de Janeiro","Dubai","Acapulco","Munich","Barcelona","Halle","Queen's Club","Hamburg","Washington","Beijing","Tokyo","Vienna","Basel"],
    "_2020_2021_covid": "COVID cancelled Beijing/Tokyo/Queen's/Halle/Washington in 2020; St Petersburg held one-off 500 in 2020-2021. Always reconcile against actual CSV rows present that year; anything level A NOT in list -> ATP_250.",
    "_astana": "Astana (Nur-Sultan) was 500 in 2022-2023 only."
  },

  "WTA1000_BY_YEAR": {
    "2021": { "mandatory_1000": ["Indian Wells","Miami","Madrid","Beijing"], "nonmandatory_900": ["Dubai","Rome","Montreal","Cincinnati","Wuhan"] },
    "2022": { "mandatory_1000": ["Indian Wells","Miami","Madrid","Beijing"], "nonmandatory_900": ["Doha","Rome","Toronto","Cincinnati","Guadalajara"] },
    "2023": { "mandatory_1000": ["Indian Wells","Miami","Madrid","Beijing"], "nonmandatory_900": ["Dubai","Rome","Montreal","Cincinnati","Guadalajara"] },
    "2024": { "all_mandatory_1000": ["Indian Wells","Miami","Madrid","Rome","Beijing","Toronto","Cincinnati","Wuhan","Doha","Dubai"] },
    "2025": { "all_mandatory_1000": ["Indian Wells","Miami","Madrid","Rome","Beijing","Montreal","Cincinnati","Wuhan","Doha","Dubai"] },
    "_doha_dubai": "Exactly ONE of {Doha,Dubai} is 1000 in 2021-2023 (they alternate); the other is WTA_500. From 2024 both are 1000.",
    "_canada": "Sackmann uses host city Montreal/Toronto (alternates yearly).",
    "_covid": "Beijing/Wuhan cancelled 2020-2022 -> simply absent from CSV."
  },

  "WTA_PREMIER_MANDATORY_2009_2020": ["Indian Wells","Miami","Madrid","Beijing"],
  "WTA_PREMIER5_BY_YEAR": {
    "2015": ["Dubai or Doha (one)","Rome","Cincinnati","Montreal/Toronto","Wuhan"],
    "2016_2020": ["Dubai or Doha (one)","Rome","Cincinnati","Montreal/Toronto","Wuhan"],
    "_note": "Premier 5 winner = 900. Doha/Dubai alternate Premier-5/Mandatory-feeder status by year; verify per season. Everything else level P (<=2020) = WTA_500 (Premier 700, W=470); level I = WTA_250 (W=280)."
  },

  "WTA500_BY_YEAR": {
    "_algorithm": "Do NOT hand-maintain. For year>=2021: tier = WTA_1000 if name in WTA1000_BY_YEAR; else WTA_500 if name in a curated 500 set; else WTA_250. Validate residual per year against '<year> WTA Tour' Wikipedia. The 500 set is the residual of level {P,I,W} rows after removing 1000s. Doha/Dubai: the one NOT 1000 that year is 500.",
    "2024": ["Brisbane","Adelaide","Abu Dhabi","Linz","Stuttgart","Charleston","Berlin","Eastbourne","Bad Homburg","Washington","San Diego","Guadalajara","Monterrey","Ningbo","Tokyo","Seoul"],
    "2025": ["Brisbane","Adelaide","Abu Dhabi","Merida","Linz","Stuttgart","Charleston","Berlin","Queen's Club","Bad Homburg","Washington","Monterrey","Guadalajara","Ningbo","Tokyo","Seoul"]
  }
}
```

---

## 3. Best-N counting rules per tour/era

```json
{
  "atp_best_n_by_era": [
    { "years": "2009-2023", "counting_core": 18, "structure": "4 Slams + 8 mandatory Masters 1000 + best 6 others", "finals_addon": "ATP Finals = bonus 19th/20th for the 8 qualifiers", "note": "Monte-Carlo optional from 2009" },
    { "years": "2024-2025", "counting_core": 19, "structure": "4 Slams + 8 mandatory Masters 1000 + best 7 others (United Cup in the 'others' pool)", "finals_addon": "ATP Finals = bonus 20th for 8 qualifiers" },
    { "years": "2026+", "counting_core": 18, "structure": "cap reduced to 18 from 29 Dec 2025", "finals_addon": "ATP Finals = bonus 19th", "note": "forward-looking; do NOT apply to 2009-2025" }
  ],
  "wta_best_n_by_era": [
    { "years": "2015-2023", "counting_core": 16, "structure": "4 Slams + Premier-Mandatory/WTA-1000-mandatory + best others", "finals_addon": "WTA Finals = bonus 17th for qualifiers" },
    { "years": "2024-2025", "counting_core": 18, "structure": "4 Slams + 6 combined WTA-1000-mandatory + 1 WTA-only-1000-mandatory + best 7 others", "finals_addon": "WTA Finals = bonus 19th for qualifiers" }
  ],
  "window": { "rolling_official": "52 weeks (points drop exactly 52wk after processing)", "finals_drop": "Monday after last tour event before next year's Finals (not flat 52wk)", "race_calendar": "Jan 1 reset, current-calendar-year only — the form to validate against" },
  "zero_pointer_rule": "A Slam/mandatory-Masters/WTA-1000-mandatory the player was a direct-acceptance for but skipped counts as a 0-point result in that slot (and consumes a counting slot); if the player could never have been a DA, an extra 'best other' slot is added instead. CSV reproduction naturally yields 0 for an unplayed event, so this is consistent for top players.",
  "atp_masters_to_500_250_replacement": "up to 3 mandatory-Masters results may be replaced by a better later 500/250 score (player must have competed without penalty); affects only high-precision reconstruction.",
  "eligible_best_others": {
    "atp": ["ATP 500","ATP 250","ATP Challenger","ITF Men's WTT","United Cup"],
    "wta": ["WTA 1000","WTA 500","WTA 250","WTA 125","ITF W15+"]
  },
  "RACE_EQUALS_SUM_WHEN": "Race total === Σ(earned points across all counting events that year) IFF the player's number of counting events <= cap AND no mandatory zero-pointers. Naive sum-of-ALL overshoots for high-volume players."
}
```

---

## 4. Ground truth + fetched year-end standings, and the validatable subset

```json
{
  "ground_truth_recommendation": {
    "primary": "year-end Race total (ATP Race to Turin / WTA Race to the Finals) == year-end official ranking points — calendar-year aligned, matches 'points earned per player per calendar year'.",
    "strict_regression_set": "the 8 year-end Finals qualifiers per tour per year (Race total INCLUDES the Finals bonus; mandatory zeros fold in naturally).",
    "programmatic_breakdown_source": "ultimatetennisstatistics.com (open Sackmann-derived, no JS gate). Human cross-ref: atptour.com/.../rankings-breakdown (current snapshot only, JS-rendered).",
    "name_join": "apply existing ATP 98% / WTA 96% normalization (e.g. 'Karolína Plíšková'->'Karolina Pliskova', 'Alison Riske'/'Alison Riske-Amritraj', 'Wang Qiang' order)."
  },

  "validatable_to_EXACTLY_zero": {
    "subset": "players whose counting events in the year <= cap (ATP 19 [18 from 2026]; WTA 16 [18 from 2024]) AND with no mandatory zero-pointers. In a normal season this is ~the entire top 30-50 once Challenger/ITF/qualifying are excluded.",
    "guaranteed_clean": "the top-8 Finals qualifiers each tour/year (Race total incl. Finals bonus).",
    "excluded_from_sum_safely_for_top_players": ["Challenger","ITF","qualifying-round standalone points — they never outrank a counted main-tour event for top players"]
  },

  "best_N_rolling_caveats": {
    "high_volume_players": "elites in unusually busy years and lower-ranked grinders exceed the cap; naive sum overshoots — must drop worst results beyond cap before comparing.",
    "team_events": "United Cup (2023+, max 500) and ATP Cup (2020-2022, max 750) are opponent-rank-scaled, NOT round-derivable from CSV — cannot be reproduced to zero from match round alone.",
    "finals_events": "ATP/WTA Finals require match-by-match RR accumulation (per-RR-win + SF/F bonuses), not a flat round lookup."
  },

  "ATP_2019_year_end_top30": {
    "snapshot": "2019-12-30", "source": "wikipedia 2019 ATP Tour (1-20) + espn season/2019 (21-30, agreed on all 1-20)",
    "standings": [
      {"rank":1,"player":"Rafael Nadal","points":9985},{"rank":2,"player":"Novak Djokovic","points":9145},{"rank":3,"player":"Roger Federer","points":6590},{"rank":4,"player":"Dominic Thiem","points":5825},{"rank":5,"player":"Daniil Medvedev","points":5705},{"rank":6,"player":"Stefanos Tsitsipas","points":5300},{"rank":7,"player":"Alexander Zverev","points":3345},{"rank":8,"player":"Matteo Berrettini","points":2870},{"rank":9,"player":"Roberto Bautista Agut","points":2540},{"rank":10,"player":"Gael Monfils","points":2530},
      {"rank":11,"player":"David Goffin","points":2335},{"rank":12,"player":"Fabio Fognini","points":2290},{"rank":13,"player":"Kei Nishikori","points":2180},{"rank":14,"player":"Diego Schwartzman","points":2125},{"rank":15,"player":"Denis Shapovalov","points":2050},{"rank":16,"player":"Stan Wawrinka","points":2000},{"rank":17,"player":"Karen Khachanov","points":1840},{"rank":18,"player":"Alex de Minaur","points":1775},{"rank":19,"player":"John Isner","points":1770},{"rank":20,"player":"Grigor Dimitrov","points":1747},
      {"rank":21,"player":"Felix Auger-Aliassime","points":1636},{"rank":22,"player":"Lucas Pouille","points":1600},{"rank":23,"player":"Andrey Rublev","points":1584},{"rank":24,"player":"Benoit Paire","points":1538},{"rank":25,"player":"Guido Pella","points":1530},{"rank":26,"player":"Nikoloz Basilashvili","points":1450},{"rank":27,"player":"Pablo Carreno Busta","points":1422},{"rank":28,"player":"Borna Coric","points":1415},{"rank":29,"player":"Jo-Wilfried Tsonga","points":1410},{"rank":30,"player":"Nick Kyrgios","points":1395}
    ]
  },

  "ATP_2023_year_end_top30": {
    "snapshot": "2023-12-25", "source": "wikipedia 2023 ATP Tour (1-20) + espn season/2023 (21-30, agreed on all 1-20)",
    "standings": [
      {"rank":1,"player":"Novak Djokovic","points":11245},{"rank":2,"player":"Carlos Alcaraz","points":8855},{"rank":3,"player":"Daniil Medvedev","points":7600},{"rank":4,"player":"Jannik Sinner","points":6490},{"rank":5,"player":"Andrey Rublev","points":4805},{"rank":6,"player":"Stefanos Tsitsipas","points":4235},{"rank":7,"player":"Alexander Zverev","points":3985},{"rank":8,"player":"Holger Rune","points":3660},{"rank":9,"player":"Hubert Hurkacz","points":3245},{"rank":10,"player":"Taylor Fritz","points":3100},
      {"rank":11,"player":"Casper Ruud","points":2825},{"rank":12,"player":"Alex de Minaur","points":2740},{"rank":13,"player":"Tommy Paul","points":2665},{"rank":14,"player":"Grigor Dimitrov","points":2570},{"rank":15,"player":"Karen Khachanov","points":2520},{"rank":16,"player":"Frances Tiafoe","points":2310},{"rank":17,"player":"Ben Shelton","points":2145},{"rank":18,"player":"Cameron Norrie","points":1940},{"rank":19,"player":"Nicolas Jarry","points":1810},{"rank":20,"player":"Ugo Humbert","points":1765},
      {"rank":21,"player":"Francisco Cerundolo","points":1760},{"rank":22,"player":"Adrian Mannarino","points":1755},{"rank":23,"player":"Tallon Griekspoor","points":1640},{"rank":24,"player":"Sebastian Korda","points":1530},{"rank":25,"player":"Jan-Lennard Struff","points":1522},{"rank":26,"player":"Alejandro Davidovich Fokina","points":1495},{"rank":27,"player":"Lorenzo Musetti","points":1470},{"rank":28,"player":"Sebastian Baez","points":1435},{"rank":29,"player":"Felix Auger-Aliassime","points":1425},{"rank":30,"player":"Tomas Martin Etcheverry","points":1375}
    ]
  },

  "WTA_2019_year_end_top30": {
    "snapshot": "2019-12-30", "source": "wikipedia 2019 WTA Tour (1-20, official-cited) + espn type/wta/season/2019 (21-30). Wikipedia used where ESPN conflicts (ranks 5,8).",
    "standings": [
      {"rank":1,"player":"Ashleigh Barty","points":7851},{"rank":2,"player":"Karolina Pliskova","points":5940},{"rank":3,"player":"Naomi Osaka","points":5496},{"rank":4,"player":"Simona Halep","points":5462},{"rank":5,"player":"Bianca Andreescu","points":5192},{"rank":6,"player":"Elina Svitolina","points":5075},{"rank":7,"player":"Petra Kvitova","points":4776},{"rank":8,"player":"Belinda Bencic","points":4745},{"rank":9,"player":"Kiki Bertens","points":4245},{"rank":10,"player":"Serena Williams","points":3935},
      {"rank":11,"player":"Aryna Sabalenka","points":3120},{"rank":12,"player":"Johanna Konta","points":2879},{"rank":13,"player":"Madison Keys","points":2767},{"rank":14,"player":"Sofia Kenin","points":2740},{"rank":15,"player":"Petra Martic","points":2617},{"rank":16,"player":"Marketa Vondrousova","points":2390},{"rank":17,"player":"Elise Mertens","points":2290},{"rank":18,"player":"Alison Riske","points":2210},{"rank":19,"player":"Donna Vekic","points":2205},{"rank":20,"player":"Angelique Kerber","points":2175},
      {"rank":21,"player":"Karolina Muchova","points":1864},{"rank":22,"player":"Dayana Yastremska","points":1825},{"rank":23,"player":"Maria Sakkari","points":1820},{"rank":24,"player":"Amanda Anisimova","points":1793},{"rank":25,"player":"Sloane Stephens","points":1737},{"rank":26,"player":"Anett Kontaveit","points":1645},{"rank":27,"player":"Anastasija Sevastova","points":1617},{"rank":28,"player":"Julia Goerges","points":1610},{"rank":29,"player":"Wang Qiang","points":1563},{"rank":30,"player":"Anastasia Pavlyuchenkova","points":1560}
    ],
    "espn_conflict": "ESPN shows Andreescu 5183 / Bencic 4685; Wikipedia (official-cited) values used."
  },

  "WTA_2023_year_end_top30": {
    "snapshot": "2023-11-13 (year-end Monday; confirm exact freeze date)", "source": "wikipedia 2023 WTA Tour (1-20, official 'by the numbers') + espn type/wta/season/2023 (21-30). Wikipedia used where ESPN conflicts (ranks 7,8,17).",
    "standings": [
      {"rank":1,"player":"Iga Swiatek","points":9295},{"rank":2,"player":"Aryna Sabalenka","points":9050},{"rank":3,"player":"Coco Gauff","points":6580},{"rank":4,"player":"Elena Rybakina","points":6365},{"rank":5,"player":"Jessica Pegula","points":5975},{"rank":6,"player":"Ons Jabeur","points":4195},{"rank":7,"player":"Marketa Vondrousova","points":4075},{"rank":8,"player":"Karolina Muchova","points":3651},{"rank":9,"player":"Maria Sakkari","points":3620},{"rank":10,"player":"Barbora Krejcikova","points":2880},
      {"rank":11,"player":"Beatriz Haddad Maia","points":2855},{"rank":12,"player":"Madison Keys","points":2816},{"rank":13,"player":"Jelena Ostapenko","points":2720},{"rank":14,"player":"Petra Kvitova","points":2660},{"rank":15,"player":"Zheng Qinwen","points":2660},{"rank":16,"player":"Liudmila Samsonova","points":2650},{"rank":17,"player":"Belinda Bencic","points":2570},{"rank":18,"player":"Daria Kasatkina","points":2550},{"rank":19,"player":"Veronika Kudermetova","points":2520},{"rank":20,"player":"Caroline Garcia","points":2095},
      {"rank":21,"player":"Ekaterina Alexandrova","points":2035},{"rank":22,"player":"Victoria Azarenka","points":1905},{"rank":23,"player":"Donna Vekic","points":1865},{"rank":24,"player":"Magda Linette","points":1861},{"rank":25,"player":"Elina Svitolina","points":1809},{"rank":26,"player":"Sorana Cirstea","points":1765},{"rank":27,"player":"Anastasia Potapova","points":1588},{"rank":28,"player":"Anhelina Kalinina","points":1570},{"rank":29,"player":"Elise Mertens","points":1495},{"rank":30,"player":"Jasmine Paolini","points":1435}
    ],
    "espn_conflict": "ESPN shows Vondrousova 4046 / Muchova 3650 / Bencic 2571; Wikipedia (official-cited) values used. Ranks 14/15/16 cluster at 2660/2660/2650 — verify tie ordering against the official numeric list.",
    "tie_note": "Kvitova & Zheng both 2660 — head-to-head/tiebreak ordering from official list."
  }
}
```

---

## 5. KNOWN RISKS / OPEN QUESTIONS

**Tier classification**
- **Doha/Dubai 1000↔500 alternation (2021-2023):** exactly one is WTA 1000 each year; must be pinned per season from the specific `<year> Qatar/Dubai Open` article, not the summary list. Same caution for ATP Doha (250 thru 2024).
- **WTA500_BY_YEAR is a residual** for 2021-2025 — incomplete/uncertain entries (esp. 2021 COVID `W`-coded events). Validate each year's residual against the `<year> WTA Tour` Wikipedia results table; the safe fallback (not-1000-and-not-curated-500 ⇒ 250) preserves magnitude but mis-tiers genuine 500s as 250s if the 500 set is incomplete.
- **Premier 5 vs Premier (`P`) pre-2021** depends on the per-year Premier-5 name list; Sackmann sometimes codes Premier-Mandatory under `P` not `PM` — always use name lists, never the code. `draw_size==128` for a WTA event is a strong Premier-Mandatory signal.
- **ATP 500 32-draw vs 48-draw** (R32 row exists only for 48-draw) must be picked from CSV `draw_size` per event-year; W/F/SF marquee values are unaffected.
- **2020-2021 COVID re-leveling** (St Petersburg one-off 500, cancellations, Cincinnati-in-NY) — `*`-marked entries need per-event verification against that season's actual calendar/draw size.

**Points values**
- **Challenger sub-round curve (F/SF/QF/R16)** was revised more than once (2023 vs 2024). Adversarial Dispute 2: the 2024/2025 curve is LOWER (CH175 F=90 not 100; CH125 F=64 not 75) per Wikipedia category pages. The CH100/CH75 2024 inner values here are interpolated by analogy and **must be re-derived from the year-specific ITF/PIF rulebook PDF before scoring Challengers**. Winner values (175/125/100/75/50) are certain. Low impact: Challengers don't affect the top-player validatable subset.
- **CH75 R16 7 (2023) → 8 (2024/2025)** — subsumed by the broader curve uncertainty above.
- **Pre-2018 Challenger tables** (2009-2017, prize-suffix naming) differ and were not derived — only matters if ingesting pre-2018 Challengers.
- **Pre-2019 ITF `+H` (Hospitality) variants** give the winner ~7-11 more points but Sackmann does not flag `+H`; pre-2019 ITF points carry a small known error band unless `+H` is distinguished via `tourney_name`/external calendar.
- **WTA W40 tier (~2023+)** has no row in the official 2024/2025 chart; if it appears, value is unconfirmed (likely interpolates W≈40). Map Sackmann numeric ITF codes to the era-correct table (2019 reform abolished `$60K/$80K`, renamed `$25K→W35`).
- **2009 Premier 5 = 800 / 2010-2013 sub-rounds (GS F=1400)** — MEDIUM confidence, not re-pinned to a primary source; OUT of repo scope (WTA starts 2015).
- **WTA Finals intermediate (non-undefeated) totals for 2009-2013** less precisely documented than 2016+; undefeated max 1500 is certain. 2014 Championships title bonus quoted inconsistently — verify before summing 2014.

**Counting / window**
- **United Cup (2023+, max 500) and ATP Cup (2020-2022, max 750)** cannot be reproduced to zero from CSV round alone — opponent-rank + stage scaled, win-only. Decide: accept known discrepancy, join external live-ranking, or exclude from the guarantee. Mixed doubles = 0.
- **ATP/WTA Finals require match-by-match RR accumulation**, not a round lookup — implement as per-RR-win + SF/F bonuses.
- **2009-2023 ATP "best others" count (6 vs 7)** shifts slightly with United Cup/ATP Cup introduction (2020-2024); the mandatory frame (4 Slams + 8 Masters + Finals) is stable. Confirm per year for tight 2019-2024 reconstruction.
- **Mandatory-Masters / WTA-1000 zero-pointer slots** require the per-year list of which events were mandatory (Monte-Carlo optional from 2009; Madrid/Shanghai date/format shifts) to model top-8 players who skipped events.
- **ATP Masters→500/250 replacement (up to 3)** affects high-precision reconstruction at the cap boundary.

**Ground truth**
- **Ranks 21-30 rely on ESPN** (secondary). Re-confirm against an official snapshot (headless browser vs `atptour.com rankDate=` / WTA year-end PDF) if absolute zero-discrepancy is required at 21-30.
- **WTA 2019 (Andreescu/Bencic) and 2023 (Vondrousova/Muchova/Bencic) ESPN↔Wikipedia conflicts** — Wikipedia (official-cited) values used here; treat the official ATP/WTA year-end snapshot as the final tiebreaker.
- **WTA 2023 snapshot date (2023-11-13)** is the year-end Monday but the exact official freeze date should be confirmed; **ranks 14/15/16 tie cluster (2660/2660/2650)** ordering needs the official numeric list.
- **Name normalization** required before joining ESPN/Wikipedia display forms to Sackmann (existing ATP 98% / WTA 96% join).

Relevant repo files: cached Sackmann CSVs at `/Users/tsenoner/TennisArc/ingest/.cache/elo/{ATP,WTA}_YYYY.csv` (header verified: `tourney_name,surface,draw_size,tourney_level,tourney_date,...,round,...`); existing Elo tooling at `/Users/tsenoner/TennisArc/ingest/elo-reverse/`.