# e2e — Playwright harness (Phase 6 §9)

Everything here runs **offline with no keys**: a `DEMO=1` mock seats.aero server on `:3999`
(`scripts/mock-seatsaero.ts`, serving `fixtures/demo/`) and a production `next start` on
`:3400` over a throwaway SQLite file. Nothing on any screenshot is real data.

## Run

```sh
pnpm build                 # once; the suite needs a production build (.next/BUILD_ID)
pnpm e2e                   # all projects: desktop-light, desktop-dark, mobile-light, mobile-dark
pnpm e2e -g before         # only the "before" screenshots (docs/screenshots/v0.2/before/)
pnpm e2e -g axe            # only the axe baseline (desktop projects)
pnpm e2e -g screenshots    # only the §9 capture matrix (docs/screenshots/v0.2/)
pnpm e2e -g responsive     # only the three width bands + reduced motion + the i18n floor
pnpm e2e -g "keyboard walk" # only the mouse-free walk of docs/UI.md §8
VISUAL=1 pnpm e2e -g visual         # compare against the committed Linux baselines
VISUAL=1 pnpm e2e:update -g visual  # rewrite them — put the reason in the commit message
pnpm e2e:ui                # Playwright UI mode
pnpm exec playwright show-report e2e-report

pnpm exec tsx scripts/screenshot-index.ts          # rebuild the contact sheet
pnpm exec tsx scripts/screenshot-index.ts --check  # check names only, write nothing
```

If `.next/BUILD_ID` is missing, `e2e/start-app.sh` runs `next build` itself (Playwright starts
the `webServer` entries *before* `globalSetup`, so the script is the guard that actually fires;
`e2e/global-setup.ts` repeats the check). `next start` prints a warning about `output:
"standalone"`; it still serves pages, static assets and the API, so the harness keeps the
simpler `next start` rather than copying `.next/static` into the standalone tree.

Typecheck the harness with `pnpm exec tsc -p e2e/tsconfig.json --noEmit` (the root `tsconfig.json`
does not include `e2e/`; `playwright.config.ts` and `scripts/seed-e2e.ts` are covered by
`pnpm typecheck` as well). `pnpm lint` covers `e2e/`.

## Servers and environment

| Server | Command | Ready check |
|---|---|---|
| mock seats.aero | `DEMO=1 MOCK_SEATS_PORT=3999 pnpm exec tsx scripts/mock-seatsaero.ts` | `GET /healthz` (keyless, 200) |
| app | `bash e2e/start-app.sh` → seed + `next start -H 127.0.0.1 -p 3400` | `GET /login` |

The app process gets (from `playwright.config.ts`, `appEnv`): `DATABASE_PATH=<tmpdir>/awardgrid-e2e/e2e.db`
(override with `E2E_DB_PATH`), `MASTER_KEY=eeee…` (64 × `e`, test-only), `SEATS_AERO_BASE_URL=http://127.0.0.1:3999/partnerapi/`,
`APP_URL=http://127.0.0.1:3400`, `COOKIE_SECURE=false`, `NODE_ENV=production`, `TZ=UTC`,
`ANTHROPIC_API_KEY=""` (the ask lane shows its "not configured" state), `ASK_DEMO_STREAM=1`
(the scripted Ask stream below) and no Telegram token (mock transport). Because these are set in the process environment they beat any local `.env`.
Ports: `E2E_APP_PORT`, `E2E_MOCK_PORT`. Locally `reuseExistingServer` is on, so a server you
started yourself on those ports is reused; in CI (`CI=1`) the suite always starts its own.

## The scripted Ask stream (`/api/ask/demo`)

The app runs with no `ANTHROPIC_API_KEY`, so the real ask lane can never stream and the Ask
drawer's streaming states would be unphotographable. `src/app/api/ask/demo/route.ts` replays a
fixed, obviously synthetic answer as SSE framed exactly like `POST /api/ask` (init, text deltas
every 150 ms, two tool events, a result with a cost), so `e2e/ask-drawer.spec.ts` can exercise
and photograph the streaming UI offline. Nothing on those screenshots was fetched.

Two switches, both required, so nothing of this exists in production:

- **Server:** `ASK_DEMO_STREAM=1` (exported by `start-app.sh`). Without it the route is a 404.
- **Page:** `?askdemo=1` in the URL, remembered in `sessionStorage` for the rest of the session
  (the grid rewrites its own URL when a query runs). `NEXT_PUBLIC_ASK_DEMO=1` at **build** time
  does the same for every page; the harness deliberately does not set it, because it is inlined
  by `next build` (so it would only apply when `start-app.sh` runs the build) and it would put
  every other spec's Ask drawer on the scripted stream.

Extra page switches, for the states a happy stream cannot show: `&askcap=1` reports today's
spend at the cap (disabled input, reason and reset time) and `&askerr=<code>` answers with one
scripted failure (`no_key`, `timeout`, `plugin_missing`, `budget`, `sdk`). The drawer probes
`/api/ask/demo?probe=1` once on mount and falls back to the real `/api/ask` on a 404.

## Database and users (`scripts/seed-e2e.ts`)

`start-app.sh` runs `pnpm exec tsx scripts/seed-e2e.ts --db "$DATABASE_PATH" --fresh` on every
start: the SQLite file is deleted and recreated, migrations applied, users created. The script
is idempotent without `--fresh`, refuses the default runtime database path, and prints usernames
only. Password for every user: `demo-password-1`. The seats.aero key of each user is a **scenario
selector** for the mock (`DEMO_KEYS` in `scripts/mock-seatsaero.ts`) — the app never learns that:

