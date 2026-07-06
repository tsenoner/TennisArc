import { describe, it, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Player } from "../src/model";
import {
  winProbability,
  kFactor,
  resolveSurfaceElo,
  parseEloMatchesCsv,
  EloEngine,
  computeRatingsAsOf,
  computeRatingsAsOfSorted,
  sortEloRows,
  applyHistoricalElo,
  activeLayoffDays,
  layoffPenalty,
  DEFAULT_ELO_CONFIG,
  type EloConfig,
  type EloMatchRow,
  type LayoffDock,
} from "./historical-elo";

const csv = readFileSync(resolve(__dirname, "fixtures/elo-matches-sample.csv"), "utf8");
const rows = parseEloMatchesCsv(csv);

const player = (id: string, name: string): Player => ({
  id, name, country: "", seed: null, entry: null, ranking: null, sofaSlug: null, elo: null, birthdate: null,
});

const row = (over: Partial<EloMatchRow>): EloMatchRow => ({
  tourneyName: "Test", tourneyDate: 20000101, surface: null,
  winnerId: "w", loserId: "l", winnerName: "Win Ner", loserName: "Lo Ser",
  round: "F", level: "A", ...over,
});

describe("winProbability", () => {
  it("is 0.5 between equal ratings", () => {
    expect(winProbability(1500, 1500)).toBe(0.5);
  });
  it("is monotonic in the rating gap", () => {
    expect(winProbability(1600, 1500)).toBeGreaterThan(0.5);
    expect(winProbability(1500, 1600)).toBeLessThan(0.5);
    expect(winProbability(1700, 1500)).toBeGreaterThan(winProbability(1600, 1500));
  });
  it("is the complement of the reversed pairing (zero-sum)", () => {
    expect(winProbability(1600, 1500) + winProbability(1500, 1600)).toBeCloseTo(1, 12);
  });
});

describe("kFactor", () => {
  it("strictly decreases as prior matches accumulate", () => {
    expect(kFactor(0)).toBeGreaterThan(kFactor(1));
    expect(kFactor(1)).toBeGreaterThan(kFactor(2));
    expect(kFactor(2)).toBeGreaterThan(kFactor(50));
  });
  it("matches 250/(n+5)^0.4 exactly", () => {
    expect(kFactor(0)).toBeCloseTo(131.32639, 4);
    expect(kFactor(1)).toBeCloseTo(122.08984, 4);
  });
});

describe("EloEngine overall update", () => {
  it("is symmetric at equal ratings — winner's gain equals loser's loss", () => {
    const e = new EloEngine();
    e.update(row({ surface: null, winnerId: "a", loserId: "b" }));
    const a = e.players.get("a")!;
    const b = e.players.get("b")!;
    expect(a.overall - 1500).toBeCloseTo(1500 - b.overall, 10);
    expect(a.overall).toBeCloseTo(1565.66320, 4);
    expect(b.overall).toBeCloseTo(1434.33680, 4);
  });

  it("walkovers and retirements still move ratings (Sackmann lists a winner)", () => {
    // Fixture match 5 is a W/O (empty minutes), match 6 is a RET — both must update the listed winner.
    const wo = rows.find((r) => r.winnerId === "100" && r.loserId === "300")!;
    const ret = rows.find((r) => r.winnerId === "300" && r.loserId === "400")!;
    expect(wo).toBeDefined();
    expect(ret).toBeDefined();
    const e = new EloEngine();
    e.update(wo);
    expect(e.players.get("100")!.overall).toBeGreaterThan(1500);
    expect(e.players.get("300")!.overall).toBeLessThan(1500);
    e.update(ret);
    expect(e.players.get("300")!.overall).toBeGreaterThan(1500 - 100); // recovered after the RET win
    expect(e.players.get("400")!.overall).toBeLessThan(1500);
  });
});

describe("surface isolation", () => {
  it("a clay match leaves grass and hard ratings untouched", () => {
    const e = new EloEngine();
    e.update(row({ surface: "Clay", winnerId: "a", loserId: "b" }));
    const a = e.players.get("a")!;
    expect(a.clay).not.toBe(1500);
    expect(a.clayN).toBe(1);
    expect(a.grass).toBe(1500);
    expect(a.grassN).toBe(0);
    expect(a.hard).toBe(1500);
    expect(a.hardN).toBe(0);
  });

  it("an unknown/empty surface updates overall only", () => {
    const e = new EloEngine();
    e.update(row({ surface: null, winnerId: "a", loserId: "b" }));
    const a = e.players.get("a")!;
    expect(a.overall).not.toBe(1500);
    expect(a.clayN + a.hardN + a.grassN).toBe(0);
  });
});

