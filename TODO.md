# TODO

## [BACKGROUND IDEA] Data refresh → move off the Mac to an always-on residential runner

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

## UX overhaul — follow-ups (tracked as GitHub issues)

The overhaul (write-once labels, centre readout, 3 lens panels, match insight, multi-slam, surface ELO, birthdates) shipped to `main` + production on 2026-06-09. The deferred, non-blocking items the final cross-plan review surfaced are tracked as issues:

- [#5](https://github.com/tsenoner/TennisArc/issues/5) — a11y: keyboard + screen-reader access for the bracket
- [#6](https://github.com/tsenoner/TennisArc/issues/6) — bundle SVG flags (Windows emoji-flag gap)
- [#7](https://github.com/tsenoner/TennisArc/issues/7) — country-lens nation summary in the centre readout
- [#8](https://github.com/tsenoner/TennisArc/issues/8) — guard match insight on projected/TBD arcs
- [#9](https://github.com/tsenoner/TennisArc/issues/9) — retire `Player.ageYears`
- [#10](https://github.com/tsenoner/TennisArc/issues/10) — `slamStatus` "upcoming"
- [#11](https://github.com/tsenoner/TennisArc/issues/11) — small cleanups (deep-link URL escaping, `winProbability` assertions)