| User | Key | What you get |
|---|---|---|
| `demo` | `demo-key-normal` | full demo dataset; one saved standing query ("Asia to Seattle, business and first", every 3 h) with one recorded run (+3 new, −1 dropped) |
| `nokey` | — | "Add your seats.aero key" empty state; the Ask drawer's no-key state |
| `empty` | `demo-key-empty` | `/search` answers with no rows → "No award seats found"; `/queries` empty state |
| `linked` | `demo-key-normal` | Telegram already linked, quiet hours set → the second Settings state |
| `slow` | `demo-key-slow` | every mock response delayed 1 500 ms → loading states |
| `slow2`, `slow3`, `slow4` | `demo-key-slow` | the same, one per Playwright project (`E2E_SLOW_USERS`): the availability cache is keyed by user, and a project must not be served the previous project's answer |
| `slow5`–`slow8` | `demo-key-slow` | a second set of four (`E2E_CHIP_SLOW_USERS`) for `chips.spec.ts`, which runs the same query: sharing one set would let whichever spec ran first warm the cache |
| `partial` | `demo-key-partial` | `aeroplan` rows omitted; `/routes?source=aeroplan` → 500 ("one program not fetched") |
| `quota` | `demo-key-normal` | `api_usage` row for today at 950 calls → quota banner, search refused |
| `mixed` | `demo-key-normal` | the Mixed cabin chip test (issue #18), the only one that runs the query twice: on `demo` those two extra calls moved the `used / limit` readout in every published capture taken after it |

The shared constants live in `e2e/users.ts` (dependency-free: Playwright loads it with its own
loader, so it must not import Next.js or the database).

## Fixtures (`e2e/fixtures.ts`)

- `loginAs(page, username)` / `asUser(username)` — POST `/api/auth/login` with an `Origin`
  header (the cross-site guard) through an API request context, then copy the httpOnly cookie
  into the page's context. One login per user per worker (cached), so the login throttle is never hit.
- `applyTheme(page)` — `emulateMedia({ colorScheme, reducedMotion: "reduce" })` from the project name.
- `openGridWithResults(page, user?, text?)`, `openCellDrawer`, `closeDrawer`, `openAskDrawer`,
  `submitQuery`, `queryBox`, `availableCells` — role/text selectors on the current UI (no data-testids).
- `beforeShot(page, name)` — full-page PNG to `docs/screenshots/v0.2/before/<name>-<viewport>-<theme>.png`.
- `CANONICAL_QUERY_ZH` / `CANONICAL_QUERY_EN` — the spec's canonical query; both parse
  deterministically, so no language model is needed.

## Specs

- `before.spec.ts` — the Phase 6.0 "before" images of the v0.1 UI: login, register, grid-empty,
  grid-results, grid-cell-drawer, grid-ask-drawer, grid-nokey, grid-quota, grid-empty-results,
  queries, queries-empty, settings, legal — 13 per project, 52 files. Plain `page.screenshot()`
  captures, not visual-regression baselines. Known artefact: with `fullPage` the drawer's
  backdrop covers only the first viewport height (fixed-position overlay); the drawer itself is
  intact. The PNGs are the record of the v0.1 UI and are never regenerated: to prove the spec
  still passes against a newer UI it writes to `test-results/before/` (gitignored) by default; the committed record under `docs/screenshots/v0.2/before/` was captured once in 6.0 and is never regenerated (set `E2E_BEFORE_DIR` explicitly to write elsewhere).
- `axe.spec.ts` — `@axe-core/playwright` (WCAG 2.x A/AA tags) on login, register, legal, grid
  results, the eight chip editors, the cell drawer, the Ask drawer, quota, no key, empty results,
  parse failure, manual mode, queries (list, expanded row, edit drawer, empty) and settings, on
  **desktop-light, desktop-dark and mobile-light** (dark is audited too because contrast is the
  point). Since 6.6 the §8 floor — zero serious/critical — is enforced **by default**;
  `E2E_AXE_STRICT=0` downgrades the run to report-only. Writes counts per impact to
  `docs/screenshots/v0.2/axe-summary.json` (the 6.0 baseline stays in `before/axe-summary.json`)
  and logs serious/critical ids. 6.0 baseline: one serious `color-contrast` violation on
  grid-results; the design system removed it.
- `responsive.spec.ts` — Phase 6.6 (spec §6, §8): the three width bands in one pass. The viewport
  is set per test (1440 / 1024 / 390) rather than by the project, because density is width-driven,
  so the spec runs on **desktop-light only**. It pins the cell losing a line at each step down,
  the drawer going push → overlay → sheet (and the Ask drawer's bottom sheet with its drag
  handle), the toolbar collapsing into the Filters sheet, chip wrapping, the reduced top bar, the
  sticky date column under sideways scroll, 40 px touch targets, no sideways page overflow on any
  route, "nothing animates" under `prefers-reduced-motion`, and the i18n floor (no English string
  leaks through in zh-CN).
- `keyboard-walk.spec.ts` — Phase 6.6 (spec §8): the mouse-free walk written out in `docs/UI.md`
  §8, step for step, asserting `document.activeElement` after each key press. **Nothing in it
  clicks.** It runs on **desktop-light only** — it is a focus-order contract, not a rendering
  check. If a step changes in `docs/UI.md` §8 it changes here, and the reverse.
- `shell.spec.ts` — Phase 6.1: top bar, footer, theme and language toggles, user and mobile
  menus, login/register/legal. Captures land in `docs/screenshots/v0.2/shell/`.
- `ask-drawer.spec.ts` — Phase 6.4 (spec §3.6): context pills and their `aria-pressed` toggle,
  the three suggestions, the streamed markdown answer, tool activity collapsed and expanded,
  Stop, the cost meter moving after an answer, the cap and the mobile bottom sheet. Captures land
  in `docs/screenshots/v0.2/ask-drawer/`. Every stream here is the scripted one above. The
  keyless drawer is captured through `&askerr=no_key`, not the `nokey` user: the "Ask" button
  lives in the toolbar, which only renders once a query has run on a key.
- `screenshots.spec.ts` — Phase 6.6: the whole §9 capture matrix (see below), and nothing else.
  It never writes to the e2e database: "Run now" and the Telegram deep link are intercepted and
  answered in `e2e/states.ts`, and the invalid-key paste is rejected by the mock before any write.
  The loading skeleton is reached by delaying the browser's own `/api/find` call rather than by
  borrowing a `slow` seed user — all eight are claimed by `grid.spec.ts` and `chips.spec.ts`, and
  the availability cache is per user.
- `visual.spec.ts` — Phase 6.6: the curated `toHaveScreenshot` subset (see below). Inert without
  `VISUAL=1`.

## The capture matrix (spec §9)

One declaration, one spec, one generated index:

| File | Role |
|---|---|
| `e2e/matrix.ts` | the matrix itself — page, state, what it shows, viewports, full-page or not. Dependency-free, so `tsx` can import it outside Playwright. |
| `e2e/states.ts` | how to *reach* each state (log in, run the query, open the drawer, stub the one write). Shared with `visual.spec.ts`, so the two suites can never mean different things by "the Ask drawer mid-stream". |
| `e2e/screenshots.spec.ts` | walks the matrix and captures it. Its last test fails if any declared PNG is missing for that project. |
| `scripts/screenshot-index.ts` | builds `docs/screenshots/v0.2/README.md` (the contact sheet) and checks the tree. |

**Naming rule**, enforced by `FILE_RE` in `e2e/matrix.ts` and by the index script:

```
docs/screenshots/v0.2/<page>/<state>-<viewport>-<theme>[-zh].png
        page      shell · grid · queries · settings   (before/ keeps the v0.1 record)
        viewport  desktop (1440×900) · mobile (390×844)
        theme     light · dark
        -zh       the same state again with the UI in zh-CN (spec §8)
```

Pages are captured full-page; drawer, popover and sheet states are captured at viewport size —
`fullPage` paints a fixed-position backdrop over the first viewport height and nothing below it,
which photographs an artefact instead of the drawer. A `clip` takes the top N px at full width,
for a state whose subject is a strip of chrome (`shell/topbar`, `shell/topbar-user-menu`).
Deliberate gaps, all declared in the matrix: `grid/hover-tooltip` is desktop-only (a tooltip never
opens on touch — the tap opens the drawer), `shell/topbar-menu` is mobile-only and
`shell/topbar-user-menu` desktop-only, because each is the presentation the other viewport does
not have.

The index script exits 1 on a folder that is not a known page, a file that breaks the naming
rule, or a matrix entry with no PNG on disk; `--strict` also fails on a capture the matrix does
not declare. It reports any PNG over 400 KB and prints the total size of the tree.

**One owner per capture** (#34). Every PNG outside `before/` is declared in `e2e/matrix.ts` and
written by `screenshots.spec.ts`; the feature specs assert and photograph nothing, and there are
no per-feature detail folders any more. `pnpm exec tsx scripts/screenshot-index.ts --strict
--check` is a required step in the CI `checks` job, so a capture that is not declared fails the
build rather than quietly joining the tree. To add one: add a `MatrixShot`, and a state helper in
`e2e/states.ts` if the state is new.

## Visual-regression baselines (Linux plan)

`e2e/visual.spec.ts` holds a curated subset — eight states × three projects (desktop light and
dark, mobile light) = 24 `toHaveScreenshot` comparisons — at `maxDiffPixelRatio: 0.01` with
animations disabled. Everything whose text is a clock reading is masked (`timeMasks()` in
`e2e/states.ts`): freshness ages, the quota counters and "resets in", the grid's date row headers
and Dates chip (the demo dataset is shifted so day one is *today*, so every date label moves
overnight), relative run times, and the key row's "added <date>". The masked box is still
compared; only the reading inside it is exempt.

`snapshotPathTemplate` is `e2e/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}` —
**no platform suffix**. Baselines are generated and committed from Linux CI, never from a Mac:
font rasterisation differs and a macOS baseline would fail on CI. So the projects set
`ignoreSnapshots` unless `VISUAL=1`, and a plain `pnpm e2e` runs the visual tests (proving the
states are still reachable) without ever failing on a missing or foreign baseline.

**Updating the baselines** — they only exist for Linux, so they come from CI:

1. Push the branch. The `visual` job runs `VISUAL=1 pnpm e2e -g visual` with
   `continue-on-error: true` (spec §11: non-blocking until five consecutive green runs, then
   promote to required and record it in `DECISIONS.md`) and uploads `e2e/__screenshots__` plus
   `test-results` — the expected/actual/diff triples — as the artifact **`visual-snapshots`**.
2. When no baseline is committed yet, the job instead runs `VISUAL=1 pnpm e2e:update -g visual`
   and uploads the generated set as the artifact **`visual-baselines`**.
3. Download that artifact, unzip it into `e2e/__screenshots__/`, and commit it **with the reason
   in the commit message** ("visual: rebaseline — cell line height changed in <PR>").

Locally, `VISUAL=1 pnpm e2e:update -g visual` writes macOS baselines: useful for a quick look,
never for committing.

## Rules

- Screenshots must never contain real data: only the seeded users, the demo dataset and the
  mock server are allowed on screen. Never point the harness at a real database or key.
- Nothing here is a secret: the master key is 64 × `e`, passwords and keys are the literal
  strings above. Keep it that way so gitleaks stays quiet (no hex blobs, no `sk-` prefixes).
- Output folders (`e2e-report/`, `test-results/`, `playwright/.cache/`) are gitignored.
  `e2e/__screenshots__/` deliberately is **not**: those are the committed Linux baselines.
- One suite at a time per checkout. Every run seeds the same SQLite file, binds the same two
  ports and clears `test-results/`, so two `pnpm e2e` runs in one working tree take each other's
  app server down mid-test.