describe("resolveSurfaceElo", () => {
  it("returns null for an unplayed surface (count 0)", () => {
    expect(resolveSurfaceElo(1700, 0, 1500)).toBeNull();
  });
  it("is a flat 50/50 blend of overall and surface at any nonzero count", () => {
    // TA methodology: 0.5*overall + 0.5*surface regardless of sample size.
    expect(resolveSurfaceElo(1700, 1, 1500)).toBeCloseTo(0.5 * 1700 + 0.5 * 1500, 10); // 1600
    expect(resolveSurfaceElo(1505, 2, 1600)).toBeCloseTo(0.5 * 1505 + 0.5 * 1600, 10); // 1552.5
  });
  it("uses the same 50/50 blend at high counts (no burn-in, no pure-surface mode)", () => {
    expect(resolveSurfaceElo(1700, 10, 1500)).toBe(0.5 * 1700 + 0.5 * 1500); // 1600
    expect(resolveSurfaceElo(1700, 25, 1500)).toBe(0.5 * 1700 + 0.5 * 1500); // 1600
  });
});

describe("parseEloMatchesCsv", () => {
  it("parses every playable row incl. W/O, RET, RR and team (level D) events", () => {
    expect(rows).toHaveLength(10);
    expect(rows.some((r) => r.round === "RR")).toBe(true);
    expect(rows.some((r) => r.level === "D")).toBe(true); // Davis Cup team event included
    expect(rows.find((r) => r.winnerId === "100" && r.loserId === "300")!.surface).toBe("Clay");
  });

  it("maps empty surface to null and keeps known surfaces", () => {
    const empty = rows.find((r) => r.winnerId === "600" && r.loserId === "601")!;
    expect(empty.surface).toBeNull();
    expect(rows.find((r) => r.surface === "Grass")).toBeDefined();
  });

  it("skips rows with an empty id or a non-numeric tourney_date", () => {
    const header = csv.split(/\r?\n/)[0];
    const bad = [
      header,
      // empty winner_id
      "x,Test,Hard,32,A,20200101,1,,,,W One,R,180,USA,25,2,,,L One,R,180,USA,25,6-0 6-0,3,F,60,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,100,2,90",
      // non-numeric tourney_date
      "x,Test,Hard,32,A,notadate,1,5,,,W Two,R,180,USA,25,6,,,L Two,R,180,USA,25,6-0 6-0,3,F,60,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,100,2,90",
    ].join("\n");
    expect(parseEloMatchesCsv(bad)).toHaveLength(0);
  });
});

describe("computeRatingsAsOf — freeze cutoff", () => {
  it("strict < excludes same-date rows (an in-tournament match never feeds its own freeze)", () => {
    // The fixture's hard match is dated 20160201. With cutoff exactly 20160201 it must be excluded,
    // so the only match in scope is the 20160101 clay win -> Nadal up, Djokovic down.
    const before = computeRatingsAsOf(rows, 20160201);
    const nadal = before.byId.get("100")!;
    const djok = before.byId.get("200")!;
    expect(nadal.overall).toBeCloseTo(1565.66320, 3); // exactly one clay match applied
    expect(djok.overall).toBeCloseTo(1434.33680, 3);
    expect(nadal.hard).toBeNull(); // hard match excluded -> no hard sample
  });

  it("includes everything strictly before the cutoff", () => {
    const at = computeRatingsAsOf(rows, 20160500); // the four Nadal/Djokovic meetings
    const nadal = at.byId.get("100")!;
    const djok = at.byId.get("200")!;
    expect(nadal.overall).toBeCloseTo(1477.30770, 3);
    expect(djok.overall).toBeCloseTo(1522.69230, 3);
    // both have played hard (1) and grass (1) and clay (2) by now
    expect(nadal.hard).not.toBeNull();
    expect(nadal.grass).not.toBeNull();
    expect(nadal.clay).not.toBeNull();
  });
});

