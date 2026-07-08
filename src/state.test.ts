import { describe, it, expect } from "vitest";
import { makeSyntheticSnapshot } from "./fixtures/synthetic";
import { buildSunburst, winnerId, timeOnCourt, timeLeaderboard, type SunNode } from "./state";
import { surfaceElo, projectFavorite, winProbability } from "./state";
import type { Player } from "./model";

const mkPlayer = (o: Partial<Player>): Player => ({
  id: "x", name: "X", country: "", seed: null, entry: null, ranking: null, sofaSlug: null, elo: null, birthdate: null, ...o,
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

  it("flags the node of a live match (so it colours by live time, not pending grey)", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1, completedRounds: 0 });
    s.matches["0-1"] = { ...s.matches["0-1"], status: "live", winner: null, durationSec: 1800, durationProvisional: true };
    const find = (n: SunNode): SunNode | undefined =>
      n.matchId === "0-1" && n.children.length ? n : n.children.map(find).find(Boolean);
    expect(find(buildSunburst(s))?.live).toBe(true);
    // a scheduled sibling match's node is not live
    const find00 = (n: SunNode): SunNode | undefined =>
      n.matchId === "0-0" && n.children.length ? n : n.children.map(find00).find(Boolean);
    expect(find00(buildSunburst(s))?.live).toBe(false);
  });

  it("does not flag a node live when the match already has a decided winner (data-lag guard)", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1, completedRounds: 0 });
    // winner set while status still reads "live" — must resolve to decided (projected:false), NOT live
    s.matches["0-1"] = { ...s.matches["0-1"], status: "live", winner: "p1" };
    const find = (n: SunNode): SunNode | undefined =>
      n.matchId === "0-1" && n.children.length ? n : n.children.map(find).find(Boolean);
    const node = find(buildSunburst(s));
    expect(node?.live).toBe(false);
    expect(node?.projected).toBe(false);
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

describe("timeOnCourt coverage", () => {
  it("marks a player complete only when every counted match has a duration", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 3 });
    const t0 = timeOnCourt(s);
    for (const v of t0.values()) expect(v.complete).toBe(true);
    // unknown duration in one match → both its players become incomplete
    const m = s.matches["0-0"];
    s.matches["0-0"] = { ...m, durationSec: null };
    const t = timeOnCourt(s);
    expect(t.get(m.p1!)!.complete).toBe(false);
    expect(t.get(m.p2!)!.complete).toBe(false);
    // an uninvolved player keeps full coverage
    const other = s.matches["0-1"];
    expect(t.get(other.p1!)!.complete).toBe(true);
  });

  it("keeps an in-progress (null-duration) match's players on the board — provisional, not incomplete", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 3 });
    const m = s.matches["0-0"];
    // a suspended / resumed match whose current on-court time isn't known yet (durationSec null)
    s.matches["0-0"] = { ...m, status: "suspended", winner: null, durationSec: null };
    const t = timeOnCourt(s);
    // unlike a FINISHED null-duration match (which flips complete=false and drops the player), an
    // in-progress one only marks the total provisional — the player keeps their completed prior rounds
    expect(t.get(m.p1!)!.complete).toBe(true);
    expect(t.get(m.p1!)!.provisional).toBe(true);
    expect(t.get(m.p2!)!.complete).toBe(true);
  });
});

