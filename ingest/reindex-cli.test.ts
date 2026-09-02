import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { snap, writeSnap } from "./fixtures/snapshot";

// The CLI entry (`pnpm reindex`), not just the exported reindex(): the wiring is what broke. The
// launchd clone lives under "~/Library/Application Support/TennisArc/refresh", and the old guard
// string-compared import.meta.url with `file://${process.argv[1]}`, so `tsx ingest/reindex.ts`
// exited 0 there without rebuilding anything — for weeks.
//
// Here argv[1] reaches the script through a symlink whose name contains a space; Node reports the
// main module's REAL path in import.meta.url, so the two disagree exactly as they did in the clone
// (the percent-encoding half of that mismatch is covered directly in main-guard.test.ts). The old
// guard fails this; isMain() resolves both sides to real paths and passes.
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("reindex CLI", () => {
  it("rebuilds index.json when argv[1] points through a path containing a space", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "reindex cli "));
    try {
      await writeSnap(join(cwd, "public", "data"), 2026, "atp-wimbledon.json",
        snap("ATP", 2026, "wimbledon", "Wimbledon", "Grass", "2026-07-13T23:44:19.450Z"));
      const linked = join(cwd, "with space");
      await symlink(REPO_ROOT, linked);
      const r = spawnSync(
        join(REPO_ROOT, "node_modules", ".bin", "tsx"),
        [join(linked, "ingest", "reindex.ts")],
        { cwd, encoding: "utf8" },
      );
      expect(r.status).toBe(0);
      const idx = JSON.parse(await readFile(join(cwd, "public", "data", "index.json"), "utf8"));
      expect(idx.slams.map((s: { tour: string; year: number; slam: string }) => `${s.tour}/${s.year}/${s.slam}`))
        .toEqual(["ATP/2026/wimbledon"]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }, 30_000);
});
