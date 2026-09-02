import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The canonical on-disk identity of a path: its real path when it exists, else just resolved. */
const canonical = (p: string): string => {
  try { return realpathSync(p); } catch { return resolve(p); }
};

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
 */
export function isMain(moduleUrl: string, entry: string | undefined = process.argv[1]): boolean {
  if (!entry || !moduleUrl.startsWith("file:")) return false;
  return canonical(fileURLToPath(moduleUrl)) === canonical(entry);
}
