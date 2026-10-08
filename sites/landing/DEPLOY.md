# Public site: deploy and rollback runbook

As of the 2026-10-07 migration, AwardGrid's **six public pages** and their static
files are hosted in the new **DoWhiz** Vercel team (`do-whiz`), project
`awardgrid-website`. A script-only Cloudflare Worker, `awardgrid-vercel-public`,
forwards the existing public routes to <https://awardgrid-website.vercel.app>.
The canonical public origin remains <https://awardgrid.dowhiz.com>.

Releases currently use manual static uploads. A Git push or merge does **not**
deploy Vercel or the Worker. This change saves the already-deployed hosting and
proxy configuration; it does not publish unrelated new page copy from main.
The migrated static files were built from
`c552f7dfc021c966da24d21e9b1d4c2897f8c216`; the migration closeout source base
is `13495dd017561d873a7e7d670c5f268492c32491`. Those revisions differ in public
content, so do not describe the current live HTML as a build of the latter.

## Shape and boundaries

```text
awardgrid.dowhiz.com public routes
    -> Cloudflare Worker awardgrid-vercel-public (script only)
    -> Vercel awardgrid-website (static sites/landing/dist)

awardgrid.dowhiz.com other paths, including /?..., /login, /grid, /api/...
    -> existing Cloudflare Tunnel -> existing private web app
```

- DNS, tunnel, private authentication, API, SQLite and the owner's running web
  app stay as they were. The private application is excluded from this migration.
- The proxy has no assets binding. It accepts GET/HEAD and forwards only public
  accept, conditional/range and User-Agent headers, withholding cookies,
  authorization and visitor IP headers. It strips upstream Set-Cookie and streams
  the response without buffering it.
- Vercel aliases are `noindex`. On successful canonical-host responses the proxy
  removes that alias header; its own workers.dev responses and public errors are
  `noindex`. Canonical tags still name awardgrid.dowhiz.com.
- Vercel redirects to the same upstream origin are rewritten to the requesting
  public origin. Slash/index normalization preserves incoming query parameters.
- Cloudflare Web Analytics can add its disclosed beacon to browser HTML responses.
  Source pages contain only JSON-LD scripts, not application API calls.
- The previous assets Worker `awardgrid-site` remains available for rollback.
  **`sites/landing/wrangler.jsonc` is legacy rollback-only.** Normal Worker releases
  must use `cloudflare-public-proxy/wrangler.json` explicitly.

## Routes

These eleven route patterns belong to `awardgrid-vercel-public` on the
`dowhiz.com` zone and are listed in `cloudflare-public-proxy/wrangler.json`.
The retained legacy configuration lists the same routes for a deliberate rollback.

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

**Exact routes do not match a query string.** A Cloudflare route pattern matches
the whole URL, query string included; only a pattern ending in `*` matches URLs
with a query. `/` is the public static home, but `/?utm_source=...`, `/?ref=...`
and other root queries still reach the private web app. The same applies to
root files with queries. Campaign links should point to `/ios/`, whose prefix
route accepts query strings.

Every other path stays with the private web app. Do not introduce a hostname-wide
wildcard, route `/grid` or `/api` to Vercel, remove the tunnel, upload its database,
or include the application server in the static artifact. The public home cannot
know who is signed in; its existing grid link points into the private app.

## Build and package

From the repository root, use Node 22 or newer and the pinned pnpm version.
On Apple Silicon use a matching ARM Node runtime and dependency installation.

```bash
pnpm install --frozen-lockfile
pnpm --filter @awardgrid/landing test
pnpm --filter @awardgrid/landing typecheck
AWARDGRID_SUPPORT_EMAIL=knowhiz.us@gmail.com pnpm build:landing
node scripts/growth/validate-public-claims.mjs --dist sites/landing/dist
cp sites/landing/vercel.json sites/landing/dist/vercel.json
rm -f sites/landing/awardgrid-website.zip
(cd sites/landing/dist && zip -qr -X ../awardgrid-website.zip .)
```

The support address is public production contact information. CI uses
`support@example.com` as a fixture: never deploy a CI or test build with that
placeholder. The build writes the six manifest pages, hashed `/_site/` stylesheet,
robots, sitemap, llms.txt, IndexNow key and favicons. Only ZIP the contents of
`sites/landing/dist`; no .env, SQLite files, private application files or iOS shell.
The public-claims guard must pass at the registry's actual release status.

`sites/landing/vercel.json` uses ordered low-level routes to set security headers,
immutable asset caching and alias noindex, normalize slash/index URLs, serve the
six pages and return 404 for missing files. Vercel does not interpret `public/_headers`;
that file remains for the legacy assets Worker. The latter pins favicon.ico to
image/x-icon; Vercel currently serves it as image/vnd.microsoft.icon, also a valid
icon media type. Adding a page requires the manifest, canonical/structured data,
public-facts registration, Vercel routes and any necessary Cloudflare route.