describe("sortEloRows / computeRatingsAsOfSorted", () => {
  it("pre-sorting once and replaying matches computeRatingsAsOf for multiple cutoffs", () => {
    const sorted = sortEloRows(rows);
    for (const cutoff of [20160500, 99999999]) {
      const fromSorted = computeRatingsAsOfSorted(sorted, cutoff);
      const inline = computeRatingsAsOf(rows, cutoff);
      expect([...fromSorted.byId.entries()]).toEqual([...inline.byId.entries()]);
      expect([...fromSorted.byName.entries()]).toEqual([...inline.byName.entries()]);
    }
  });

  it("sortEloRows returns a new array sorted by (tourneyDate, original index) without mutating input", () => {
    const shuffled = [...rows].reverse();
    const snapshot = [...shuffled];
    const out = sortEloRows(shuffled);
    expect(out).not.toBe(shuffled);
    expect(shuffled).toEqual(snapshot); // input untouched
    for (let i = 1; i < out.length; i++) {
      expect(out[i].tourneyDate).toBeGreaterThanOrEqual(out[i - 1].tourneyDate);
    }
  });
});

describe("computeRatingsAsOf — name join", () => {
  it("keys byName on fullKey and drops an ambiguous fullKey (two ids, one name)", () => {
    const all = computeRatingsAsOf(rows, 99999999);
    expect(all.byId.has("600")).toBe(true);
    expect(all.byId.has("601")).toBe(true);
    expect(all.byName.has("samsmith")).toBe(false); // ambiguous -> omitted
    expect(all.byName.has("rafaelnadal")).toBe(true); // unambiguous -> present
  });

  it("is order-independent: a shuffled input yields identical ratings", () => {
    const shuffled = [...rows].sort(() => 0.5 - Math.random()).reverse();
    const a = computeRatingsAsOf(rows, 99999999);
    const b = computeRatingsAsOf(shuffled, 99999999);
    for (const id of a.byId.keys()) {
      const ea = a.byId.get(id)!;
      const eb = b.byId.get(id)!;
      expect(eb.overall).toBeCloseTo(ea.overall, 12);
      expect(eb.clay ?? -1).toBeCloseTo(ea.clay ?? -1, 12);
      expect(eb.hard ?? -1).toBeCloseTo(ea.hard ?? -1, 12);
      expect(eb.grass ?? -1).toBeCloseTo(ea.grass ?? -1, 12);
    }
  });
});

describe("applyHistoricalElo", () => {
  it("joins on fullKey, then sigKey, and leaves unmatched players' elo untouched", () => {
    const all = computeRatingsAsOf(rows, 20160500);
    const players: Record<string, Player> = {
      p1: player("p1", "Rafael Nadal"), // exact fullKey
      p2: player("p2", "N. Djokovic"), // sigKey fallback (surname + initial)
      p3: player("p3", "Someone Unknown"), // no join -> elo stays null
    };
    players.p3.elo = { overall: 1234, hard: null, clay: null, grass: null }; // pre-existing, must persist
    const res = applyHistoricalElo(players, all.byName);
    expect(res.matched).toBe(2);
    expect(res.unmatched).toEqual(["Someone Unknown"]);
    expect(players.p1.elo!.overall).toBeCloseTo(1477.30770, 3);
    expect(players.p2.elo!.overall).toBeCloseTo(1522.69230, 3); // joined Djokovic by signature
    expect(players.p3.elo!.overall).toBe(1234); // untouched
  });

  it("does not join an ambiguous fullKey even by sigKey (never a wrong rating)", () => {
    const all = computeRatingsAsOf(rows, 99999999);
    const players: Record<string, Player> = { p: player("p", "Sam Smith") };
    const res = applyHistoricalElo(players, all.byName);
    expect(res.matched).toBe(0);
    expect(players.p.elo).toBeNull(); // ambiguous name dropped from byName -> no join
  });

  it("skips a sigKey fallback when two snapshot players share one signature (snapshot-side guard)", () => {
    // "rafaelnadal" is unambiguous on the CSV side (bySig.get('nadal:r') is non-null), but two snapshot
    // players collide on sigKey 'nadal:r' and neither exact-matches 'rafaelnadal'. We can't tell which
    // one is Rafael, so NEITHER may inherit his rating — both stay null with matched === 0.
    const all = computeRatingsAsOf(rows, 20160500);
    const players: Record<string, Player> = {
      p1: player("p1", "R. Nadal"),        // sigKey nadal:r, no direct fullKey hit
      p2: player("p2", "Ricardo Nadal"),   // sigKey nadal:r, no direct fullKey hit
    };
    const res = applyHistoricalElo(players, all.byName);
    expect(res.matched).toBe(0);
    expect(players.p1.elo).toBeNull();
    expect(players.p2.elo).toBeNull();
    expect(res.unmatched.sort()).toEqual(["R. Nadal", "Ricardo Nadal"]);
  });

  it("writes a plain PlayerElo (no leaked source-name field)", () => {
    const all = computeRatingsAsOf(rows, 20160500);
    const players: Record<string, Player> = { p: player("p", "Rafael Nadal") };
    applyHistoricalElo(players, all.byName);
    expect(Object.keys(players.p.elo!).sort()).toEqual(["clay", "grass", "hard", "overall"]);
  });
});

