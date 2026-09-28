# AwardGrid

<!-- public-claims:start -->
## AwardGrid for iPhone

AwardGrid is an iPhone app by Curastone CORP.
AwardGrid for iPhone has been submitted to the App Store.
AwardGrid for iPhone has been submitted as a free app, with no in-app purchase. It needs your own paid seats.aero Pro subscription with API access; without that key it searches nothing.
AwardGrid depends on seats.aero's Partner API, which seats.aero licenses for non-commercial use and can limit or withdraw. Check your seats.aero settings show an API tab before you subscribe.

It puts seats.aero's cached award availability for several origins, several destinations and up to 92 days into one table. Each cell shows the lowest miles for each cabin you asked for, with the program and the seats left; each option also shows its fees and how old the data is.

Type the routes and dates in English or Chinese, or set them in the editor.
List, Calendar and Matrix views; compare up to four options; save results on the device.

Results are seats.aero's cached availability, not a live search, and each shows how old it is. Confirm on the program's own site before you transfer points.
Watches are checked when you open or return to the app, and at no other time; there is no background check and no notification.
Ask is optional: it answers questions about your results with Claude, on your own Anthropic API key, after you allow it. Anthropic bills each question to that key.

The AwardGrid iPhone app has no accounts and no server of its own, and there is no analytics, advertising, tracking or crash reporting in the app. Searches go to seats.aero and, only for Ask, to Anthropic.

For an option it opens seats.aero's booking link when there is one; otherwise you copy the search. It never books.
No live search, no booking, no round trips, no alerts or notifications, no scraping of airline or bank sites, no airline or bank passwords, no logos.

AwardGrid is not affiliated with, endorsed by, or sponsored by seats.aero, Anthropic, any airline, or any loyalty program.

- About the app: <https://awardgrid.dowhiz.com/ios/>
- Privacy policy: <https://awardgrid.dowhiz.com/privacy/>
- Support: <https://awardgrid.dowhiz.com/support/>
<!-- public-claims:end -->

## Private web app (separate from the iPhone app; not public)

This repo also holds a private, invite-only web app, separate from the iPhone app.

AwardGrid began as a private, invite-only web app for its developer and a small group of friends. The iPhone app
has been submitted to the App Store as a separate public release. Every user brings their **own** seats.aero Pro key.
**Data: seats.aero.**

The web app's scheduler (the **worker** lane below) is not running in the current deployment (`docs/DEPLOYMENT.md`).

Two lanes plus a scheduler (`ARCHITECTURE.md` §1):

- **find** (fast, deterministic): text → `QueryObject` (deterministic parser; one Claude structured-output call only when
  dates or places cannot be resolved) → seats.aero Cached Search / Bulk Availability with the calling user's key →
  per-user cache → pivot → grid. The LLM never fetches award data.
