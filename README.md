# TennisArc

A live, offline-first **radial bracket** PWA for tennis Grand Slams (ATP + WTA singles) — a zoomable sunburst of the draw, coloured by cumulative time on court, with seed projections, a time-on-court leaderboard, and tap-to-open match detail that deep-links to SofaScore.

Built with **Vite + TypeScript (vanilla DOM) + vite-plugin-pwa**; data ingested from SofaScore via headless Chromium and refreshed by a free GitHub Actions cron.

## Develop

```bash
pnpm install
pnpm dev          # http://localhost:5173  (fetches /data/{atp,wta}.json)
pnpm test         # vitest (TZ=UTC pinned)
pnpm typecheck    # tsc --noEmit
pnpm build        # tsc --noEmit && vite build → dist/
pnpm preview      # serve dist/ (exercises the service worker)
```

The app reads `public/data/{atp,wta}.json` (committed real Roland Garros 2026 seed data) and works fully offline once installed (service-worker precache + IndexedDB cache).

## Data ingestion

```bash
pnpm ingest       # headless Chromium → SofaScore → public/data/{atp,wta}.json
```

`ingest/` resolves the target Slam from `ingest/config.ts` (`CURRENT_SLAM`), pulls the SofaScore `cuptrees` bracket + per-match detail/stats from a Cloudflare-cleared browser context, normalizes to the `Snapshot` model (`src/model.ts`), and writes static JSON. Switch the tracked tournament by changing `CURRENT_SLAM` (season ids auto-resolve).

### Auto-refresh

`.github/workflows/refresh.yml` runs `pnpm ingest` on a cron (every 30 min) and force-pushes the JSON to a dedicated **`data` branch** (clean, files at root). The app fetches fresh data from that branch when `VITE_DATA_BASE_URL` is set, falling back to the committed same-origin seed otherwise.

## Deploy (Vercel)

1. Push the repo to GitHub (`gh repo create TennisArc --public --source=. --push`).
2. Import the repo in Vercel (auto-detects Vite).
3. Set the env var `VITE_DATA_BASE_URL` = `https://raw.githubusercontent.com/<user>/TennisArc/data` so the app reads the cron-refreshed `data` branch.
4. The GitHub Actions cron (or a manual "Run workflow") publishes the `data` branch; the app then shows live data and "updated N min ago".

## Architecture

`model.ts` (types) → `state.ts` (bracket tree, time-on-court, projections) → `layout.ts` (d3 radial partition) → `color.ts` (swappable scales) → `render.ts` (SVG/HTML strings) → `app.ts` (offline-first loop). `store.ts` (idb-keyval) + `api.ts` (fetch) feed the loop; `ingest/` produces the data. Design docs in `docs/superpowers/`.

## Data source & licence

Data is reverse-engineered from SofaScore's public endpoints for personal, non-commercial use; the app only links out to SofaScore (it does not re-host their UI). Not affiliated with SofaScore, the ATP, WTA, or any tournament.
