import { describe, it, expect } from "vitest";
import { makeSyntheticSnapshot } from "./fixtures/synthetic";
import { buildSunburst, winnerId, timeOnCourt, timeLeaderboard } from "./state";
import { surfaceElo, projectFavorite, winProbability } from "./state";
import type { Player } from "./model";

const mkPlayer = (o: Partial<Player>): Player => ({
  id: "x", name: "X", country: "", seed: null, entry: null, ranking: null, ageYears: null, sofaSlug: null, elo: null, birthdate: null, ...o,
});

describe("buildSunburst", () => {
  it("roots at the champion and has the draw size as leaves", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 3 });
    const root = buildSunburst(s);
    expect(root.depth).toBe(0);
    // champion = winner of the final
    const final = Object.values(s.matches).find((m) => m.nextMatchId === null)!;
    expect(root.occupant).toBe(winnerId(final));
    // leaves = 8 entrants
    const leaves: string[] = [];
    const walk = (n: typeof root) => n.children.length ? n.children.forEach(walk) : leaves.push(n.id);
    walk(root);
    expect(leaves).toHaveLength(8);
  });

  it("assigns a stable unique id per node and links each non-leaf to a match", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 4, seed: 2 });
    const root = buildSunburst(s);
    const ids = new Set<string>();
    const walk = (n: typeof root) => { ids.add(n.id); n.children.forEach(walk); };
    walk(root);
    // 4-draw: champion(1) + finalists(2) + entrants(4) = 7 nodes
    expect(ids.size).toBe(7);
    expect(root.matchId).toBe(Object.values(s.matches).find((m) => m.nextMatchId === null)!.id);
  });

  it("projects the top seed to the title when no results are in yet", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 5, completedRounds: 0 });
    const root = buildSunburst(s);
    expect(root.projected).toBe(true);
    expect(root.occupant).toBe("p0"); // seed 1 / ranking 1 wins every projected match
    // leaves (entrants) are known, not projected
    const leaf = (n: typeof root): typeof root => (n.children.length ? leaf(n.children[0]) : n);
    expect(leaf(root).projected).toBe(false);
  });
});

describe("timeOnCourt", () => {
  it("sums duration for finished matches and counts matches per player", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 4, seed: 1 });
    const t = timeOnCourt(s);
    expect(t.get("p0")!.sec).toBeGreaterThan(0);
    const champ = buildSunburst(s).occupant!;
    expect(t.get(champ)!.matches).toBe(2); // champion played R1 + final
  });

  it("counts each counted match's duration for both players; gating excludes walkover/null", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 2 });
    // walkover: excluded by status even though it still has a duration
    s.matches["0-0"] = { ...s.matches["0-0"], status: "walkover" };
    // retired: counted, keeps its duration
    s.matches["0-1"] = { ...s.matches["0-1"], status: "retired" };
    // finished but null duration: excluded (unknown, not zero)
    s.matches["0-2"] = { ...s.matches["0-2"], durationSec: null };
    const t = timeOnCourt(s);
    const totalSec = [...t.values()].reduce((a, v) => a + v.sec, 0);
    // independent re-derivation of the rule: counted statuses with a known duration, ×2 players
    const expected = Object.values(s.matches).reduce((a, m) => {
      const counted = m.status === "finished" || m.status === "retired" || m.status === "live";
      return a + (counted && m.durationSec != null ? m.durationSec * 2 : 0);
    }, 0);
    expect(totalSec).toBe(expected);
  });

  it("flags live totals provisional and tracks deepest round reached", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 4, seed: 1 });
    const live = s.matches["0-1"];
    s.matches["0-1"] = { ...live, status: "live", winner: null, durationSec: 1800, durationProvisional: true };
    const t = timeOnCourt(s);
    expect(t.get(live.p1!)!.provisional).toBe(true);
    // a first-round loser's deepest round is 0 (they never advance)
    const r1 = s.matches["0-0"];
    const r1Loser = r1.winner === "p1" ? r1.p2! : r1.p1!;
    expect(t.get(r1Loser)!.roundReached).toBe(0);
  });
});

describe("timeLeaderboard", () => {
  it("ranks players by descending time, caps at the limit, excludes zero-time", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 32, seed: 4 });
    const rows = timeLeaderboard(s, timeOnCourt(s), 5);
    expect(rows).toHaveLength(5);
    for (let i = 1; i < rows.length; i++) expect(rows[i].sec).toBeLessThanOrEqual(rows[i - 1].sec);
    for (const r of rows) {
      expect(r.sec).toBeGreaterThan(0);
      expect(r.name).toBe(s.players[r.playerId].name);
    }
  });

  it("carries the provisional flag through from live matches", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const m = s.matches["0-0"];
    s.matches["0-0"] = { ...m, status: "live", winner: null, durationSec: 9999, durationProvisional: true };
    const rows = timeLeaderboard(s, timeOnCourt(s), 20);
    const liveRow = rows.find((r) => r.playerId === m.p1);
    expect(liveRow?.provisional).toBe(true);
  });

  it("excludes players with zero court time (e.g. a walkover loser)", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    const wo = s.matches["0-0"];
    // walkover with no duration: the loser played only this match → 0 counted time
    s.matches["0-0"] = { ...wo, status: "walkover", durationSec: null, winner: "p1" };
    const time = timeOnCourt(s);
    const loser = wo.p2!;
    expect(time.get(loser)!.sec).toBe(0);
    const rows = timeLeaderboard(s, time, 50);
    expect(rows.some((r) => r.playerId === loser)).toBe(false);
  });
});

