# The static site: deploy runbook

The iPhone app's page, its privacy policy and its support page (release decision D7), served on
`awardgrid.dowhiz.com` beside the web app, from Cloudflare, so they stay up while the owner's Mac sleeps.

## Shape

```
awardgrid.dowhiz.com/            ─┐
awardgrid.dowhiz.com/grid, /api… ─┴─► Cloudflare Tunnel ─► next start on the Mac (the web app; unchanged)

awardgrid.dowhiz.com/ios*       ─┐
awardgrid.dowhiz.com/privacy*    │
awardgrid.dowhiz.com/support*    ├─► Worker awardgrid-site-router ─► Pages project awardgrid-site
awardgrid.dowhiz.com/_site/*    ─┘       (worker/router.js)            (sites/landing/dist, direct upload)
```

- **Pages project `awardgrid-site`**: the built `dist/`, uploaded directly (no Git connection: the monorepo's
  install is the whole web app's, and this site changes rarely). Its own address, `awardgrid-site.pages.dev`,
  also serves `dist/index.html` at its root.
- **Worker `awardgrid-site-router`**: `worker/router.js`, bound only to the four routes above on the
  `dowhiz.com` zone. It forwards the path and query and nothing else: no cookie (the web app's session cookie lives
  on this host), no visitor header, only GET and HEAD. The web app's own paths never reach it; before this, those
  four prefixes only redirected to the web app's 404.
- Restful's site is the model (`restful.dowhiz.com`, Pages project `restful-website`); AwardGrid differs only
  because its hostname already belongs to the web app, so it takes paths instead of a custom domain.

## Build

```bash
export PATH="$HOME/.local/node-arm64/bin:$PATH"
AWARDGRID_SUPPORT_EMAIL=knowhiz.us@gmail.com pnpm build:landing   # the same public contact as Restful's site
```

The build refuses to run without the address. It writes `dist/index.html`, `dist/ios/`, `dist/privacy/`,
`dist/support/` and `dist/_site/styles-<hash>.css`; every page links the stylesheet relatively.

## Deploy (Cloudflare dashboard)

1. **Pages.** Workers & Pages › Create › Pages › Upload assets (direct upload), project `awardgrid-site`, the
   contents of `dist/` (a zip of them works). Later deploys: the project › Create deployment › upload again.
   Check `https://awardgrid-site.pages.dev/privacy/` before step 2. If Cloudflare gives the project another
   subdomain, put that one in `PAGES_ORIGIN` in `worker/router.js`.
2. **Worker.** Workers & Pages › Create › Worker, name `awardgrid-site-router`; replace the starter code with
   `worker/router.js`; Deploy.
3. **Routes.** The Worker › Settings › Domains & Routes › Add › Route, zone `dowhiz.com`, one route each:
   `awardgrid.dowhiz.com/ios*`, `awardgrid.dowhiz.com/privacy*`, `awardgrid.dowhiz.com/support*`,
   `awardgrid.dowhiz.com/_site/*`. Failure mode: fail closed (a failing Worker returns an error, never the web app).

No DNS record changes: `awardgrid.dowhiz.com` stays the tunnel's CNAME.

## Check

```bash
for p in /ios/ /privacy/ /support/; do curl -s -o /dev/null -w "%{http_code} $p\n" https://awardgrid.dowhiz.com$p; done   # 200 each
curl -sI https://awardgrid.dowhiz.com/privacy | grep -i '^location'                                                    # …/privacy/
curl -s https://awardgrid.dowhiz.com/privacy/ | grep -c 'knowhiz.us@gmail.com'                                        # > 0
curl -s -o /dev/null -w "%{http_code}\n" https://awardgrid.dowhiz.com/        # the web app, unchanged
curl -s -o /dev/null -w "%{http_code}\n" https://awardgrid.dowhiz.com/legal   # the web app, unchanged
```

## Roll back

Delete the four routes (the Worker › Settings › Domains & Routes). The web app answers those paths again as before;
the Pages project and the Worker can stay.