test("parseEloMatchesCsv drops rows whose level the predicate rejects", () => {
  const csv = [
    "tourney_name,surface,tourney_date,winner_id,loser_id,winner_name,loser_name,round,tourney_level",
    "A,Hard,20240101,1,2,W A,L B,R32,C",   // level C -> kept by predicate below
    "B,Hard,20240101,3,4,W C,L D,R32,15",  // level 15 -> rejected
  ].join("\n");
  const all = parseEloMatchesCsv(csv);
  expect(all).toHaveLength(2); // default keeps everything
  const filtered = parseEloMatchesCsv(csv, (lvl) => lvl !== "15");
  expect(filtered).toHaveLength(1);
  expect(filtered[0].level).toBe("C");
});

test("parseEloMatchesCsv carries round and level for seeding", () => {
  const csv = [
    "tourney_name,surface,tourney_date,winner_id,loser_id,winner_name,loser_name,round,tourney_level",
    "Some Challenger,Hard,20240101,1,2,A B,C D,Q1,C",
  ].join("\n");
  const rows = parseEloMatchesCsv(csv);
  expect(rows[0].round).toBe("Q1");
  expect(rows[0].level).toBe("C");
});

const seedRow = (o: Partial<EloMatchRow> = {}) => ({
  tourneyName: "T", tourneyDate: 20240101, surface: "Hard" as const,
  winnerId: "1", loserId: "2", winnerName: "Win A", loserName: "Lose B",
  round: "R32", level: "A", ...o,
});
test("seedFor controls the entrant rating; default is 1500", () => {
  expect(DEFAULT_ELO_CONFIG.seedFor("A", "R32")).toBe(1500);
  // A debut loser starts at the seed and drops kFactor(0)*0.5 ≈ 65.66 after one loss, so they end
  // just below the seed. Shifting the seed shifts that whole window by the same amount.
  const def = computeRatingsAsOf([seedRow()], 20240102);
  expect(def.byId.get("2")!.overall).toBeLessThan(1500);
  expect(def.byId.get("2")!.overall).toBeGreaterThan(1400); // 1500 - 65.66 ≈ 1434.34
  const cfg: EloConfig = { seedFor: (level) => (level === "C" ? 1230 : 1500) };
  const cust = computeRatingsAsOf([seedRow({ level: "C" })], 20240102, cfg);
  expect(cust.byId.get("2")!.overall).toBeLessThan(1230);
  expect(cust.byId.get("2")!.overall).toBeGreaterThan(1130); // 1230 - 65.66 ≈ 1164.34
  // The two configs differ by exactly the seed gap (1500 - 1230 = 270): same dynamics, shifted floor.
  expect(def.byId.get("2")!.overall - cust.byId.get("2")!.overall).toBeCloseTo(270, 9);
  // `round` is part of the seed signature too: a qualifying-round (Q*) debutant can be seeded apart
  // from a main-draw one. Guards against the round arg being dropped from the seedFor(level, round) call.
  const roundCfg: EloConfig = { seedFor: (_level, round) => (round.startsWith("Q") ? 1200 : 1500) };
  const q = computeRatingsAsOf([seedRow({ round: "Q1" })], 20240102, roundCfg);
  expect(q.byId.get("2")!.overall).toBeLessThan(1200);
  expect(q.byId.get("2")!.overall).toBeGreaterThan(1100); // 1200 - 65.66 ≈ 1134.34
});

