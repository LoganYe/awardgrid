# The static site: deploy runbook

The iPhone app's page, its privacy policy and its support page (release decision D7), served on
`awardgrid.dowhiz.com` beside the web app by Cloudflare, so they stay up while the owner's Mac sleeps.

**Live since 2026-09-25:** <https://awardgrid.dowhiz.com/ios/>, <https://awardgrid.dowhiz.com/privacy/>,
<https://awardgrid.dowhiz.com/support/>. The home page and the root files (robots.txt, sitemap.xml, llms.txt, the
IndexNow key, the favicons) are served once their exact routes are added (see Routes and Deploy).

## Shape

```
awardgrid.dowhiz.com/?…, /login, /register, /grid, /legal, /api/… ─► Cloudflare Tunnel ─► next start on the Mac (the web app)

awardgrid.dowhiz.com/ (exact)              ─┐
awardgrid.dowhiz.com/ios*                   │
awardgrid.dowhiz.com/privacy*               │
awardgrid.dowhiz.com/support*               ├─► Worker awardgrid-site: static assets only, no script (sites/landing/dist)
awardgrid.dowhiz.com/_site/*                │
awardgrid.dowhiz.com/robots.txt, … (exact) ─┘
```

- **Worker `awardgrid-site`** holds the built `dist/` as static assets and runs no code; Cloudflare serves requests
  to an assets-only Worker at no charge. HTML handling `auto-trailing-slash` (`/privacy` redirects to `/privacy/`),
  not-found handling `none` (a path with no file is a plain 404). Its own address,
  `awardgrid-site.logan-yegaoyang.workers.dev`, serves the same files, with `X-Robots-Tag: noindex` (`_headers`).
- **Routes** on the `dowhiz.com` zone send those paths to it (the table below); everything else on the hostname is
  the web app as before. Failure mode: fail closed.
- **No DNS change:** `awardgrid.dowhiz.com` stays the tunnel's record.
- **Cloudflare Web Analytics** is on for the hostname. Cloudflare adds its beacon script to HTML responses for
  browsers, not for a plain curl. The source pages have no script but JSON-LD (honesty.test.ts). The privacy policy's
  "This website" section discloses the analytics: the owner's decision, 2026-09-27.
- `wrangler.jsonc` states the same deployment, for `wrangler deploy`.
- Restful's site is the model (`restful.dowhiz.com`, a Pages project on its own hostname). AwardGrid's hostname
  already belongs to the web app, so the site takes paths instead.

## Routes

Every route is on the zone `dowhiz.com` and is listed in `wrangler.jsonc`.

| Route | Kind | What the Worker serves there |
| --- | --- | --- |
| `awardgrid.dowhiz.com/ios*` | prefix | `/ios/`, the iPhone app's page (`/ios` redirects to `/ios/`) |
| `awardgrid.dowhiz.com/privacy*` | prefix | `/privacy/`, the privacy policy |
| `awardgrid.dowhiz.com/support*` | prefix | `/support/`, the support page |
| `awardgrid.dowhiz.com/_site/*` | prefix | the stylesheet every page links, cached as immutable |
| `awardgrid.dowhiz.com/` | exact | the home page, `index.html` |
| `awardgrid.dowhiz.com/robots.txt` | exact | `public/robots.txt`, byte for byte |
| `awardgrid.dowhiz.com/sitemap.xml` | exact | the sitemap the build writes from `pages.json` |
| `awardgrid.dowhiz.com/llms.txt` | exact | `public/llms.txt` |
| `awardgrid.dowhiz.com/665e809ddf84f9e36cd81d6f8842eaf6.txt` | exact | the IndexNow key (`pages.json` `indexnow_key`) |
| `awardgrid.dowhiz.com/favicon.ico` | exact | the favicon, 32×32 |
| `awardgrid.dowhiz.com/favicon.svg` | exact | the favicon, SVG |

**Exact routes do not match a query string.** A Cloudflare route pattern matches the whole URL, query string included,
and only a pattern that ends in `*` matches a URL that has one. So `awardgrid.dowhiz.com/` serves `/` alone:
`/?utm_source=…` or `/?ref=…` still reaches the web app's home page, and so does any other `/?…`. A link with
parameters therefore points at `/ios/`, whose prefix route matches its query strings. The same goes for the root
files: a crawler asks for `/robots.txt` without one.

