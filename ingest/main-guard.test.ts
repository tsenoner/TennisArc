import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMain } from "./main-guard";

const GUARD = fileURLToPath(new URL("./main-guard.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));

// A temp dir whose name contains a space — the shape of the launchd clone that turned the old
// string-comparison guard into a silent no-op (see ingest/main-guard.ts).
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

  it("is false for a non-file: module URL", () => {
    expect(isMain("data:text/javascript,0", "/repo/ingest/reindex.ts")).toBe(false);
  });

  it("is false when the entry path does not exist", () => {
    expect(isMain(import.meta.url, join(dir, "gone.ts"))).toBe(false);
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

// Closing the class, not just the two instances: the broken predicate was copy-pasted into seven
// scripts and a partial migration is how it comes back. Any new entry script must use isMain().
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SELF = join(REPO_ROOT, "ingest", "main-guard.ts"); // documents the bug in prose — exempt
const OLD_GUARD = /import\.meta\.url\s*===/;

describe("no source file reintroduces the string-comparison main-guard", () => {
  it("finds the idiom only in the module that replaced it", () => {
    const offenders: string[] = [];
    for (const root of ["ingest", "src", "scripts", "api"]) {
      let entries: string[];
      try { entries = readdirSync(join(REPO_ROOT, root), { recursive: true }) as string[]; }
      catch { continue; }
      for (const e of entries) {
        const file = join(REPO_ROOT, root, e);
        if (!file.endsWith(".ts") || file === SELF) continue;
        if (OLD_GUARD.test(readFileSync(file, "utf8"))) offenders.push(relative(REPO_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

// runMain() is where the five entry scripts' error tails were unified. They previously split
// between process.exit(1) and process.exitCode — the latter is what survives here, because
// process.exit() can tear the process down before a queued stderr write to a pipe has flushed,
// losing the very error an unattended log exists to capture.
describe("runMain", () => {
  const write = async (name: string, body: string) => {
    const file = join(dir, name);
    await writeFile(file, body);
    return file;
  };
  const run = (file: string) => spawnSync(TSX, [file], { encoding: "utf8" });

  it("runs main and exits 0 when the module is the entry script", async () => {
    const file = await write("entry.ts",
      `import { runMain } from ${JSON.stringify(GUARD)};\n` +
      `runMain(import.meta.url, () => { console.log("ran"); });\n`);
    const r = run(file);
    expect(r.stdout).toContain("ran");
    expect(r.status).toBe(0);
  });

  it("does not run main when the module was merely imported", async () => {
    await write("mod.ts",
      `import { runMain } from ${JSON.stringify(GUARD)};\n` +
      `runMain(import.meta.url, () => { console.log("ran"); });\n`);
    const entry = await write("entry.ts", `import "./mod.ts";\nconsole.log("entry only");\n`);
    const r = run(entry);
    expect(r.stdout).toContain("entry only");
    expect(r.stdout).not.toContain("ran");
    expect(r.status).toBe(0);
  });

  it("reports a rejected main with its label and exit status 1", async () => {
    const file = await write("entry.ts",
      `import { runMain } from ${JSON.stringify(GUARD)};\n` +
      `runMain(import.meta.url, async () => { throw new Error("boom"); }, "reindex");\n`);
    const r = run(file);
    expect(r.stderr).toContain("reindex failed:");
    expect(r.stderr).toContain("boom");
    expect(r.status).toBe(1);
  });

  it("reports a synchronous throw too, without a label", async () => {
    const file = await write("entry.ts",
      `import { runMain } from ${JSON.stringify(GUARD)};\n` +
      `runMain(import.meta.url, () => { throw new Error("boom"); });\n`);
    const r = run(file);
    expect(r.stderr).toContain("boom");
    expect(r.stderr).not.toContain("failed:");
    expect(r.status).toBe(1);
  });
}, 30_000);
