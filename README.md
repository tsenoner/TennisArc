# TennisArc

A live, offline-first **radial bracket** PWA for tennis Grand Slams (ATP + WTA singles) — a zoomable sunburst of the draw, coloured by cumulative time on court, with seed projections, a time-on-court leaderboard, and tap-to-open match detail that deep-links to SofaScore.

Built with **Vite + TypeScript (vanilla DOM) + vite-plugin-pwa**; data ingested from SofaScore via headless Chromium. **Live: https://tennisarc.vercel.app**

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

`ingest/` only fetches while a Slam is actually in progress (`activeSlam()` in `ingest/config.ts` — the slam whose active window `[from, to)` contains now). Between tournaments the bracket is frozen, so the ingest exits immediately *before* launching a browser and pushes nothing; the `data` branch keeps the last Slam's final state. When a window is open it pulls the SofaScore `cuptrees` bracket + per-match detail/stats from a Cloudflare-cleared browser context, normalizes to the `Snapshot` model (`src/model.ts`), and writes static JSON. It auto-switches to the next Slam when that slam's draw is released (no edit needed), and keeps the previous one until the new full draw is available. Force a specific slam regardless of the window with `SLAM=wimbledon pnpm ingest`. Update the per-slam `from`/`to` dates + ids in `config.ts` when rolling to a new year.

### Refreshing data

SofaScore's API blocks datacenter IPs (Cloudflare 403), so **GitHub-hosted Actions cannot ingest** — the `.github/workflows/refresh.yml` workflow is manual-only and intended for a self-hosted runner with a residential/proxy IP.

To refresh from a residential connection (your machine), run:

```bash
scripts/publish-data.sh   # pnpm ingest → force-push the `data` branch (files at root)
```

Schedule it via `launchd`/`cron` while your machine is online. The deployed app reads the `data` branch when `VITE_DATA_BASE_URL` is set, and always falls back to the committed same-origin seed in `public/data/`.

## Deploy (Vercel)

**Live:** https://tennisarc.vercel.app — Vercel (Vite preset, output `dist/`), serving the committed real Roland Garros 2026 data, installable + offline-capable. Redeploy after changes with `vercel deploy --prod`.

Optional follow-ups:

- **Auto-deploy on push:** install the Vercel GitHub App on `tsenoner/TennisArc` (Vercel → project → Settings → Git) so pushes to `main` deploy automatically. Until then deploys are manual (`vercel deploy --prod`).
- **Live data:** the site ships with the committed real RG 2026 seed in `public/data/`. To serve refreshed data, run `scripts/publish-data.sh` from a residential IP (see "Refreshing data") to populate the `data` branch, then set the Vercel env var `VITE_DATA_BASE_URL=https://raw.githubusercontent.com/tsenoner/TennisArc/data`. The app prefers that branch and falls back to the seed if it's missing.

## Architecture

`model.ts` (types) → `state.ts` (bracket tree, time-on-court, projections) → `layout.ts` (d3 radial partition) → `color.ts` (swappable scales) → `render.ts` (SVG/HTML strings) → `app.ts` (offline-first loop). `store.ts` (idb-keyval) + `api.ts` (fetch) feed the loop; `ingest/` produces the data. Design docs in `docs/superpowers/`.

## Data source & licence

Data is reverse-engineered from SofaScore's public endpoints for personal, non-commercial use; the app only links out to SofaScore (it does not re-host their UI). Not affiliated with SofaScore, the ATP, WTA, or any tournament.
