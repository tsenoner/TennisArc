import { describe, it, expect } from "vitest";
import { parseSeedsCsv, applySeeds, distinctSeedCount } from "./seeds";
import type { Player } from "../src/model";

const player = (id: string, name: string, seed: number | null = null): Player => ({
  id, name, country: "", seed, entry: null, ranking: null, ageYears: null,
  sofaSlug: null, elo: null, birthdate: null,
});

// Minimal Sackmann-shaped header: only the six columns parseSeedsCsv reads need correct names; the
// rest are placeholders so column indices line up with the real 49-wide schema isn't required —
// indexOf keys off the names, so an abbreviated header with the right names in any order is fine.
const HEADER = "tourney_name,round,winner_name,winner_seed,loser_name,loser_seed";
const row = (t: string, r: string, wn: string, ws: string, ln: string, ls: string): string =>
  [t, r, wn, ws, ln, ls].join(",");

describe("parseSeedsCsv", () => {
  it("keeps only the slam's main-draw numeric seeds (ignores other tourneys, qualies, WC/Q/LL)", () => {
    const csv = [
      HEADER,
      row("Wimbledon", "R128", "Karolina Pliskova", "11", "Some Body", ""),       // numeric + blank
      row("Wimbledon", "R64", "Novak Djokovic", "1", "Wild Card", "WC"),           // entry code skipped
      row("Wimbledon", "Q1", "Quali Player", "5", "Other Quali", "6"),            // qualies round excluded
      row("Brisbane", "R32", "Off Tour", "3", "Nobody", "4"),                      // wrong tourney
      row("Wimbledon", "F", "Andy Murray", "3", "Milos Raonic", "6"),             // numeric both sides
    ].join("\n");
    const map = parseSeedsCsv(csv, "wimbledon");
    expect(map.byFull.get("karolinapliskova")).toBe(11);
    expect(map.byFull.get("novakdjokovic")).toBe(1);
    expect(map.byFull.get("andymurray")).toBe(3);
    expect(map.byFull.get("milosraonic")).toBe(6);
    // entry-code, qualie, and off-tour players never land in the map
    expect(map.byFull.has("wildcard")).toBe(false);
    expect(map.byFull.has("qualiplayer")).toBe(false);
    expect(map.byFull.has("offtour")).toBe(false);
    expect(map.byFull.has("somebody")).toBe(false); // blank seed
    expect(distinctSeedCount(map)).toBe(4); // 11,1,3,6
  });

  it("drops Sackmann's out-of-range markers: a GS seeds only 1..32, so 33+ (notable unseeded) is ignored", () => {
    const csv = [
      HEADER,
      row("Roland Garros", "R128", "Paula Badosa", "33", "Real Seed", "8"), // 33 = unseeded marker
      row("Roland Garros", "R64", "Zero Seed", "0", "Filler", ""),          // stray 0 also rejected
    ].join("\n");
    const map = parseSeedsCsv(csv, "roland-garros");
    expect(map.byFull.has("paulabadosa")).toBe(false);
    expect(map.byFull.has("zeroseed")).toBe(false);
    expect(map.byFull.get("realseed")).toBe(8);
  });
});

