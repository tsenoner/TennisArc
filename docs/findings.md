# Findings & gotchas log — operations, deployment, data-serving

> A running log of non-obvious, cross-cutting findings and footguns hit while operating and
> deploying TennisArc — the kind that quietly cost an afternoon if rediscovered from scratch.
> Deep, issue-scoped investigations keep their own file (e.g.
> [`issue-25-findings.md`](issue-25-findings.md) for the Elo / points reverse-engineering,
> [`data-refresh-ops.md`](data-refresh-ops.md) for the live-refresh runbook); this file is for the
> smaller, standalone traps that don't warrant one. **Newest first.** When you burn time on a
> non-obvious cause, add an entry here.

---

## 2026-07-01 — Deep-link hard reload 404s: `cleanUrls` vs the SPA fallback

**Symptom.** A full page load or shared link to any client route — e.g.
`https://tennisarc.vercel.app/atp/2026/wimbledon` — returned Vercel's edge `404: NOT_FOUND`
(`x-vercel-error: NOT_FOUND`), before the app ever ran. Soft, in-app navigation to the same route
worked fine. Not route-specific: `/foobar` and every non-file path 404'd identically; only `/`
(the real file) served.

**Root cause.** `vercel.json` set `"cleanUrls": true` **and** a catch-all SPA fallback rewrite with
destination `/index.html`. `cleanUrls` turns `/index.html` into a 308 redirect to `/` — it is no
longer a servable path — so the fallback pointed every virtual path at a non-servable target and
fell through to the platform 404. Vercel's own SPA docs use `destination: "/index.html"`, but
*without* `cleanUrls`; the **combination** is the footgun. Soft nav hid it because the client router
resolves those paths itself and never asks Vercel.

**Fix.** `vercel.json` rewrite destination `"/index.html"` → `"/"` (the path `cleanUrls` serves the
index at). Commit `13db0e7`. Verified live: deep links now return the app shell (200) and the app
boots end-to-end.

> **Gotcha.** Keep the catch-all rewrite destination `"/"` while `cleanUrls` is on. If anyone
> "tidies" it back to `/index.html`, deep-link hard reloads 404 again. Real static files and hashed
> assets are unaffected — Vercel checks the filesystem *before* applying rewrites, so only paths with
> no matching file reach the fallback.

## 2026-07-01 — "Is the live data deployed?" — probe the `data` branch, not the origin seed

**Symptom.** While verifying the fix above, `curl https://tennisarc.vercel.app/data/index.json` and
`.../data/slams/2026/atp-wimbledon.json` returned a mid-June manifest with no Wimbledon 2026 (and
HTML for the missing slam file) — which *looked* like "live data isn't deployed," even though the
running site was showing a fresh, live Wimbledon draw. That contradiction was a false alarm.

**Root cause.** The origin's `/data/` is only the committed **fallback seed** (`public/data/`, which
is stale by design). The deployed app fetches `${VITE_DATA_BASE_URL}/${file}` **first**
(`VITE_DATA_BASE_URL = https://raw.githubusercontent.com/tsenoner/TennisArc/data`, the branch the
30-min refresh force-pushes) and only falls back to same-origin `/data/` if the base URL is unset or
that fetch fails — see `fetchData` in [`../src/api.ts`](../src/api.ts). So probing the Vercel origin
inspects the wrong source.

> **Gotcha.** To check whether live data is fresh, curl the **`data` branch**, not the app origin:
> ```bash
> curl -s https://raw.githubusercontent.com/tsenoner/TennisArc/data/index.json | jq '.generatedAt'
> curl -sI https://raw.githubusercontent.com/tsenoner/TennisArc/data/slams/2026/atp-wimbledon.json
> ```
> A slam absent from the origin seed returning HTML/404 at `tennisarc.vercel.app/data/...` is
> expected and harmless. Topology and the `VITE_DATA_BASE_URL` wiring: [`data-refresh-ops.md`](data-refresh-ops.md)
> ("Does it show on the site?").