describe("timeLeaderboard", () => {
  it("excludes players with partial duration coverage (their total would silently undercount)", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 3 });
    const final = Object.values(s.matches).find((m) => m.roundIndex === 2)!;
    const champ = final.winner === "p1" ? final.p1! : final.p2!;
    s.matches[final.id] = { ...final, durationSec: null }; // champion's final: duration unknown
    const rows = timeLeaderboard(s, timeOnCourt(s), 50);
    expect(rows.some((r) => r.playerId === champ)).toBe(false); // sec > 0, but undercounted
    expect(rows.length).toBeGreaterThan(0); // fully-covered players still ranked
  });

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
    // walkover with no duration: the loser played only this match → 0 counted time. The
    // walkover must go to the fixture's ORIGINAL winner — the original loser is the one
    // player guaranteed to have no later-round court time to leak into the assertion.
    s.matches["0-0"] = { ...wo, status: "walkover", durationSec: null };
    const time = timeOnCourt(s);
    expect(wo.winner).not.toBeNull(); // fail loudly (not vacuously) if the fixture ever leaves round 0 undecided
    const loser = wo.winner === "p1" ? wo.p2! : wo.p1!;
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
  it("lists the seeds in seed order, carries surface ELO, and flags ELO upsets", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 2 });
    // make the round-0 loser the higher-ELO favourite so their loss reads as an upset
    const m = s.matches["0-0"];
    const win = m.winner === "p1" ? m.p1! : m.p2!;
    const lose = m.winner === "p1" ? m.p2! : m.p1!;
    s.players[win] = { ...s.players[win], elo: { overall: 1800, hard: 1800, clay: 1800, grass: 1800 } };
    s.players[lose] = { ...s.players[lose], elo: { overall: 2000, hard: 2000, clay: 2000, grass: 2000 } };
    const out = seedProgress(s);
    expect(out.mode).toBe("seed");
    expect(out.total).toBe(8);       // all 8 in a draw of 8 are seeded
    expect(out.remaining).toBe(1);   // only the champion survives a completed draw
    expect(out.rows).toHaveLength(8);
    // seed-ascending ordering; the badge rank equals the seed number
    for (let i = 1; i < out.rows.length; i++) {
      expect(out.rows[i].seed!).toBeGreaterThan(out.rows[i - 1].seed!);
    }
    expect(out.rows[0]).toMatchObject({ rank: 1, seed: 1 });
    // each row carries the surface ELO (clay)
    const loser = out.rows.find((r) => r.playerId === lose)!;
    expect(loser.elo).toBe(2000); // clay ELO of the (overridden) favourite
    // the favourite who lost round 0 is out, reached nothing, and is flagged as an upset
    expect(loser).toMatchObject({ alive: false, roundReached: 0, upset: true });
    // the champion is alive and went furthest (log2(8) = 3 rounds)
    const champ = out.rows.find((r) => r.alive)!;
    expect(champ.roundReached).toBe(3);
  });

  it("elo sort ranks the top 32 by surface ELO (incl. unseeded) with the ELO position as the badge", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 2 });
    // unseed the last entrant and make it the strongest by clay ELO; the rest descend
    s.players["p7"] = { ...s.players["p7"], seed: null, elo: { overall: 2500, hard: 2500, clay: 2500, grass: 2500 } };
    for (let i = 0; i < 7; i++) {
      const e = 2000 - i * 10;
      s.players[`p${i}`] = { ...s.players[`p${i}`], elo: { overall: e, hard: e, clay: e, grass: e } };
    }
    const out = seedProgress(s, "elo");
    expect(out.mode).toBe("elo");
    expect(out.rows[0]).toMatchObject({ rank: 1, playerId: "p7", seed: null }); // strongest is unseeded
    for (let i = 1; i < out.rows.length; i++) {
      expect(out.rows[i].elo!).toBeLessThanOrEqual(out.rows[i - 1].elo!); // strictly descending ELO
    }
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

  it("ignores SofaScore placeholder future-slot teams (no phantom '—' nation)", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    Object.keys(s.players).forEach((id) => { s.players[id] = { ...s.players[id], country: "ESP" }; });
    // A placeholder occupies only later-round slots (never a round-0 match) and has no country —
    // exactly the "R16P1"/"Qf1" teams SofaScore seeds for the unresolved bracket.
    s.players["ph-r16p1"] = {
      id: "ph-r16p1", name: "R16P1", country: "", seed: null, entry: null,
      ranking: null, sofaSlug: "r16p1", elo: null, birthdate: null,
    };

    const rows = countryBreakdown(s);

    expect(rows.find((r) => r.country === "—")).toBeUndefined();      // placeholder not counted
    expect(rows.find((r) => r.country === "ESP")!.entrants).toBe(8);  // only the 8 real entrants
  });

  it("counts a real entrant whose first-round block is absent from the source data", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    Object.keys(s.players).forEach((id) => { s.players[id] = { ...s.players[id], country: "ESP" }; });
    // SofaScore sometimes drops a real player's first-round block, so they surface only from a later
    // round (e.g. Federer at 2014 Roland Garros). Unlike a placeholder they carry a country / seed /
    // ranking, so they must still be counted — never silently dropped from the Nations panel.
    s.players["fed"] = {
      id: "fed", name: "Roger Federer", country: "CHE", seed: 4, entry: null,
      ranking: 4, sofaSlug: "federer-roger", elo: null, birthdate: null,
    };

    const rows = countryBreakdown(s);

    expect(rows.find((r) => r.country === "CHE")!.entrants).toBe(1); // missing-from-round-0 real entrant kept
    expect(rows.find((r) => r.country === "ESP")!.entrants).toBe(8);
  });

  it("ignores a placeholder embedded in a round-0 slot (2023 Australian Open shape)", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    Object.keys(s.players).forEach((id) => { s.players[id] = { ...s.players[id], country: "ESP" }; });
    // A malformed payload dropped a synthetic "R64Pn" team into a real first-round slot. Unlike the
    // earlier test (placeholder never in a match), this one occupies a round-0 slot, so the
    // first-round fingerprint alone would let it through — only the placeholder check excludes it.
    s.players["ph-r64p1"] = {
      id: "ph-r64p1", name: "R64P1", country: "", seed: null, entry: null,
      ranking: null, sofaSlug: "r64p1", elo: null, birthdate: null,
    };
    s.matches["0-0"] = { ...s.matches["0-0"], p2: "ph-r64p1" };

    const rows = countryBreakdown(s);

    expect(rows.find((r) => r.country === "—")).toBeUndefined();      // no phantom nation
    expect(rows.find((r) => r.country === "ESP")!.entrants).toBe(8);  // 8 real players, placeholder dropped
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

import { sectionTitle, roundAbbrev } from "./state";

describe("sectionTitle", () => {
  const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 32, seed: 7 });
  const root = buildSunburst(s);

  it("names the halves in draw-sheet language (r.0 = top of the sheet)", () => {
    expect(sectionTitle(s, root, "r.0")).toBe("Top half");
    expect(sectionTitle(s, root, "r.1")).toBe("Bottom half");
  });

  it("names a quarter for its DRAWN top seed, not its current occupant", () => {
    // owner = min seed among the quarter's entrants (p0..p7 → seed 1), whoever leads it now
    expect(sectionTitle(s, root, "r.0.0")).toBe("0's quarter");   // "Player 0", seed 1
    expect(sectionTitle(s, root, "r.1.1")).toBe("24's quarter");  // "Player 24", seed 25
  });

  it("falls back to the node's own round for deeper sections and owner-less quarters", () => {
    // depth 3 in a 32-draw is a Round-of-16 node, occupant or not
    expect(sectionTitle(s, root, "r.0.0.0")).toBe("R16 section");
    // an all-TBD quarter (every drawn slot unknown) has no owner — it names its round instead
    const blank = structuredClone(root);
    const strip = (n: typeof root) => { n.occupant = null; n.children.forEach(strip); };
    strip(blank.children[0].children[0]);
    expect(sectionTitle(s, blank, "r.0.0")).toBe("QF section");
  });

  it("returns 'Full draw' for the root and '' for ids that don't resolve", () => {
    expect(sectionTitle(s, root, "r")).toBe("Full draw");
    expect(sectionTitle(s, root, "r.7.7")).toBe("");
    expect(sectionTitle(s, root, "x.0")).toBe("");
  });

  it("roundAbbrev (moved here from render) keeps its abbreviations", () => {
    expect(roundAbbrev(0, s.rounds)).toBe("R32");
    expect(roundAbbrev(2, s.rounds)).toBe("QF");
    expect(roundAbbrev(5, s.rounds)).toBe("Champion");
  });
});

