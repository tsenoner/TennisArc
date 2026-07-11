import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Tour } from "../src/model";
// .js extension REQUIRED: with package.json "type":"module", Vercel transpiles this function to ESM
// without bundling, and Node ESM needs explicit extensions on relative imports (tsc bundler-resolution,
// Vite, tsx and vitest all resolve ".js" → ".ts", so it's safe across the whole toolchain). Applies
// down the whole runtime import chain (ingest/flashscore.ts → ingest/names.ts → src/names.ts).
import { parseLiveFeed } from "../ingest/flashscore.js";
// .js extension REQUIRED here too (same ESM rule as the parseLiveFeed import below).
import { fetchFeed } from "./_flashscore.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const tour = String(req.query.tour ?? "").toUpperCase();
  const slam = String(req.query.slam ?? "");
  if ((tour !== "ATP" && tour !== "WTA") || !slam) {
    res.status(400).json({ error: "tour (atp|wta) and slam are required" });
    return;
  }
  try {
    const r = await fetchFeed("f_2_0_3_en_1");
    if (r.ok) {
      const body = await r.text();
      // Short cache + short SWR: with few viewers, stale-while-revalidate serves the STALE copy
      // to each poll while revalidating behind it, so a long SWR window becomes a sustained lag
      // (measured ~a game behind during the 2026 WTA final with 25/60). 10/10 keeps the games
      // score within ~15-20s of the feed at one upstream fetch per ~10s worst case.
      res.setHeader("Cache-Control", "public, s-maxage=10, stale-while-revalidate=10");
      res.status(200).json({ matches: parseLiveFeed(body, { tour: tour as Tour, slam }) });
      return;
    }
  } catch { /* fall through to the empty-overlay fallback */ }
  // Upstream unavailable (non-200 or network error) → empty overlay + short cache; the client keeps
  // showing the snapshot's values. One fallback shared by the !ok and thrown paths.
  res.setHeader("Cache-Control", "public, s-maxage=10");
  res.status(200).json({ matches: [] });
}
