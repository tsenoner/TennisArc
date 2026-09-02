import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// scripts/check-manifest.sh — the publish-time guard that the manifest lists every per-slam
// snapshot on disk. It exists because `pnpm reindex` once no-op'd silently for weeks (see
// ingest/cli.ts): the files were all there, the manifest just stopped mentioning some of them.
const SCRIPT = fileURLToPath(new URL("../scripts/check-manifest.sh", import.meta.url));

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "check manifest ")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

async function snapshots(...names: string[]): Promise<void> {
  await mkdir(join(dir, "slams", "2026"), { recursive: true });
  for (const n of names) await writeFile(join(dir, "slams", "2026", n), "{}");
}
const manifest = (n: number) =>
  writeFile(join(dir, "index.json"), JSON.stringify({ schemaVersion: 2, slams: Array.from({ length: n }, () => ({})) }));
const run = () => spawnSync("bash", [SCRIPT, dir], { encoding: "utf8" });

describe("check-manifest.sh", () => {
  it("passes when index.json lists exactly the snapshots on disk", async () => {
    await snapshots("atp-wimbledon.json", "wta-wimbledon.json");
    await manifest(2);
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("2 slams");
  });

  it("fails when a snapshot on disk is missing from the manifest", async () => {
    await snapshots("atp-wimbledon.json", "wta-wimbledon.json");
    await manifest(1);
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/lists 1 slams? but 2 snapshots/);
  });

  it("fails when index.json is missing", async () => {
    await snapshots("atp-wimbledon.json");
    const r = run();
    expect(r.status).not.toBe(0);
  });

  it("only counts atp-/wta- snapshots under slams/{year}/, not the manifest or stray files", async () => {
    await snapshots("atp-wimbledon.json", "notes.json");
    await writeFile(join(dir, "atp-2026-wimbledon.json"), "{}"); // legacy flat layout — never lives in public/data
    await manifest(1);
    expect(run().status).toBe(0);
  });
});