import { quarterOwners } from "./state";

describe("quarterOwners", () => {
  // synthetic 32-draw: entrants p0..p31 in draw order, seed i+1, ranking i+1 —
  // quarters hold p0-7 / p8-15 / p16-23 / p24-31 (TR r.0.0, BR r.0.1, BL r.1.0, TL r.1.1)
  it("crowns the drawn top seed of each quarter, in TR/BR/BL/TL node order", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 32, seed: 7 });
    const owners = quarterOwners(s, buildSunburst(s))!;
    expect(owners.map((o) => o.nodeId)).toEqual(["r.0.0", "r.0.1", "r.1.0", "r.1.1"]);
    expect(owners.map((o) => o.playerId)).toEqual(["p0", "p8", "p16", "p24"]);
    expect(owners.map((o) => o.seed)).toEqual([1, 9, 17, 25]);
  });

  it("keeps an eliminated owner, flagged out (the label dims; the name stays)", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 32, seed: 7 });
    s.matches["0-0"] = { ...s.matches["0-0"], winner: "p2" }; // seed 1 (p0) falls in round 0
    const owners = quarterOwners(s, buildSunburst(s))!;
    expect(owners[0]).toMatchObject({ playerId: "p0", seed: 1, out: true });
  });

  it("breaks a seed tie by better ranking", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 32, seed: 7 });
    s.players["p0"] = { ...s.players["p0"], seed: null };          // vacate seed 1
    s.players["p3"] = { ...s.players["p3"], seed: 2, ranking: 1 }; // ties p1's seed 2, better rank
    const owners = quarterOwners(s, buildSunburst(s))!;
    expect(owners[0]).toMatchObject({ playerId: "p3", seed: 2 });
  });

  it("falls back to the best-ranked entrant in a seedless quarter", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 32, seed: 7 });
    for (let i = 0; i < 8; i++) s.players[`p${i}`] = { ...s.players[`p${i}`], seed: null };
    s.players["p0"] = { ...s.players["p0"], ranking: 50 };          // demote the natural first
    const owners = quarterOwners(s, buildSunburst(s))!;
    expect(owners[0]).toMatchObject({ playerId: "p1", seed: null }); // ranking 2 leads the seedless quarter
  });

  it("owns nothing in an all-TBD quarter (caption-only label, the others still resolve)", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 32, seed: 7, completedRounds: 0 });
    // blank the TR quarter's drawn slots: round-0 matches 0-0..0-3 feed QF 0 (players p0..p7)
    for (const id of ["0-0", "0-1", "0-2", "0-3"]) s.matches[id] = { ...s.matches[id], p1: null, p2: null };
    const owners = quarterOwners(s, buildSunburst(s))!;
    expect(owners[0]).toMatchObject({ playerId: null, seed: null, out: false });
    expect(owners[1].playerId).toBe("p8");
  });

  it("returns null when the draw has no quarter structure (fewer than 3 rounds)", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 4, seed: 1 });
    expect(quarterOwners(s, buildSunburst(s))).toBeNull();
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
    const ins = matchInsight(s, "0-0", timeOnCourt(s), 1_700_000_000)!;
    expect(ins.upset).toBe(true);
    expect(ins.badges).toContain("Upset");
    expect(ins.badges).toContain("From a set down");
    expect(ins.badges.some((b) => /tiebreak/.test(b))).toBe(true);
    expect(ins.eloLine).toMatch(/ELO favoured/);
    expect(ins.eloLine).toMatch(/\(\+200\)$/); // 2000 vs 1800 favourite gap
    expect(ins.p1.elo).not.toBeNull();
  });
});

