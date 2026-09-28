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
page). No `og:image` yet. `/`, `/ios/`, `/ios/award-grid/` and `/ios/zh-hans/` carry the JSON-LD graph (Organization,
WebSite); nothing claims `MobileApplication` before the app is released.

A page that shows questions carries a `FAQPage` node in that graph, generated from the questions it shows:
`/ios/` and `/ios/zh-hans/`. The questions follow one convention, `<section class="faq" data-faq
aria-labelledby="…">` with each question an `<h3>` and its answer the `<p>`s after it, and
`node scripts/growth/sync-faq-schema.mjs --write` writes the node from them (`--check` fails on drift, in CI). Edit
the visible questions, never the JSON-LD.

`/ios/` and `/ios/zh-hans/` name each other with `hreflang` (`en`, `zh-Hans`, and `x-default` for `/ios/`).
`/privacy/` and `/support/` hold their Chinese on the same page (`#zh`), so they have no alternates, and
`/ios/award-grid/` is in English only.

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
- Rewritten on 2026-09-28 to answer questions rather than only carry a tagline: "What you need" (the iPhone, the
  seats.aero Pro key, the Anthropic key for Ask, and the dependency on seats.aero's Partner API), the example table,
  "Questions" (the nine answers of `growth/geo/accuracy-answer.md`, word for word), "What it does not do" and "Where
  this is up to". The H1 is unchanged. Every new sentence is registry copy.
- The three "How it works" articles (the web app's front-door copy) are gone. Their facts are in "What you need",
  the questions and the table; their "Bilingual" article said "Ask in Chinese or English", and Ask is the name of
  the AI feature, so searching is "type" everywhere (`docs/COPY.md`, "The product's name").
- "How the table works" links to `/ios/award-grid/`; the footer links the Chinese version and names Anthropic in the
  affiliation sentence, as the other pages do.
- The "What it does not do" table turns the front door's one sentence (`home.limits.body`) into a table, longer
  rather than shorter, after Restful's page (docs/PIVOT.md §4; DECISIONS.md, same entry). Its rows are kept as they
  were, the "No accounts, no analytics in the app" row word for word as the owner wrote it (PR #104); "No round trips"
  (the scope claim) was added.
- "Where this is up to" is the released status (the switch to released), all registry copy: release_status's
  released sentence for this page, the prerequisite, the dependency, the prerequisite's released sentence from
  seats.aero's help centre (not every Pro account or country gets API access), a link to the listing with the campaign
  token `ct=awardgrid-ios` and the provider token `pt=124116782`, and the pointer to the privacy policy. Before the day
  the app is first found on the App Store the gate finds all of it premature (`--status submitted`;
  `scripts/growth/current-tree.test.ts` pins the list).
- Known mismatches, kept as the spec says until the owner decides:
  - The example table is laid out the web app's way: one row per route, one column per date, and a bare "—" in an
    empty cell. The iPhone app's Matrix, which "How the table works" describes right below it, has the dates as rows
    and the routes as columns, labels each slot with its cabin, and says why a slot is empty ("No matches") instead
    of a bare dash (`apps/ios/src/components/results/AvailabilityMatrix.tsx`). The caption covers the figures, not
    the layout. Either the example is redrawn as the Matrix, or the link moves away from it.
  - Two kept rows of "What it does not do" say less exactly what the registry says: "It checks your watches when you
    open the app, and at no other time" (the app also checks when you return to it, as the questions above say:
    `apps/ios/src/app/App.tsx`), and "Without your seats.aero Pro key the app does nothing at all" (the app has an
    example screen that needs no key; the registry's words are "searches nothing"). Changing them is a two-word edit
    each, once the owner allows it.
- The meta description names the key first and is 155 characters or fewer, so a search result does not cut the
  prerequisite off; `sites/landing/test/crawl.test.ts` holds every page's description to that width (a CJK
  character counts as two).

### `ios/award-grid/index.html`: how the table works

- For someone asking whether an app puts several origins, destinations and dates into one table. The claim is the
  narrow one: on iPhone, on your own seats.aero Pro key, several origins, several destinations and up to 92 days.
  It does not say no other tool does this.
- Every sentence is registry copy: identity, grid, prerequisite, keys, query_input, filters, views, program_link,
  data_cached, cell_fields, programs, scope, quota, watches, dependency, not_offered and release_status.
- The table is the iPhone app's Matrix: each cell holds, for each cabin asked, the lowest miles, the program and the
  seats; fees and data age are on each option's card (`AvailabilityMatrix.tsx`, `AvailabilityCard.tsx`). The
  web app's table put fees and data age in the cell, and that wording is retired (`grid.retired_copy`).
- No other tool is named: the registry holds no claim about any other tool. No example query: none is registered (a
  whole query needs a parser fixture test first), and the parser reads bare airport codes only in upper case.
- The lead says what the table is (several origins, several destinations and up to 92 days, on your own key); what a
  cell and an option's card show is left to "What the table shows", so the page says it once. The steps of "How it
  works" use the step-shaped sentences of views, program_link and keys ("your iPhone", since a web page may be read
  on any device). Cabins are not called an optional filter: a search always asks for at least one, business and
  first unless you choose others (the filters claim).
- The status sentence sits right before the prerequisite, so the released status sentence, which says "free", can
  replace it as it is (`FREE_WITHOUT_PRO`).

### `privacy/index.html`: the iPhone app's privacy policy

- Release decisions D7 and D8 (`docs/release/IOS_1.0_RELEASE.md`). What the app sends and keeps, with sources, is in
  `docs/release/APP_STORE_HANDOFF.md` §6; `LEGAL.md` says the same for the repository.
- The App Privacy answers in App Store Connect and `apps/ios/ios/App/App/PrivacyInfo.xcprivacy` must match this page.
  Change them together, and change this page first.
- No script and no webfont request; `apps/ios/src/honesty.test.ts` scans the page.

### `support/index.html`: the support page

- Release decision D7: App Store Connect's Support URL. Facts only, in the product's own voice (`docs/COPY.md`),
  each of them one of `docs/release/APP_STORE_HANDOFF.md` §6.
- The first two questions, in English and in the Chinese section, are where to find the seats.aero API key and what
  a missing API tab means (the prerequisite and dependency claims; seats.aero's own page on API access). A person
  without API access should learn it before installing, not after.
- Its questions do not use the FAQ convention (`data-faq`), so the page carries no FAQPage.
- No script and no webfont request; `apps/ios/src/honesty.test.ts` scans the page.
