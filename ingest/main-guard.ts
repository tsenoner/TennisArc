import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * True when `moduleUrl` (a script's `import.meta.url`) is the script Node was launched with — the
 * ESM stand-in for `require.main === module`, so a file can be both importable and runnable.
 *
 * Compares filesystem paths, never URL strings: `import.meta.url` percent-encodes spaces
 * (`Application%20Support`) while `process.argv[1]` doesn't, so the naive
 * `import.meta.url === \`file://${process.argv[1]}\`` test is false for any checkout under a path
 * with a space. That silently turned `pnpm reindex` into a no-op in the launchd clone
 * (`~/Library/Application Support/TennisArc/refresh`) and dropped Wimbledon 2026 from the manifest
 * while its snapshots sat untouched on the data branch.
 *
 * Decided in two steps, and the order matters. `fileURLToPath` + `resolve` settle the ordinary case
 * — including the space case — with NO filesystem access, so no I/O error can turn a runnable script
 * back into a silent no-op. Only a symlinked invocation can still be a match (Node reports the main
 * module's REAL path in `import.meta.url` while `argv[1]` keeps the link), and only that case pays
 * for `realpathSync`, which is also the only call that can fail (ENOENT for an entry that doesn't
 * exist, EACCES/ELOOP on a parent) — a failure there means "not the entry script".
 *
 * Convention: guard a script only when something also imports it — that is what makes the guard
 * load-bearing rather than ceremony. Entry scripts nothing imports (`ingest/index.ts`,
 * `backfill-durations.ts`, `backfill-finals.ts`, `elo-burnin.ts`, `elo-reconstruct.ts`, most of
 * `elo-reverse/` and `points/`) just run their work unconditionally, which is immune to this bug by
 * construction.
 */
export function isMain(moduleUrl: string, entry: string | undefined = process.argv[1]): boolean {
  if (!entry) return false; // REPL / `node -e` — there is no entry script
  let self: string;
  try {
    self = fileURLToPath(moduleUrl);
  } catch {
    return false; // non-`file:` module URL (data:, blob:) — never the entry script
  }
  const main = resolve(entry); // argv[1] can be relative to cwd
  if (self === main) return true;
  try {
    return realpathSync(self) === realpathSync(main);
  } catch {
    return false;
  }
}

/**
 * Run `main` when — and only when — this module is the entry script (see {@link isMain}), reporting
 * failure the same way in every script: the error to stderr, exit status 1. `label` prefixes the
 * message, e.g. `runMain(import.meta.url, main, "reindex")` → `reindex failed: …`.
 *
 * Sets `process.exitCode` rather than calling `process.exit()`: the latter tears the process down
 * before a queued stderr write has flushed. On macOS, writes to a pipe are asynchronous (writes to
 * a file or TTY are not), so `pnpm elo:scatter | tee` or any wrapper that pipes output can lose the
 * very error that explains the run. Only `reindex` runs in the publish pipeline and it already set
 * `exitCode`, so this changed nothing there; the four network scripts it did change are dev tools,
 * where lingering briefly on an error path costs nothing.
 */
export function runMain(moduleUrl: string, main: () => void | Promise<void>, label?: string): void {
  if (!isMain(moduleUrl)) return;
  void (async () => main())().catch((err: unknown) => {
    if (label) console.error(`${label} failed:`, err);
    else console.error(err);
    process.exitCode = 1;
  });
}