describe("surfaceElo", () => {
  it("picks the slam surface, falling back to overall then null", () => {
    const p = mkPlayer({ elo: { overall: 2000, hard: 2100, clay: 1900, grass: 1800 } });
    expect(surfaceElo(p, "Clay")).toBe(1900);
    expect(surfaceElo(p, "Grass")).toBe(1800);
    expect(surfaceElo(p, "Hard")).toBe(2100);
    expect(surfaceElo(mkPlayer({ elo: { overall: 2000, hard: null, clay: null, grass: null } }), "Clay")).toBe(2000);
    expect(surfaceElo(mkPlayer({ elo: null }), "Clay")).toBeNull();
  });
});

describe("projectFavorite", () => {
  const players: Record<string, Player> = {
    a: mkPlayer({ id: "a", seed: 5, ranking: 20, elo: { overall: 1900, hard: 1900, clay: 2200, grass: 1900 } }),
    b: mkPlayer({ id: "b", seed: 1, ranking: 2, elo: { overall: 2100, hard: 2100, clay: 2000, grass: 2100 } }),
    c: mkPlayer({ id: "c", seed: null, ranking: 50, elo: null }),
    d: mkPlayer({ id: "d", seed: null, ranking: 80, elo: null }),
  };
  it("favours higher SURFACE elo (clay specialist beats higher overall seed)", () => {
    expect(projectFavorite(players, "a", "b", "Clay")).toBe("a"); // a clay 2200 > b clay 2000
    expect(projectFavorite(players, "a", "b", "Hard")).toBe("b"); // b hard 2100 > a hard 1900
  });
  it("falls back to ranking then seed when elo is missing", () => {
    expect(projectFavorite(players, "c", "d", "Clay")).toBe("c"); // c rank 50 < d rank 80
  });
  it("handles null participants (TBD)", () => {
    expect(projectFavorite(players, null, "b", "Clay")).toBe("b");
    expect(projectFavorite(players, "a", null, "Clay")).toBe("a");
    expect(projectFavorite(players, null, null, "Clay")).toBeNull();
  });
});

describe("winProbability", () => {
  it("is 0.5 for equal elo and rises with the gap", () => {
    expect(winProbability(2000, 2000)).toBeCloseTo(0.5, 5);
    expect(winProbability(2200, 2000)).toBeCloseTo(0.7597, 3);
    expect(winProbability(2000, 2200)).toBeCloseTo(0.2403, 3);
  });
});

import { labelAnchors, buildSunburst as buildSun2 } from "./state";

describe("labelAnchors", () => {
  it("labels the champion once at the root and never repeats a player", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 2 });
    const root = buildSun2(s);
    const anchors = labelAnchors(root);
    expect(anchors.has(root.id)).toBe(true); // champion labelled at centre
    // a player advancing into the next decided round is NOT anchored on the outer arc
    const advancing = root.children.find((c) => c.occupant === root.occupant)!;
    expect(anchors.has(advancing.id)).toBe(false);
    // every decided occupant appears exactly once across the anchor set
    const seen = new Map<string, number>();
    const walk = (n: typeof root) => {
      if (anchors.has(n.id) && n.occupant) seen.set(n.occupant, (seen.get(n.occupant) ?? 0) + 1);
      n.children.forEach(walk);
    };
    walk(root);
    for (const count of seen.values()) expect(count).toBe(1);
  });

  it("does not anchor projected (undecided) arcs", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 5, completedRounds: 0 });
    const root = buildSun2(s);
    expect(labelAnchors(root).has(root.id)).toBe(false); // champion is projected → no anchor
  });
});

import { seedProgress } from "./state";

describe("seedProgress", () => {
  it("lists each seed with how far they got (deepest first) and flags ELO upsets", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 2 });
    // make the round-0 loser the higher-ELO favourite so their loss reads as an upset
    const m = s.matches["0-0"];
    const win = m.winner === "p1" ? m.p1! : m.p2!;
    const lose = m.winner === "p1" ? m.p2! : m.p1!;
    s.players[win] = { ...s.players[win], elo: { overall: 1800, hard: 1800, clay: 1800, grass: 1800 } };
    s.players[lose] = { ...s.players[lose], elo: { overall: 2000, hard: 2000, clay: 2000, grass: 2000 } };
    const out = seedProgress(s);
    expect(out.seedsTotal).toBe(8);       // all 8 in a draw of 8 are seeded
    expect(out.seedsRemaining).toBe(1);   // only the champion survives a completed draw
    expect(out.rows).toHaveLength(8);
    // deepest-first ordering
    for (let i = 1; i < out.rows.length; i++) {
      expect(out.rows[i - 1].roundReached).toBeGreaterThanOrEqual(out.rows[i].roundReached);
    }
    // the favourite who lost round 0 is out, reached nothing, and is flagged as an upset
    const fell = out.rows.find((r) => r.playerId === lose)!;
    expect(fell).toMatchObject({ alive: false, roundReached: 0, upset: true });
    // the champion is alive and went furthest (log2(8) = 3 rounds)
    const champ = out.rows.find((r) => r.alive)!;
    expect(champ.roundReached).toBe(3);
  });
});

