# TennisArc

A live **radial bracket** web app for tennis Grand Slams (ATP + WTA singles) — a zoomable sunburst of the draw, coloured by cumulative time on court, with seed projections, a time-on-court leaderboard, and tap-to-open match detail that deep-links to SofaScore.

Built with **Vite + TypeScript (vanilla DOM) + vite-plugin-pwa**; data ingested from SofaScore via headless Chromium. **Live: https://tennisarc.vercel.app**

## Develop

```bash
pnpm install
pnpm dev          # http://localhost:5173  (serves the committed /data seed)
pnpm test         # vitest (TZ=UTC pinned)
pnpm typecheck    # tsc --noEmit
pnpm build        # tsc --noEmit && vite build → dist/
pnpm preview      # serve dist/
```

The app reads the committed seed under `public/data/` — `index.json` (manifest) plus one snapshot per slam at `slams/{year}/{tour}-{slam}.json` — and refetches it live (90 s polling while a slam is in play). A permanent rewrite in `vercel.json` maps the pre-reorg flat paths (`/data/{tour}-{year}-{slam}.json`) onto the nested layout so clients running the old (now self-destroying) service worker never 404.

## Data ingestion

```bash
pnpm ingest       # headless Chromium → SofaScore → public/data/slams/{year}/{tour}-{slam}.json
pnpm reindex      # rebuild public/data/index.json from the snapshots on disk (no network)
```

`ingest/` only fetches while a Slam is actually in progress (`activeSlam()` in `ingest/config.ts` — the slam whose active window `[from, to)` contains now). Between tournaments the bracket is frozen, so the ingest exits immediately *before* launching a browser and pushes nothing; the `data` branch keeps the last Slam's final state. When a window is open it pulls the SofaScore `cuptrees` bracket + per-match detail/stats from a Cloudflare-cleared browser context, normalizes to the `Snapshot` model (`src/model.ts`), and writes static JSON. It auto-switches to the next Slam when that slam's draw is released (no edit needed), and keeps the previous one until the new full draw is available. Force a specific slam regardless of the window with `SLAM=wimbledon pnpm ingest`. Update the per-slam `from`/`to` dates + ids in `config.ts` when rolling to a new year.

Backfill past editions with `BACKFILL_YEARS=2024,2025 pnpm ingest` (add `BACKFILL_SLAMS=wimbledon` to restrict the slams). `scripts/probe-history.ts` reports how far back SofaScore has usable draws per slam/tour.

Historical Elo is **recomputed** from Jeff Sackmann's full match history and frozen at each slam's start (so a 2016 draw shows 2016 Elo, not today's) via `pnpm backfill-elo` — a surface-aware engine calibrated to reproduce [Tennis Abstract's published board](https://tennisabstract.com/reports/atp_elo_ratings.html). Re-fit the entrant seed against the live board with `npx tsx ingest/calibrate-elo.ts`. The shipped from-scratch engine is a documented-methodology approximation (TA's generation code is unpublished); a later board-replay reverse-engineering reproduces TA to ~3 (ATP) / ~1.4 (WTA) Elo and is byte-exact in clean windows. **The canonical summary of all the Elo / yElo / ranking-points / W-L reverse-engineering findings (issue #25) is [`docs/issue-25-findings.md`](docs/issue-25-findings.md)** (the per-topic working logs under `docs/` remain as the detailed audit trail; an engine migration to the board-replay rule is pending).

After any backfill, run `pnpm backfill-durations` (optionally with years: `pnpm backfill-durations 2024 2025`). It re-sources every snapshot's match durations from the Sackmann-schema match CSVs (ATP via the TML mirror while Sackmann's repos are 404 — see the data-source note; provider routing lives in `ingest/sources.ts`) and sanity-bounds the rest — SofaScore's historical `time.periodN` is missing before mid-2014, has whole-event holes, and counts rain/curfew suspensions as play time (`ingest/durations.ts` documents the merge policy). Where the CSVs have a hole (Roland Garros 2022/2024/2025, ATP 2015 Wimbledon + US Open, WTA 2015), plausible SofaScore values are kept.

