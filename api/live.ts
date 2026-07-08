import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Tour } from "../src/model";
import { parseLiveFeed } from "../ingest/flashscore";

const FEED = "https://global.flashscore.ninja/2/x/feed/f_2_0_3_en_1";
const X_FSIGN = "SW9D1eZo";
const UA = "TennisArc/1.0 (+https://tennisarc.vercel.app)";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const tour = String(req.query.tour ?? "").toUpperCase();
  const slam = String(req.query.slam ?? "");
  if ((tour !== "ATP" && tour !== "WTA") || !slam) {
    res.status(400).json({ error: "tour (atp|wta) and slam are required" });
    return;
  }
  try {
    const r = await fetch(FEED, { headers: { "x-fsign": X_FSIGN, "user-agent": UA } });
    if (!r.ok) {
      res.setHeader("Cache-Control", "public, s-maxage=10");
      res.status(200).json({ matches: [] });
      return;
    }
    const body = await r.text();
    res.setHeader("Cache-Control", "public, s-maxage=25, stale-while-revalidate=60");
    res.status(200).json({ matches: parseLiveFeed(body, { tour: tour as Tour, slam }) });
  } catch {
    res.setHeader("Cache-Control", "public, s-maxage=10");
    res.status(200).json({ matches: [] });
  }
}
