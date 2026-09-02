import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * True when `moduleUrl` (a script's `import.meta.url`) is the script Node was launched with — the
 * ESM stand-in for `require.main === module`, so a file can be both importable and runnable.
 *
 * Compares real filesystem paths, never URL strings: `import.meta.url` percent-encodes spaces
 * (`Application%20Support`) while `process.argv[1]` doesn't, so the naive
 * `import.meta.url === \`file://${process.argv[1]}\`` test is false for any checkout under a path
 * with a space. That silently turned `pnpm reindex` into a no-op in the launchd clone
 * (`~/Library/Application Support/TennisArc/refresh`) and dropped Wimbledon 2026 from the manifest
 * while its snapshots sat untouched on the data branch. Real paths also see through a symlinked
 * entry (Node resolves the main module's real path for `import.meta.url`).
 *
 * Convention: guard a script only when something also imports it — that is what makes the guard
 * load-bearing rather than ceremony. Entry scripts nothing imports (`ingest/index.ts`,
 * `backfill-durations.ts`, `backfill-finals.ts`) just call `main()` unconditionally, which is
 * immune to this bug by construction.
 *
 * `realpathSync` throws for a path that doesn't exist and `fileURLToPath` for a non-`file:` URL;
 * either means this is not the entry script, hence the blanket `catch`.
 */
export function isMain(moduleUrl: string, entry: string | undefined = process.argv[1]): boolean {
  try {
    return !!entry && realpathSync(fileURLToPath(moduleUrl)) === realpathSync(entry);
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
 * before a queued stderr write to a pipe has flushed, which is exactly how an unattended log loses
 * the error that explains the run.
 */
export function runMain(moduleUrl: string, main: () => void | Promise<void>, label?: string): void {
  if (!isMain(moduleUrl)) return;
  void (async () => main())().catch((err: unknown) => {
    if (label) console.error(`${label} failed:`, err);
    else console.error(err);
    process.exitCode = 1;
  });
}
