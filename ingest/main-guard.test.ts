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

  it("decides an exact match without touching the filesystem", () => {
    // The whole point of the outage was a script that silently did nothing. An identical path must
    // resolve to `true` from the strings alone, so no I/O error (EACCES/ELOOP on a parent, a
    // network volume blinking) can ever put a runnable script back into that state.
    const gone = join(dir, "no", "such", "dir", "reindex.ts");
    expect(isMain(pathToFileURL(gone).href, gone)).toBe(true);
  });

  it("resolves an entry given relative to cwd", () => {
    expect(isMain(pathToFileURL(join(process.cwd(), "ingest", "reindex.ts")).href, "ingest/reindex.ts")).toBe(true);
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
// Both files spell the broken idiom out — one in prose, one in the patterns below — so both are
// exempt; nothing else in the repo has a reason to write either.
const EXEMPT = new Set([
  join(REPO_ROOT, "ingest", "main-guard.ts"),
  join(REPO_ROOT, "ingest", "main-guard.test.ts"),
]);
const SRC_EXT = /\.(?:ts|tsx|mjs|js)$/;
// Any comparison against import.meta.url, either operand order, == or === — not just the one shape
// that happened to be in the tree.
const URL_COMPARE = /import\.meta\.url\s*[=!]==?|[=!]==?\s*import\.meta\.url/;
// And any other read of process.argv[1] at all. isMain() is the only thing that needs the entry
// path, so banning it outright also catches the shapes the pattern above misses — notably
// `fileURLToPath(import.meta.url) === process.argv[1]`, which survives a space but still breaks on
// a symlinked invocation. Comments in sibling tests describe the bug, so only non-test sources.
const ARGV_ENTRY = /process\.argv\[1\]/;

describe("no source file reintroduces the string-comparison main-guard", () => {
  it("finds the idiom only in the module that replaced it", () => {
    const offenders: string[] = [];
    for (const root of ["ingest", "src", "scripts", "api", "tests"]) {
      let entries: string[];
      try { entries = readdirSync(join(REPO_ROOT, root), { recursive: true }) as string[]; }
      catch { continue; }
      for (const e of entries) {
        const file = join(REPO_ROOT, root, e);
        if (!SRC_EXT.test(file) || EXEMPT.has(file)) continue;
        const text = readFileSync(file, "utf8");
        const isTest = /\.test\.[cm]?[jt]sx?$/.test(file);
        if (URL_COMPARE.test(text) || (!isTest && ARGV_ENTRY.test(text))) {
          offenders.push(relative(REPO_ROOT, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

// runMain() is where the seven entry scripts' error tails were unified. They previously split
// between process.exit(1) and process.exitCode — the latter is what survives here, because
// process.exit() can tear the process down before a queued stderr write has flushed (on macOS,
// writes to a pipe are asynchronous), losing the very error that explains the run.
describe("runMain", () => {
  const write = async (name: string, body: string) => {
    const file = join(dir, name);
    await writeFile(file, body);
    return file;
  };
  const run = (file: string) => {
    const r = spawnSync(TSX, [file], { encoding: "utf8" });
    if (r.error) throw r.error; // e.g. tsx not installed — say that, don't fail on a null stdout
    return r;
  };

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