describe("applySeeds", () => {
  it("assigns via exact fullKey join", () => {
    const csv = [HEADER, row("Wimbledon", "R128", "Novak Djokovic", "1", "Nobody", "")].join("\n");
    const map = parseSeedsCsv(csv, "wimbledon");
    const players = { a: player("a", "Novak Djokovic") };
    const s = applySeeds(players, map);
    expect(players.a.seed).toBe(1);
    expect(s.filledFull).toBe(1);
    expect(s.filledSig).toBe(0);
  });

  it("falls back to the surname+initial signature for an abbreviated snapshot name", () => {
    // snapshot has "J. Janković"; CSV full name "Jelena Jankovic" — fullKey misses, sigKey hits.
    const csv = [HEADER, row("Australian Open", "R128", "Jelena Jankovic", "15", "Nobody", "")].join("\n");
    const map = parseSeedsCsv(csv, "australian-open");
    const players = { a: player("a", "J. Janković") };
    const s = applySeeds(players, map);
    expect(players.a.seed).toBe(15);
    expect(s.filledSig).toBe(1);
    expect(s.filledFull).toBe(0);
  });

  it("skips an ambiguous signature (two distinct full names share surname+initial)", () => {
    const csv = [
      HEADER,
      row("US Open", "R128", "Mike Smith", "3", "Nobody", ""),
      row("US Open", "R64", "Mary Smith", "7", "Other", ""),
    ].join("\n");
    const map = parseSeedsCsv(csv, "us-open");
    expect(map.sigOwner.get("smith:m")).toBeNull(); // ambiguous
    const players = { a: player("a", "M. Smith") }; // abbreviated -> only sigKey could match
    const s = applySeeds(players, map);
    expect(players.a.seed).toBeNull();
    expect(s.sigAmbiguousSkip).toBe(1);
  });

  it("Pliskova twin guard: Kristyna stays null when Karolina already took seed 11 via fullKey", () => {
    const csv = [
      HEADER,
      row("Wimbledon", "R128", "Karolina Pliskova", "11", "Filler One", ""),
      row("Wimbledon", "R128", "Kristyna Pliskova", "", "Filler Two", ""), // unseeded twin
    ].join("\n");
    const map = parseSeedsCsv(csv, "wimbledon");
    // Both twins share sig "pliskova:k", but only Karolina has a seed, so sigOwner resolves to 11.
    expect(map.sigOwner.get("pliskova:k")).toBe(11);
    const players = {
      k: player("k", "Karolina Pliskova"),
      r: player("r", "Kristyna Pliskova"),
    };
    const s = applySeeds(players, map);
    expect(players.k.seed).toBe(11);  // fullKey
    expect(players.r.seed).toBeNull(); // taken guard, NOT 11
    expect(s.filledFull).toBe(1);
    expect(s.takenSkip).toBe(1);
    expect(s.filledSig).toBe(0);
  });

  it("pass-1 fullKey join never duplicates a seed already pinned to another player", () => {
    // The snapshot wrongly pins seed 6 to a stale player (upstream quirk); Sackmann's real #6 is FAA.
    // Merge must not assign FAA a second seed 6 — leave him null rather than create a duplicate.
    const csv = [HEADER, row("Australian Open", "R128", "Felix Auger-Aliassime", "6", "Filler", "")].join("\n");
    const map = parseSeedsCsv(csv, "australian-open");
    const players = {
      stale: player("stale", "Some Qualifier", 6), // wrongly holds seed 6 already
      faa: player("faa", "Felix Auger-Aliassime"),  // Sackmann's real #6, currently null
    };
    const s = applySeeds(players, map);
    expect(players.stale.seed).toBe(6);    // existing seed untouched (merge)
    expect(players.faa.seed).toBeNull();   // not assigned a duplicate 6
    expect(s.takenSkip).toBe(1);
    const seeds = Object.values(players).map((p) => p.seed).filter((x) => x !== null);
    expect(new Set(seeds).size).toBe(seeds.length); // no duplicates
  });

  it("does not guess between two abbreviated snapshot players sharing one signature", () => {
    // Only Karolina is seeded in Sackmann (full names), so sigOwner('pliskova:k')=11 is unambiguous on
    // the CSV side. But if BOTH twins appear abbreviated in the snapshot, neither can be assigned.
    const csv = [
      HEADER,
      row("Wimbledon", "R128", "Karolina Pliskova", "11", "Filler One", ""),
      row("Wimbledon", "R128", "Kristyna Pliskova", "", "Filler Two", ""),
    ].join("\n");
    const map = parseSeedsCsv(csv, "wimbledon");
    const players = {
      a: player("a", "K. Pliskova"), // abbreviated — can't fullKey-join either twin
      b: player("b", "K. Pliskova"),
    };
    const s = applySeeds(players, map);
    expect(players.a.seed).toBeNull();
    expect(players.b.seed).toBeNull();
    expect(s.sigAmbiguousSkip).toBe(2); // both skipped: snapshot-side signature collision
  });

  it("merge (overwrite=false) preserves an existing partial seed and never overwrites it", () => {
    // snapshot already seeded Serena 1; CSV says 1 too but also adds Kvitova 4.
    const csv = [
      HEADER,
      row("Australian Open", "R128", "Serena Williams", "1", "Nobody", ""),
      row("Australian Open", "R128", "Petra Kvitova", "4", "Other", ""),
    ].join("\n");
    const map = parseSeedsCsv(csv, "australian-open");
    const players = {
      a: player("a", "Serena Williams", 1), // already seeded
      b: player("b", "Petra Kvitova"),       // unseeded -> should fill
    };
    const s = applySeeds(players, map);
    expect(players.a.seed).toBe(1);
    expect(players.b.seed).toBe(4);
    expect(s.alreadySeeded).toBe(1);
    expect(s.filledFull).toBe(1);
  });

  it("preserves a legit sub-32 draw: 30 distinct Sackmann seeds -> 30 filled, the rest null", () => {
    // nameTokens strips digits, so each player needs a distinct *letter-only* name. Letters a..ad
    // give 30 unique surnames; the matching snapshot player reuses the same name.
    const letterName = (i: number): string => `Seed ${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`;
    const rows = [HEADER];
    for (let i = 0; i < 30; i++) rows.push(row("Wimbledon", "R128", letterName(i), String(i + 1), `Filler ${letterName(i)}x`, ""));
    const map = parseSeedsCsv(rows.join("\n"), "wimbledon");
    expect(distinctSeedCount(map)).toBe(30);
    const players: Record<string, Player> = {};
    for (let i = 0; i < 30; i++) players[`p${i}`] = player(`p${i}`, letterName(i));
    players.un1 = player("un1", "Unseeded Onezz"); // not in CSV
    players.un2 = player("un2", "Unseeded Twozz");
    const s = applySeeds(players, map);
    const filled = Object.values(players).filter((p) => p.seed !== null);
    expect(filled).toHaveLength(30);
    expect(players.un1.seed).toBeNull();
    expect(players.un2.seed).toBeNull();
    expect(s.filledFull).toBe(30);
  });

  it("is idempotent: a second run fills nothing new and leaves seeds unchanged", () => {
    const csv = [
      HEADER,
      row("Wimbledon", "R128", "Karolina Pliskova", "11", "Filler", ""),
      row("Wimbledon", "R128", "Novak Djokovic", "1", "Other", ""),
    ].join("\n");
    const map = parseSeedsCsv(csv, "wimbledon");
    const players = { a: player("a", "Karolina Pliskova"), b: player("b", "Novak Djokovic") };
    const first = applySeeds(players, map);
    expect(first.filledFull).toBe(2);
    const before = Object.fromEntries(Object.values(players).map((p) => [p.id, p.seed]));
    const second = applySeeds(players, map);
    expect(second.filledFull).toBe(0);
    expect(second.filledSig).toBe(0);
    expect(second.alreadySeeded).toBe(2);
    const after = Object.fromEntries(Object.values(players).map((p) => [p.id, p.seed]));
    expect(after).toEqual(before);
  });

  it("Makarova nickname mismatch stays null (Kate vs Ekaterina, never fabricated)", () => {
    // Snapshot has "Ekaterina Makarova"; Sackmann names her "Kate Makarova" — and only outside the
    // slam main draw, so she never appears in the slam map. Neither fullKey nor sigKey joins.
    const csv = [HEADER, row("US Open", "R128", "Someone Else", "5", "Filler", "")].join("\n");
    const map = parseSeedsCsv(csv, "us-open");
    const players = { a: player("a", "Ekaterina Makarova") };
    const s = applySeeds(players, map);
    expect(players.a.seed).toBeNull();
    expect(s.unjoined).toBe(1);
  });

  it("leaves non-seed fields (entry/ranking/elo/...) byte-identical after applySeeds", () => {
    const csv = [HEADER, row("Wimbledon", "R128", "Novak Djokovic", "1", "Filler", "")].join("\n");
    const map = parseSeedsCsv(csv, "wimbledon");
    const p: Player = {
      id: "x", name: "Novak Djokovic", country: "SRB", seed: null, entry: "WC",
      ranking: 4, ageYears: 38.1, sofaSlug: "djokovic-novak",
      elo: { overall: 2100, hard: 2150, clay: 2000, grass: 2050 }, birthdate: "1987-05-22",
    };
    const players = { x: p };
    applySeeds(players, map);
    expect(players.x.seed).toBe(1); // only field that changed
    // every other field untouched
    expect(players.x.entry).toBe("WC");
    expect(players.x.ranking).toBe(4);
    expect(players.x.ageYears).toBe(38.1);
    expect(players.x.sofaSlug).toBe("djokovic-novak");
    expect(players.x.elo).toEqual({ overall: 2100, hard: 2150, clay: 2000, grass: 2050 });
    expect(players.x.birthdate).toBe("1987-05-22");
    expect(players.x.country).toBe("SRB");
  });

  it("overwrite=true replaces an existing (stale) seed", () => {
    const csv = [HEADER, row("Wimbledon", "R128", "Novak Djokovic", "1", "Filler", "")].join("\n");
    const map = parseSeedsCsv(csv, "wimbledon");
    const players = { a: player("a", "Novak Djokovic", 9) }; // stale 9
    const s = applySeeds(players, map, { overwrite: true });
    expect(players.a.seed).toBe(1);
    expect(s.filledFull).toBe(1);
    expect(s.alreadySeeded).toBe(0);
  });
});
