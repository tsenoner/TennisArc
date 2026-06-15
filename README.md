# TennisArc

A live, offline-first **radial bracket** PWA for tennis Grand Slams (ATP + WTA singles) — a zoomable sunburst of the draw, coloured by cumulative time on court, with seed projections, a time-on-court leaderboard, and tap-to-open match detail that deep-links to SofaScore.

Built with **Vite + TypeScript (vanilla DOM) + vite-plugin-pwa**; data ingested from SofaScore via headless Chromium. **Live: https://tennisarc.vercel.app**

## Develop

```bash
pnpm install
pnpm dev          # http://localhost:5173  (serves the committed /data seed)
pnpm test         # vitest (TZ=UTC pinned)
pnpm typecheck    # tsc --noEmit
pnpm build        # tsc --noEmit && vite build → dist/
pnpm preview      # serve dist/ (exercises the service worker)
```

The app reads the committed seed under `public/data/` — `index.json` (manifest) plus one snapshot per slam at `slams/{year}/{tour}-{slam}.json` — and works fully offline once installed (service-worker precache + IndexedDB cache). A permanent rewrite in `vercel.json` maps the pre-reorg flat paths (`/data/{tour}-{year}-{slam}.json`) onto the nested layout so clients running a not-yet-updated service worker never 404.

## Data ingestion

```bash
pnpm ingest       # headless Chromium → SofaScore → public/data/slams/{year}/{tour}-{slam}.json
pnpm reindex      # rebuild public/data/index.json from the snapshots on disk (no network)
```

`ingest/` only fetches while a Slam is actually in progress (`activeSlam()` in `ingest/config.ts` — the slam whose active window `[from, to)` contains now). Between tournaments the bracket is frozen, so the ingest exits immediately *before* launching a browser and pushes nothing; the `data` branch keeps the last Slam's final state. When a window is open it pulls the SofaScore `cuptrees` bracket + per-match detail/stats from a Cloudflare-cleared browser context, normalizes to the `Snapshot` model (`src/model.ts`), and writes static JSON. It auto-switches to the next Slam when that slam's draw is released (no edit needed), and keeps the previous one until the new full draw is available. Force a specific slam regardless of the window with `SLAM=wimbledon pnpm ingest`. Update the per-slam `from`/`to` dates + ids in `config.ts` when rolling to a new year.

Backfill past editions with `BACKFILL_YEARS=2024,2025 pnpm ingest` (add `BACKFILL_SLAMS=wimbledon` to restrict the slams). `scripts/probe-history.ts` reports how far back SofaScore has usable draws per slam/tour.

Historical Elo is **recomputed** from Jeff Sackmann's full match history and frozen at each slam's start (so a 2016 draw shows 2016 Elo, not today's) via `pnpm backfill-elo` — a surface-aware engine calibrated to reproduce [Tennis Abstract's published board](https://tennisabstract.com/reports/atp_elo_ratings.html). Re-fit the entrant seed against the live board with `npx tsx ingest/calibrate-elo.ts`. The shipped from-scratch engine is a documented-methodology approximation (TA's generation code is unpublished); a later board-replay reverse-engineering reproduces TA to ~3 (ATP) / ~1.4 (WTA) Elo and is byte-exact in clean windows. See [`docs/elo-methodology.md`](docs/elo-methodology.md) (and the corrected [`docs/elo-formula.md`](docs/elo-formula.md) / findings §0 — an engine migration to the board-replay rule is pending).

After any backfill, run `pnpm backfill-durations` (optionally with years: `pnpm backfill-durations 2024 2025`). It re-sources every snapshot's match durations from Jeff Sackmann's CSVs and sanity-bounds the rest — SofaScore's historical `time.periodN` is missing before mid-2014, has whole-event holes, and counts rain/curfew suspensions as play time (`ingest/durations.ts` documents the merge policy). Where the CSVs have a hole (Roland Garros 2022/2024/2025, ATP 2015 Wimbledon + US Open, WTA 2015), plausible SofaScore values are kept.

Known coverage gaps in the committed history: Wimbledon 2020 (cancelled), WTA before 2015 (no usable SofaScore draws), and the **2011 ATP US Open is omitted entirely** — SofaScore's `cuptrees` for that edition is missing a main-draw match, so the full draw can't be assembled and `index.json` simply doesn't list it.

### Refreshing data

SofaScore's API blocks datacenter IPs (Cloudflare 403), so **GitHub-hosted Actions cannot ingest** — the `.github/workflows/refresh.yml` workflow is manual-only and intended for a self-hosted runner with a residential/proxy IP.

To refresh from a residential connection (your machine), run:

```bash
scripts/publish-data.sh   # pnpm ingest → force-push the `data` branch (index.json + slams/ tree)
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

Live draws and scores are reverse-engineered from SofaScore's public endpoints for personal, non-commercial use; the app only links out to SofaScore (it does not re-host their UI). Historical match durations, ELO ratings, and player birthdates come from [Jeff Sackmann / Tennis Abstract](https://www.tennisabstract.com/)'s [tennis_atp](https://github.com/JeffSackmann/tennis_atp) and [tennis_wta](https://github.com/JeffSackmann/tennis_wta) datasets, licensed [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) — the derived JSON published on the `data` branch therefore carries the same licence. Not affiliated with SofaScore, Tennis Abstract, the ATP, WTA, or any tournament.
