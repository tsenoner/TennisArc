import type { VercelRequest, VercelResponse } from "@vercel/node";
// .js extensions REQUIRED: unbundled ESM function (see api/live.ts for the full rule).
import { FEED_HOST, UA, X_FSIGN } from "./_flashscore.js";
import { parseCurrentGame } from "../ingest/flashscore.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const mid = String(req.query.mid ?? "");
  if (!/^[A-Za-z0-9]{8}$/.test(mid)) {
    res.status(400).json({ error: "mid (8-char Flashscore match id) is required" });
    return;
  }
  try {
    const r = await fetch(`${FEED_HOST}/df_mhs_1_${mid}`, { headers: { "x-fsign": X_FSIGN, "user-agent": UA } });
    if (r.ok) {
      // No current game (finished / not started) parses to null → {}. The client treats {} as
      // "nothing to show" and keeps its last value; same 200-with-empty posture as /api/live.
      const game = parseCurrentGame(await r.text());
      res.setHeader("Cache-Control", "public, s-maxage=5, stale-while-revalidate=15");
      res.status(200).json(game ?? {});
      return;
    }
  } catch { /* fall through to the empty fallback */ }
  res.setHeader("Cache-Control", "public, s-maxage=5");
  res.status(200).json({});
}
