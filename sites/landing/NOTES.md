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

## What the source comments say, page by page

The comments stay in the source for whoever edits the page; the build drops them.

### `index.html`: the site's own root

- On awardgrid.dowhiz.com the web app keeps `/`; the Worker `awardgrid-site` serves only `/ios/`, `/privacy/`,
  `/support/` and `/_site/` from this build (`DEPLOY.md`, `wrangler.jsonc`). This page is what the Worker's own
  `workers.dev` address shows at its root (`DEPLOY.md`). The source comment still calls it "the Pages project's own
  address"; the site has been a Worker since 2026-09-25 (`DEPLOY.md`).
- No script and no webfont request; `apps/ios/src/honesty.test.ts` scans the page.

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
