import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { snap, writeSnap } from "../ingest/fixtures/snapshot";
import { reindex } from "../ingest/reindex";

// The publish-time guard that index.json lists every per-slam snapshot on disk — see
// scripts/check-manifest.sh for why it exists.
const SCRIPT = fileURLToPath(new URL("./check-manifest.sh", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "check manifest ")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

/** Snapshot files on disk, named "atp-wimbledon.json" etc. under slams/2026/. */
async function snapshots(...names: string[]): Promise<void> {
  await mkdir(join(dir, "slams", "2026"), { recursive: true });
  for (const n of names) await writeFile(join(dir, "slams", "2026", n), "{}");
}
/** Manifest entries, given as "TOUR/year/slam" identities. */
const manifest = (...ids: string[]) =>
  writeFile(join(dir, "index.json"), JSON.stringify({
    schemaVersion: 2,
    slams: ids.map((id) => {
      const [tour, year, slam] = id.split("/");
      return { tour, year: Number(year), slam };
    }),
  }));
// Invoked the way publish-data.sh invokes it — through the shebang, not `bash <script>` — so a lost
// executable bit fails here instead of aborting an unattended publish with "Permission denied".
const run = (target = dir) => {
  const r = spawnSync(SCRIPT, [target], { encoding: "utf8" });
  if (r.error) throw r.error;
  return r;
};

describe("check-manifest.sh", () => {
  it("passes when index.json lists exactly the snapshots on disk", async () => {
    await snapshots("atp-wimbledon.json", "wta-wimbledon.json");
    await manifest("ATP/2026/wimbledon", "WTA/2026/wimbledon");
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("2 slams");
  });

  it("names the slam that is on disk but missing from the manifest", async () => {
    await snapshots("atp-wimbledon.json", "wta-wimbledon.json");
    await manifest("ATP/2026/wimbledon");
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("on disk but not in the manifest: WTA/2026/wimbledon");
  });

  it("names a slam the manifest claims that has no snapshot on disk", async () => {
    await snapshots("atp-wimbledon.json");
    await manifest("ATP/2026/wimbledon", "ATP/2026/us-open");
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("in the manifest but not on disk: ATP/2026/us-open");
  });

  // A count check would pass this: same length, wrong slams — a stale manifest of the right size.
  it("catches a same-length manifest that lists the wrong slams", async () => {
    await snapshots("atp-wimbledon.json");
    await manifest("ATP/2026/us-open");
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("ATP/2026/wimbledon");
    expect(r.stderr).toContain("ATP/2026/us-open");
  });

  // Comparing two Sets calls a manifest with a repeated entry consistent — and a repeat renders a
  // duplicate tab, which is a visible bug in exactly the surface this guard protects.
  it("catches a slam listed twice in the manifest", async () => {
    await snapshots("atp-wimbledon.json");
    await manifest("ATP/2026/wimbledon", "ATP/2026/wimbledon");
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("listed more than once in the manifest: ATP/2026/wimbledon");
  });

  it("fails with a legible message when index.json is missing", async () => {
    await snapshots("atp-wimbledon.json");
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("manifest missing");
  });

  it("only counts atp-/wta- snapshots under slams/{year}/, not the manifest or stray files", async () => {
    await snapshots("atp-wimbledon.json", "notes.json");
    await writeFile(join(dir, "atp-2026-wimbledon.json"), "{}"); // legacy flat layout — never lives in public/data
    await manifest("ATP/2026/wimbledon");
    expect(run().status).toBe(0);
  });

  // The guard is only worth anything while it agrees with reindex about which files are snapshots:
  // the rule is written twice (ingest/reindex.ts's SNAP_RE, this script's glob + name regex), and a
  // change to one side alone would leave a manifest that silently omits a slam looking "ok". Pin
  // them to each other by checking a manifest reindex itself produced.
  it("accepts exactly the manifest reindex() builds", async () => {
    await writeSnap(dir, 2026, "atp-wimbledon.json", snap("ATP", 2026, "wimbledon", "Wimbledon", "Grass", "2026-07-13T00:00:00.000Z"));
    await writeSnap(dir, 2026, "wta-us-open.json", snap("WTA", 2026, "us-open", "US Open", "Hard", "2026-09-13T00:00:00.000Z"));
    await writeSnap(dir, 2025, "atp-roland-garros.json", snap("ATP", 2025, "roland-garros", "Roland Garros", "Clay", "2025-06-08T00:00:00.000Z"));
    await writeFile(join(dir, "index.json"), JSON.stringify(await reindex(dir)));
    const r = run();
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("3 slams");
  });

  // The committed seed is hand-edited (snapshots get frozen in by hand — see the Wimbledon 2026
  // freeze), and reindex is easy to forget. Pin it here so a snapshot can never be committed
  // without the manifest that makes it reachable.
  it("holds for the committed public/data seed", () => {
    const r = run(join(REPO_ROOT, "public", "data"));
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
});