- **ask** (slow, advisory): one Claude Agent SDK session per question with the pruned, MIT-licensed
  [travel-hacking-toolkit](https://github.com/borski/travel-hacking-toolkit) plugin; read-only, cost-capped, streamed.
- **worker**: standing queries re-run on a cron, diffed against the last run, pushed to the user's own Telegram chat.

No scraping, no shared keys, no Live Search, no logos, no money. See `LEGAL.md`.

## Requirements

- Node ≥ 22 (`.nvmrc`; `better-sqlite3@13` needs 22). On this project's dev Mac the arm64 build lives at
  `~/.local/node-arm64` — put its `bin` first on `PATH`.
- pnpm 12 via corepack: `corepack enable pnpm && corepack prepare pnpm@12.3.4 --activate` (pinned in `package.json#packageManager`).
- One **seats.aero Pro** API key **per user** (seats.aero → Settings → API; Pro = 1,000 calls/day, non-commercial). It is
  pasted by each user in Settings, never configured on the server.
- One **Anthropic API key** for the operator (`ANTHROPIC_API_KEY`) — used only by the parser fallback and the Ask lane.
- Optional: a Telegram bot token (standing-query alerts), Docker + Compose (deployment).

## Setup in five commands

```sh
git clone --recurse-submodules <repo-url> awardgrid && cd awardgrid   # the toolkit is a git submodule under vendor/
pnpm install
cp .env.example .env && node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # paste into MASTER_KEY=
pnpm db:migrate                                                       # creates data/runtime/awardgrid.db (DATABASE_PATH)
pnpm admin invite --for <name> && pnpm dev                            # http://localhost:3000 → /register with the code
```

Also put `ANTHROPIC_API_KEY` in `.env`. `next dev` / `next start` read `.env` themselves; the tsx CLIs (`pnpm grid`,
`pnpm admin`, `pnpm worker`, `pnpm db:migrate`) do **not** — export it first when they need more than the defaults
(`set -a && . ./.env && set +a`; `pnpm worker` needs `MASTER_KEY`). The Ask lane additionally needs `pnpm build:plugin`
once (see below).

## Environment variables (`.env.example`)

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `MASTER_KEY` | yes | — | 64 hex chars (32 bytes). AES-256-GCM key for every stored user API key. Losing it invalidates all stored keys; rotating it means every user re-enters their key. |
| `ANTHROPIC_API_KEY` | yes (parser fallback, Ask) | — | Operator's Anthropic key. Without it, queries that the deterministic parser cannot resolve return a clear error and Ask is unavailable; the grid itself still works. |
| `DATABASE_PATH` | no | `./data/runtime/awardgrid.db` | SQLite file shared by the app and the worker. Volume-mount it in Docker. |
| `APP_URL` | no | `http://localhost:3000` | Public base URL used in Telegram messages (grid links). |
| `TELEGRAM_BOT_TOKEN` | no | — | Bot token from @BotFather. Empty → mock transport (alerts are logged, linking is disabled). |
| `TELEGRAM_BOT_USERNAME` | no | from `getMe` | Bot username for the `t.me/<bot>?start=…` deep link; leading `@` is stripped. |
| `TELEGRAM_API_BASE` | no | `https://api.telegram.org` | Override only for tests/proxies. |
| `AWARDGRID_DATA_DIR` | no | `./data/runtime` | Mock-transport JSONL sink and worker state. |
| `AWARDGRID_PARSER_MODEL` | no | `claude-haiku-4-5-20251001` | Parser model (structured output). Haiku 4.5 retires no sooner than 2026-10-15 — set this when it does. |
| `AWARDGRID_ASK_MODEL` | no | `claude-sonnet-5` | Ask-lane model passed to the Agent SDK. |
| `CACHE_TTL_MINUTES` | no | `45` | Per-user availability cache TTL; re-renders and standing queries reuse pulls inside it. |
| `SEATS_AERO_DAILY_SOFT_LIMIT` | no | `950` | Per-user hard stop below seats.aero's 1,000/day; the reset time (assumed 00:00 UTC) is shown. |
| `ASK_DAILY_COST_CAP_USD` | no | `2` | Per-user daily Ask spend, summed from the SDK's `total_cost_usd`. |
| `ASK_TIMEOUT_MS` | no | `120000` | Wall-clock abort for one Ask session (`AbortController`). |
| `SEATS_AERO_BASE_URL` | dev only | — | Point the client at `scripts/mock-seatsaero.ts` (`http://127.0.0.1:3999/partnerapi/`). Never set in production. |
| `COOKIE_SECURE` | no | `true` in production | Set `false` for plain-HTTP deployments (Tailscale without TLS); cookies are `HttpOnly`, `SameSite=Lax`. |
| `TRUST_PROXY_HEADERS` | no | unset | Set `1` only behind a trusted reverse proxy (Cloudflare Access / Tailscale Serve) so `X-Forwarded-For` feeds the per-IP login limiter. Otherwise limits key on username + a global bucket. |

Not in `.env.example` but read by the CLI: `SEATS_AERO_API_KEY` (your own key for `pnpm grid` live mode),
`AWARDGRID_FIXTURE` (same as `--fixture`), `AWARDGRID_CACHE_DIR` (on-disk Get Routes cache for the CLI; default
`$XDG_CACHE_HOME/awardgrid` or `~/.cache/awardgrid`), `AWARDGRID_PLUGIN_ROOT` (built plugin location; default `./build/plugin`,
set by the Docker image), `ASK_PER_REQUEST_MAX_USD` (default `0.5`), `MOCK_SEATS_PORT` (default `3999`).

## The CLI: `pnpm grid`

```sh
pnpm grid "香港,上海,东京,首尔到西雅图 未来一个月 头等" --fixture test/fixtures/seatsaero/synthetic-example-query.json
pnpm grid "HKG, TYO to SEA next month business" --csv out.csv --orientation routes --lang en
SEATS_AERO_API_KEY=<your-key> pnpm grid "SEA to NRT 2026-11-01 to 2026-11-15 F"       # live, your own key
```

Flags: `--fixture <cached-search.json>` (offline, no key), `--csv <file>`, `--json`, `--orientation dates|routes`,
`--lang zh|en`, `--today YYYY-MM-DD`, `--width N`. Exit codes: 0 ok · 2 parse problem · 3 quota · 4 API/config.
The first line echoes the parsed query (origins after city expansion, dates, cabins, programs) so a wrong expansion is
visible; the footer shows calls used and cache status. `pnpm run find` is an alias — note the `run`: pnpm ≥ 10 reserves
the bare `pnpm find` for registry search, and built-ins win over `package.json` scripts.

## Admin CLI: `pnpm admin`

```
pnpm admin invite --for <name>            mint one invite code (prints the code only)
pnpm admin users                          list users: username, created, has seats key
pnpm admin invites                        list unused invite codes
pnpm admin revoke-sessions --user <name>  sign a user out everywhere
```

Reads `DATABASE_PATH`. Never prints hashes, keys or session tokens.

## Adding a friend

1. `pnpm admin invite --for alice` → one single-use code.
2. Send them the code and the URL. The bare host now says what this is, that there is no public signup, and that they
   must bring their own paid seats.aero Pro key; `/register?code=…` takes them straight to the form. They pick a
   username and password (argon2id) and enter the code.
3. They open **Settings → API keys** and paste their own seats.aero Pro key. Saving costs one seats.aero call (validation)
   on *their* quota; the UI then shows only `••••` + the last four characters. Optional Duffel / Ignav keys are used
   only by the Ask lane.
4. Optional: Settings → Telegram → Link, and Settings → quiet hours / language.

There is no server key: a user without a key sees an empty state pointing to Settings, and neither the grid nor the
worker ever borrows another user's key. Caches and daily quotas are per user.

## Standing queries + Telegram

- Save any parsed query from the grid header with a name, a cron (default `0 */3 * * *`; anything more frequent than
  hourly is rejected), a notify rule (`new_cells` | `price_drop` | `both`, default `both`) and a drop threshold (default 10%).
  Manage them at `/queries` (list, last run, toggle, edit, delete, run now).
- Run `pnpm worker` (same `.env`, same SQLite). It ticks every minute (UTC), runs due queries with the owner's key
  (respecting the cache TTL and quota — insufficient quota records `skipped_reason=quota` and sends nothing), diffs on
  `(program, origin, dest, date, cabin)`, and sends one digest per run with new cells and drops ≥ threshold. Quiet hours
  delay delivery to the next run rather than dropping it.
- Telegram: create a bot with [@BotFather](https://t.me/BotFather), set `TELEGRAM_BOT_TOKEN` and
  `TELEGRAM_BOT_USERNAME` in `.env`, start `pnpm worker` (it long-polls `getUpdates`; no public webhook needed), then
  each user clicks **Link Telegram** in Settings and presses Start on the one-time `t.me` deep link (15-minute expiry).
  Messages go only to that chat. `/unlink` in the chat, or Unlink in Settings, stops them.
- With no token the worker uses a **mock transport**: messages are appended to `AWARDGRID_DATA_DIR/notify-mock.jsonl` (chat ids hashed)
  and Settings keeps the account's real status ("Not linked") with a line saying this server does not send alerts.

## The Ask lane

```sh
pnpm build:plugin      # vendor/travel-hacking-toolkit → build/plugin (gitignored); rerun after a submodule update
```

`scripts/build-plugin.ts` copies the vendored plugin root (`.claude-plugin/plugin.json`, name `travel-hacker`), the
27 kept skills, `data/*.json` and `LICENSE`, and **removes 21 skills**: everything that uses Docker/Patchright or
browser automation (`american-airlines`, `amex-travel`, `chase-travel`, `southwest`, `ticketsatwork`, `vrbo`,
`sutochno`, `google-flights`, `seatmaps`), reads `*_USERNAME`/`*_PASSWORD` or keys awardgrid does not manage
(`awardwallet`, `rapidapi`, `serpapi`, `tripadvisor`, `scandinavia-transit`), runs installers or scripts
(`atlas-obscura`, `deutsche-bahn`, `round-the-world`), or touches the filesystem (`gardening`, `trip-log`,
`getting-started`, `compare-hotels`). The list is explicit in `scripts/plugin-manifest.ts`; the build fails if a
toolkit update adds an unclassified skill, and `build/plugin/PRUNED.md` records the result. Of the toolkit's MCP servers
only the keyless kiwi / trivago / ferryhopper / skiplagged are passed to the session; `agents/`, `.mcp.json` and
`scripts/` are never copied.

At runtime each question spawns one Agent SDK session with a **replaced** environment containing only the calling
user's decrypted keys (`SEATS_AERO_API_KEY`, optional `DUFFEL_API_KEY_LIVE` / `IGNAV_API_KEY`), `settingSources: []`,
`strictMcpConfig: true`, a tool gate (Read/Glob/Grep inside the plugin only; `curl` to an allow-list of API hosts;
no writes), `maxTurns: 12`, a per-request budget of `min($0.50, remaining)`, a **$2/user/day** cap, and a **120 s**
abort. The current grid's `QueryObject` and the selected cell are injected as context; the answer streams over SSE.
The system prompt allows search, compare and explain only — never book, log in or bypass anything.

## UI

Seven pages — `/grid`, `/queries` and `/settings` behind a session, `/login`, `/register` and `/legal` reachable
without one, and the signed-out front door at `/` — built on one small design system: eleven colour tokens per theme in `src/styles/tokens.css`, one
sans with tabular figures and a CJK fallback stack, a 13/14/16/20 px scale, no logos and no brand colours.
`docs/UI.md` is the working manual (tokens, component map, how to add a string or a token, responsive rules, the a11y
floor); `docs/UI_PLAN.md` is the design record behind it.

- **Themes.** Light and dark, default following the system. The top bar's theme control is a text button that cycles
  System → Light → Dark; Settings → Language and theme has the explicit radios. The choice is stored in the `ag_theme`
  cookie (per device, read in the root layout so there is no flash) and in `users.theme` (per account, seeding a new
  device). Language is EN / 中文 in the same bar; both dictionaries are complete (601 keys each).
- **Keyboard.** The grid is one tab stop with a roving focus: **arrows** move a cell, **Home / End** jump to the ends of
  the row, **Ctrl/Cmd+Home / End** to the grid corners, **PageUp / PageDown** move 7 rows (one week), **Enter** or
  **Space** opens the cell drawer, **Esc** closes whichever drawer is open and returns focus to the cell that opened it.
  Every other control is reachable with Tab; the focus ring is a 2 px accent outline on `:focus-visible`.
- **Demo mode** — the whole UI with no key, no network and no quota:
  ```sh
  pnpm demo                                                            # DEMO=1 mock seats.aero on :3999, serving fixtures/demo/
  set -a && . ./.env && set +a                                         # the tsx CLIs don't read .env; the seed needs the app's MASTER_KEY
  pnpm exec tsx scripts/seed-e2e.ts --db data/runtime/demo.db --fresh  # demo users (password demo-password-1); prints usernames only
  DATABASE_PATH=data/runtime/demo.db SEATS_AERO_BASE_URL=http://127.0.0.1:3999/partnerapi/ pnpm dev
  ```
  Every value in `fixtures/demo/` is invented (`fixtures/demo/README.md` says so). Each seeded user's fake key selects a
  scenario on the mock — `demo` (full dataset), `nokey`, `empty`, `slow` (loading states), `partial` (one program not
  fetched), `quota` (daily limit reached) — so every page state can be reached without touching seats.aero.
- **Screenshots.** `docs/screenshots/v0.2/<page>/<state>-<viewport>-<theme>[-zh].png` — every page in every state at
  1440 × 900 and 390 × 844, light and dark, with the grid and both drawers also in Chinese. `docs/screenshots/v0.2/before/`
  is the frozen record of the v0.1 UI, and `axe-summary.json` is the current accessibility audit.
- **End-to-end.** `pnpm e2e` (see the Tests section) regenerates the screenshots and asserts the semantics behind them.

## Local development with the mock seats.aero

```sh
pnpm exec tsx scripts/mock-seatsaero.ts                     # 127.0.0.1:3999, serves the recorded fixtures, dates shifted to today
pnpm exec tsx scripts/seed-dev.ts                           # users alice / bob, password "password123", two fake keys (dev MASTER_KEY if unset)
SEATS_AERO_BASE_URL=http://127.0.0.1:3999/partnerapi/ pnpm dev
```

Any non-empty key is accepted by the mock, so the seeded fake keys "work" and no quota is spent. `seed-dev.ts`
refuses to run with `NODE_ENV=production`; the fake key strings are exactly what `scripts/check-no-secrets-in-bundle.sh`
greps the build for.

## Deployed at `awardgrid.dowhiz.com`

A Cloudflare Tunnel from the dev Mac, not a host on Cloudflare: rendering `/` alone traces two native
N-API binaries (`better-sqlite3`, `@node-rs/argon2`), which their runtime cannot load. Two LaunchAgents
keep `next start` (loopback only) and `cloudflared` running. **`docs/DEPLOYMENT.md`** has the shape, the
restart commands, the DNS rollback and what is deliberately not running (Cloudflare Access, the worker).

## Docker Compose

```sh
docker compose build && docker compose up -d      # one image, two services: app (Next.js standalone, :3000) + worker
curl -fsS localhost:3000/api/health               # {"ok":true,...} — no auth, no DB; also the container HEALTHCHECK
docker compose logs -f worker                     # JSON lines; never contain keys, chat ids or usernames
docker compose down                               # the named volume awardgrid-data (/data: SQLite, cache, mock sink) survives; -v deletes it
```

`Dockerfile` (multi-stage, `node:22-bookworm-slim`) runs `pnpm build:plugin && pnpm build`, keeps the full
`node_modules` so `tsx` can run the worker / migrate / admin CLIs, installs `curl` + `jq` (the only runtime dependencies
of the kept toolkit skills) and `tini`, and starts the app with `tsx src/cli/migrate.ts && node server.js`. The worker
service waits for the app's healthcheck and runs `tsx src/cli/worker.ts`. `docker-compose.yml` reads `.env` for both
services and pins `DATABASE_PATH=/data/awardgrid.db` on the shared volume. Admin commands inside the container:
`docker compose exec app node_modules/.bin/tsx src/cli/admin.ts invite --for <name>`.

Port 3000 is bound to **127.0.0.1 only**; reach it through **Tailscale** or **Cloudflare Access** — never expose it to
the public internet (there is no public signup, but there is also no second factor). Plain HTTP over Tailscale needs
`COOKIE_SECURE=false`; behind a TLS-terminating proxy set `TRUST_PROXY_HEADERS=1` so login rate limits see the client IP,
and set `APP_URL` to the URL friends actually use. `MASTER_KEY` must be identical for app and worker (it is: one `.env`).
Docker was **not** available on the machine this was built on; the CI job `docker smoke` builds the image and checks
`/api/health` and `/login` on every push, and the local compose smoke is listed in `FINAL_REPORT.md` §4.

## Tests

```sh
pnpm build:plugin && pnpm test                 # Vitest, 109 files / 1,110 tests, no network, no keys (2 live-gated tests skip; 1 more skips until the plugin is built)
pnpm test:app                                  # just the app's 84 files / 829 tests
pnpm test:core                                 # just @awardgrid/core's 25 files / 281 tests — runs standalone, in under a second
pnpm typecheck && pnpm lint                    # typecheck covers the app AND the package (including the core's own tests)
pnpm build && pnpm e2e                         # Playwright: UI behaviour, axe, screenshots — offline against the DEMO mock
bash scripts/check-no-secrets-in-bundle.sh --build   # fixture/seed key strings absent from .next/, Partner-Authorization absent from client chunks
AWARDGRID_LIVE_SMOKE=1 pnpm exec tsx scripts/ask-smoke.ts   # optional: one real Ask session; needs ANTHROPIC_API_KEY; ≤ $0.50
```

**End-to-end and visual.** `pnpm e2e` runs the Playwright suite (`e2e/`, four projects: desktop and mobile × light and
dark) against a production `next start` and the `DEMO=1` mock seats.aero, over a throwaway SQLite file — no network, no
keys, no real data on any screenshot. It asserts the UI semantics of every page state, runs `@axe-core/playwright`
(WCAG 2.x A/AA; zero serious or critical violations, counts written to `docs/screenshots/v0.2/axe-summary.json`), and
writes the screenshot matrix under `docs/screenshots/v0.2/` (declared once in `e2e/matrix.ts`;
`pnpm exec tsx scripts/screenshot-index.ts` rebuilds the contact sheet and fails on a missing or misnamed capture).
`pnpm e2e -g <name>` runs one spec, `pnpm e2e:ui` opens Playwright's UI mode,
`pnpm exec playwright show-report e2e-report` opens the last report. `e2e/README.md` documents the seeded users, the
scenario keys and the scripted Ask stream.

Visual-regression baselines (`e2e/visual.spec.ts`) are generated and committed **from Linux CI only** — macOS font
rasterisation differs, so a Mac baseline fails on CI. The comparisons are inert unless `VISUAL=1`, so a routine run
never fails on them: `VISUAL=1 pnpm e2e -g visual` compares, `VISUAL=1 pnpm e2e:update -g visual` rewrites, with the
reason in the commit message. The CI `visual` job is non-blocking until it has been green on five consecutive runs
(`DECISIONS.md` § 6.6). Details in `docs/UI.md` § 5.

Every external payload is a fixture: `packages/core/test/fixtures/seatsaero/` (official docs examples + a seeded
synthetic Cached Search for the canonical query — it lives in the package so the core is testable on its own),
`test/fixtures/queries/cases.json` (36 bilingual parser cases), `test/fixtures/ask/`
(a recorded SDK init message asserted by `test/ask/init-assertions.test.ts`). CI (`.github/workflows/ci.yml`) runs
typecheck, lint, test, `next build` + `scripts/check-no-secrets-in-bundle.sh`, a tracked-`.env`/SQLite check, gitleaks,
and the Docker smoke. `next.config.ts` narrows Next's standalone file tracing (`outputFileTracingExcludes`) so tests,
fixtures, `scripts/`, `vendor/`, `src/` and `data/runtime/` never land in `.next/standalone/`; a local `.env` still does
(Next copies it by design) — `.next/` is gitignored and `.dockerignore` keeps `.env*` out of the image.

## Repo map

```
src/app/            Next.js App Router: / (the signed-out front door) /grid /settings /queries /login /register
                    /legal + /api/* route handlers
src/components/     grid (query box, chips, table, cell drawer), ask drawer, queries, settings, shell (header/footer), ui
packages/tokens/    @awardgrid/tokens — ONE palette, read by the web app, the shell and the landing site.
                    tokens.css (colour/type/motion/spacing, values frozen by tests + visual baselines)
                    surfaces.css (the two surface modes of PIVOT §4: radius/blur/elevation fork)
apps/ios/           @awardgrid/ios — the Capacitor client shell (PIVOT §6 Phase 2). Runs on the
                    user's own seats.aero key, in their device's Keychain. No server of ours.
sites/landing/      the static landing page (PIVOT §2). Zero JavaScript, zero network requests.
packages/core/      @awardgrid/core — the runtime-independent core every shell consumes (docs/PIVOT.md §2).
                    Ships raw TypeScript, no build step, no server dependencies. Imported as
                    "@awardgrid/core/<module>"; `src/lib/i18n/server.ts` stays in the app because it is
                    the one file coupled to Next (next/headers).
  .../query/        places seed loader, deterministic bilingual parser, LLM structured-output fallback, QueryObject (zod)
  .../seatsaero/    typed Partner API client (/search /availability /trips/{id} /routes), quota, cache, routes catalog, find planner
  .../grid/         pivot, ranking, freshness tiers, CSV, ASCII renderer, deeplinks (AA)
  .../qr/ i18n/     QR encoder; en + zh-CN dictionaries and t()          .../notices.ts   shared notice strings
  .../test/fixtures seats.aero + grid fixtures      .../data/places.json   the places seed
src/lib/db/         Drizzle schema + SQLite stores (quota, cache, routes)      drizzle/   migrations
src/lib/auth|crypto|keys/  invites, argon2id passwords, cookie sessions, AES-256-GCM key store
src/lib/scheduler/  cron matcher, diff, runSavedQuery      src/lib/notify/   Telegram + mock transports, digest, poller
src/lib/ask/        SDK options, env isolation, tool gate, budget hold, streaming session
src/lib/server/     request-side helpers (find, trips, usage, origin/CSRF, rate limit)   src/lib/i18n/server.ts  getLocale() (next/headers)
src/cli/            find (grid), admin, worker, migrate         src/proxy.ts   same-origin guard for /api/*
scripts/            build-plugin, plugin-manifest, mock-seatsaero, seed-dev, ask-smoke, check-no-secrets-in-bundle.sh
src/styles/         app-only CSS; the tokens themselves live in packages/tokens (docs/UI.md §1)
test/               fixtures/, integration/ (CLI, two users, scheduler harness), ask/, query/
e2e/                Playwright suite + harness docs      fixtures/demo/   synthetic demo dataset for the DEMO=1 mock
docs/UI.md          UI manual (design system, component map, procedures)   docs/UI_PLAN.md   the design record
docs/COPY.md        copy rules and the en ↔ zh glossary   docs/screenshots/v0.2/   the screenshot matrix + axe summary
data/runtime/       SQLite + mock sink (gitignored)   spikes/   throwaway pivot spikes (docs/PHASE0.md), excluded from build/lint/CI
docs/reference/     the seats.aero reference pages the client was built from
vendor/travel-hacking-toolkit   git submodule (MIT)          build/plugin   pruned plugin (gitignored)
```

Further reading: `ARCHITECTURE.md` (verified endpoints, SDK options, model IDs, docs-vs-prompt conflicts),
`DECISIONS.md` (every choice with rationale), `docs/UI.md` (the UI manual) and `docs/UI_PLAN.md` (why it looks like
that), `docs/COPY.md` (copy rules and glossary), `LEGAL.md` (terms, attribution, disable-on-request), `BACKLOG.md`
(deferred items), `FINAL_REPORT.md` (what works, what is mocked, needs-human-action, cost estimate).

## License

MIT (see `LICENSE`). The Ask lane bundles the
[travel-hacking-toolkit](https://github.com/borski/travel-hacking-toolkit), MIT License, © Michael Borohovski; its
license is preserved in `vendor/travel-hacking-toolkit/LICENSE` and copied into `build/plugin/LICENSE`. awardgrid is not
affiliated with seats.aero, any airline, or any loyalty program.