import { cumulativeOnCourt } from "./state";

describe("cumulativeOnCourt", () => {
  it("accumulates a player's match durations round by round (running total)", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 3 });
    const cum = cumulativeOnCourt(s);
    // p0 plays match 0-0 in round 0 → through(0) is exactly that match's duration
    expect(cum.through("p0", 0)).toBe(s.matches["0-0"].durationSec ?? 0);
    // running total is non-decreasing across rounds
    expect(cum.through("p0", 1)).toBeGreaterThanOrEqual(cum.through("p0", 0));
    expect(cum.through("p0", 2)).toBeGreaterThanOrEqual(cum.through("p0", 1));
    // out-of-range round clamps to the final total
    expect(cum.through("p0", 99)).toBe(cum.through("p0", 2));
    expect(cum.max).toBeGreaterThan(0);
  });
  it("returns 0 for an unknown player", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    expect(cumulativeOnCourt(s).through("nobody", 0)).toBe(0);
  });
});

import { countryBreakdown } from "./state";

describe("countryBreakdown", () => {
  it("groups players by country with entrants + still-in counts, ranked", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    // force two known countries
    const ids = Object.keys(s.players);
    ids.forEach((id, i) => { s.players[id] = { ...s.players[id], country: i < 5 ? "ESP" : "FRA" }; });
    const rows = countryBreakdown(s);
    const esp = rows.find((r) => r.country === "ESP")!;
    expect(esp.entrants).toBe(5);
    expect(esp.stillIn).toBeLessThanOrEqual(esp.entrants);
    expect(esp.players.length).toBe(5);
    // ranked by stillIn desc then entrants desc
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i];
      expect(a.stillIn > b.stillIn || (a.stillIn === b.stillIn && a.entrants >= b.entrants)).toBe(true);
    }
  });
});

import { ageOn, birthdayInWindow, formatBirthday } from "./state";

describe("age + birthday helpers", () => {
  it("ageOn computes integer age as of a date", () => {
    expect(ageOn("1987-05-22", "2026-06-07")).toBe(39);
    expect(ageOn("1987-05-22", "2026-05-21")).toBe(38); // before birthday that year
    expect(ageOn(null, "2026-06-07")).toBeNull();
  });
  it("birthdayInWindow detects a birthday within N days before the reference", () => {
    expect(birthdayInWindow("2000-05-28", "2026-06-07", 16)).toBe(true);  // 28 May within ~2wk before 7 Jun
    expect(birthdayInWindow("2000-01-01", "2026-06-07", 16)).toBe(false);
    expect(birthdayInWindow(null, "2026-06-07", 16)).toBe(false);
  });
  it("formatBirthday gives a short day-month label", () => {
    expect(formatBirthday("1987-05-22")).toBe("22 May");
    expect(formatBirthday(null)).toBe("");
  });
});

import { matchInsight } from "./state";

describe("matchInsight", () => {
  it("derives upset + comeback + tiebreak badges and an ELO line", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 4, seed: 1 });
    const m = s.matches["0-0"];
    const win = m.winner === "p1" ? m.p1! : m.p2!;
    const lose = m.winner === "p1" ? m.p2! : m.p1!;
    s.players[win] = { ...s.players[win], elo: { overall: 1800, hard: 1800, clay: 1800, grass: 1800 } };
    s.players[lose] = { ...s.players[lose], elo: { overall: 2000, hard: 2000, clay: 2000, grass: 2000 } };
    // winner dropped the first set, then a tiebreak set
    s.matches["0-0"] = { ...m, score: [{ p1: 4, p2: 6 }, { p1: 7, p2: 6, tb: 5 }, { p1: 6, p2: 3 }] };
    if (m.winner === "p2") s.matches["0-0"].score = [{ p1: 6, p2: 4 }, { p1: 6, p2: 7, tb: 5 }, { p1: 3, p2: 6 }];
    const ins = matchInsight(s, "0-0", timeOnCourt(s))!;
    expect(ins.upset).toBe(true);
    expect(ins.badges).toContain("Upset");
    expect(ins.badges).toContain("From a set down");
    expect(ins.badges.some((b) => /tiebreak/.test(b))).toBe(true);
    expect(ins.eloLine).toMatch(/ELO favoured/);
    expect(ins.p1.elo).not.toBeNull();
  });
});
