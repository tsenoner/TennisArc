import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isMain } from "./cli";

// A temp dir whose name contains a space — the shape of the launchd clone under
// "~/Library/Application Support/TennisArc/refresh" that turned the old guard into a silent no-op.
let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "cli guard ")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("isMain", () => {
  it("recognises the entry script when its path contains a space", async () => {
    const entry = join(dir, "reindex.ts");
    await writeFile(entry, "");
    // import.meta.url percent-encodes the space; process.argv[1] does not
    expect(pathToFileURL(entry).href).toContain("%20");
    expect(isMain(pathToFileURL(entry).href, entry)).toBe(true);
  });

  it("is false for a module that was merely imported by the entry script", async () => {
    const entry = join(dir, "index.ts");
    const imported = join(dir, "reindex.ts");
    await writeFile(entry, "");
    await writeFile(imported, "");
    expect(isMain(pathToFileURL(imported).href, entry)).toBe(false);
  });

  it("is false when there is no entry script (REPL / -e)", () => {
    expect(isMain("file:///repo/ingest/reindex.ts", undefined)).toBe(false);
  });

  it("matches through a symlinked entry path (Node resolves the main module's real path)", async () => {
    const real = join(dir, "real");
    const link = join(dir, "link");
    await mkdir(real);
    await writeFile(join(real, "reindex.ts"), "");
    await symlink(real, link);
    expect(isMain(pathToFileURL(join(real, "reindex.ts")).href, join(link, "reindex.ts"))).toBe(true);
  });
});
