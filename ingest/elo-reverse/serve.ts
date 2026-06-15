// Tiny static server for the reproduction dashboard. Serves ingest/elo-reverse/ (dashboard.html + the
// generated *-data.json sidecars) so the 5 MB dataset is fetched over HTTP rather than inlined, then opens
// the browser. Stays alive until Ctrl-C.   npx tsx ingest/elo-reverse/serve.ts
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { exec } from "node:child_process";

const DIR = resolve(process.cwd(), "ingest/elo-reverse");
const PORT = Number(process.env.PORT) || 5188;
const MIME: Record<string, string> = { ".html": "text/html", ".json": "application/json", ".js": "text/javascript", ".css": "text/css" };

const server = createServer(async (req, res) => {
  const url = (req.url || "/").split("?")[0];
  const rel = url === "/" ? "dashboard.html" : decodeURIComponent(url.replace(/^\/+/, ""));
  const file = resolve(DIR, rel);
  if (!file.startsWith(DIR)) { res.writeHead(403).end("forbidden"); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" }).end(body);
  } catch {
    res.writeHead(404).end("not found: " + rel);
  }
});

// Bind PORT; if it's already taken (e.g. a previous run still serving), step up to the next free port
// rather than crashing on EADDRINUSE.
function listen(port: number, attemptsLeft: number) {
  server.once("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && attemptsLeft > 0) {
      console.log(`port ${port} in use, trying ${port + 1}…`);
      listen(port + 1, attemptsLeft - 1);
    } else {
      console.error(err);
      process.exit(1);
    }
  });
  server.listen(port, () => {
    const link = `http://localhost:${port}/`;
    console.log(`reproduction dashboard → ${link}  (Ctrl-C to stop)`);
    if (!process.env.NO_OPEN) exec(`open ${link}`);
  });
}
listen(PORT, 12);