Known coverage gaps in the committed history: Wimbledon 2020 (cancelled), WTA before 2015 (no usable SofaScore draws), and the **2011 ATP US Open is omitted entirely** — SofaScore's `cuptrees` for that edition is missing a main-draw match, so the full draw can't be assembled and `index.json` simply doesn't list it.

### Refreshing data

SofaScore's API blocks datacenter IPs (Cloudflare 403), so **GitHub-hosted Actions cannot ingest** — the `.github/workflows/refresh.yml` workflow is manual-only and intended for a self-hosted runner with a residential/proxy IP.

To refresh from a residential connection (your machine), run:

```bash
scripts/publish-data.sh   # pnpm ingest → force-push the `data` branch (index.json + slams/ tree)
```

Schedule it via `launchd`/`cron` while your machine is online. The deployed app reads the `data` branch when `VITE_DATA_BASE_URL` is set, and always falls back to the committed same-origin seed in `public/data/`.

The live scheduler setup (launchd label, snapshot path, logs), its failure modes — a hung Playwright run wedges the whole schedule because launchd never overlaps runs — and a step-by-step "is it healthy / how to unstick it" runbook are in [`docs/data-refresh-ops.md`](docs/data-refresh-ops.md). `scripts/refresh-runner.sh` wraps the publish under a watchdog timeout so a stuck browser can no longer block every future tick.

## Deploy (Vercel)

**Live:** https://tennisarc.vercel.app — Vercel (Vite preset, output `dist/`), serving the committed real Roland Garros 2026 data, installable (the offline layer was removed 2026-07; a self-destroying service worker cleans up old installs). Redeploy after changes with `vercel deploy --prod`.

Optional follow-ups:

- **Auto-deploy on push:** install the Vercel GitHub App on `tsenoner/TennisArc` (Vercel → project → Settings → Git) so pushes to `main` deploy automatically. Until then deploys are manual (`vercel deploy --prod`).
- **Live data:** the site ships with the committed real RG 2026 seed in `public/data/`. To serve refreshed data, run `scripts/publish-data.sh` from a residential IP (see "Refreshing data") to populate the `data` branch, then set the Vercel env var `VITE_DATA_BASE_URL=https://raw.githubusercontent.com/tsenoner/TennisArc/data`. The app prefers that branch and falls back to the seed if it's missing.

> **Deploy/data gotchas** (routing 404s on hard reload, why probing `tennisarc.vercel.app/data/` shows stale data) are logged in [`docs/findings.md`](docs/findings.md). Add an entry there when a non-obvious cause costs you time.

## Architecture

`model.ts` (types) → `state.ts` (bracket tree, time-on-court, projections) → `layout.ts` (d3 radial partition) → `color.ts` (swappable scales) → `render.ts` (SVG/HTML strings) → `app.ts` (live-first loop). `api.ts` (fetch) feeds the loop; `ingest/` produces the data. Design docs in `docs/superpowers/`.

## Data source & licence

Live draws and scores are reverse-engineered from SofaScore's public endpoints for personal, non-commercial use; the app only links out to SofaScore (it does not re-host their UI). Sub-minute live score/status freshness for the in-play slam is additionally sourced from Flashscore's public live-score feed, fetched by a stateless Vercel function and overlaid on the SofaScore-derived snapshot client-side (personal, non-commercial gap-fill use, not a bulk mirror — see [`docs/data-refresh-ops.md`](docs/data-refresh-ops.md)). Historical match durations, ELO ratings, and player birthdates come from [Jeff Sackmann / Tennis Abstract](https://www.tennisabstract.com/)'s [tennis_atp](https://github.com/JeffSackmann/tennis_atp) and [tennis_wta](https://github.com/JeffSackmann/tennis_wta) datasets, licensed [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) — the derived JSON published on the `data` branch therefore carries the same licence. Since Sackmann's ATP/WTA repos went 404 in mid-2026, ATP player + match data is read from the Sackmann-schema [TML mirror](https://stats.tennismylife.org) (`stats.tennismylife.org`, no explicit reuse licence — de-minimis non-commercial factual use only); WTA has no mirror and its birthdates degrade to null until `tennis_wta` returns (per-tour routing in `ingest/sources.ts`). Not affiliated with SofaScore, Flashscore, Tennis Abstract, TML, the ATP, WTA, or any tournament.
