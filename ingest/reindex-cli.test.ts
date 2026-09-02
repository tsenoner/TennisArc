import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Snapshot } from "../src/model";

// The CLI entry (`pnpm reindex`) — not just the exported reindex() function. The launchd clone
// lives under "~/Library/Application Support/TennisArc/refresh", and the old main-guard compared
// import.meta.url (percent-encoded: Application%20Support) with process.argv[1] (raw), so
// `tsx ingest/reindex.ts` exited 0 there without rebuilding anything — for weeks. This runs the
// real script through a path containing a space and asserts the manifest actually gets written.
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const snapshot: Snapshot = {
  schemaVersion: 2, generatedAt: "2026-07-13T23:44:19.450Z", tour: "ATP",
  tournament: { slam: "wimbledon", name: "Wimbledon", year: 2026, surface: "Grass", sofaUniqueTournamentId: 2361, sofaSeasonId: 85943, drawSize: 128 },
  players: {},
  matches: {
    "6-0": {
      id: "6-0", roundIndex: 6, slot: 0, nextMatchId: null, p1: "a", p2: "b",
      status: "finished", winner: "p1", score: null, live: null, durationSec: null,
      durationProvisional: false, sofaEventId: null, sofaCustomId: null, stats: null,
    },
  },
  rounds: [],
};

describe("reindex CLI", () => {
  it("rebuilds index.json when invoked through a path containing a space", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "reindex cli "));
    try {
      await mkdir(join(cwd, "public", "data", "slams", "2026"), { recursive: true });
      await writeFile(join(cwd, "public", "data", "slams", "2026", "atp-wimbledon.json"), JSON.stringify(snapshot));
      const linked = join(cwd, "with space");   // argv[1] carries the space; import.meta.url won't
      await symlink(REPO_ROOT, linked);
      const r = spawnSync(
        join(REPO_ROOT, "node_modules", ".bin", "tsx"),
        [join(linked, "ingest", "reindex.ts")],
        { cwd, encoding: "utf8" },
      );
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("reindex: 1 slams");
      const idx = JSON.parse(await readFile(join(cwd, "public", "data", "index.json"), "utf8"));
      expect(idx.slams.map((s: { tour: string; year: number; slam: string }) => `${s.tour}/${s.year}/${s.slam}`))
        .toEqual(["ATP/2026/wimbledon"]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }, 30_000);
});
