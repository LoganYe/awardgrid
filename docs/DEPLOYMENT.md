# awardgrid — deployment runbook

**Live:** https://awardgrid.dowhiz.com — the app runs on this Mac, published through a
Cloudflare Tunnel. Nothing runs *on* Cloudflare: the app needs native `better-sqlite3` and
`@node-rs/argon2`, which their runtime cannot load.

## Shape

    Mac ──── next start (127.0.0.1:3000, loopback only)
      └───── cloudflared tunnel "awardgrid"  ──►  Cloudflare edge  ──►  awardgrid.dowhiz.com

Tunnel id `d700e72f-e61e-4ff1-8351-34baa9052959`. Config `~/.cloudflared/config.yml`.
Credentials `~/.cloudflared/<tunnel-id>.json` — **secret; deleting the tunnel revokes them.**

## Processes (launchd, start at login, restart on crash — restart verified by SIGKILL)

| Agent | Runs | Logs |
|---|---|---|
| `com.awardgrid.app` | `node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000` | `~/Library/Logs/awardgrid/app{,.err}.log` |
| `com.awardgrid.tunnel` | `cloudflared tunnel run awardgrid` | `~/Library/Logs/awardgrid/tunnel{,.err}.log` |

    launchctl list | grep awardgrid                       # state
    launchctl kickstart -k gui/$(id -u)/com.awardgrid.app  # restart
    launchctl bootout   gui/$(id -u)/com.awardgrid.app     # stop until next login

The site is down while the Mac sleeps. That is inherent to this shape.

## App env (`.env`, gitignored) — the three that matter behind a proxy

    APP_URL=https://awardgrid.dowhiz.com
    COOKIE_SECURE=true          # cookies are https-only now
    TRUST_PROXY_HEADERS=1       # rate limits key off cf-connecting-ip, not the tunnel's IP

Get any of these wrong and login breaks: the origin guard compares `Origin` against `Host`.

## Login with Seats.aero (the web app)

The web app connects each user's seats.aero account only through Login with Seats.aero (`src/lib/seats-oauth`); no
seats.aero key is pasted or stored. It needs one more line in `.env`:

    SEATS_OAUTH_CLIENT_ID=<AwardGrid's seats.aero client ID>   # the iPhone app's; not a secret

The client secret stays in the token service (`sites/auth`, the Worker awardgrid-auth); this server never holds it.
Codes are exchanged and tokens refreshed through `https://awardgrid.dowhiz.com/oauth/seats` (override with
`SEATS_OAUTH_TOKEN_SERVICE_URL` only for development). The sign-in tokens are stored in `seats_connections`,
encrypted with `MASTER_KEY`: rotating `MASTER_KEY` means every user connects again.

Short-term caching: seats.aero results older than 24 hours are deleted from the database when the server opens it and
every 10 minutes after (`src/lib/seats-oauth/retention.ts`), and on every `pnpm worker` tick.

**Releasing it (owner's call; the order matters):**

1. Redeploy the Worker first (`sites/auth/DEPLOY.md` section 7) and run its two curl checks. Until then the Worker sends
   the web app's sign-ins to the iPhone app's scheme, and Connect cannot finish in a browser.
2. Add `SEATS_OAUTH_CLIENT_ID` to `.env`.
3. Back up the database and `.next`, as for any deploy: migration `0005_seats_oauth` **deletes every pasted seats.aero
   key** (`user_keys` rows with provider `seats_aero`) and flags those accounts for a one-time "connect seats.aero"
   notice. It runs on the first request that opens the database after the restart.

       cp -Rc .next ~/Desktop/workspace/awardgrid-deploy-backup-$(date +%Y%m%d)/next
       sqlite3 data/runtime/awardgrid.db ".backup '$HOME/Desktop/workspace/awardgrid-deploy-backup-$(date +%Y%m%d)/awardgrid.db'"

4. With `main` checked out in the main checkout and clean: `pnpm build`, then at once
   `launchctl kickstart -k gui/$(id -u)/com.awardgrid.app`; open `/api/auth/me` once to apply the migration.
5. Check: Settings shows the seats.aero section with **Connect seats.aero**; Connect goes to seats.aero's page and
   comes back "seats.aero is connected."; a search shows "Data: seats.aero" next to the results; Disconnect empties
   it again. `pnpm admin users` lists who is connected.

Rollback: restore `.next` and the database from the backup and kickstart again. The Worker change is backward
compatible (the iPhone app's states never take the new path), so it can stay.

## DNS migration, 2026-09-09

`dowhiz.com` moved GoDaddy → Cloudflare nameservers `jade` / `rodney.ns.cloudflare.com`.
22 records imported from GoDaddy's **BIND zone export**, not Cloudflare's scan — the scan
finds "common" records and would have missed the Postmark DKIM key and the SPF macro host.
All imported records set to **DNS only**; only `awardgrid` is proxied (required for Tunnel).

Verified before the cutover by querying both nameservers and diffing: **16/16 matched**.
Verified after: all six MX intact. DNSSEC was off, so the switch could not blackhole the domain.

Rollback: set the nameservers at GoDaddy back to `ns23`/`ns24.domaincontrol.com`.
Baseline + zone export: `docs/dns-baseline-dowhiz.md` (the zone export itself is deliberately not committed).

## Not done

- **Cloudflare Access is NOT set up.** The login page is reachable by anyone with the URL.
  Blocked on activating Zero Trust Free, which wants a billing address and ToS acceptance.
  What guards it today, probed live: bad invite → 400, unknown login → 401, register capped
  at 20/IP/15 min, invite keyspace 64^12.
- **The scheduler is not running.** No `pnpm worker`, so standing queries do not run and no
  Telegram digests are sent. Add a third LaunchAgent if you want it (needs `MASTER_KEY`).
- Two `pnpm worker` processes from 2026-09-06 05:17 are still alive from an old session
  (`ps aux | grep '[s]rc/cli/worker.ts'`). They tick against the same database.
