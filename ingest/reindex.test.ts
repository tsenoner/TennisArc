import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { reindex } from "./reindex";
import type { Match, Snapshot } from "../src/model";

function snap(tour: "ATP" | "WTA", year: number, slam: string, name: string, surface: string, generatedAt: string): Snapshot {
  const final: Match = {
    id: "0", roundIndex: 0, slot: 0, nextMatchId: null, p1: "a", p2: "b",
    status: "finished", winner: "p1", score: null, live: null, durationSec: null,
    durationProvisional: false, sofaEventId: null, sofaCustomId: null, stats: null,
  };
  return {
    schemaVersion: 2, generatedAt, tour,
    tournament: { slam, name, year, surface, sofaUniqueTournamentId: 1, sofaSeasonId: 1, drawSize: 128 },
    players: {}, matches: { "0": final }, rounds: [],
  };
}

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "reindex-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("reindex", () => {
  it("builds the manifest from per-slam snapshots, ignoring aliases and index", async () => {
    await writeFile(resolve(dir, "atp-2026-roland-garros.json"), JSON.stringify(snap("ATP", 2026, "roland-garros", "Roland Garros", "Clay", "2026-06-09T00:00:00.000Z")));
    await writeFile(resolve(dir, "wta-2026-australian-open.json"), JSON.stringify(snap("WTA", 2026, "australian-open", "Australian Open", "Hard", "2026-02-01T00:00:00.000Z")));
    // noise that must be excluded:
    await writeFile(resolve(dir, "atp.json"), JSON.stringify(snap("ATP", 2026, "roland-garros", "Roland Garros", "Clay", "2026-06-09T00:00:00.000Z")));
    await writeFile(resolve(dir, "index.json"), "{}");

    const idx = await reindex(dir);
    expect(idx.slams).toHaveLength(2);
    // canonical order (matches mergeIndex): newest year, then slam alpha, then tour
    expect(idx.slams.map((s) => `${s.tour}/${s.slam}`)).toEqual(["WTA/australian-open", "ATP/roland-garros"]);
    // newest snapshot stamp wins, deterministically
    expect(idx.generatedAt).toBe("2026-06-09T00:00:00.000Z");
    expect(idx.slams[1]).toMatchObject({ tour: "ATP", year: 2026, slam: "roland-garros", status: "complete", drawSize: 128 });
  });

  it("is deterministic — same files yield a byte-identical manifest", async () => {
    await writeFile(resolve(dir, "atp-2026-roland-garros.json"), JSON.stringify(snap("ATP", 2026, "roland-garros", "Roland Garros", "Clay", "2026-06-09T00:00:00.000Z")));
    expect(JSON.stringify(await reindex(dir))).toBe(JSON.stringify(await reindex(dir)));
  });
});
