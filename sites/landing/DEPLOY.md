# The static site: deploy runbook

The iPhone app's page, its privacy policy and its support page (release decision D7), served on
`awardgrid.dowhiz.com` beside the web app by Cloudflare, so they stay up while the owner's Mac sleeps.

**Live since 2026-09-25:** <https://awardgrid.dowhiz.com/ios/>, <https://awardgrid.dowhiz.com/privacy/>,
<https://awardgrid.dowhiz.com/support/>.

## Shape

```
awardgrid.dowhiz.com/, /grid, /legal, /api/… ─► Cloudflare Tunnel ─► next start on the Mac (the web app; unchanged)

awardgrid.dowhiz.com/ios*      ─┐
awardgrid.dowhiz.com/privacy*   ├─► Worker awardgrid-site: static assets only, no script (sites/landing/dist)
awardgrid.dowhiz.com/support*   │
awardgrid.dowhiz.com/_site/*   ─┘
```

- **Worker `awardgrid-site`** holds the built `dist/` as static assets and runs no code; Cloudflare serves requests
  to an assets-only Worker at no charge. HTML handling `auto-trailing-slash` (`/privacy` redirects to `/privacy/`),
  not-found handling `none` (a path with no file is a plain 404). Its own address,
  `awardgrid-site.logan-yegaoyang.workers.dev`, also serves the site's root page.
- **Four routes** on the `dowhiz.com` zone send only those path prefixes to it; everything else on the hostname is the
  web app as before. Failure mode: fail closed. Nothing on the web app answered those prefixes before (they
  redirected to its 404).
- **No DNS change:** `awardgrid.dowhiz.com` stays the tunnel's record.
- **Cloudflare Web Analytics** is on for the hostname. Cloudflare adds its beacon script to HTML responses for
  browsers, not for a plain curl. The source pages have no script (honesty.test.ts). The privacy policy's "This
  website" section discloses the analytics: the owner's decision, 2026-09-27.
- `wrangler.jsonc` states the same deployment, for `wrangler deploy`.
- Restful's site is the model (`restful.dowhiz.com`, a Pages project on its own hostname). AwardGrid's hostname
  already belongs to the web app, so the site takes paths instead.

## Build

```bash
export PATH="$HOME/.local/node-arm64/bin:$PATH"
AWARDGRID_SUPPORT_EMAIL=knowhiz.us@gmail.com pnpm build:landing   # the same public contact as Restful's site
```

The build refuses to run without the address. It writes `dist/index.html`, `dist/ios/`, `dist/privacy/`,
`dist/support/` and `dist/_site/styles-<hash>.css`; every page links the stylesheet relatively.

## Deploy

**Dashboard (how it was first deployed).** Zip the contents of `dist/`
(`cd sites/landing/dist && zip -qr -X ../awardgrid-site.zip .`). First time: Workers & Pages › Create application ›
Upload your static files › the zip › Worker name `awardgrid-site` › Advanced settings as above › Deploy; then the
Worker › Domains › Add Route, zone `dowhiz.com`, once per pattern in `wrangler.jsonc`. After that, a new version
replaces the assets and keeps the routes.

**CLI.** `npx wrangler deploy` from `sites/landing` after `wrangler login` (an OAuth grant on the owner's
Cloudflare account, the owner's call). It uploads `dist/` and sets the same routes.

## Check

```bash
for p in /ios/ /privacy/ /support/; do curl -s -o /dev/null -w "%{http_code} $p\n" https://awardgrid.dowhiz.com$p; done   # 200 each
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://awardgrid.dowhiz.com/privacy                           # 307 …/privacy/
curl -s https://awardgrid.dowhiz.com/privacy/ | grep -c 'knowhiz.us@gmail.com'                                        # > 0
for p in / /legal /api/health; do curl -s -o /dev/null -w "%{http_code} $p\n" https://awardgrid.dowhiz.com$p; done  # the web app, 200
curl -s -A 'Mozilla/5.0' -H 'Accept: text/html' https://awardgrid.dowhiz.com/privacy/ | grep -c cloudflareinsights  # 1 while Web Analytics is on (disclosed); a plain curl gets 0
```

## Roll back

Delete the four routes (the Worker › Domains). The web app answers those paths again, as before; the Worker can stay.
