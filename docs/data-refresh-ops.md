# Data refresh ops — the live 30-min SofaScore pull

> Operational runbook for the residential-IP data refresh: how it's wired, how it can wedge, and
> how to tell what's going on without guessing. Companion to the README "Refreshing data" section
> (the *why* — Cloudflare blocks datacenter IPs) and `scripts/refresh-runner.sh` / `scripts/publish-data.sh`
> (the *what*). This doc is the *where it runs and how to unstick it*.

## The chain

SofaScore's API 403s datacenter IPs (Cloudflare), so the refresh **cannot** run on GitHub-hosted
Actions or Vercel — it runs on a residential machine. Today that's the author's Mac via a launchd
agent; later it moves to an always-on Raspberry Pi via a systemd timer (`refresh-runner.sh` is
written for both).

```
launchd (com.tennisarc.refresh, every 1800s)
  └─ /bin/bash -lc 'exec "$HOME/Library/Application Support/TennisArc/run-refresh.sh"'   ← a SNAPSHOT copy
       └─ syncs the dedicated clone ~/Library/Application Support/TennisArc/refresh to origin/main
            └─ scripts/publish-data.sh   (ingest → carry-forward → durations → reindex → force-push)
                 └─ pnpm ingest → headless Chromium → SofaScore
                      └─ force-push the `data` branch  →  Vercel app reads it (when VITE_DATA_BASE_URL is set)
```

## Where it lives (Mac)

| Thing | Path / value |
| --- | --- |
| launchd label | `com.tennisarc.refresh` |
| plist | `~/Library/LaunchAgents/com.tennisarc.refresh.plist` |
| interval | `StartInterval = 1800` (30 min), `RunAtLoad = true` |
| **what launchd runs** | `~/Library/Application Support/TennisArc/run-refresh.sh` (a **snapshot**, NOT the repo file) |
| source of truth | `scripts/refresh-runner.sh` in this repo |
| dedicated clone | `~/Library/Application Support/TennisArc/refresh` |
| log | `~/Library/Logs/tennisarc-refresh.log` |

> **Gotcha — the runner is a snapshot.** launchd executes the copy under `~/Library/Application Support/`,
> not `scripts/refresh-runner.sh`. After editing the repo script you **must re-copy** it or the change
> never takes effect:
> ```bash
> cp scripts/refresh-runner.sh "$HOME/Library/Application Support/TennisArc/run-refresh.sh"
> ```
> (The clone *is* reset to `origin/main` each run, so `publish-data.sh` and the rest of the repo are
> always fresh — only the outer runner wrapper is a manual snapshot, on purpose: it must survive the
> clone being reset/cleaned.)

## The failure mode: one hung run wedges the whole schedule

**launchd (and systemd) never overlap two runs of the same job.** If a run is still alive when the
next interval fires, that tick is silently skipped. So a single stuck run blocks **every** future
tick until it's killed — nothing publishes, the `data` branch freezes, and there is no error: the
job just looks "running."

The realistic way this happens: `pnpm ingest` launches headless Chromium, a SofaScore navigation
hangs, and the 60s `page.goto` timeout doesn't fire (or its teardown also blocks). The run sits
there indefinitely.

### The guard (added after the 2026-06 incident)

`scripts/refresh-runner.sh` now runs `publish-data.sh` under a hard timeout
(`TENNISARC_TIMEOUT`, default **1200s / 20 min**). On timeout it **walks the PID tree** and
SIGTERM-then-SIGKILLs every descendant, so each cycle is self-clearing.

Why a tree-walk and not GNU `timeout`/`gtimeout` (which signal a process group)? The headless
`chrome-headless-shell` child **opens its own session** (it shows as state `Ss` in `ps`), so a
process-group kill misses it and leaks orphaned Chromium. The watchdog snapshots the full
descendant set *before* killing, so reparenting after the first kill can't strand a grandchild.
(`gtimeout` also isn't installed on the Mac, and this approach needs zero extra deps — it works
as-is on the Pi too.)

### The dead-man ping (added 2026-07-10)

