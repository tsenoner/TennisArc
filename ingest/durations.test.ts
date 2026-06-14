import { describe, it, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseMatchesCsv, applyDurations, qualChallUrl, keepWtaQualItf, type SlamDurationRow } from "./durations";
import type { Match, Player } from "../src/model";

const csv = readFileSync(resolve(__dirname, "fixtures/matches-sample.csv"), "utf8");

const player = (id: string, name: string): Player => ({
  id, name, country: "", seed: null, entry: null, ranking: null, ageYears: null, sofaSlug: null, elo: null, birthdate: null,
});
const match = (roundIndex: number, p1: string, p2: string, durationSec: number | null): Match => ({
  id: `${roundIndex}-0`, roundIndex, slot: 0, nextMatchId: null, p1, p2,
  status: "finished", winner: "p1", score: null, live: null,
  durationSec, durationProvisional: false, sofaEventId: null, sofaCustomId: null, stats: null,
});

describe("parseMatchesCsv", () => {
  it("keeps only the requested slam's main-draw rows, mapping rounds and minutes→seconds", () => {
    const rows = parseMatchesCsv(csv, "australian-open");
    // R128 Sinner, F Sinner, R64 walkover, two R128 collision rows — Q1 and Brisbane excluded
    expect(rows).toHaveLength(5);
    const r128 = rows.find((r) => r.winnerName === "Jannik Sinner" && r.roundIndex === 0);
    expect(r128?.durationSec).toBe(127 * 60);
    const final = rows.find((r) => r.winnerName === "Jannik Sinner" && r.roundIndex === 6);
    expect(final?.durationSec).toBe(224 * 60);
  });

  it("matches the 'Us Open' tourney_name casing for us-open", () => {
    const rows = parseMatchesCsv(csv, "us-open");
    expect(rows).toHaveLength(1);
    expect(rows[0].roundIndex).toBe(1); // R64
    expect(rows[0].durationSec).toBe(95 * 60);
  });

  it("parses empty minutes (walkover) as null duration", () => {
    const rows = parseMatchesCsv(csv, "australian-open");
    const wo = rows.find((r) => r.winnerName === "Casper Ruud");
    expect(wo).toBeDefined();
    expect(wo!.durationSec).toBeNull();
  });
});