The web app keeps every other path: `/?…`, `/login`, `/register`, `/grid`, `/legal`, `/api/…`. They do not pass
through the Worker, so `_headers` does not apply to them.

`_headers` (in `public/`, copied into `dist/`) sets, for the Worker's responses: `Strict-Transport-Security:
max-age=31536000` (no includeSubDomains, no preload) and `X-Content-Type-Options: nosniff` on every path;
`Cache-Control: public, max-age=31536000, immutable` on `/_site/*` (the file names carry a content hash); and
`X-Robots-Tag: noindex` on the workers.dev address, whose pages also carry a canonical link to
`https://awardgrid.dowhiz.com/…`.

## Build

```bash
export PATH="$HOME/.local/node-arm64/bin:$PATH"
AWARDGRID_SUPPORT_EMAIL=knowhiz.us@gmail.com pnpm build:landing   # the same public contact as Restful's site
```

The build refuses to run without the address. It builds the pages `pages.json` lists (`dist/index.html`,
`dist/ios/`, `dist/privacy/`, `dist/support/`) and `dist/_site/styles-<hash>.css`, copies `public/` (robots.txt,
llms.txt, the key file, favicon.svg, favicon.ico, `_headers`), and writes `dist/sitemap.xml` from `pages.json`,
one `<lastmod>` per page. It also refuses a `lastmod` later than the build date. Every page links the stylesheet
and the favicons relatively, so the same files work on the hostname and on workers.dev.

Adding a page: its `index.html`, an entry in `pages.json` (path, file, lastmod), its head tags (canonical, og, twitter,
favicons; `sites/landing/test/crawl.test.ts` checks them), a line in `growth/product-facts.json` `public_files`, and a
route if its path is not under one already.

## Deploy

Upload and routes go together: the new files first, then the routes that send the new paths to them.

**CLI.** `npx wrangler deploy` from `sites/landing` after `wrangler login` (an OAuth grant on the owner's
Cloudflare account, the owner's call). It uploads `dist/` and sets every route in `wrangler.jsonc` in one step.

**Dashboard (how it was first deployed).** Zip the contents of `dist/`
(`cd sites/landing/dist && zip -qr -X ../awardgrid-site.zip .`).

1. The Worker `awardgrid-site` › upload the zip as a new version (first time: Workers & Pages › Create application ›
   Upload your static files › the zip › Worker name `awardgrid-site` › Advanced settings as above › Deploy).
2. Look at the new version on workers.dev: `/`, `/robots.txt`, `/sitemap.xml`, `/llms.txt`, the key file and
   `/favicon.ico` answer 200.
3. At once, the Worker › Domains & Routes › Add Route, zone `dowhiz.com`, once for each route of the table above that
   is not there yet (the seven exact ones, the first time). A new version keeps the routes it already has.

Before the exact routes exist, `/` is the web app's home page and the root files are the web app's 404; nothing else
changes.

## Check

After every deploy, and weekly:

```bash
node sites/landing/scripts/verify-live.mjs --help                  # what it checks and its flags
node sites/landing/scripts/verify-live.mjs --json verify-live.json # read-only; exit 1 on any failure
```

It asks for each page as a browser does (a browser user agent and `Accept: text/html`, which is when Cloudflare adds
the Web Analytics beacon) and checks:

- the Worker's pages (`/`, `/ios/`, `/privacy/`, `/support/`, and the workers.dev address) carry no HTML comment and no
  script except JSON-LD without `src` and the one Cloudflare beacon;
- each root file answers 200 from the Worker (no `vary: rsc`, which the web app sends) with a sensible content type,
  and the served robots.txt is byte for byte `public/robots.txt` (so a line Cloudflare's managed robots.txt might add
  in front shows up as a difference);
- `/ios/` has `strict-transport-security`, and workers.dev has `x-robots-tag: noindex`;
- the web app's `/login` and `/register` still carry `noindex` (robots.txt does not block them, so crawlers can see
  that), and how many beacons the web app's paths carry (disclosed; not a failure).

`--before-deploy` expects the state before these routes, to see what a deploy changes. In both modes it also asks for
`http://awardgrid.dowhiz.com/login` and warns unless that is a permanent redirect (301 or 308) to https;
`--expect-https-redirect` makes it a failure, for use once the hostname has an http-to-https redirect rule.

A 5xx is Cloudflare's own error page (a 530 while the Mac sleeps and the tunnel is down). The Worker does not answer
one, so who would serve that path is reported as `unknown`, and no page check runs on it. Where the Worker should
answer (after the deploy, `/` and the root files too) it is a failure; on a web app path, a warning.

The quick version by hand:

```bash
for p in / /ios/ /privacy/ /support/ /robots.txt /sitemap.xml /llms.txt /665e809ddf84f9e36cd81d6f8842eaf6.txt /favicon.ico /favicon.svg; do
  curl -s -o /dev/null -w "%{http_code} %{content_type} $p\n" https://awardgrid.dowhiz.com$p; done               # 200 each
curl -s https://awardgrid.dowhiz.com/robots.txt | diff - sites/landing/public/robots.txt && echo robots.txt matches
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://awardgrid.dowhiz.com/privacy                  # 307 …/privacy/
curl -s https://awardgrid.dowhiz.com/privacy/ | grep -c 'knowhiz.us@gmail.com'                               # > 0
curl -sI https://awardgrid.dowhiz.com/ios/ | grep -i strict-transport-security                               # max-age=31536000
curl -sI https://awardgrid-site.logan-yegaoyang.workers.dev/ios/ | grep -i x-robots-tag                        # noindex
for p in "/?x=1" /login /legal /api/health; do curl -s -o /dev/null -w "%{http_code} $p\n" "https://awardgrid.dowhiz.com$p"; done   # the web app, 200
```

## IndexNow

After a deploy has passed the check, and only when the owner confirms, tell the IndexNow engines the pages changed:

```bash
node sites/landing/scripts/indexnow.mjs                        # dry run: prints the payload, sends nothing
node sites/landing/scripts/indexnow.mjs --submit --i-confirm    # submits the pages of pages.json
```

The key is `pages.json` `indexnow_key`; `public/<key>.txt` holds it and the exact route serves it at
`https://awardgrid.dowhiz.com/<key>.txt`, which is where the engines look. A 200 or a 202 is success.

## Search-console verification

Nothing for it is in the repository yet.

- **Google:** the HTML tag method, for the URL-prefix property `https://awardgrid.dowhiz.com/`. Put the
  `<meta name="google-site-verification" content="…">` tag Google gives into the `<head>` of
  `sites/landing/index.html`, build, and deploy. Google reads it from `/`, which is the Worker's home page once the
  exact route `awardgrid.dowhiz.com/` exists, so it needs no file and no route. A Domain property, verified by a DNS
  TXT record, needs no change to the site at all.

  Not Google's HTML file (`google<token>.html`) with a single route: with `html_handling` `auto-trailing-slash` the
  Worker answers `/google<token>.html` with a 307 to `/google<token>`, which no route sends to the Worker, so the web
  app answers it with a 404. If the file is wanted anyway, it needs both exact routes,
  `awardgrid.dowhiz.com/google<token>.html` and `awardgrid.dowhiz.com/google<token>` (`crawl.test.ts` expects that
  pair for an `.html` file in `public/`), plus the steps for Bing's file below; after the deploy,
  `curl -sIL https://awardgrid.dowhiz.com/google<token>.html` must end in a 200.
- **Bing:** `BingSiteAuth.xml`. Put the file as given into `public/`, register it in `growth/product-facts.json`
  (`nonmarketing_files`, with a reason), add its exact route (`awardgrid.dowhiz.com/BingSiteAuth.xml`) to
  `wrangler.jsonc` and the table above, build, and deploy as above. An `.xml` file is served as it is, with no
  redirect.

## Roll back

- **The home page and root files:** delete their exact routes (the Worker › Domains & Routes). `/` is the web app's
  home page again, and the root files are the web app's 404.
- **A bad version:** the Worker › Deployments › Rollback, to the version before. The routes stay. If that version is
  older than the home page and the root files (rolling back their first deploy), also delete the exact routes (the
  bullet above): otherwise `/` serves that version's own `index.html`, the old root page of the workers.dev address,
  and every root file is the Worker's plain 404.
- **All of it:** delete every route. The web app answers those paths again, as before; the Worker can stay. This
  also takes `/privacy/` and `/support/` off the hostname, and App Store Connect's privacy policy URL and support URL
  point there.
