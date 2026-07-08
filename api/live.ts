import type { VercelRequest, VercelResponse } from "@vercel/node";

// TEMPORARY egress probe — replaced by the real handler in Task 4. Proves Flashscore answers from
// Vercel's egress IP before we invest in the parser/join/client.
const FEED = "https://global.flashscore.ninja/2/x/feed/f_2_0_3_en_1";
const X_FSIGN = "SW9D1eZo";
const UA = "TennisArc/1.0 (+https://tennisarc.vercel.app)";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const r = await fetch(FEED, { headers: { "x-fsign": X_FSIGN, "user-agent": UA } });
    const body = await r.text();
    const recs = body.split("~").filter((s) => s.startsWith("AA÷"));
    const live = recs.filter((s) => s.split("¬").some((p) => p === "AB÷2"));
    res.status(200).json({
      upstreamStatus: r.status,
      bytes: body.length,
      liveCount: live.length,
      hasWimbledon: body.includes("Wimbledon"),
      sample: live.slice(0, 5).map((s) => {
        const d: Record<string, string> = {};
        for (const p of s.split("¬")) { const i = p.indexOf("÷"); if (i > 0) d[p.slice(0, i)] = p.slice(i + 1); }
        return `${d.AE ?? "?"} v ${d.AF ?? "?"}`;
      }),
    });
  } catch (e) {
    res.status(502).json({ error: String((e as Error)?.message ?? e) });
  }
}
