# sites/landing: notes for whoever edits the site

This file is not part of the site. Vite builds only the pages listed in `vite.config.ts`
(`build.rolldownOptions.input`) and copies only `sites/landing/public/`; this file is in neither, so it is never
deployed. It holds the notes the pages' HTML comments hold, because the build removes those comments.

## No HTML comments in the built pages

- `vite.config.ts` runs the plugin `awardgrid:strip-html-comments` last on every page. It removes each
  `<!-- … -->`; a comment on a line of its own goes with its line, and one beside other markup leaves that markup
  alone.
- The build stops if a `<!--` would survive: an unterminated comment, or one inside a `<script>`, `<style>`,
  `<textarea>` or `<title>` (the plugin leaves the content of those elements as it is).
- The built HTML is what a reader, a crawler and a search or answer engine receives. A note about a page belongs in
  its source comment or in this file, never in the built output.
- Checks:
  - after `AWARDGRID_SUPPORT_EMAIL=… pnpm build:landing`, `grep -rc '<!--' sites/landing/dist --include=*.html`
    prints 0 for every page;
  - `sites/landing/test/build.test.ts` builds the site into a temp directory and asserts the same;
  - CI's `landing` job (`.github/workflows/ci.yml`) runs
    `node scripts/growth/validate-public-claims.mjs --dist sites/landing/dist`, whose `HTML_COMMENT_IN_DIST` rule
    fails on any `<!--`, and greps the built pages for one.

## `root` and `publicDir`

`vite.config.ts` sets `root` to this directory and `publicDir` to `sites/landing/public`, whichever directory the
build starts in. Vite's defaults are the working directory and its `public/`, and the repo root's `public/` belongs
to the Next.js web app (`public/fonts/`), so a build started from the repo root would otherwise copy it into this
site. `sites/landing/test/build.test.ts` checks both settings, and that no file of the root `public/` is in the output.

## Scripts

The source pages contain no executable script. The only `<script>` allowed is `type="application/ld+json"` without
`src` (DECISIONS.md, "The landing site ships zero JavaScript…", amended 2026-09-28).
`apps/ios/src/honesty.test.ts` fails a page with any other script and scans the JSON-LD strings together with the
page text; `sites/landing/test/build.test.ts` checks the built pages the same way.

## The support address

The privacy and support pages carry `%AWARDGRID_SUPPORT_EMAIL%`. The build replaces it with
`AWARDGRID_SUPPORT_EMAIL` and refuses to build without a plausible address (`vite.config.ts`), so the address is not
kept in git. CI and the tests use `support@example.com`.

## The workers.dev copy

The Worker serves the same files at its own address, `awardgrid-site.logan-yegaoyang.workers.dev`. `_headers` gives
them `X-Robots-Tag: noindex` there, and each page's canonical link names `https://awardgrid.dowhiz.com/…`. That keeps
search engines to the hostname. It does not stop a reader, or an answer engine, that fetches the workers.dev copy.

`index.html`, `public/llms.txt` and `public/robots.txt` carry the web app note in the form that names the hostname
(`webapp_note`, `kept_named_host`: "The web app at awardgrid.dowhiz.com is private and invite-only; …"), because they are
also served on the workers.dev address, where no web app runs and "at this address" would not be true. LEGAL.md, which only
the web app serves (at /legal), keeps `kept_host`.

## What the source comments say, page by page

The comments stay in the source for whoever edits the page; the build drops them.

### `index.html`: the home page

- `/` on awardgrid.dowhiz.com, by an exact Worker route: a route without a wildcard does not match a query string, so
  `/?…` is still the web app's home page (`DEPLOY.md`, "Routes"; `wrangler.jsonc`). It is also the root of the
  Worker's own `workers.dev` address.
- Every sentence is registry copy (`growth/product-facts.json`): the lead is `grid`'s extra sentence (query_input, grid
  and prerequisite in one), then `release_status` for the current status, the web app's `webapp_note` (`kept_host`)
  as plain text, and `affiliation`. No "Log in" link: whoever uses the web app keeps its `/login` or `/grid` address.
- Its links are relative (`./ios/`), so they work on the hostname and on workers.dev.
- No script but JSON-LD (the organization and the website) and no webfont request; `apps/ios/src/honesty.test.ts`
  scans the page.

### Head tags on every page

Each page listed in `pages.json` carries a canonical link to itself on `https://awardgrid.dowhiz.com`, `og:type`
`website`, `og:url` (the canonical), `og:title` (its title), `og:description` (its meta description),
`twitter:card` `summary`, and the favicons `/favicon.svg` and `/favicon.ico` (the build writes them relative to the
page). No `og:image` yet. `/` and `/ios/` carry the JSON-LD graph (Organization, WebSite); nothing claims
`MobileApplication` before the app is released, and no `FAQPage` until the questions are on the page.
`sites/landing/test/crawl.test.ts` checks all of it, in the source and in the built pages.

### `ios/index.html`: the iPhone app's page

- No third-party script and no webfont request. The reason is recorded in DECISIONS.md, "The landing site ships zero
  JavaScript…".
- The lead paragraph was the web app's `home.lead` until 2026-09-28. It described the web app's table (every cell with
  miles, fees, seats, program and data age) and used "Ask" for searching, which is the name of the iPhone app's AI
  feature. It is now the registry's query_input and grid copy (growth/product-facts.json): in the iPhone app's Matrix
  each cell holds the lowest miles for each cabin asked, with the program and the seats; fees and data age are on each
  option's card (apps/ios/src/components/results/AvailabilityMatrix.tsx, AvailabilityCard.tsx).
- The example table's section sets `data-surface="flat"`: it is data, so the glass effect is off behind it, as it is
  behind restful.dowhiz.com's `.fact-table` and `.compare-table`. Blur behind a column of mileage figures makes them
  harder to read.
- The "How it works" articles are the web app's front-door copy, changed only where the move to an app made it
  untrue. The front door's `home.invite.*` block is left out: it described a shared server, and the app has none
  (DECISIONS.md, "\"Invite only\" is gone from the copy and nothing else is").
- The "What it does not do" table turns the front door's one sentence (`home.limits.body`) into a table, longer
  rather than shorter, after Restful's page (docs/PIVOT.md §4; DECISIONS.md, same entry).

### `privacy/index.html`: the iPhone app's privacy policy

- Release decisions D7 and D8 (`docs/release/IOS_1.0_RELEASE.md`). What the app sends and keeps, with sources, is in
  `docs/release/APP_STORE_HANDOFF.md` §6; `LEGAL.md` says the same for the repository.
- The App Privacy answers in App Store Connect and `apps/ios/ios/App/App/PrivacyInfo.xcprivacy` must match this page.
  Change them together, and change this page first.
- No script and no webfont request; `apps/ios/src/honesty.test.ts` scans the page.

### `support/index.html`: the support page

- Release decision D7: App Store Connect's Support URL. Facts only, in the product's own voice (`docs/COPY.md`),
  each of them one of `docs/release/APP_STORE_HANDOFF.md` §6.
- No script and no webfont request; `apps/ios/src/honesty.test.ts` scans the page.