test("byName prefers the dominant Sackmann id over a same-name low-match phantom", () => {
  // Two ids share fullKey "starplayer": id "1" plays 4 matches, id "2" a single phantom match
  // (mirrors Mensik: 212 real matches under one id, 11 under a qual/challenger duplicate id).
  const rows: EloMatchRow[] = [
    seedRow({ winnerId: "1", winnerName: "Star Player", loserId: "9a", loserName: "Opp A", tourneyDate: 20240101 }),
    seedRow({ winnerId: "1", winnerName: "Star Player", loserId: "9b", loserName: "Opp B", tourneyDate: 20240108 }),
    seedRow({ winnerId: "1", winnerName: "Star Player", loserId: "9c", loserName: "Opp C", tourneyDate: 20240115 }),
    seedRow({ winnerId: "9d", winnerName: "Opp D", loserId: "1", loserName: "Star Player", tourneyDate: 20240122 }),
    seedRow({ winnerId: "2", winnerName: "Star Player", loserId: "9e", loserName: "Opp E", tourneyDate: 20240129 }),
  ];
  const { byId, byName } = computeRatingsAsOf(rows, 20240201);
  expect(byName.get("starplayer")).toBe(byId.get("1")); // dominant id (4 matches) wins over phantom (1)
});

test("byName still drops genuinely ambiguous same-name ids with comparable match counts", () => {
  const rows: EloMatchRow[] = [
    seedRow({ winnerId: "10", winnerName: "Twin Name", loserId: "8a", loserName: "X A", tourneyDate: 20240101 }),
    seedRow({ winnerId: "10", winnerName: "Twin Name", loserId: "8b", loserName: "X B", tourneyDate: 20240108 }),
    seedRow({ winnerId: "11", winnerName: "Twin Name", loserId: "8c", loserName: "X C", tourneyDate: 20240115 }),
    seedRow({ winnerId: "11", winnerName: "Twin Name", loserId: "8d", loserName: "X D", tourneyDate: 20240122 }),
  ];
  const { byName } = computeRatingsAsOf(rows, 20240201);
  expect(byName.get("twinname")).toBeUndefined(); // 2 vs 2 matches -> ambiguous -> dropped
});

describe("activeLayoffDays (TA injury/absence: off-season is not counted)", () => {
  it("counts only the Feb 1–Oct 1 competitive window", () => {
    // Last match 1 Feb, asOf 1 Oct same year => the whole ~Feb1-Oct1 window (~242 days).
    expect(activeLayoffDays(20200201, 20201001)).toBeGreaterThan(230);
    expect(activeLayoffDays(20200201, 20201001)).toBeLessThan(250);
  });
  it("excludes the winter off-season between two seasons", () => {
    // Last match 1 Oct 2020, asOf 1 Feb 2021: the entire gap is off-season => 0 active days.
    expect(activeLayoffDays(20201001, 20210201)).toBe(0);
  });
  it("is 0 for the all-rows sentinel cutoff and for no prior match", () => {
    expect(activeLayoffDays(20200201, 99999999)).toBe(0); // sentinel > 30,000,000
    expect(activeLayoffDays(0, 20210101)).toBe(0); // never played
  });
});

describe("layoffPenalty (100 @ 8wk -> 150 @ ~1yr, gated at >=1900)", () => {
  const dock: LayoffDock = { triggerDays: 56, minPenalty: 100, maxPenalty: 150, maxDays: 365, ratingFloor: 1900, recoveryMatches: 20, recoveryMult: 1.5, comebackResetYears: 2 };
  it("is 0 below the 8-week trigger", () => {
    expect(layoffPenalty(dock, 55, 2200)).toBe(0);
    expect(layoffPenalty(dock, 56, 2200)).toBe(100); // exactly at the trigger
  });
  it("is 0 below the rating floor, regardless of layoff length", () => {
    expect(layoffPenalty(dock, 300, 1899)).toBe(0);
    expect(layoffPenalty(dock, 300, 1900)).toBeGreaterThan(100); // exactly at the floor -> docked
  });
  it("rises linearly to the 150 plateau and clamps there", () => {
    const mid = layoffPenalty(dock, Math.round((56 + 365) / 2), 2000);
    expect(mid).toBeCloseTo(125, 0); // halfway between 100 and 150
    expect(layoffPenalty(dock, 365, 2000)).toBeCloseTo(150, 6);
    expect(layoffPenalty(dock, 10_000, 2000)).toBeCloseTo(150, 6); // clamped, never exceeds maxPenalty
  });
});