The watchdog bounds a *single* stuck run, but a schedule that stops entirely (agent unloaded,
laptop asleep for days, repeated failures) is invisible unless someone looks. The runner therefore
reports each cycle to a [healthchecks.io](https://healthchecks.io) check when one is configured:
success pings the check URL, failure pings `<url>/fail` (immediate alert, no grace-period wait).
Ping failures never fail the run.

Setup: create a check (schedule: every 30 min, grace ≥ 45 min — a full slam-day ingest can run
long) and put its ping URL in **one** of:

- the file `~/Library/Application Support/TennisArc/healthcheck-url` (one line; preferred — the
  URL is semi-secret and must stay out of the repo), or
- the `TENNISARC_HEALTHCHECK_URL` env var in the launchd plist / systemd unit.

No URL configured → the runner behaves exactly as before. Remember the runner executes as a
**snapshot** — re-copy after changing `scripts/refresh-runner.sh` (see below).

## Runbook — is it healthy, and how to unstick it

```bash
# 1. Is the agent loaded? Is a run alive right now, and what was the last exit?
launchctl list com.tennisarc.refresh | grep -E '"PID"|LastExitStatus'
#   "PID" present  → a run is in progress (or wedged — cross-check the log mtime below)
#   no "PID" line  → idle, waiting for the next tick
#   LastExitStatus → 0 = clean; 143 = the watchdog SIGTERMed it (the usual self-clearing timeout);
#                    137 = SIGKILLed (it ignored SIGTERM through the 20s grace, or was killed by hand)

# 2. Is it actually making progress, or frozen? A healthy run touches the log every cycle.
ls -l  ~/Library/Logs/tennisarc-refresh.log     # mtime older than ~30 min while "PID" is set ⇒ wedged
tail -40 ~/Library/Logs/tennisarc-refresh.log    # last lines tell you which slam/step it reached

# 3. Suspected wedge — see the stuck process tree (publish-data.sh + node + chrome-headless-shell).
#    `ps -p "$RUN_PID"` alone shows only the runner; walk the descendants like the watchdog does.
RUN_PID=$(launchctl list com.tennisarc.refresh | sed -n 's/.*"PID" = \([0-9]*\).*/\1/p')
descendants() { echo "$1"; for c in $(pgrep -P "$1" 2>/dev/null); do descendants "$c"; done; }
ps -o pid,ppid,stat,etime,command -p "$(descendants "$RUN_PID" | paste -sd, -)"  # ELAPSED in days = stuck

# 4. Clear it. The watchdog should now prevent indefinite hangs, but to kill the whole tree by hand,
#    reuse the descendants walk from step 3 — `pkill -P` only hits DIRECT children and would strand
#    the chrome-headless-shell grandchildren (the very leak the watchdog tree-walks to avoid).
PIDS="$(descendants "$RUN_PID")"
kill -TERM ${=PIDS} 2>/dev/null                        # zsh: ${=PIDS} splits the list (see gotcha below)
sleep 20
kill -KILL ${=PIDS} 2>/dev/null                        # anything that ignored SIGTERM through the grace
#    Leftover git state self-heals: the next run does
#    `git reset --hard origin/main && git clean` in the clone and `git branch -D data-pub`.

# 5. Run immediately (don't wait up to 30 min) — also the way to recover after clearing a wedge:
launchctl kickstart -k "gui/$(id -u)/com.tennisarc.refresh"
```

> **Gotcha — killing under zsh.** The interactive shell here is **zsh**, which does **not** word-split
> an unquoted `$VAR`. So `kill -TERM $PIDS` (with `PIDS="111 222 333"`) fails with
> `illegal pid: 111 222 333` — the whole string is treated as one argument. Pass **literal** pids
> (`kill -TERM 111 222 333`), loop one-at-a-time, or split explicitly (`${=PIDS}` in zsh,
> `$PIDS` works only in bash). This is why an early kill attempt looked like a permissions/sandbox
> failure but wasn't.

## Worked example — the 2026-06 wedge

On **2026-06-26 ~15:17** a run launched Chromium, a SofaScore navigation hung, and the process tree
(bash → pnpm → node → 4× chrome-headless-shell, 12 procs) sat alive. Because launchd doesn't overlap
runs, **every 30-min tick for the next 3 days was skipped** — the log froze at 15:19 and the `data`
branch stayed at the 15:18 commit. Nothing errored; the job just showed a live PID with an old log.

Fix: killed the tree, added the watchdog timeout to `refresh-runner.sh`, re-copied the snapshot, and
kickstarted. The recovery run published live Wimbledon scores (ATP 25 / WTA 14 matches played, up
from 0) and force-pushed the `data` branch. Total downtime would have been unbounded without the
guard.

## Live scores (Flashscore) — not part of this chain

Score/status freshness for the in-play slam does **not** go through the Mac refresh chain above.
A stateless Vercel Node function, `api/live.ts`, fetches Flashscore's global livescore feed
(`https://global.flashscore.ninja/2/x/feed/f_2_0_3_en_1`, header `x-fsign: SW9D1eZo`), parses it
(`ingest/flashscore.ts` → `parseLiveFeed`) down to the requested slam's main-draw singles, and
returns `{ matches }` with `Cache-Control: s-maxage=10, stale-while-revalidate=10`. The client
(`src/live.ts` + `src/app.ts`) polls `/api/live` every ~15s while viewing a LIVE slam, joins
records to the snapshot by surname-pair (`sigKey`/`flashSigKey`), and overlays live/finished
status + score + winner onto the immutable snapshot at render time — the snapshot itself is never
mutated.

That means the Mac (and everything above in this doc) supplies **structure only** — draw shape,
new matches, durations, seeds/ELO — not live scores. If the Mac's refresh is wedged (see the
failure mode above), live scores keep updating on their own ~25-30s cadence unaffected; only
structural changes (a new round's matches appearing, final durations) wait for the next healthy
Mac cycle.

> **Gotcha — ESM needs explicit `.js` extensions.** `package.json` is `"type": "module"`, so
> Vercel transpiles `api/live.ts` to ESM **without bundling** — Node's ESM loader requires explicit
> `.js` extensions on relative imports (it won't infer `.ts` source resolves to `.js` output).
> Omitting one crashes the function at cold start with `ERR_MODULE_NOT_FOUND`, invisible in local
> dev/build and only surfacing on Vercel. Already fixed (inline comments mark the affected
> imports) — keep it in mind when editing `api/live.ts`'s import chain.

## Does it show on the site?

Publishing to the `data` branch only reaches https://tennisarc.vercel.app if the Vercel env var
**`VITE_DATA_BASE_URL`** points at the branch
(`https://raw.githubusercontent.com/tsenoner/TennisArc/data`). If it's unset, the deployed app falls
back to the committed seed in `public/data/` and live updates won't appear no matter how healthy the
refresh is. Check with `vercel env ls` (or the Vercel dashboard) if fresh data isn't showing.