## Publish

1. Upload the ZIP to the existing `awardgrid-website` Vercel project using the
   static upload flow. Review the preview and make the verified version production.
   Confirm <https://awardgrid-website.vercel.app/ios/> serves the intended build and
   carries `X-Robots-Tag: noindex` before changing the proxy.
2. Normally no proxy change is needed for a content release. When updating it,
   run its offline tests, inspect the config's eleven public patterns and deploy
   explicitly from `sites/landing`:

   ```bash
   pnpm test:public-proxy
   npx wrangler deploy --config cloudflare-public-proxy/wrangler.json
   ```

   Wrangler uses the existing authorized Cloudflare account. Inspect the proposed
   route reassignment before applying it. `PUBLIC_ORIGIN` must be an HTTPS Vercel
   alias for this public static project. This does not require a DNS change.
3. Check the canonical site in Chrome and with a browser User-Agent as below.
   Keep the previous verified Vercel deployment and assets Worker for rollback.

## Verify

All six manifest pages must answer HTTPS 200, carry their own canonical URL,
allow Googlebot under robots.txt and omit noindex on the primary hostname. Check
GET and HEAD assets, slash/index redirects including query retention, robots,
sitemap, llms.txt, IndexNow key, favicon types and a missing public URL (404).
Primary responses forwarded by the proxy carry
`X-AwardGrid-Public-Origin: vercel`; Vercel and workers.dev previews stay noindex.

Use a browser User-Agent. Cloudflare can return 403 for generic scripted agents;
do not weaken its protections to make such a probe pass. Example from the root:

```bash
curl -A 'Mozilla/5.0' -sSI https://awardgrid.dowhiz.com/ios/
curl -A 'Mozilla/5.0' -sSI 'https://awardgrid.dowhiz.com/privacy?lang=en'
curl -A 'Mozilla/5.0' -sSI https://awardgrid-vercel-public.logan-yegaoyang.workers.dev/ios/
curl -A 'Mozilla/5.0' -sSI https://awardgrid-website.vercel.app/ios/
```

The first is 200 with HSTS/nosniff and no noindex. The second redirects with
`lang=en` intact. The last two are 200 with noindex.

`node sites/landing/scripts/verify-live.mjs --json verify-live.json` is the
broader historical read-only verifier, now targeting the active proxy. It also
requests private login/register/legal/root-query paths and reports tunnel errors;
those checks do not establish acceptance of the excluded private business app.
Its recorded before-deploy fixtures remain historical, replayed under the new
proxy address in tests. Run that broader verifier only when the private web app
is intentionally in the validation scope. Local proxy tests and the landing
suite use fixtures and make no real network requests.

These checks establish public reachability and crawl access, not guaranteed
search indexing. In Search Console, inspect a representative public URL live,
confirm crawling is allowed and submit validation for an unintended public block.
Keep intended private path restrictions; do not make /grid or /api indexable.
The existing IndexNow script offers a dry run; explicit submission is a separate
publishing action after the deployed pages have passed validation.

## Search-console ownership

Prefer an existing DNS-verified Domain property, which needs no page change.
For a URL-prefix property, Google can verify a supplied HTML meta tag in the
public home. If adding an HTML verification file instead, register it with the
public-facts inventory, ensure Vercel serves it and assign its exact Cloudflare
route; test any extension normalization redirect end-to-end. Legacy Cloudflare
assets can redirect a .html filename to its extensionless counterpart, so their
rollback configuration needs both exact routes. A Bing XML file similarly needs
an explicit route and public-facts registration. Do not invent verification tags
or add routes before the provider supplies them.

## Roll back

- **Bad static content:** select the previous verified Vercel production version.
  The proxy still points at the stable production alias; recheck pages and headers.
- **Bad proxy version:** roll back `awardgrid-vercel-public` to its previous
  verified script version, preserving the eleven route patterns and PUBLIC_ORIGIN.
- **Return public hosting to Cloudflare:** first verify the retained
  `awardgrid-site.logan-yegaoyang.workers.dev` pages/root files and support contact.
  Reassign the same eleven routes to `awardgrid-site` in the dashboard, or deliberately
  deploy the legacy `sites/landing/wrangler.jsonc` with a reviewed, correct dist.
  Confirm TLS, robots, canonicals, headers and assets on the primary host.
- Deleting all public routes would send privacy/support/public URLs into the
  private app and can break App Store links. Prefer route reassignment to a verified
  public deployment. Never change private tunnel/DNS/database settings to roll
  back the public site.