import { countsTime, buildSunburst as buildSun3, matchInsight as insight3, timeOnCourt as toc3, type SunNode as SunNode3 } from "./state";

describe("suspended-match handling", () => {
  const flat = (n: SunNode3): SunNode3[] => [n, ...n.children.flatMap(flat)];

  it("marks a suspended match's node suspended (not live) in the sunburst tree", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1, completedRounds: 0 });
    s.matches["0-0"] = { ...s.matches["0-0"], status: "suspended", winner: null };
    const susp = flat(buildSun3(s)).filter((n) => n.suspended);
    expect(susp.length).toBeGreaterThan(0);
    expect(susp.every((n) => n.matchId === "0-0" && !n.live)).toBe(true);
  });

  it("counts a suspended match's time as provisional, like a live one", () => {
    expect(countsTime({ status: "suspended" } as any)).toEqual({ count: true, provisional: true });
  });

  it("badges a finished match that spanned a suspension", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    s.matches["0-0"] = { ...s.matches["0-0"], wasSuspended: true };
    const ins = insight3(s, "0-0", toc3(s), 1_700_000_000)!;
    expect(ins.badges).toContain("Suspended");
  });

  it("treats a locally-healed (estimated) finished duration as provisional, a measured one as final", () => {
    expect(countsTime({ status: "finished", durationProvisional: true } as any)).toEqual({ count: true, provisional: true });
    expect(countsTime({ status: "finished", durationProvisional: false } as any)).toEqual({ count: true, provisional: false });
  });

  it("does not mint a Marathon badge off a provisional (healed) suspension estimate, and ranks it provisional", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1 });
    // a finished match whose >3h duration is a suspension-healed ESTIMATE, not measured minutes
    s.matches["0-0"] = { ...s.matches["0-0"], status: "finished", durationSec: 12000, durationProvisional: true, wasSuspended: true };
    const ins = insight3(s, "0-0", toc3(s), 1_700_000_000)!;
    expect(ins.badges).not.toContain("Marathon"); // an estimate is not a confirmed marathon
    expect(ins.badges).toContain("Suspended");
    // and the estimate carries a provisional total (the `*`) rather than ranking as measured
    expect(toc3(s).get(s.matches["0-0"].p1!)!.provisional).toBe(true);
  });
});