describe("applyDurations", () => {
  const aoRows = parseMatchesCsv(csv, "australian-open");

  it("sets the CSV duration on an exact name+round join, overriding a garbage local value", () => {
    const players = { a: player("a", "Jannik Sinner"), b: player("b", "Daniil Medvedev") };
    const matches = { m: match(6, "a", "b", 341176) }; // SofaScore suspension garbage
    const res = applyDurations(matches, players, aoRows);
    expect(matches.m.durationSec).toBe(224 * 60);
    expect(res.fromCsv).toBe(1);
  });

  it("joins via the surname+initial fallback when the local name is abbreviated", () => {
    const usRows = parseMatchesCsv(csv, "us-open");
    const players = { a: player("a", "A. van Uytvanck"), b: player("b", "Tamara Korpatsch") };
    const matches = { m: match(1, "a", "b", null) };
    const res = applyDurations(matches, players, usRows);
    expect(matches.m.durationSec).toBe(95 * 60);
    expect(res.fromCsv).toBe(1);
  });

  it("joins names with non-decomposing diacritics (Ł → l)", () => {
    const rgRows = parseMatchesCsv(csv, "roland-garros");
    const players = { a: player("a", "Łukasz Kubot"), b: player("b", "Sam Querrey") };
    const matches = { m: match(2, "a", "b", null) };
    applyDurations(matches, players, rgRows);
    expect(matches.m.durationSec).toBe(101 * 60);
  });

  it("keeps a sane local duration when the CSV row has none (walkover)", () => {
    const players = { a: player("a", "Casper Ruud"), b: player("b", "Marin Cilic") };
    const matches = { m: match(1, "a", "b", 5400) };
    const res = applyDurations(matches, players, aoRows);
    expect(matches.m.durationSec).toBe(5400);
    expect(res.keptLocal).toBe(1);
  });

  it("nulls an implausible local duration (>6h) when the CSV has no row for the match", () => {
    const players = { a: player("a", "Nobody Known"), b: player("b", "Also Unknown") };
    const matches = { m: match(3, "a", "b", 341176) };
    const res = applyDurations(matches, players, aoRows);
    expect(matches.m.durationSec).toBeNull();
    expect(res.dropped).toBe(1);
  });

  it("rejects an implausibly large CSV duration (poisoned upstream minutes) and keeps the sane local value", () => {
    const players = { a: player("a", "Real Player"), b: player("b", "Other Player") };
    const matches = { m: match(0, "a", "b", 5400) }; // a plausible local value is present
    const rows: SlamDurationRow[] = [
      { roundIndex: 0, winnerName: "Real Player", loserName: "Other Player", durationSec: 60_000_000 },
    ];
    const res = applyDurations(matches, players, rows);
    expect(matches.m.durationSec).toBe(5400); // CSV ceiling rejected the poison; local kept
    expect(res.fromCsv).toBe(0);
    expect(res.keptLocal).toBe(1);
  });

  it("keeps a genuine >6h match from the CSV (Isner–Mahut 39 900s is under the 12h ceiling)", () => {
    const players = { a: player("a", "John Isner"), b: player("b", "Nicolas Mahut") };
    const matches = { m: match(0, "a", "b", null) };
    const rows: SlamDurationRow[] = [
      { roundIndex: 0, winnerName: "John Isner", loserName: "Nicolas Mahut", durationSec: 39_900 },
    ];
    const res = applyDurations(matches, players, rows);
    expect(matches.m.durationSec).toBe(39_900);
    expect(res.fromCsv).toBe(1);
  });

  it("refuses ambiguous fallback joins (two CSV rows sharing surname+initial keys)", () => {
    // "M. Smith vs A. Jones" fuzzy-matches BOTH collision rows (100m and 130m) — must join neither
    const players = { a: player("a", "M. Smith"), b: player("b", "A. Jones") };
    const matches = { m: match(0, "a", "b", 4000) };
    const res = applyDurations(matches, players, aoRows);
    expect(matches.m.durationSec).toBe(4000); // sane local kept, no CSV value applied
    expect(res.fromCsv).toBe(0);
  });

  it("ignores unfinished matches", () => {
    const players = { a: player("a", "Jannik Sinner"), b: player("b", "Daniil Medvedev") };
    const m = { ...match(6, "a", "b", 1234), status: "scheduled" as const, winner: null };
    const matches = { m };
    applyDurations(matches, players, aoRows);
    expect(matches.m.durationSec).toBe(1234);
  });
});

test("qualChallUrl builds the qual/challenger file URL per tour", () => {
  expect(qualChallUrl("ATP", 2024)).toBe(
    "https://raw.githubusercontent.com/JeffSackmann/tennis_atp/master/atp_matches_qual_chall_2024.csv");
  expect(qualChallUrl("WTA", 2024)).toBe(
    "https://raw.githubusercontent.com/JeffSackmann/tennis_wta/master/wta_matches_qual_itf_2024.csv");
});

test("keepWtaQualItf keeps >=50K ITF tiers and all non-numeric (non-ITF) levels", () => {
  expect(keepWtaQualItf("50")).toBe(true);
  expect(keepWtaQualItf("100")).toBe(true);
  expect(keepWtaQualItf("25")).toBe(false);   // sub-$50K ITF -> excluded
  expect(keepWtaQualItf("15")).toBe(false);
  expect(keepWtaQualItf("W")).toBe(true);      // non-ITF WTA level -> kept
  expect(keepWtaQualItf("G")).toBe(true);
});
