# TODO

> Ordered **by importance** on 2026-09-02, from the multi-agent audit that produced epic [#184](https://github.com/tsenoner/TennisArc/issues/184) and issues #185–#212. Each open issue carries a matching `P0`–`P3` label on GitHub, so the tracker sorts the same way. Size: S = an evening, M = a few sessions, L = a multi-week track. Importance is not execution order — #184 lists the order (tests + tokens first, so the CSS rewrite has a safety net).

## P0 — correctness bugs, small, do now

- [ ] **#208** `ingest/config.ts` hard-codes 2026 windows → from 2027 every refresh is a silent no-op. Hard deadline: before the AO 2027 draw (~14 Jan). *S*
- [ ] **#185** Flashscore name join fails for two-initial / compound names → those live matches show a 30-min-old score under a pulsing "live" dot. Happening now (US Open). *S*
- [ ] **#189** `WSF1`/`WQF` placeholder teams leak into players; the final's card reads "🏳 WSF1 — WSF2". One regex + read-time guard. *S*
- [ ] **#204** 2019 ATP US Open has 30 mirrored R1 results (Nadal "lost" to Millman, then reaches the final; +1 in 2015 AO, 2022 RG). Fix `enrich` home/away orientation, add an integrity check to the publish path, re-backfill. *M*

## P1 — the core asks: match card, phones, links, search, Elo honesty

- [ ] **#187** Google-style scoreboard card (two player rows, per-set columns, tiebreak superscripts, live points, serve dot, stats table inside the card) replacing strip + Details — with **#68**'s dock so the wheel never shrinks. *L*
- [ ] **#199** Playwright e2e + screenshot suite — do before any CSS rewrite. *M*
- [ ] **#190** One design-token source (app.css / color.ts / index.html / theme.ts / manifest). *M*
- [ ] **#196** Phone layout mode: section view + pager + list fallback, reclaim the dead bands, live-now rail, native pinch. *L*
- [ ] **#194** Wheel labels: device-aware size floors (today 4.7 px on a phone), no ellipsis / mid-word splits, axis collisions, sched-tag tiers, proper surnames. *M*
- [ ] **#195** Round-depth filter `?from=r32` (default on phones); settle the ring/arc grammar first. *M*
- [ ] **#186** Flashscore + SofaScore links in the card, player-page links. *S* (after #185)
- [ ] **#197** Player search (name / country / seed → reveal path + latest match). *M*
- [ ] **#198** `?p=` / `?match=` route params so a pinned player or match is shareable. *S*
- [ ] **#203** Elo freshness contract: live slam = TA weekly board, past slams = frozen replay, 2026 mixes both; label it and pick one semantics. *M*
- [ ] **#209** Say when data is degraded (silent Flashscore failure, silent seed fallback that redirects a US Open link to Wimbledon, "updated 1219h ago"). *M*
- [ ] **#67** Mobile checklist (touch targets, strip layout shift, landscape) — extended by the audit comment. *M*

## P2 — next: visual system, data polish, ops, tour expansion groundwork

- [ ] **#191** Colour semantics + WCAG contrast (light theme fails AA in several places). *M*
- [ ] **#192** Lens colour scales per theme (heat ramp through grey, seed bands invisible, country wheel = page). *M*
- [ ] **#193** Shared component primitives (buttons, cards, chips, icons, 44 px targets). *M*
- [ ] **#188** Retirements / walkovers marked in the card. *S*
- [ ] **#205** 27 snapshots name rounds "1/32 · 1/16 · 1/8". *S*
- [ ] **#206** Entry-type + country gaps in 14 / 2009–2011 snapshots (prerequisite for #1 / #2). *M*
- [ ] **#207** Refresh ops: healthcheck channel + slam-window gating (110 auto-issues), partial-failure exit codes, force-with-lease publish, dead `refresh.yml`. *M*
- [ ] **#65** WTA Elo replay silently disabled by the Sackmann 404 (audit comment). *M*
- [ ] **#211** Split `app.ts` / `render.ts` along their seams, derive per-draw data once — before #1 / #3 grow them. *M*
- [ ] **#3** More tournaments (umbrella; data-model spec in the audit comment) → **#200** event registry *S*, **#201** manifest v3 + season navigator *L*, **#202** multi-event ingest scheduler *L*.
- [ ] **#28** Own Elo engine — the prerequisite for per-match Elo (id bridge first, see comment). *L*
- [ ] **#2** Entry-type badges (Q / WC / LL / seeded). *S* (after #206)
- [ ] **#210** Docs drift: HELP.md stale since June, README / TODO / RESEARCH, attribution, LICENSE. *S*
- [ ] **#66** PWA phase-2 removal (trigger has passed). *S*

## P3 — backlog

- [ ] **#212** Repo hygiene: linter, split tsconfig, research code out of `ingest/`, escapeHtml bypasses, 0.8 MB flags. *M*
- [ ] **#1** Qualifying rounds (model + geometry proposal in the audit comment; needs #206, #195). *L*
- [ ] **#4** Historic data views (shares `players.json` with #197 phase 2). *L*
- [ ] **#5** Keyboard / screen-reader bracket · **#22** phone sheet focus containment · **#43** live-transition announcements. *M*
- [ ] **#56** UTR ranking (open question). *?*
- [ ] **#26 #27 #29** own data pipeline / points engine / DB restructuring. *L*
- [ ] **#31 #32 #33 #34 #35 #36** Elo / points-engine follow-ups from #25. *S–M*

---

## Background — data refresh runner (unchanged; the scheduler + alerting work is now #202 / #207)

### [BACKGROUND IDEA] Data refresh → move off the Mac to an always-on residential runner

> **Status 2026-06-12: backgrounded, not planned.** Historical slams (2009–2026) are now
> pre-fetched and static, so the runner only matters for live freshness during the ~8 slam
> weeks/year while the Mac is closed. Mitigation instead of new hardware: a daily GitHub
> Action backfilling results/durations from Jeff Sackmann's CSVs (datacenter-friendly).
> Revisit the Pi only if slam-week staleness actually hurts in practice.
>
> **On-the-fly fetching from Vercel was probed and is non-viable (2026-06-12):** a deployed
> probe function got HTTP 403 (server: Varnish, no cf-ray) from SofaScore on the API hosts
> AND the plain homepage. The same plain `fetch` also 403s from a residential IP — the edge
> fingerprints the client, so only a real browser session passes, and a real headless browser
> from datacenter IPs is also blocked (GitHub Actions / CF Workers, tested earlier). Client-side
> fetching from visitors' browsers fails on CORS + the x-requested-with token gate. Don't retest.
>
> **ESPN's unofficial API IS datacenter-accessible (probed from a Vercel function 2026-06-12:
> HTTP 200, full payload).** `site.api.espn.com/apis/site/v2/sports/tennis/{atp,wta}/scoreboard`
> exposes per-tournament groupings with every match (round, status, competitors, winner,
> linescores, wasSuspended) — enough to build live slam draws from a cloud cron, killing the
> residential-IP requirement entirely. Caveats: unofficial/undocumented (could change without
> notice), date-keyed (assemble the draw by iterating ?dates=YYYYMMDD over the fortnight), and
> NO per-match duration field — durations would stay SofaScore-live (Mac, opportunistic) and/or
> Sackmann (days later). Next natural test window: Wimbledon (starts ~2026-06-29) — verify the
> slam appears with full 128-draw groupings before building an ingest path on it.

