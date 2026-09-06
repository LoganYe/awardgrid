# awardgrid

Private, friends-only award-flight grid: one natural-language question (Chinese or English) → one table of
origins × destinations × dates, each cell the cheapest award seat (miles · fees · seats left · program · freshness)
with a link to the program's own search page. Non-commercial, invite-only, fewer than ten users, every user brings
their **own** seats.aero Pro key. **Data: seats.aero.**

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
2. Send them the code and the URL. They open `/register`, pick a username and password (argon2id), enter the code.
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

## Local development with the mock seats.aero

```sh
pnpm exec tsx scripts/mock-seatsaero.ts                     # 127.0.0.1:3999, serves the recorded fixtures, dates shifted to today
pnpm exec tsx scripts/seed-dev.ts                           # users alice / bob, password "password123", two fake keys (dev MASTER_KEY if unset)
SEATS_AERO_BASE_URL=http://127.0.0.1:3999/partnerapi/ pnpm dev
```

Any non-empty key is accepted by the mock, so the seeded fake keys "work" and no quota is spent. `seed-dev.ts`
refuses to run with `NODE_ENV=production`; the fake key strings are exactly what `scripts/check-no-secrets-in-bundle.sh`
greps the build for.

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
pnpm build:plugin && pnpm test                 # Vitest, 79 files / 722 tests, no network, no keys (2 live-gated tests skip; 1 more skips until the plugin is built)
pnpm typecheck && pnpm lint
bash scripts/check-no-secrets-in-bundle.sh --build   # fixture/seed key strings absent from .next/, Partner-Authorization absent from client chunks
AWARDGRID_LIVE_SMOKE=1 pnpm exec tsx scripts/ask-smoke.ts   # optional: one real Ask session; needs ANTHROPIC_API_KEY; ≤ $0.50
```

Every external payload is a fixture: `test/fixtures/seatsaero/` (official docs examples + a seeded synthetic Cached
Search for the canonical query), `test/fixtures/queries/cases.json` (36 bilingual parser cases), `test/fixtures/ask/`
(a recorded SDK init message asserted by `test/ask/init-assertions.test.ts`). CI (`.github/workflows/ci.yml`) runs
typecheck, lint, test, `next build` + `scripts/check-no-secrets-in-bundle.sh`, a tracked-`.env`/SQLite check, gitleaks,
and the Docker smoke. `next.config.ts` narrows Next's standalone file tracing (`outputFileTracingExcludes`) so tests,
fixtures, `scripts/`, `vendor/`, `src/` and `data/runtime/` never land in `.next/standalone/`; a local `.env` still does
(Next copies it by design) — `.next/` is gitignored and `.dockerignore` keeps `.env*` out of the image.

## Repo map

```
src/app/            Next.js App Router: /grid /settings /queries /login /register /legal + /api/* route handlers
src/components/     grid (query box, chips, table, cell drawer), ask drawer, queries, settings, shell (header/footer), ui
src/lib/query/      places seed loader, deterministic bilingual parser, LLM structured-output fallback, QueryObject (zod)
src/lib/seatsaero/  typed Partner API client (/search /availability /trips/{id} /routes), quota, cache, routes catalog, find planner
src/lib/grid/       pivot, ranking, freshness tiers, CSV, ASCII renderer, deeplinks (AA)
src/lib/db/         Drizzle schema + SQLite stores (quota, cache, routes)      drizzle/   migrations
src/lib/auth|crypto|keys/  invites, argon2id passwords, cookie sessions, AES-256-GCM key store
src/lib/scheduler/  cron matcher, diff, runSavedQuery      src/lib/notify/   Telegram + mock transports, digest, poller
src/lib/ask/        SDK options, env isolation, tool gate, budget hold, streaming session
src/lib/server/     request-side helpers (find, trips, usage, origin/CSRF, rate limit)   src/lib/i18n/  en + zh-CN
src/cli/            find (grid), admin, worker, migrate         src/proxy.ts   same-origin guard for /api/*
scripts/            build-plugin, plugin-manifest, mock-seatsaero, seed-dev, ask-smoke, check-no-secrets-in-bundle.sh
test/               fixtures/, integration/ (CLI, two users, scheduler harness), ask/, query/
data/places.json    editable city → airports seed with zh/en aliases     data/runtime/   SQLite + mock sink (gitignored)
docs/reference/     the seats.aero reference pages the client was built from
vendor/travel-hacking-toolkit   git submodule (MIT)          build/plugin   pruned plugin (gitignored)
```

Further reading: `ARCHITECTURE.md` (verified endpoints, SDK options, model IDs, docs-vs-prompt conflicts),
`DECISIONS.md` (every choice with rationale), `LEGAL.md` (terms, attribution, disable-on-request), `BACKLOG.md`
(deferred items), `FINAL_REPORT.md` (what works, what is mocked, needs-human-action, cost estimate).

## License

MIT (see `LICENSE`). The Ask lane bundles the
[travel-hacking-toolkit](https://github.com/borski/travel-hacking-toolkit), MIT License, © Michael Borohovski; its
license is preserved in `vendor/travel-hacking-toolkit/LICENSE` and copied into `build/plugin/LICENSE`. awardgrid is not
affiliated with seats.aero, any airline, or any loyalty program.
