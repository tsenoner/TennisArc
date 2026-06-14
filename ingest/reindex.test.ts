import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { reindex } from "./reindex";
import type { Match, Snapshot } from "../src/model";

function snap(tour: "ATP" | "WTA", year: number, slam: string, name: string, surface: string, generatedAt: string, finalOver: Partial<Match> = {}): Snapshot {
  const final: Match = {
    id: "0", roundIndex: 0, slot: 0, nextMatchId: null, p1: "a", p2: "b",
    status: "finished", winner: "p1", score: null, live: null, durationSec: null,
    durationProvisional: false, sofaEventId: null, sofaCustomId: null, stats: null, ...finalOver,
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

async function writeSnap(dir: string, year: number, file: string, s: Snapshot): Promise<void> {
  await mkdir(resolve(dir, "slams", String(year)), { recursive: true });
  await writeFile(resolve(dir, "slams", String(year), file), JSON.stringify(s));
}

describe("reindex", () => {
  it("builds the manifest from slams/{year}/ snapshots, ignoring root-level files", async () => {
    await writeSnap(dir, 2026, "atp-roland-garros.json", snap("ATP", 2026, "roland-garros", "Roland Garros", "Clay", "2026-06-09T00:00:00.000Z"));
    await writeSnap(dir, 2026, "wta-australian-open.json", snap("WTA", 2026, "australian-open", "Australian Open", "Hard", "2026-02-01T00:00:00.000Z"));
    await writeSnap(dir, 2025, "atp-wimbledon.json", snap("ATP", 2025, "wimbledon", "Wimbledon", "Grass", "2025-07-14T00:00:00.000Z"));
    // noise that must be excluded: the manifest itself and legacy flat-layout leftovers
    await writeFile(resolve(dir, "index.json"), "{}");
    await writeFile(resolve(dir, "atp-2026-roland-garros.json"), JSON.stringify(snap("ATP", 2026, "roland-garros", "Roland Garros", "Clay", "2026-06-09T00:00:00.000Z")));
    await writeFile(resolve(dir, "atp.json"), JSON.stringify(snap("ATP", 2026, "roland-garros", "Roland Garros", "Clay", "2026-06-09T00:00:00.000Z")));

    const idx = await reindex(dir);
    expect(idx.slams).toHaveLength(3);
    // canonical order (matches mergeIndex): newest year, then slam alpha, then tour
    expect(idx.slams.map((s) => `${s.tour}/${s.year}/${s.slam}`)).toEqual([
      "WTA/2026/australian-open", "ATP/2026/roland-garros", "ATP/2025/wimbledon",
    ]);
    // newest snapshot stamp wins, deterministically
    expect(idx.generatedAt).toBe("2026-06-09T00:00:00.000Z");
    expect(idx.slams[1]).toMatchObject({ tour: "ATP", year: 2026, slam: "roland-garros", status: "complete", drawSize: 128 });
  });

  it("classifies a past slam with a scheduled (never-decided) final as complete, not live", async () => {
    // issue #19: a past slam whose final was never scraped must not stay 'live' and hijack the boot pick
    await writeSnap(dir, 2021, "atp-us-open.json", snap("ATP", 2021, "us-open", "US Open", "Hard", "2026-06-12T00:00:00.000Z", { status: "scheduled", winner: null }));
    await writeSnap(dir, 2026, "atp-roland-garros.json", snap("ATP", 2026, "roland-garros", "Roland Garros", "Clay", "2026-06-09T00:00:00.000Z"));
    const idx = await reindex(dir);
    const uso = idx.slams.find((s) => s.year === 2021 && s.slam === "us-open")!;
    expect(uso.status).toBe("complete");
    expect(idx.slams.some((s) => s.status === "live")).toBe(false);
  });

  it("does not leave the latest slam stuck 'live' when its final was never decided", async () => {
    // The only snapshot on disk, stamped INSIDE its own (past) window with a scheduled final. A
    // file-stamp clock would read that in-window stamp and call it 'live' forever; the wall clock
    // (now well past Sept 2021) correctly degrades it to complete.
    await writeSnap(dir, 2021, "atp-us-open.json", snap("ATP", 2021, "us-open", "US Open", "Hard", "2021-09-12T00:00:00.000Z", { status: "scheduled", winner: null }));
    const idx = await reindex(dir);
    expect(idx.slams[0].status).toBe("complete");
    expect(idx.slams.some((s) => s.status === "live")).toBe(false);
  });

  it("is deterministic — same files yield a byte-identical manifest", async () => {
    await writeSnap(dir, 2026, "atp-roland-garros.json", snap("ATP", 2026, "roland-garros", "Roland Garros", "Clay", "2026-06-09T00:00:00.000Z"));
    expect(JSON.stringify(await reindex(dir))).toBe(JSON.stringify(await reindex(dir)));
  });
});