import { scheduledInfo, msToVenueMidnight } from "./state";
import type { Match as SchedMatch } from "./model";

const schedMatch = (o: Partial<SchedMatch> = {}): SchedMatch => ({
  id: "1-0", roundIndex: 1, slot: 0, nextMatchId: null, p1: "a", p2: "b",
  status: "scheduled", winner: null, score: null, live: null,
  durationSec: null, durationProvisional: false, sofaEventId: 1, sofaCustomId: null, stats: null, ...o,
});

describe("scheduledInfo", () => {
  const DAY = 86400;
  const NOW = 20_000 * DAY + 12 * 3600; // noon UTC on an arbitrary day — pure arithmetic either way

  it("precise: flagged slot within 36h → start + court", () => {
    expect(scheduledInfo(schedMatch({ scheduledStart: NOW + 3600, scheduledPrecise: true, scheduledCourt: "Court 2" }), NOW))
      .toEqual({ start: NOW + 3600, court: "Court 2" });
  });

  it("nominal: an UNFLAGGED stamp within 36h still surfaces (hide rules differ, display does not)", () => {
    // The evening-before case: a nominal 11:00 round-day stamp sits inside any window — precision
    // must come from the data source (the per-event override), never clock distance alone.
    expect(scheduledInfo(schedMatch({ scheduledStart: NOW + 20 * 3600 }), NOW))
      .toEqual({ start: NOW + 20 * 3600, court: null });
  });

  it("precise: a flagged stamp surfaces at ANY distance (provisional showpiece slots)", () => {
    // SofaScore publishes real provisional times for semis/finals a week out (scheduledPrecise
    // comes from the data source, not clock distance) — display them instead of degrading to a
    // date-only coarse tag. Nominal placeholders stay coarse because they are never flagged.
    expect(scheduledInfo(schedMatch({ scheduledStart: NOW + 8 * DAY, scheduledPrecise: true }), NOW))
      .toEqual({ start: NOW + 8 * DAY, court: null });
  });

  it("far-future placeholder rounds are shown (coarse), not suppressed", () => {
    expect(scheduledInfo(schedMatch({ status: "notstarted", p1: null, p2: null, scheduledStart: NOW + 5 * DAY }), NOW))
      .toEqual({ start: NOW + 5 * DAY, court: null });
  });

  it("precise slot: just-overdue still shows; >6h past hides", () => {
    expect(scheduledInfo(schedMatch({ scheduledStart: NOW - 1800, scheduledPrecise: true }), NOW))
      .toEqual({ start: NOW - 1800, court: null });
    expect(scheduledInfo(schedMatch({ scheduledStart: NOW - 7 * 3600, scheduledPrecise: true }), NOW)).toBeNull();
  });

  it("coarse slot survives hours past its stamp but drops once its day is over (no slam: UTC fallback)", () => {
    expect(scheduledInfo(schedMatch({ scheduledStart: NOW - 11 * 3600 }), NOW))     // 01:00 today UTC — day not over
      .toEqual({ start: NOW - 11 * 3600, court: null });
    expect(scheduledInfo(schedMatch({ scheduledStart: NOW - 13 * 3600 }), NOW)).toBeNull(); // 23:00 yesterday UTC
  });

  it("nominal hide gate runs on the VENUE day when the slam is known — far-west venue (US Open)", () => {
    // Nominal 11:00 New York = 15:00 UTC. The stamp's UTC day ends at 20:00 NY the same evening —
    // the venue rule must keep the tag through the venue evening and drop it at venue midnight.
    const start = Date.UTC(2026, 8, 1, 15) / 1000;               // 1 Sep 2026 11:00 EDT
    const utcEve = Date.UTC(2026, 8, 2, 1) / 1000;               // 21:00 EDT 1 Sep — UTC day already over
    const pastMidnight = Date.UTC(2026, 8, 2, 5) / 1000;         // 01:00 EDT 2 Sep — venue day over
    expect(scheduledInfo(schedMatch({ scheduledStart: start }), utcEve, "us-open"))
      .toEqual({ start, court: null });
    expect(scheduledInfo(schedMatch({ scheduledStart: start }), utcEve)).toBeNull(); // UTC proxy hides early
    expect(scheduledInfo(schedMatch({ scheduledStart: start }), pastMidnight, "us-open")).toBeNull();
  });

  it("nominal hide gate runs on the VENUE day when the slam is known — far-east venue (AO)", () => {
    // Nominal 11:00 Melbourne (AEDT, UTC+11) = 00:00 UTC. The venue day ends at 13:00 UTC —
    // the UTC proxy would keep the tag lingering ~11h into the next venue morning.
    const start = Date.UTC(2027, 0, 20, 0) / 1000;               // 20 Jan 2027 11:00 AEDT
    const nextVenueMorning = Date.UTC(2027, 0, 20, 14) / 1000;   // 01:00 AEDT 21 Jan — venue day over
    expect(scheduledInfo(schedMatch({ scheduledStart: start }), nextVenueMorning, "australian-open")).toBeNull();
    expect(scheduledInfo(schedMatch({ scheduledStart: start }), nextVenueMorning)) // UTC proxy lingers
      .toEqual({ start, court: null });
    expect(scheduledInfo(schedMatch({ scheduledStart: start }), Date.UTC(2027, 0, 20, 12) / 1000, "australian-open"))
      .toEqual({ start, court: null });                          // 23:00 AEDT — venue day not over yet
  });

  it("allowlist: no other status leaks a time, even with stray fields", () => {
    for (const status of ["finished", "live", "suspended", "retired", "walkover"] as const) {
      expect(scheduledInfo(schedMatch({ status, scheduledStart: NOW + 3600, scheduledPrecise: true }), NOW)).toBeNull();
    }
  });

  it("returns null when the match carries no scheduledStart", () => {
    expect(scheduledInfo(schedMatch(), NOW)).toBeNull();
  });

  it("msToVenueMidnight ticks at the venue's next midnight; null for an unknown slam", () => {
    const nowMs = Date.UTC(2026, 8, 1, 15);                       // 11:00 EDT 1 Sep
    expect(msToVenueMidnight(nowMs, "us-open")).toBe(Date.UTC(2026, 8, 2, 4) - nowMs); // 00:00 EDT = 04:00 UTC
    expect(msToVenueMidnight(nowMs, "not-a-slam")).toBeNull();
  });
});

describe("matchInsight — scheduled", () => {
  const NOW = 1_700_000_000;

  it("uses the passed wall-clock now — a stale generatedAt never gates the display", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1, completedRounds: 0 });
    s.generatedAt = new Date((NOW - 12 * 3600) * 1000).toISOString(); // half-day-old snapshot
    s.matches["0-0"] = { ...s.matches["0-0"], status: "scheduled", winner: null,
      scheduledStart: NOW + 2 * 3600, scheduledPrecise: true, scheduledCourt: "Centre Court" };
    expect(insight3(s, "0-0", toc3(s), NOW)!.scheduled)
      .toEqual({ start: NOW + 2 * 3600, court: "Centre Court" });
  });

  it("surfaces a far-future placeholder date as coarse", () => {
    const s = makeSyntheticSnapshot({ tour: "ATP", drawSize: 8, seed: 1, completedRounds: 0 });
    s.matches["0-0"] = { ...s.matches["0-0"], status: "scheduled", winner: null, scheduledStart: NOW + 5 * 86400 };
    expect(insight3(s, "0-0", toc3(s), NOW)!.scheduled)
      .toEqual({ start: NOW + 5 * 86400, court: null });
  });
});