The SofaScore ingest must run from a **residential IP** — datacenter IPs (GitHub Actions, Cloudflare Workers/Pages) get a Cloudflare `403`, even with a real headless browser. For now it runs on the Mac via a `launchd` agent (`~/Library/LaunchAgents/com.tennisarc.refresh.plist`, every 1800s), which only refreshes while the Mac is awake and logged in.

Since 2026-06-11 the agent runs `~/Library/Application Support/TennisArc/run-refresh.sh` (a snapshot of `scripts/refresh-runner.sh` — re-copy if that file changes), which syncs a **dedicated clone** at `~/Library/Application Support/TennisArc/refresh` to `origin/main` and publishes from there. The dev checkout is never touched by the cron, and merges to `main` take effect on the next cycle with no manual `git pull`.

The remaining fix is a cheap always-on box on the home network. **Nothing in the app or the repo changes** — the Pi installs the same `scripts/refresh-runner.sh` (systemd instead of launchd), force-pushes the same `data` branch, and the live site keeps reading `VITE_DATA_BASE_URL` as it does today. This is purely a swap of *where the cron lives*.

- [ ] Acquire hardware (Raspberry Pi 4/5, see below).
- [ ] Provision OS + clone repo + install deps (runbook below).
- [ ] Install the systemd timer (or crontab) so it refreshes every 30 min, headless, across reboots.
- [ ] Verify a real `data`-branch push lands from the Pi, then **cut over** (disable the Mac `launchd` agent so there's a single writer).

---

### Raspberry Pi runbook (copy-paste when the hardware arrives)

**Hardware / OS**
- **Raspberry Pi 4 or 5, 4 GB RAM recommended** (headless Chromium + Node is RAM-hungry; 2 GB is the floor). An SSD over USB beats a microSD for longevity, but a 32 GB+ card is fine.
- **64-bit OS is required** — Playwright ships no 32-bit Chromium. Use **Raspberry Pi OS (64-bit) Lite** (no desktop needed) or **Ubuntu Server 24.04 arm64**.
- Enable SSH in Raspberry Pi Imager so you can run everything headless.

**1. Base packages + Node 22 LTS + pnpm**
```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y git ca-certificates curl
# Node 22 LTS, system-wide (cleaner than nvm for cron/systemd contexts)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo corepack enable          # provides pnpm
corepack prepare pnpm@latest --activate
node -v && pnpm -v            # sanity check
```

**2. GitHub CLI (for HTTPS push auth — matches `publish-data.sh`)**
```bash
sudo apt install -y gh
gh auth login                 # choose GitHub.com → HTTPS → "Login with a web browser":
                              #   it prints a one-time code; open github.com/login/device
                              #   on your phone/laptop and paste it (no browser needed on the Pi)
gh auth setup-git             # makes git use the gh token for HTTPS pushes
```
> `scripts/publish-data.sh` pushes to the **HTTPS** remote `https://github.com/tsenoner/TennisArc.git` precisely so this token-based helper works in a headless/no-SSH-agent context. Don't switch it to SSH.

**3. Clone + install + browser**
```bash
git clone https://github.com/tsenoner/TennisArc.git ~/TennisArc
cd ~/TennisArc
pnpm install --frozen-lockfile
# Playwright's bundled Chromium (arm64 build) + its system libs:
pnpm exec playwright install --with-deps chromium
```
> **ARM gotcha:** `--with-deps` shells out to `apt` and may warn that Raspberry Pi OS isn't a recognized distro. If the bundled Chromium then fails to launch, fall back to the distro browser: `sudo apt install -y chromium`, then in `ingest/sofascore.ts` change the launch to
> `chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH })`
> and export `CHROMIUM_PATH=/usr/bin/chromium` in the service env (step 4). Test before wiring the timer: `SLAM=wimbledon pnpm ingest` should write `public/data/slams/{year}/atp-wimbledon.json` + `wta-wimbledon.json`.

**4. Schedule it — systemd timer (recommended; mirrors the Mac launchd agent)**

A user-level service + timer, with **lingering enabled** so it runs without an active login (essential for a headless box).

`~/.config/systemd/user/tennisarc-refresh.service`:
```ini
[Unit]
Description=TennisArc data refresh (ingest SofaScore → push data branch)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=%h/TennisArc
# corepack puts pnpm shims under /usr/bin; add %h/.local/bin just in case.
Environment=PATH=/usr/local/bin:/usr/bin:/bin:%h/.local/bin
# Uncomment if you took the system-Chromium fallback in step 3:
# Environment=CHROMIUM_PATH=/usr/bin/chromium
ExecStart=%h/TennisArc/scripts/publish-data.sh
```

`~/.config/systemd/user/tennisarc-refresh.timer`:
```ini
[Unit]
Description=Run TennisArc data refresh every 30 min

[Timer]
OnBootSec=2min
OnUnitActiveSec=30min
Persistent=true

[Install]
WantedBy=timers.target
```

Enable it:
```bash
sudo loginctl enable-linger "$USER"          # run user services without an active session
systemctl --user daemon-reload
systemctl --user enable --now tennisarc-refresh.timer
systemctl --user start tennisarc-refresh.service   # run once now to verify
journalctl --user -u tennisarc-refresh -f          # watch the logs
systemctl --user list-timers tennisarc-refresh     # confirm next run
```

**Alternative — plain crontab** (simpler, less observable). cron has a bare environment, so a tiny wrapper sets PATH and logs:
```bash
cat > ~/TennisArc/scripts/cron-refresh.sh <<'EOF'
#!/usr/bin/env bash
export PATH=/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin
# export CHROMIUM_PATH=/usr/bin/chromium   # if using the system-Chromium fallback
cd "$HOME/TennisArc" && exec scripts/publish-data.sh
EOF
chmod +x ~/TennisArc/scripts/cron-refresh.sh
( crontab -l 2>/dev/null; echo "*/30 * * * * $HOME/TennisArc/scripts/cron-refresh.sh >> $HOME/tennisarc-refresh.log 2>&1" ) | crontab -
```

**5. Verify, then cut over**
- Confirm a real push from the Pi: `git ls-remote https://github.com/tsenoner/TennisArc.git data` should show a fresh commit, and the Pi's log should say `published data branch`. The Vercel `data`-branch deploy stays disabled (handled by `vercel.json` on both `main` and the data branch — don't touch).
- Once the Pi is proven, **stop the Mac agent** so there's a single writer (two force-pushers racing is harmless — each is a full replace, last-wins — but redundant):
  ```bash
  # on the Mac:
  launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.tennisarc.refresh.plist
  ```
  Re-enable later with `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.tennisarc.refresh.plist` if you retire the Pi.

**Maintenance**
- `git -C ~/TennisArc pull` after app changes that touch `ingest/`, then `pnpm install --frozen-lockfile` if deps changed.
- Annual: bump the per-slam `from` dates + `unitournament` ids in `ingest/config.ts` (they're 2026 values).

---

### Alternative to the home box: residential/mobile proxy

- [ ] A residential or mobile proxy wired into `ingest/sofascore.ts` (Playwright `launch({ proxy: { server, username, password } })`) would let the existing **manual** GitHub Actions workflow — or a Cloudflare Worker — ingest from anywhere (~$1–5/mo). Trades the Pi's one-time cost + home-network dependency for a recurring proxy bill and an extra failure point. Only worth it if a home runner isn't viable.

---
