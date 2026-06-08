# TODO

## Data refresh → move off the Mac to an always-on residential runner

The SofaScore ingest must run from a **residential IP** — datacenter IPs (GitHub Actions, Cloudflare Workers/Pages) get a Cloudflare `403`, even with a real headless browser. For now `scripts/publish-data.sh` runs on the Mac via a `launchd` agent (`~/Library/LaunchAgents/com.tennisarc.refresh.plist`), which only refreshes while the Mac is awake and logged in.

- [ ] **Raspberry Pi / always-on home box:** clone the repo, install pnpm + `pnpm exec playwright install chromium`, set up `gh` auth (or a deploy token), and run `scripts/publish-data.sh` on a cron (~every 30 min). Same residential-IP requirement, but no "Mac must be awake" dependency.
- [ ] **Alternative:** a residential/mobile proxy wired into `ingest/sofascore.ts` would let the existing (manual) GitHub Actions workflow — or a Cloudflare Worker — run from anywhere (~$1–5/mo).
