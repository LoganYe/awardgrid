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
pnpm e2e:update            # refresh toHaveScreenshot baselines — put the reason in the commit message
pnpm e2e:ui                # Playwright UI mode
pnpm exec playwright show-report e2e-report
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
`ANTHROPIC_API_KEY=""` (the ask lane shows its "not configured" state) and no Telegram token
(mock transport). Because these are set in the process environment they beat any local `.env`.
Ports: `E2E_APP_PORT`, `E2E_MOCK_PORT`. Locally `reuseExistingServer` is on, so a server you
started yourself on those ports is reused; in CI (`CI=1`) the suite always starts its own.

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
| `slow` | `demo-key-slow` | every mock response delayed 1 500 ms → loading states |
| `partial` | `demo-key-partial` | `aeroplan` rows omitted; `/routes?source=aeroplan` → 500 ("one program not fetched") |
| `quota` | `demo-key-normal` | `api_usage` row for today at 950 calls → quota banner, search refused |

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
  intact.
- `axe.spec.ts` — `@axe-core/playwright` (WCAG 2.x A/AA tags) on login, grid-results, settings,
  queries for the two desktop projects. Writes counts per impact to
  `docs/screenshots/v0.2/before/axe-summary.json` and logs serious/critical ids. It does **not**
  fail yet; set `E2E_AXE_STRICT=1` (or flip `AXE_STRICT`) once 6.6 lands to enforce the §8 floor.
  Baseline: one serious `color-contrast` violation on grid-results in both themes.

## Visual-regression baselines (Linux plan)

`snapshotPathTemplate` is `e2e/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}` —
**no platform suffix**. Baselines are generated and committed from Linux CI (the `visual` job,
non-blocking at first, §11), never from a Mac: font rasterisation differs, and a macOS baseline
would fail on CI. `toHaveScreenshot` runs with `maxDiffPixelRatio: 0.01` and animations disabled.
No `toHaveScreenshot` assertions exist yet (6.0 only ships the harness and the "before" PNGs).

## Rules

- Screenshots must never contain real data: only the seeded users, the demo dataset and the
  mock server are allowed on screen. Never point the harness at a real database or key.
- Nothing here is a secret: the master key is 64 × `e`, passwords and keys are the literal
  strings above. Keep it that way so gitleaks stays quiet (no hex blobs, no `sk-` prefixes).
- Output folders (`e2e-report/`, `test-results/`, `playwright/.cache/`) are gitignored.