test("the dock is applied at extraction only to absent players >= the rating floor", () => {
  // A low ratingFloor (1400) so a seeded-1500 player triggers, isolating the wiring from a 1900 climb.
  const dock: LayoffDock = { triggerDays: 56, minPenalty: 100, maxPenalty: 150, maxDays: 365, ratingFloor: 1400, recoveryMatches: 20, recoveryMult: 1.5, comebackResetYears: 2 };
  const cfg: EloConfig = { seedFor: () => 1500, dock };
  const noDock: EloConfig = { seedFor: () => 1500 };
  const r = [seedRow({ winnerId: "1", winnerName: "Abs Ent", loserId: "2", loserName: "Op P", tourneyDate: 20200201 })];
  const cutoff = 20210101; // long after the Feb-2020 match -> absent

  const undockedRec = computeRatingsAsOf(r, cutoff, noDock).byId.get("1")!;
  const undocked = undockedRec.overall;
  const docked = computeRatingsAsOf(r, cutoff, cfg).byId.get("1")!;
  const expected = layoffPenalty(dock, activeLayoffDays(20200201, cutoff), undocked);
  expect(expected).toBeGreaterThan(100); // a real dock got applied
  expect(docked.overall).toBeCloseTo(undocked - expected, 6); // overall docked by exactly the penalty
  expect(docked.hard!).toBeCloseTo(undockedRec.hard! - expected, 6); // surface docked by the same penalty

  // Gate: a floor above the player's rating -> no dock. Active player (recent match) -> no dock.
  const highFloor: EloConfig = { seedFor: () => 1500, dock: { ...dock, ratingFloor: 9999 } };
  expect(computeRatingsAsOf(r, cutoff, highFloor).byId.get("1")!.overall).toBeCloseTo(undocked, 6);
  const recent = computeRatingsAsOf(r, 20200301, cfg).byId.get("1")!.overall; // only ~4 weeks out
  const recentNo = computeRatingsAsOf(r, 20200301, noDock).byId.get("1")!.overall;
  expect(recent).toBeCloseTo(recentNo, 6); // below the 8-week trigger -> no dock
});

describe("on-return dock + combine-and-differential", () => {
  const dock: LayoffDock = { triggerDays: 56, minPenalty: 100, maxPenalty: 150, maxDays: 365, ratingFloor: 1400, recoveryMatches: 20, recoveryMult: 1.5, comebackResetYears: 2 };
  const cfg: EloConfig = { seedFor: () => 1500, dock };
  const win = (id: string, opp: string, date: number) => row({ winnerId: id, loserId: opp, tourneyDate: date, surface: null });

  it("docks the STATE on a return from a >= trigger in-season gap and opens the boosted-K window", () => {
    const e = new EloEngine(cfg);
    e.update(win("1", "2", 20200201)); // debut win, no prior gap
    expect(e.players.get("1")!.clusterDock).toBe(0);
    e.update(win("1", "3", 20200601)); // return from a ~121 active-day gap -> dock fires
    const c1 = e.players.get("1")!.clusterDock;
    expect(c1).toBeGreaterThan(100); // above the curve's 100 floor
    expect(c1).toBeLessThan(125); // ~110 for 121 days, well under the 150 cap
    expect(e.players.get("1")!.recoveryLeft).toBe(19); // 20-match window opened, the return match consumed 1
  });

  it("charges only the DIFFERENTIAL for a second layoff within the combine window", () => {
    const e = new EloEngine(cfg);
    e.update(win("1", "2", 20200201));
    e.update(win("1", "3", 20200601)); // first return ~121d
    const c1 = e.players.get("1")!.clusterDock;
    e.update(win("1", "4", 20200901)); // second return ~92d, combines (within 2yr)
    const c2 = e.players.get("1")!.clusterDock;
    expect(c2).toBeGreaterThan(c1); // the cluster grew
    expect(c2 - c1).toBeLessThan(c1); // ...but only by the differential, far less than a fresh ~110 dock
    expect(c2).toBeLessThanOrEqual(dock.maxPenalty); // bounded by the curve cap, never stacks past 150
  });

  it("starts a FRESH cluster for a layoff > comebackResetYears after the last comeback", () => {
    const e = new EloEngine(cfg);
    e.update(win("1", "2", 20200201));
    e.update(win("1", "3", 20200601)); // first cluster (~121d), lastComeback = 20200601
    e.update(win("1", "4", 20230601)); // 3 years later (> 2yr) -> reset: cluster = the new gap ONLY
    const s = e.players.get("1")!;
    expect(s.clusterDays).toBe(activeLayoffDays(20200601, 20230601)); // reset, NOT cumulative (121 + gap)
    expect(s.clusterDock).toBeGreaterThan(100); // a full fresh dock (curve caps at 150 for this long gap)
  });
});
