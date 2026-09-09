# DECISIONS

Every non-trivial choice, one line each, newest at the bottom. Format:
`- **topic**: decision. _Why:_ rationale.` Fixed defaults from the kickoff prompt (§2, §4, §6, §12) are not repeated here unless a doc contradicted them.

## Phase 0

- **Project directory**: the kickoff said "from an empty directory", but Claude Code was started in `~/Desktop/workspace`, which already holds other projects. Built in `~/Desktop/workspace/awardgrid/` instead. _Why:_ never touch sibling projects; the repo root is what matters.
- **Node runtime on the dev Mac**: use the arm64 Node 22 at `~/.local/node-arm64` (with `corepack`-managed pnpm 12), not the default `/usr/local/bin/node`, which is an Intel binary under Rosetta. _Why:_ native modules (`better-sqlite3`, `argon2`) fail to build/load under the Rosetta node on this machine.
- **pnpm**: not preinstalled; enabled via `corepack enable pnpm` + `corepack prepare pnpm@latest --activate` (pnpm 12.3.4). Pinned in `package.json#packageManager`. _Why:_ the prompt fixes pnpm; corepack is the zero-install path.
- **Docker**: not installed on the host. Dockerfile + `docker-compose.yml` are written and reviewed but the compose smoke test is listed under "Needs human action". _Why:_ §0.3 — do the maximum possible, note the gap.
- **LICENSE copyright holder**: `Logan (LoganYe)` — `gh api user` returns name "Logan", login "LoganYe". _Why:_ prompt says "my name from gh api user"; login added so the holder is unambiguous.
- **Toolkit plugin root**: the vendored repo's *Claude Code* plugin is the repository root (`.claude-plugin/plugin.json`, name `travel-hacker`; `skills/`, `agents/`, `.mcp.json`). `plugins/travel-hacking-toolkit/` is the **Codex** plugin (`.codex-plugin/plugin.json`). `scripts/build-plugin.ts` therefore composes `build/plugin/` from the repo root, not from `plugins/travel-hacking-toolkit/`. _Why:_ docs/facts win over the prompt (§0.3); the prompt's path would load nothing in the Agent SDK.
- **Test key absent**: `SEATS_AERO_API_KEY_TEST` is not set in this environment → all seats.aero fixtures are built from the official docs' example payloads; 0 of the 40-call budget used. _Why:_ §0.4.
- **Telegram token absent**: `TELEGRAM_BOT_TOKEN_TEST` not set → mock transport with the same interface is the default in tests; real transport is selected by env at runtime. _Why:_ §6.
- **seats.aero freshness field**: the documented Availability timestamps are `CreatedAt`/`UpdatedAt`; `ComputedLastSeen` is not in the OpenAPI snapshot (updatedAt 2025-04-23). awardgrid uses `ComputedLastSeen` when present, else `UpdatedAt`, else the fetch time. _Why:_ never invent fields (§0.2 #7) while still honouring the kickoff's "ComputedLastSeen or equivalent".
- **Fees per cell**: the documented Cached Search summary has no taxes; `TotalTaxes` (minor units) only comes from Get Trips. Cells therefore show fees as "—" until expanded (or when an observed `{cabin}TotalTaxes` field is present). _Why:_ §0.2 #7; Get Trips is fetched only on cell expand (§4.3).
- **Cabin parameters**: `/search` uses `cabins=` (plural, names `economy|premium|business|first`); `/availability` uses `cabin=` (singular). The prompt's "cabin" wording maps to these. _Why:_ verified in the OpenAPI definitions.
- **Get Routes**: exists at `GET /partnerapi/routes?source=<program>` (doc page `get-routes-1.md`, not listed in llms.txt). Fetched lazily per (user, source) with a 7-day cache, only for sources actually queried and only when a pair returned nothing, so unmonitored pairs are labelled without spending 26 calls up front. _Why:_ §4.3 requires the label; quota is precious.
- **Pagination**: pass the first response's `cursor` back AND increment `skip` by results received; dedupe by `ID`. _Why:_ Concepts page + toolkit skill agree; cursor alone is not enough.
- **Structured outputs for the parser**: Messages API `output_config.format = { type: "json_schema", schema }` via `client.messages.parse` + `zodOutputFormat` (`@anthropic-ai/sdk/helpers/zod`). The older `output_format` field / beta header is deprecated and not used. _Why:_ current docs; no beta header needed.
- **Model IDs**: parser default `claude-haiku-4-5-20251001` ($1/$5 per MTok — cheapest current model; supports structured outputs); ask lane default `claude-sonnet-5` ($2/$10 — current mid-tier). Overridable via `AWARDGRID_PARSER_MODEL` / `AWARDGRID_ASK_MODEL`. _Why:_ §2 rule (cheapest that passes the fixture suite; mid-tier for ask); Haiku 4.5 retires no sooner than 2026-10-15, so the env override matters.
- **SQLite driver**: `better-sqlite3` (prebuilt binaries load under the arm64 Node; Drizzle first-class support; synchronous API suits a single-file DB). `node:sqlite` rejected because Drizzle has no driver for it and it is still experimental on Node 22. _Why:_ simplest option that passes tests.
- **argon2**: `@node-rs/argon2` (argon2id, 64 MiB, t=3). Chosen over `argon2` because napi-rs ships prebuilt binaries for darwin-arm64 and linux glibc/musl with no build scripts, which matters for the Docker image and for this Rosetta-mixed dev Mac. _Why:_ both satisfy "argon2"; this one has zero build risk.
- **Extra tables beyond §3**: `sessions` (cookie sessions), `telegram_link_tokens` (one-time deep-link tokens), `ask_usage` (per-user daily Ask spend for the $2 cap), `cache_coverage` (so a fresh *empty* result is also served from cache within the TTL), `routes_cache` (Get Routes per user/source). `users` gained `timezone` and `locale` (quiet hours need a zone; UI has a zh-CN toggle); `invite_codes` gained `intended_for`/`created_at`; `query_runs` gained `cells_json` (diff basis). _Why:_ each is required by a §5–§8 feature; §3's columns are otherwise unchanged.
- **Toolkit build**: compose `build/plugin/` from the repo root — `.claude-plugin/plugin.json`, real files behind the `skills` symlink, `data/`, `scripts/calc_distance.py` only, pruned `.mcp.json`; `agents/travel-hacker.md` (model: opus) is not copied. _Why:_ plugin root is the repo root; the agent file would spawn Opus subagents outside our cost cap.
- **Ask-lane env isolation**: the TypeScript Agent SDK's `env` option REPLACES the subprocess environment (verified in `sdk.mjs`: `env = {...process.env}` is only the default). Each Ask session gets a minimal env (PATH, HOME, ANTHROPIC_API_KEY, the calling user's decrypted keys, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, per-user `CLAUDE_CONFIG_DIR`, `ENABLE_CLAUDEAI_MCP_SERVERS=false`) plus `settingSources: []` and `strictMcpConfig: true`. No per-request process spawning workaround is needed. _Why:_ §7.4 two-user isolation.
- **Ask-lane skill allow-list**: in addition to pruning, the SDK `skills: [...]` allow-list names every kept skill explicitly (`travel-hacker:<skill>`), so an unexpected file in the plugin can never become invocable. _Why:_ §7.2 "native allow/deny mechanism … in addition to pruning".
- **MCP servers kept**: kiwi, trivago, ferryhopper, skiplagged (keyless HTTP). Dropped: `liteapi` (needs a key we do not offer) and `airbnb` (npx package launched with `--ignore-robots-txt`). _Why:_ §7.2 lists the four to keep; robots-ignoring scraping conflicts with §0.2 #1's spirit.

## Phase 0 — research-forced decisions (docs win on facts, kickoff wins on scope; see ARCHITECTURE.md §7)

- **Filtered/dynamic-pricing toggle**: The UI "include filtered results" toggle maps to `include_filtered=true` on Cached Search, Bulk Availability and Get Trips; no `*Raw` fields are read. _Why:_ That is the only documented flag; the "raw fields" the description mentions are not defined anywhere in the spec.
- **TotalTaxes unit**: Treat `TotalTaxes` as minor units of `TaxesCurrency`, and empty `TaxesCurrency` as USD, both flagged as assumptions in the UI tooltip. _Why:_ The Concepts example equates `TotalTaxes: 1290` with $12.90; the empty-string-means-USD rule is the toolkit's interpretation, not the official doc's.
- **Trip times**: `DepartsAt`/`ArrivesAt` are stored and shown as airport-local wall-clock strings; the trailing `Z` is stripped, never converted from UTC. _Why:_ Concepts states all times are airport local despite the `Z` suffix.
- **TotalDuration**: Displayed only as an opaque integer labelled "duration (units per seats.aero)" until a smoke fixture confirms minutes. _Why:_ The spec gives no unit and the example does not reconcile with the toolkit's "minutes".
- **Bulk Availability parsing**: Bulk responses are parsed with the same lenient `{ data, count, hasMore, cursor }` / Availability zod schema as Cached Search, with a recorded fixture gap if the smoke shows otherwise. _Why:_ The Bulk 200 schema in the OpenAPI is empty (`{}`); prose says "similar to Cached Search".
- **Bulk vs Cached selection**: Executor estimates pages: Cached = ⌈pairs×days×programs / 1000⌉ per request set; Bulk = one program per call, region-filtered; pick the smaller estimate, default Cached. _Why:_ Docs: Cached for specific airports/dates across programs, Bulk for one program across regions; both cost one call per page.
- **NumDaysOut**: `Route.NumDaysOut` is shown only as a hint ("monitored ~N days out"), never used to blank a cell. _Why:_ It is an undocumented integer in the schema; its semantics are unverified.
- **Get Trips params**: Client accepts `include_filtered` and `min_cabin_pct` (default 100) and parses optional `MixedCabinPct`. _Why:_ Both are in the Get Trips OpenAPI; the toolkit skill omits `min_cabin_pct`. _Amended by issue #18:_ `min_cabin_pct` is no longer a client-only parameter — it is a field on `QueryObject`, the eighth chip, part of the cache scope, and forwarded to Cached Search, Bulk Availability and Get Trips alike. See "#18 Mixed cabin" at the end of this file.
- **Programs list**: `QueryObject.programs` is validated as strings, not a closed enum; the 26-row Concepts table seeds the picker and unknown codes returned by the API (e.g. `lifemiles`) are displayed as-is. _Why:_ `lifemiles` appears in example JSON but not in the sources table; the list changes.
- **Quota accounting**: Every HTTP request to `seats.aero/partnerapi/*` for a user (each search/bulk page, each Get Trips, each Get Routes, the key-validation call) increments `api_usage`; hard stop at 950/day. _Why:_ Only "1,000 API calls per day" is documented; no per-request weighting, 429 or headers exist, so count conservatively.
- **Quota reset boundary**: Count per UTC calendar day and label the reset time "assumed 00:00 UTC". _Why:_ The docs never state when the daily window resets.
- **Plugin manifest name**: Keep `"name": "travel-hacker"` in the copied `.claude-plugin/plugin.json`. _Why:_ The manifest `name` is the skill namespace prefix; keeping it makes `/travel-hacker:<skill>` references inside the toolkit's own docs resolve and gives a stable init-message assertion (`travel-hacker:seats-aero`).
- **Data directory**: `data/*.json` (16 files) and `LICENSE` are copied to `build/plugin/`, and the ask session's `cwd` is `build/plugin` so root-relative `data/<file>.json` paths in kept skills resolve. _Why:_ Kept reference skills read `data/…` relative to the repo root, not the skills dir.
- **Plugin init assertion**: Startup and the Phase-4 test assert the `system`/`init` message has `plugins` containing `{ name: "travel-hacker", path: <abs build/plugin> }`, `skills` containing `travel-hacker:seats-aero` and none of the 21 pruned names, and no kept `mcp_servers[].status === "failed"`. _Why:_ A nonexistent plugin path is silently skipped and the docs never state that plugin skills survive `settingSources: []`.
- **settingSources**: `settingSources: []` (with the assertion above); fallback to `["project"]` + an empty per-request cwd only if plugin skills fail to load. _Why:_ Omitting it loads `~/.claude/skills`, project `.claude/`, `CLAUDE.md` and `.mcp.json` from the host, which must not leak into friends' sessions.
- **Claude.ai connectors / host MCP**: `strictMcpConfig: true` on every ask session. _Why:_ `mcpServers: {}` does not suppress claude.ai connectors or project `.mcp.json`; `strictMcpConfig` does.
- **Tool policy**: `permissionMode: "dontAsk"`, `permissionPrompts: "none"`, `allowedTools: ["Read", "Glob", "Grep", "WebFetch", "Skill", "Bash(curl *)", "Bash(jq *)", "mcp__skiplagged__*", "mcp__kiwi__*", "mcp__trivago__*", "mcp__ferryhopper__*"]`, `disallowedTools: ["Write", "Edit", "NotebookEdit", "WebSearch", "Task"]`, exact tool names re-checked against the init `tools` array. _Why:_ `allowedTools` pre-approves but does not restrict; bare names in `disallowedTools` remove tools from context; `dontAsk` denies everything else without a prompt.
- **Ask-lane bounds**: `maxTurns: 12`, `maxBudgetUsd: min(0.50, dailyRemaining)`, `AbortController` aborted at 120 s, `Query.close()` on client disconnect, `API_TIMEOUT_MS: "90000"`, `CLAUDE_CODE_MAX_RETRIES: "2"`. _Why:_ The SDK has no wall-clock timeout option; `maxTurns`/`maxBudgetUsd` are the only built-in bounds.
- **Cost accounting**: Sum `result.total_cost_usd` (present on success and error arms) into `api_usage(provider='claude_ask')` per user per UTC day; refuse new sessions at $2.00. _Why:_ The SDK reports per-`query()` estimates only and provides no session-level total.
- **Error handling**: Wrap the `for await` in try/catch and branch on result `subtype` (`success` / `error_max_turns` / `error_during_execution` / `error_max_budget_usd`). _Why:_ A single-shot `query()` yields the error result and then throws; process-launch failures yield no result message.
- **Streaming**: `includePartialMessages: true`; forward `stream_event` `content_block_delta`/`text_delta` text over SSE from a Node-runtime route handler. _Why:_ That is the documented streaming path; the ask lane spawns a subprocess so it cannot run on the edge runtime.
- **Toolkit runtime deps in the image**: Install `curl` and `jq` in the app image; no python3, node scripts or Docker needed by kept skills. _Why:_ Kept skills are curl/jq one-liners plus JSON data; python-script skills (`round-the-world`, `transfer-bonuses` refresh) are pruned or data-only.
- **Parser model watch**: `AWARDGRID_PARSER_MODEL` is documented in `.env.example` with the Haiku 4.5 retirement note (not sooner than 2026-10-15). _Why:_ Nearest retirement horizon of any current model.
- **Parser schema constraints**: The API schema carries `additionalProperties: false`, `required`, `enum`, `format: "date"`, `minItems: 1`; `min(1)` on arrays beyond that, the 92-day span cap and integer bounds are enforced by zod after parsing; enums compared case-insensitively. _Why:_ Structured outputs reject `minimum`/`maximum`/`minLength`/`maxLength` (400) and do not guarantee enum capitalization.
- **No sampling params**: Never set `temperature`/`top_p`/`top_k`. _Why:_ Non-default values return 400 on Claude 4.7+ (Sonnet 5); unnecessary on Haiku.
- **Pruned skills (21)**: `american-airlines`, `amex-travel`, `chase-travel`, `southwest`, `ticketsatwork`, `vrbo`, `sutochno` (Docker/Patchright + `*_USERNAME`/`*_PASSWORD`), `google-flights`, `seatmaps` (agent-browser scraping), `atlas-obscura`, `deutsche-bahn` (runtime `npm install` + scraping / rail), `getting-started` (`printenv` of keys), `gardening` (arbitrary local file), `trip-log` (writes files), `awardwallet`, `rapidapi`, `serpapi`, `tripadvisor`, `scandinavia-transit` (keys outside the `seats_aero|duffel|ignav` provider enum), `round-the-world` (needs `scripts/calc_distance.py`), `compare-hotels` (orchestrates Airbnb MCP + VRBO Docker). _Why:_ Kickoff §0.2 #1/#5 plus "keep it simple": nothing that scrapes, needs credentials we don't hold, runs installers, or touches the filesystem.
- **Kept skills (27)**: `alliances`, `award-calendar`, `award-holds`, `award-sweet-spots`, `bilt`, `booking-guidance`, `cabin-codes`, `compare-flights`, `duffel`, `fallback-and-resilience`, `flight-search-strategy`, `hotel-chains`, `ignav`, `lessons-learned`, `partner-awards`, `plan-trip`, `points-valuations`, `premium-hotels`, `seats-aero`, `status-match`, `stopovers`, `transfer-bonuses`, `transfer-partners`, `trip-calculator`, `trip-planner`, `wheretocredit`, `wikipedia-airports`. _Why:_ Reference/API skills using only curl/jq/Read, `SEATS_AERO_API_KEY`, `DUFFEL_API_KEY_LIVE`, `IGNAV_API_KEY` or no key.
- **Prune test**: A test walks `build/plugin/skills` and fails if any kept `SKILL.md` matches `docker|patchright|agent-browser|_USERNAME|_PASSWORD|printenv`. _Why:_ Keeps the exclusion list honest across toolkit updates.
- **Toolkit attribution**: `build/plugin/LICENSE` and `LEGAL.md` carry "MIT License, Copyright (c) 2026 Michael Borohovski". _Why:_ MIT requires the notice in copies; the README asks for nothing more.
- **Scheduler**: `node-cron@4.6.0`; one master task `cron.schedule('*/5 * * * *', tick, { name: 'awardgrid-tick', timezone: 'UTC', noOverlap: true })` selects due `saved_queries` whose expressions were checked with `cron.validate()` at save time; `cron.shutdown()` on SIGTERM. _Why:_ v4 has no `scheduled: false`; one ticking task avoids per-query task lifecycle management.
- **Telegram transport**: `sendMessage` with `parse_mode: "HTML"` and `link_preview_options: { is_disabled: true }`; token validated with `getMe`; `/start <token>` received via `getUpdates` long polling in the worker (no `setWebhook`); mock transport when the token is absent. _Why:_ Bot API 10.3 has no `disable_web_page_preview`; long polling needs no public HTTPS endpoint behind Tailscale/Access.
- **Telegram link token**: Deep link `https://t.me/<bot>?start=<base64url token ≤ 64 chars of [A-Za-z0-9_-]>`, single-use, 15-min expiry; `telegram_chat_id` stored as text. _Why:_ Payload charset/length are documented limits; chat ids can exceed 32 bits.
- **GitHub Actions versions**: `actions/checkout@v7`, `actions/setup-node@v7`, `pnpm/action-setup@v6`, `gitleaks/gitleaks-action@v3` (`GITHUB_TOKEN` only; no `GITLEAKS_LICENSE` for a personal repo). _Why:_ gitleaks-action v2 stops working on hosted runners on 2026-09-16; the others are the current majors.
- **Node engine**: `engines.node >= 22` + `.nvmrc` = 22 (kickoff says ≥ 20). _Why:_ `better-sqlite3@13` requires Node ≥ 22; the Docker base is `node:22-bookworm-slim`.
- **Key validation call**: a new seats.aero key is validated with one `GET /search?origin_airport=SEA&destination_airport=NRT&start_date=<today>&end_date=<today>&take=10` and the call is recorded against that user's quota. _Why:_ smallest documented response; `/routes` can return thousands of rows.
- **Reference snapshots vendored**: `docs/reference/seatsaero/*.md` holds the exact reference pages the client and fixtures were built from. _Why:_ the OpenAPI snapshot (`updatedAt 2025-04-23`) lags the live API; future diffs must be against what the code assumed.

## Phase 1 — review fixes

- **`pnpm find` vs pnpm's built-in `find`**: the kickoff says `pnpm find "<query>"`, but pnpm ≥ 10 reserves `find` as an alias of `pnpm search` (registry search) and built-ins win over package.json scripts — a bare `pnpm find "<query>"` sends the query text to the npm registry. The CLI's help, headers and README therefore say `pnpm run find`; renaming the script to `grid` (`pnpm grid "<query>"`) was the follow-up and is **done** — package.json carries both `find` and `grid` (:20, :26), so `pnpm grid` and `pnpm run find` both work and only the bare `pnpm find` is the trap. _Why:_ §0.3 docs-vs-prompt — the tool must not silently do something else.
- **LLM parser output**: `QueryObjectLLM.programs` is a closed `z.enum(SEATS_SOURCES)` (the prompt's program list is generated from the same constant) and LLM origins/destinations go through the same `expandPlace` city expansion as the deterministic path; codes outside the seed are kept but surfaced as a warning. `QueryObject.programs` stays an open string list (API may return codes we do not know). _Why:_ §4.1 airports-after-expansion, §4.2 IATA-only output; a hallucinated program must be a schema failure, not a `sources=` parameter.
- **Reversed explicit ranges**: a range with explicit years written end-first (`2026-10-15 to 2026-10-01`) is swapped and a warning is attached; yearless ranges keep the "end rolls into next year" reading (`Dec 20 - Jan 5`). _Why:_ never a silent single day; the LLM path already warns.
- **Quota reservation**: `runFind` reserves the page cap (and later the Get Routes budget) through an atomic `QuotaStore.increment` and refunds what it did not use, instead of counting after the run. _Why:_ two overlapping runs for one user (standing query + interactive) could each spend the full headroom and pass 950.
- **`include_filtered` scope**: `QueryObject.include_filtered` (default false, UI toggle only) is forwarded to Cached Search / Bulk Availability and is part of the cache scope in BOTH directions (rows are stamped, coverage matched exactly). _Why:_ the API adds dynamically-priced rows without marking them, so neither scope can be filtered locally into the other.
- **Embedded `Route` in Availability is lenient**: `RouteID` and `Route.{OriginRegion,DestinationRegion,NumDaysOut,Distance}` are optional in Availability (the Concepts example omits them; the Bulk schema is empty), while Get Routes' `Route` keeps them required. `MixedCabinPct` stays an integer (Get Trips OpenAPI: int32 1..100). _Why:_ do not fail a whole page on a field the docs never promised there.
- **No `Accept` header**: the client sends only `Partner-Authorization`. _Why:_ §0.2 #7 — the only request header the reference documents.
- **CLI routes cache on disk**: live-mode `pnpm run find` keeps Get Routes results in `$AWARDGRID_CACHE_DIR/routes.json` (else `$XDG_CACHE_HOME/awardgrid`, else `~/.cache/awardgrid`), keyed by a SHA-256 prefix of the key so two keys never share entries; fixture mode stays in memory. The footer shows how many calls went to route lists. _Why:_ without it every run with an empty pair re-spent up to 26 calls; the 7-day TTL was only honoured inside one process.
- **Phase 2 scaffolding in the Phase 1 tree**: `src/lib/db`, `src/lib/auth`, `src/lib/crypto`, `drizzle/*`, `src/cli/migrate.ts` were written during Phase 1 and are unused by the fast lane; `src/cli/admin.ts` / `src/cli/worker.ts` are one-line "not implemented until Phase N" stubs so the package.json scripts resolve. _Why:_ kept rather than stashed so the tree typechecks as one unit; the Phase 2 PR is where they get their tests and wiring.
- **Unknown-currency fees in the ASCII grid**: `formatFees(x, null)` renders `$` per the Phase 0 "empty `TaxesCurrency` means USD" assumption. _Why:_ recorded assumption; the web UI carries the tooltip, the CLI note is this line.
- **Phase boundary**: the Drizzle schema/migration, `src/lib/db`, `src/lib/crypto/aes.ts` and `src/lib/auth/password.ts` were written during Phase 1 (they are the contracts Phase 2 engineers build against) but are committed in the Phase 2 PR, so each PR contains only its phase's scope. _Why:_ §0.3/§10 one PR per phase; the Phase 1 fast lane uses in-memory stores only.

## Phase 2

- **Dev-only seats.aero mock**: `scripts/mock-seatsaero.ts` serves the recorded fixtures (dates shifted to today) and `SEATS_AERO_BASE_URL` rewrites the client's base URL when set. _Why:_ lets friends and reviewers exercise the whole UI with zero quota; unset in production it is inert.
- **Route handlers read the session cookie from the request** (`userFromRequest`) instead of `next/headers`. _Why:_ keeps every handler unit-testable with plain `Request` objects; pages still use `requireUser()`.
- **CSRF**: state-changing handlers require `Content-Type: application/json` and a same-origin `Origin`/`Sec-Fetch-Site` check (`src/lib/server/origin.ts`); cookies are `SameSite=Lax`, `HttpOnly`, `Secure` in production (`COOKIE_SECURE=false` opt-out for plain-HTTP Tailscale). _Why:_ security reviewer finding; cheap belt-and-braces for a friends-only app.
- **Login rate limiting** trusts proxy IP headers only when `TRUST_PROXY_HEADERS=1`; otherwise keys on username only + a global limiter. _Why:_ spoofable `X-Forwarded-For` would let an attacker bypass per-IP limits.
- **Unmonitored pairs on cache hits**: the routes catalog is pre-loaded from `routes_cache` before serving from cache so the "not monitored by seats.aero" label survives re-renders. _Why:_ correctness reviewer finding.
- **Key validation is quota-reserved**: the one validation call reserves quota first and refunds on 401/403 or transport failure. _Why:_ a user at the soft limit must not be able to spend beyond it via Settings.
- **Nav links for Saved queries / Ask** are hidden until Phases 3–4 land. _Why:_ no dead links in v0.1.0 UI.

## Phase 3

- **Master tick every minute** (`* * * * *`, UTC, `noOverlap`), with per-query due-ness computed by a tiny 5-field cron matcher against `last_run_at`. _Why:_ one node-cron task instead of one per saved query; the earlier "*/5" note in ARCHITECTURE §9 is superseded.
- **Cron floor**: the API rejects schedules that could fire more than hourly (`cron_too_frequent`). _Why:_ a per-minute standing query would drain the 1,000/day quota.
- **Notification baseline**: the diff baseline is the most recent run whose changes are not pending (notified, nothing-to-send, first run, no Telegram); quiet-hours and send-failed runs are stepped over so changes are delivered later, never lost. First run notifies nothing. _Why:_ §6 quiet hours must delay, not drop.
- **Failed deliveries** (`{ok:false}` from the transport: blocked/429/5xx/network) record `send_failed` and retry on the next run. _Why:_ reviewer blocker — previously recorded as notified.
- **Run claim**: a conditional `UPDATE saved_queries SET last_run_at` (60 s window) serialises "run now" (web) against the worker tick; the loser returns `in_progress` / HTTP 409. _Why:_ no duplicate digests across processes.
- **Telegram messages** ≤ 4096 chars: cell lines fold into "+N more", then the grid link falls back to `/queries`. Chat ids never appear in logs (mock sink stores a hash). One chat can be linked to one account at a time; `/unlink` clears every holder.
- **Poller shutdown**: `getUpdates` takes the stop signal (`AbortSignal.any`) and confirms handled updates with a zero-timeout call on stop; the offset is not persisted (a crash may replay one already-used `/start`, which only yields a "link expired" reply).
- **Run-now HTTP mapping**: `no_key` → 409, `quota` → 429 with `resetAt`, other skips → 200 with `skipped_reason`; mock mode returns `{ deepLink: null, mock: true }` from `/api/telegram/link`.

## Phase 4

- **Physical pruning is the primary control**: a real SDK init showed `init.skills` lists every on-disk plugin skill regardless of the `skills` allowlist (plus Claude Code's bundled skills such as `deep-research`), so `build/plugin` contains only the 27 kept skills; the allowlist (`travel-hacker:<name>` × 27) is defense-in-depth. `round-the-world` and `compare-hotels` moved to the pruned list (they shell out to python / orchestrate pruned portal skills). _Why:_ §7.2 and the Phase 4 init assertion must not depend on the allowlist.
- **Tool policy**: `permissionMode: "default"`, `allowedTools: []`, an explicit `disallowedTools` list of every built-in the init exposed, and a `canUseTool` gate: Read/Glob/Grep only inside the plugin root; Skill (auto-approved by the `skills` option); MCP tools only from kiwi/trivago/ferryhopper/skiplagged; Bash only as `curl` (https, host allow-list, no `-o/-w %output{}/-H @file/-K/-T/-F/-x/-v`, header env expansion limited to the three key vars) optionally piped into `jq|head|tail|sort|uniq|wc|grep|rg|python3 -m json.tool`, with clustered short flags parsed so `sort -o<file>` / `grep -e<pat> FILE` are denied. _Why:_ `dontAsk` + `Bash(curl *)` rules would allow curl to any host and every curl flag; the gate keeps the session read-only and off airline sites (§0.2 #1, #8).
- **Budget hold**: `holdAsk` charges `min($0.50, remaining)` + 1 request atomically before the subprocess starts; `settleHold` replaces it with `total_cost_usd` when a result arrives; sessions that end without a result (timeout/abort/crash) keep the ceiling charged. _Why:_ the SDK gives no cost readout on abort; without a hold the $2/day cap was advisory under concurrency.
- **Session env**: PATH, HOME/TMPDIR/CLAUDE_CONFIG_DIR under a per-request temp dir, ANTHROPIC_API_KEY (+ https `ANTHROPIC_BASE_URL` passthrough for gateway hosts), `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `ENABLE_CLAUDEAI_MCP_SERVERS=false`, API/retry timeouts, and only the calling user's `SEATS_AERO_API_KEY` / `DUFFEL_API_KEY_LIVE` / `IGNAV_API_KEY`; `settingSources: []`, `strictMcpConfig: true`, `persistSession: false`, `maxTurns: 12`, 120 s abort. Verified live: `settingSources: []` + `plugins` does load plugin skills (ARCHITECTURE §3.1 fallback not needed); all four MCP servers connected.
- **Live model turn not verified here**: the only Anthropic credential in this environment is the Claude Code host session token (401 on the Messages API, 403 in the SDK subprocess). `scripts/ask-smoke.ts` records the init message (plugin + skills + MCP status, asserted by `test/ask/init-assertions.test.ts`) and the smoke result honestly as an auth error; re-run with a real key is listed under "Needs human action". Cost spent: $0.00.

## Phase 5

- **Docker smoke runs in CI (Docker absent locally)**: the `docker smoke` job in `.github/workflows/ci.yml` builds the image, starts `app` with a throwaway `.env` (random `MASTER_KEY`, placeholder `ANTHROPIC_API_KEY`), and asserts `/api/health` and `/login` return 200; locally the runtime layout (standalone `server.js` + `.next/` + full `node_modules`, migrate via `tsx`) was exercised outside Docker instead. _Why:_ §0.3 — do the maximum possible without the missing precondition. The image keeps the full `node_modules` (no production prune) because the worker/migrate/admin CLIs run through the `tsx` devDependency.
- **Standalone tracing narrowed with `outputFileTracingExcludes`**: `src/lib/ask/skills.ts` `readdirSync(<cwd>/build/plugin)` makes Next trace the whole project into `.next/standalone` (tests with fake keys, `vendor/`, the local SQLite under `data/runtime/`); `next.config.ts` excludes everything except `LEGAL.md`, `drizzle/`, `data/places.json`, `build/plugin` and `node_modules`, and the CI `checks` job now runs `pnpm exec next build && bash scripts/check-no-secrets-in-bundle.sh` (kickoff §9 Phase-2 self-acceptance). _Why:_ the scan failed on the server tree and a developer's `.db` must never ride along in a build artifact; excludes are simpler than rewriting the reads (`.env` is still copied by Next itself — `.dockerignore` covers the image).

## Phase 6 — UI (spec: awardgrid-phase6-ui-prompt.md)

### 6.0 Audit and plan

- **Design plan is binding**: `docs/UI_PLAN.md` (tokens with computed WCAG ratios, type roles, spacing, freshness encoding, wireframes, interaction and copy rules) was written and then adversarially reviewed against the spec's §1.2 "generic-template tells"; the review log is in the plan. Every later sub-phase implements the plan; the spec wins where the plan is silent.
- **Row height**: 48 px at ≥ 1280 px (three 13/16 lines), 32 px at 768–1279 px (two lines), 40 px under coarse pointers (one line). _Why:_ spec §3.4 pins both a three-line cell and a 32 px desktop row; three 16 px lines cannot fit 32 px and the anatomy is the product, so 32 px is honoured wherever the cell has two lines. Confirmed by the orchestrator, not re-opened.
- **Neutrals are achromatic** (true white / `#111111`), eleven tokens per theme, `--accent` is never a fill (link text, focus ring, modified-chip outline only); primary buttons are `--bg` on `--fg`. _Why:_ §1.2 review — blue fills are every data app's default.
- **Font**: self-hosted Inter variable (OFL, `public/fonts/`), Latin-only `unicode-range`, `font-variant-numeric: tabular-nums`, no stylistic sets; CJK fallbacks PingFang SC / Hiragino Sans GB / Microsoft YaHei / Noto Sans CJK SC. _Why:_ offline builds, true tabular figures, stable screenshots.
- **Demo dataset** `fixtures/demo/` (deterministic generator, every value invented) served by `scripts/mock-seatsaero.ts` under `DEMO=1`; scenarios are selected by the fake key string (`demo-key-normal|empty|error|slow|partial`). _Why:_ spec §7; lets every state be screenshotted with zero quota.
- **e2e harness**: Playwright projects desktop/mobile × light/dark, temp SQLite seeded by `scripts/seed-e2e.ts`, app started via `e2e/start-app.sh` (production build) against the DEMO mock; snapshot paths carry no platform suffix so baselines are generated on Linux CI (6.6). "Before" screenshots of the v0.1.0 UI live in `docs/screenshots/v0.2/before/`.
- **Additive backend changes planned** (each logged when it lands): `users.theme` column + `ag_theme` cookie; `GET /api/usage`; `POST /api/auth/password`; `next_run_at` + last-run fields on `GET /api/queries`; the "dynamic" cell state computed from the cached `include_filtered` scope (no extra calls); a hand-written QR encoder for the Telegram deep link (no dependency); progressive per-program fill is not buildable against this API (see "Progressive per-program fill" below, and BACKLOG.md).
- **New dependencies** (spec §0.2 allow-list only): `@tanstack/react-virtual`, `@playwright/test`, `@axe-core/playwright`. Chromium for Playwright is installed locally and in CI.

### 6.1 Design system and shell

- **`GET /api/usage` wire shape** (additive, read-only, `no-store`, 401 → `{error:"unauthorized"}`): `{ seats_aero: { used, soft_limit, limit, reset_at, state: "ok"|"warn"|"exceeded" }, ask: { spent_usd, cap_usd, remaining_usd, reset_at }, computed_at }` — snake_case like the rest of the API, replacing the camelCase sketch in `docs/UI_PLAN.md` §11. The `state` is computed by one pure module (`src/components/shell/quota-indicator-state.ts`) shared by server and client: warn at `ceil(0.8 × limit)` (800), exceeded at the soft limit (950). _Why:_ one source of truth so the top bar and the server can never disagree; the plan's sketch predates the Ask cost cap.
- **Theme persistence landed as planned**: `users.theme` (`text`, default `system`) written through `PUT /api/settings { theme }` (400 `invalid_theme`) and echoed by `GET /api/auth/me`; the `ag_theme` cookie (1 year, Lax, not httpOnly) is read in the root layout to stamp `data-theme` before paint. The cookie wins on the current device, the column seeds a new one.
- **Quota indicator refresh**: fetch on mount, every 60 s while the tab is visible, on window focus, and on the `awardgrid:usage-changed` window event (`notifyUsageChanged()` after a grid run or an Ask answer); polling stops for good after a 401. Renders nothing until data arrives.
- **Pre-paint theme script only acts on a cookie**: `THEME_SCRIPT` rewrites `<html data-theme>` only when an `ag_theme` cookie is present; with no cookie the server-rendered attribute (the stored `users.theme` for a signed-in user, else `system`) stands, and `ThemeProvider` re-reads the attribute after mount so the toggle label always names the painted theme. _Why:_ review finding — the earlier `"system"` default overwrote the stored theme on every new device, and React never patches attribute mismatches on hydration.
- **One verb through the register flow**: "Create account" is the page title, the nav label, the button and its busy state; the login page links "No account? Create one" (zh 创建账号 / 没有账号？创建一个). The route stays `/register`. _Why:_ §1.3 "the same verb through the whole flow"; plan §6.9 wrote the cross-link this way.
- **Legal page owns its h1**: `/legal` renders `legal.title` ("Legal" / 法律说明) in sentence case and drops the file's `# LEGAL` line (`stripLeadingTitle`) instead of retitling `LEGAL.md`. _Why:_ sentence case on every shell page; zh readers get a localized title.
- **Locale toggle never disables**: a disabled button drops keyboard focus, so the EN / 中文 buttons stay enabled during the refresh transition and ignore a second press (`aria-busy` on the group). _Why:_ §8 keyboard floor.
- **Theme control is a cycling text button** (`System` → `Light` → `Dark`) with the state in its accessible name; the Settings radios stay the explicit control. _Why:_ no icons in the bar (plan §6.1).
- **Notice wording**: `notice.parse.range_truncated` keeps the word "truncated" ("Date range truncated to {days} days…") because `test/fixtures/queries/cases.json` pins it and the phrase is plain English; the rest of the copy audit's rewrites (two sentences, no em dashes, sentence case) stand.
- **Harness**: `docs/screenshots/v0.2/before/` is the record of v0.1 and is never regenerated — `before.spec.ts` honours `E2E_BEFORE_DIR` so it can be proven against later UIs into a scratch directory, and it reads copy from the en dictionary instead of pinning strings. The live axe summary moved to `docs/screenshots/v0.2/axe-summary.json`; login, register and legal are held to zero serious/critical already (grid, settings, queries join under `E2E_AXE_STRICT` once their sub-phases land). 6.1 captures: `docs/screenshots/v0.2/shell/` (36 PNGs).

### 6.2 Grid

- **Freshness `unknown` is a fourth tier** (`src/lib/grid/freshness.ts`: `FRESHNESS_SPEC` carries thresholds, shapes and color tokens; `markFor`, `milesContrastStep`): an unparseable timestamp draws the hollow ring in `--fg-muted` with age `?` instead of being called stale. The ASCII renderer keeps its stale caveat mark for it. _Why:_ plan §5; "stale" is a claim about age, "unknown" is the honest state.
- **Cell states come from the pivot, reasons are i18n keys**: `CellStatus` gained `filtered` (a dynamic row hidden by the toggle, muted anatomy + `dynamic` tag) and `loading` (skeleton in the query's real shape via `skeletonGridFor`); `GridCell.reason` / `GridMeta.not_fetched_pairs` carry `grid.cell.not_fetched_quota|not_fetched|not_fetched_error`, never English text. `NOT_FETCHED_REASON.upstream` is emitted server-side when one program's Get Routes fails (`upstreamNotFetchedPairs`): a pair with no rows that no *loaded* program monitors may belong to the failed program, so it is "not fetched: seats.aero returned an error", neither "no availability" nor "not monitored". Pairs a loaded program monitors keep their own state.
- **Dynamic rows without calls**: `findGridForUser` appends the cached `include_filtered` scope (same TTL and coverage rules as the plain scope, `dynamic_rows?: false` for the scheduler's diffs) flagged `dynamic: true`; `dynamic_rows_available` on `/api/find` drives the toolbar's muted "extra calls" note. _Why:_ spec §3.4 state 5 with zero quota cost; the switch itself re-runs the query with the flag.
- **Unknown fees render `?`** (`FEES_UNKNOWN`), not a dash. _Why:_ plan §1 "unknowns say ?, never blank"; the em dash read like the no-availability en dash in the captures.
- **Hover highlight is React state on the table, cells are `memo`**: the perf spec (`e2e/grid-perf.spec.ts`, 92 days × 16 routes) measures 320 gridcells in the DOM and 16.7 ms average frames while scrolling and while crossing 30 cells, so no data-attribute rewrite was needed. Scrolling closes an *open* tooltip but never cancels a *pending* one — a keyboard move scrolls the container itself (`scrollIntoView`, the sticky-header nudge), and that scroll must not swallow the tooltip the move just armed.
- **Quota state keeps the toolbar**: with the daily limit reached and no cached grid, the toolbar still renders so Save is visibly disabled with its reason; Run in the query bar is disabled with `grid.toolbar.run_disabled_quota`; Export is off while there is no grid. _Why:_ spec §3.7 "Run and Save actions disabled with a tooltip".
- **Progressive per-program fill is not buildable against seats.aero** (issue #36; settled, not deferred). Three verified facts, each a line of this codebase:
  1. `planFind` builds ONE Cached Search request whose `sources` parameter is the comma-joined program list (`src/lib/seatsaero/find.ts:120`, `src/lib/seatsaero/client.ts:154`), and omits the parameter altogether when the query names no programs — all 26 sources answer in that single request. Per-program fill therefore means up to 26 requests where there is one: the daily quota, times 26.
  2. It would also disable the cache for good. Coverage rows are keyed on the exact sorted program set (`src/lib/db/stores/cache.ts:67-74`) and `coverageSatisfies` returns false when a stored record names programs and the query does not (`src/lib/seatsaero/cache.ts:152-154`), so a per-program record can never satisfy an all-programs query.
  3. There is nothing to fill program by program: the grid has no program axis. Its axes are dates × route pairs, and `not_fetched` is per pair with an i18n-key reason (`src/lib/grid/pivot.ts:171-180`, `src/lib/server/find.ts`). The kickoff brief's §3.4 language about "a program whose column is not fetched" describes a column that does not exist.
  What ships instead is an honest status line: what is being **asked** ("Asking seats.aero about all 26 mileage programs…"; the names themselves for one to three programs, a count beyond that; a "still going" sentence after 12 s) and how long it has taken. The elapsed seconds are an `aria-hidden` sibling of the `role="status"` sentence, never inside it, so the live region changes only when the wording does. Sentence selection is the pure `src/components/grid/searching-status.ts`; the tick lives in a leaf component so the toolbar subtree does not re-render once a second.
  _Revisit if:_ seats.aero exposes a per-program incremental endpoint, or the Bulk Availability path (`src/lib/seatsaero/find.ts:155-198` — genuinely one request per program) becomes the common plan rather than a rare win for wide multi-airport single-program queries.
- **The measurement that gates the one honest flush** (issue #36 Phase 2, NOT built). The only genuine streaming opportunity in this codebase is not the search: it is the routes phase. When any requested pair comes back with zero rows, `runFind` walks the sources ONE AT A TIME with an `await client.getRoutes(source)` each, after the rows are already final. Measured offline against an injected-latency fake transport (all 26 programs, 8 origins × 1 destination, 30 days, cold user, over the synthetic fixture through a fake transport with a fixed per-request delay; scratch harness, not committed): **26 sequential, non-overlapping `/routes` calls**, phase wall-clock **7.8 ms at 0 ms per-call latency, 1.37 s at 50 ms, 3.96 s at 150 ms**. The in-process floor is negligible, so the phase is pure round-trip count: it crosses the ~2 s gate at about **77 ms per call** (2000 / 26). Real per-call latency to seats.aero was NOT measured — that needs a live key and is out of scope here. Second measurement, same harness: a query whose every pair returns rows makes **zero** routes calls, so the phase (and any flush before it) does not fire at all on a fully-covered query. _Decision:_ Phase 2 stays unbuilt until someone measures a real cold run; below ~77 ms per call it is not worth a second transport.
- **Issue #36's open questions, decided.** (a) *Closing #36 without per-program fill* — yes: the feature is not buildable without breaking §0.2's quota and cache boundaries, and the need behind spec §3.4 (tell me what is happening) is answered by the status line. (b) *Routes-phase latency* — measured as above; the gate is unmet on the evidence available offline. (c) *How often the phase fires* — only when some pair has zero rows; a fully-covered query makes zero routes calls, which narrows Phase 2's window further than latency alone suggests. (d) *How often `failed` populates in real use* — unknown; if upstream `/routes` turns out to flake routinely the new note becomes strip noise and should be folded into the per-cell `not_fetched` reason instead, which already carries it. Reassess after the first weeks of real use. (e) *English program names inside zh copy* — kept: `SOURCE_NAMES` are brand names, the copy lint already allowlists their tokens, and the notify formatter treats them the same way. (f) *List separator in zh* — `Intl.ListFormat` in the viewer's locale, so the client-side status line reads "A、B和C" and the en one "A, B and C"; the ideographic comma matches `footer.no_affiliation`. The one exception is the server-side `find.routes_failed` variable, joined with an English comma because the API does not know the viewer's locale — the same treatment every other list inside a notice variable gets.
- **A failed route list is reported as a failure, not as a quota story** (issue #36 defect fix). `ResilientRoutesCatalog.ensureLoaded` puts a source whose Get Routes call errored into both `failed` and `skipped`, and `runFind` turns any `skipped` into `find.routes_skipped` — "skipped to stay within today's quota". So an upstream 500 on one program's route list told the user their daily allowance had run out; it had not, the call was made and charged. `reattributeRoutesNotices` (`src/lib/server/find.ts`) now splits the two causes from the one place that sees both: the quota sentence keeps only `skipped − failed` and disappears when every skip was a failure, and the failures get their own `notice.find.routes_failed` naming the programs. `programs_failed` was already on the wire and read by nothing. _Why the warnings array is rebuilt with it:_ `uiNotices` (`src/components/grid/api.ts`) pairs `notices` with `warnings` by index and falls back to the server's English for the WHOLE strip unless the lengths match, so an unpaired notice would silently untranslate every warning for a zh reader.
- **e2e shares one app process across projects**: the dynamic scope warmed by one project is cached for the next, so `grid.spec.ts` asserts the "extra calls" note and the pre-toggle filtered count conditionally on that cache state rather than resetting the database per project. `before.spec.ts` locators were widened to the 6.2 UI (status banner instead of an alert, the empty-results sentence). `grid-results` joined the strict axe pages in both themes; the axe spec now logs each offending element.
- **Header program counts come from the routes catalog** (additive on `/api/find`: `programs_by_pair: Record<pairKey, number> | null`, `programs_checked: number`): `findGridForUser` hydrates the user's stored route lists (zero calls) and, when every requested program is loaded, counts the programs monitoring each pair ("7 programs") and the programs monitoring at least one requested pair ("Checked 7 programs" in the empty state). When a list is missing the counts are null and the header says what it can see — "N with availability" (`grid.header.available_*`) — never a monitoring count it does not know. _Why:_ review finding — the cells-seen fallback changed with the cabin chip and the date window while labelled "programs monitored".
- **A missing route list makes unresolved pairs "not fetched" on every path**: pairs with no rows that none of the LOADED programs monitors are `not_fetched` whether the list failed on this request (`grid.cell.not_fetched_error`), was skipped for quota (`grid.cell.not_fetched_quota`) or is simply absent on a cached grid (`grid.cell.not_fetched`, the generic key — the routes store records successes only, so an earlier failure's cause is not known). "Not monitored" is still claimed only when every requested list is loaded. _Why:_ review finding — the partial scenario rendered plain en dashes on the cached path.
- **The Ask entry point sits at the right end of the grid toolbar** (after "Save as standing query" and "Export CSV", inside the Filters sheet below 768 px). Spec §3.3 lists five controls and does not place the Ask drawer's trigger; spec §3 puts the drawer beside the grid; plan §6.1 keeps the top bar to name, nav, quota, language, theme and user menu. Text only, no icon. `docs/UI_PLAN.md` §11 amended. _Why:_ the drawer needs a trigger on the grid page and the toolbar's right group is "act on this grid".
- **The dynamic tag is the short word `dyn` (zh 动态) at every density**: a 112 px column with a cabin tag and six-digit miles holds 99 px of content, and "dynamic" (45 px) does not fit; the full word stays in the cell's title and aria label (`grid.cell.filtered`), the tag (`grid.cell.filtered_short`) is drawn on mobile too so the filtered state never rests on the muted color alone. _Why:_ review findings on clipping at the minimum column and color-only meaning on mobile.
- **Tooltip is hoverable** (WCAG 2.1 SC 1.4.13): `.ag-tip` takes pointer events; leaving a cell closes its tooltip after a 100 ms grace (`TOOLTIP_GRACE_MS`) that the tooltip's own mouseenter cancels; Esc, blur and keyboard moves still close at once. _Why:_ review finding — `pointer-events: none` plus close-on-leave made the tooltip impossible to reach.
- **Row height includes the grid line**: `.ag-cell-in` / `.ag-skel` are `row − 1 px` tall so body rows measure exactly 48 / 32 / 40 px like the header row. Not-monitored cells draw their borders in `--line-strong` (`--line` is 1.18:1 on the raised ground). Demo availability rows now carry `{J,F}TotalTaxes` + `TaxesCurrency` on ~85 % of rows (second RNG stream, other values byte-identical) so the fees line shows amounts and `?` only where fees are unknown. The drawer uses the one formatter set in `src/lib/grid/format.ts` (the `state.ts` trio is gone).

### 6.3 Query bar and chips

- **Seven chips replace the Phase-5 form**: Origins · Destinations · Dates · Cabins · Programs · Direct only · Sort, each a label + value summary with a popover editor. `max_miles` is no longer editable (it is not one of the seven); a parsed value survives in the draft and in the URL. _Why:_ spec §3.2 fixes the set and the order.
- **Chips are the source of truth, the URL follows the last run**: chip edits mark the query modified (accent outline, a Run affordance at the end of the row, toolbar disabled, grid dimmed with a "Run to refresh" strip); `?q=` and the grid only change when the query is run. Toolbar controls (rows, cabins, dynamic pricing) still act immediately per §3.3. _Why:_ spec §3.2.
- **`SEL` keeps both airports** (`ICN`, `GMP`) per the original kickoff §4.2 seed, so the canonical query renders seven columns. The demo dataset therefore monitors `GMP → SEA` and keeps `ICN → SEA` as the single "not monitored" pair (spec §7 asks for one). _Why:_ the seed is a Phase-1 requirement; changing it to match an abbreviated example in §3.2 would break `未来一个月` queries for Seoul.
- **Relative date windows are inclusive**: "next 30 days" is today … today + 29 (30 days), matching the presets and the chip's own day count. _Why:_ reviewer finding — the chip read "(31 days)" for a query whose text said 30, and the editor's preset then flagged an unchanged query as modified.
- **Calendar is hand-written** (no new dependency): two months, keyboard-operable with a tab stop that follows the visible window, day cells named with the full localized date, the 92-day cap clamped in the editor's own state so the note and the chip never disagree; the cap is a note, never an error.
- **Errors are per chip**: every failing chip renders its own message and carries `aria-invalid` + `aria-describedby`. _Why:_ §8 — one shared message left the other chips signalling by colour alone.
- **Examples popover** opens below the whole query row (never over the field or the Run button) and fills the bar without running.
- **Demo dataset time model**: a connecting leg is never dated before the leg that fed it (eastbound transpacific keeps the same calendar day), and the mock pins one clock per server instance so a row's `UpdatedAt` is identical in `/search` and `/trips/{id}`. _Why:_ both surfaced as real inconsistencies once the dataset grew.

### 6.4 Drawers

- **One drawer slot, not two booleans**: `src/components/drawers/use-drawer-state.ts` holds `open: null | {kind:"cell",cellKey} | {kind:"ask"}`, so spec §3's "mutually exclusive" is structural — every open replaces the slot. `grid-app.tsx` closes only the cell drawer on a re-run (`closeCell`), because invalidating the selected cell should not throw away an open Ask conversation. _Why:_ a rule two call sites have to remember is a rule that eventually breaks.
- **One shell for both drawers** (`drawer-shell.tsx`): the caller states a width (480 cell, 420 Ask) and a mobile presentation, and the shell picks push (≥ 1280), overlay (768–1279), sheet or bottom sheet (< 768) from the breakpoint. Push reserves its width by padding `<main>` (`drawer.css`), so the grid shrinks instead of being covered and the page layout needed no change. `aria-modal` and the focus trap are set for the modal modes only — a pushing drawer leaves the grid usable, and announcing the page as inert would be false. Esc is ignored when `defaultPrevented`, so a popover inside the drawer that consumed it does not also close the drawer.
- **The Ask context pill uses commas, not middle dots**: spec §3.6 sketches `Current grid: 4 routes · Oct 1–30 · J+F`, but §1.2 names middle-dot meta strings as a generic-template tell and the copy lint forbids `" · "` in a translation. The pill follows `docs/UI_PLAN.md` §6.6 — "Current grid: 7 routes, Sep 6–Oct 5, J and F", with the locale's own comma and `Intl.ListFormat` for the cabins (zh 「，」 and 「和」). _Why:_ a separator glyph moved into code to dodge the lint is still the tell the lint exists for.
- **At the cap the reason is its own line**: the cost meter renders "Today $2.00 of $2.00" and the reason as two blocks, and `ask.budget` dropped its "(midnight UTC)" gloss now that the reset time prints `00:00 UTC` (`hourCycle: "h23"`). _Why:_ run together they read as one sentence and named the cap three times.
- **`GET|POST /api/ask/demo`** (additive, read-only, gated by `ASK_DEMO_STREAM=1`, off in every real deployment): a scripted SSE stream and usage response so the e2e suite can photograph streaming, tool activity, Stop, the cap and the failure states on an app that runs without `ANTHROPIC_API_KEY`. It echoes its own fixed text and reaches no model. A page opts in with `?askdemo=1` (remembered for the session, since the grid rewrites its URL on run); `NEXT_PUBLIC_ASK_DEMO` is deliberately not exported by `e2e/start-app.sh` — it is inlined at build time and would put every other spec's Ask drawer on the scripted stream.
- **The cell drawer's footer acts on the cheapest program** (`rows[0]`), as the plan §6.5 wireframe draws it: "Open in <program>", "Copy details" and "Save as standing query" belong to the row the drawer leads with. Per-program actions would need a selection affordance the spec does not describe (`BACKLOG`). The confirmation line is body text directly above the button in DOM order, asserted by `e2e/cell-drawer.spec.ts`, and it travels with the copied block.
- **`header-bar.tsx` deleted**: the v0.1 grid header (calls, cache badge, oldest/newest, quota, save, CSV, transpose, Ask) was fully superseded by the 6.2 toolbar, the shell quota indicator and the 6.4 drawers, and it was already rendered by nothing. It also joined its meta with middle dots. Its dictionary keys are left in place for 6.5.
- **Axe holds both drawer states**: `grid-cell-drawer` and `grid-ask-drawer` joined the strict pages in `e2e/axe.spec.ts` (zero serious/critical, light and dark).

### 6.4a Drawers — review fixes

- **The selection outlives the cell drawer** (`use-drawer-state.ts` gains `lastCell`): the 6.4 slot made spec §3.6's second context pill unreachable. Cell selection WAS the cell-drawer slot, and `open_ask` replaces the slot, so `Selected: SEA→NRT Oct 15 F 80,000 Alaska` could never render and the cell was never sent to the ask lane. `lastCell` is set by `open_cell`, preserved by `open_ask`, and cleared by `close` and `close_cell` (a re-run invalidates the selection). A new **"Ask about this cell"** action in the cell drawer's footer is the walk that uses it. _Why:_ the pill, the `includeCell` toggle and `cellContextFromCell` were all dead code without it.
- **The save dialog shows the scope it will save** (`queryScopeSummary` in `components/queries/format.ts`): from the cell drawer the dialog saved one route over a ±3-day window while describing itself as re-running "this exact query", and the only visible hint was a prefilled name carrying the cell's single date. It now renders one muted line — "Watches PVG to SEA, Sep 7–13, First and Business." — and a create-from-cell body (`saved.dialog.save_body_cell`). _Why:_ §1.3 — a button says exactly what happens, before it happens.
- **Drawer a11y and lifecycle**: initial focus skips the bottom sheet's drag handle (it is the dismiss control, and landing on it put Enter one press from closing the sheet); Escape is ignored while an IME is composing (`nativeEvent.isComposing`, as `query-bar.tsx` already does for Enter), so a zh draft survives dismissing the candidate window; the opener is re-captured on `openerKey` so a second cell clicked in push mode gets focus back; the modal modes lock body scroll (scrollbar compensated) and the scrim contains overscroll; and a leaving panel is `inert` with `pointer-events: none` on both panel and scrim, so the 200 ms exit no longer advertises a modal dialog or eats the next click.
- **Closing the Ask drawer aborts the stream.** `AskDrawer` is rendered unconditionally (`DrawerShell` returns null internally), so the unmount cleanup never ran on close and Esc / the scrim / the X left the SSE connection and the agent session running to completion on the operator's budget. An effect keyed on `open` now takes the same path as Stop. _Why:_ `api/ask/route.ts` says an abandoned tab cannot keep spending the daily budget; only Stop was keeping that promise.
- **One live region, and it is not the transcript.** `aria-live` wrapped every turn, so each ~150 ms text delta re-announced a half-formed sentence and the restored history announced itself wholesale. The transcript is now a plain `aria-busy` region and a one-line `role="status"` announces "Thinking…" / "Answer complete." The failure line is always mounted (`sr-only` while empty) because a live region inserted together with its text is commonly announced by nothing, and at the cap the disabled prompt box is `aria-describedby` the cost meter so the reason and reset time are read with it.
- **`safeHref` rejects backslashes.** `/\evil.invalid` passed the same-origin-path branch and resolves to `https://evil.invalid/` under WHATWG URL parsing, so a prompt-injected link could leave the origin. Backslash joined the rejected character class.
- **Ask history ends at log-out** (`clearAskSession()`): `sessionStorage` survives the same-tab navigation to `/login`, so on a shared machine the next user opened Ask and read the previous one's questions and answers. Cleared on log-out and again on a successful log-in, together with the `?askdemo=1` switch.
- **40 px touch targets in the mobile drawers**: every `xs` control inside a `sheet` or `bottom-sheet` presentation grows to 40 px (spec §3.4), keyed on the presentation rather than `pointer: coarse` — the presentation is what the rule is about. The two drawer axe audits now also run on the mobile projects, which previously audited neither presentation.
- **Skeleton widths use `nth-of-type`**: the sr-only "Loading flights…" span is the container's first child, so `nth-child` shifted every bar by one and left the third with no width rule at all (a full-width slab).
- **zh-CN drawer captures**: both `shot()` helpers gained a language dimension; `cell-drawer/open-*-zh.png` and `ask-drawer/{open-empty,answered}-*-zh.png` join the matrix, asserting no horizontal overflow in either panel. (#34 renamed these to `grid/cell-drawer-*-zh.png` and `grid/ask-{open,answered}-*-zh.png` and declared them properly; the helpers are gone.)
- **`summarizeQuery` / `summarizeCell` / `ASK_EXAMPLE_PROMPT` deleted**: nothing outside their own test referenced them (the pills render `labels.ts`, the request sends the structured objects), so the assertions were pinning English fragments no user or model ever saw.

### 6.4 Drawers

- **One drawer shell** (`src/components/drawers`) for both: pushes content at ≥ 1280 px, overlays with a scrim at 768–1279, becomes a full-height sheet (cell) or a bottom sheet with a drag handle (Ask) below 768. Focus is trapped and returned to the opener, Esc closes (guarded against IME composition), the body scrolls only inside the panel, and the exiting scrim stops swallowing clicks.
- **Mutually exclusive drawers, but the selected cell survives**: opening Ask closes the cell drawer while keeping the cell in state, so the "Selected: …" context pill works and "Ask about this cell" opens Ask with that cell attached. _Why:_ reviewer blocker — the pill could never render because selection was the cell-drawer slot.
- **Cell drawer footer acts on the cheapest program** in the cell (the plan's wireframe); per-program deeplinks would need a selection affordance the spec does not describe → BACKLOG.
- **Ask history is cleared on logout and login** (`sessionStorage`), along with the demo-stream switch. _Why:_ reviewer blocker — on a shared machine the next user saw the previous user's questions and answers.
- **Model output can only link same-origin http(s)**: `safeHref` now resolves the URL and rejects backslashes, so `/\evil.com` cannot escape the origin.
- **Closing the Ask drawer aborts the stream** (same path as Stop), so an abandoned tab cannot keep spending the daily budget.
- **Scripted Ask stream for e2e**: `src/app/api/ask/demo` is an additive, env-gated (`ASK_DEMO_STREAM=1`), keyless fixture route that replays a fixed SSE script; the drawer uses it only with `?askdemo=1`. _Why:_ the e2e app runs without an Anthropic key, and the streaming UI still has to be screenshotted and tested offline.
- **No icons on drawer action buttons** (Send, Stop, Show flights, Open in …): text only, per §1.2. The drawer's close control keeps its ✕.

### 6.5 Queries and Settings

Additive backend changes (no schema, no migration, no new dependency; every existing response shape still validates):

- **`POST /api/auth/password`** — `{current, next}` (also accepts the plan's `{currentPassword, newPassword}` spelling) → 200 with a rotated session cookie, 400 `invalid_current` / `weak_password`. Changing the password revokes every session and re-issues one for the caller, so "log out every other device" is the behaviour, not a separate switch; the Account section says so in one line.
- **`GET /api/queries` items gain `next_run_at` and `schedule_label`**, and **`GET /api/queries/[id]/runs` gains a top-level `diff`** for the last run, so the list and the expanded row render from the server payload without a second round trip.
- **`RunSummary.calls_used`**, always `null` today — `query_runs` has no calls column and the schema is frozen. The run history renders an en dash with a "not recorded" title rather than inventing a number (BACKLOG).
- **`PATCH /api/queries/[id]` accepts `query`** (the whole `QueryObject`, validated exactly as `POST` validates it). _Why:_ spec §4 says Edit opens the same chip editors as the grid; without it the drawer could show the chips but never save them, and the drawer had grown a "this server can't change what a query watches yet" fallback that reported a dropped edit as a success. Omitting the field leaves the stored chips untouched.
- **New pure helpers** `nextRunAt` / `describeCron` (`src/lib/scheduler/cron.ts`) and a **dependency-free QR encoder** (`src/lib/qr`, byte mode, level M, versions 1–10). `describeCron` returns `{kind:"custom"}` for anything it cannot describe exactly, so a label never misstates a schedule; an overdue `next_run_at` renders "due now", never a negative countdown.

Decisions and fixes made while integrating:

- **The edit drawer's chips are controlled, and now controlled by something.** `ChipRow` takes `open` / `onOpenChange` from its page; the drawer passed neither, so `open` defaulted to `null` and every chip popover in the drawer was inert — the chips rendered and nothing opened. The drawer now owns `openChip`. _Why:_ this was spec §4's "Edit opens the same chip editors as the grid inside a drawer", silently non-functional; `e2e/queries.spec.ts` now flips Direct only in the drawer, asserts the chips ride along in the PATCH body, and reloads to prove the server kept them.
- **A dropped cell is not dimmed.** `opacity: .7` over the whole cell pushed `--fg-muted` to 3.31:1 and `--stale` to 3.24:1 on both grounds — five serious axe findings, for a distinction the "Dropped cells" heading and the outlined `dropped` tag already carry. _Why:_ §8's floor is zero serious/critical, and §1.2's "nothing by colour alone" cuts the other way too: the tag was already doing the work.
- **The QR flips its plate in dark mode.** Plan §6.8 says `--fg` on `--bg`, which in dark mode is light modules on a dark ground — an inverted code many phone cameras refuse to decode, which is the only thing the QR is for. Dark mode paints `--bg` modules on a `--fg` plate: the same sanctioned inversion the primary button and the switch-on track already use, so no token rule bends and the code scans in both themes.
- **Key validation stays offline.** `PUT /api/keys` probed seats.aero through the bare global `fetch`, so adding a key left the machine even under `SEATS_AERO_BASE_URL` — spec §0.2's offline promise did not hold for the one form that makes a network call. It now passes `seatsFetchFromEnv()`, which is `undefined` in production (unchanged behaviour, still stubbable in route tests) and routes to the mock in dev and e2e. `e2e/settings.spec.ts` dropped its stand-in for `PUT /api/keys`: all three verdicts — rejected, unreachable, checked — are now the route's own answers to the DEMO mock's scenario keys.
- **Axe strict pages gained four**: `queries`, `queries-expanded`, `queries-edit-drawer`, `settings` — zero violations at every impact in both themes. The two new audits cover the densest 6.5 surfaces: the expanded row (two nested tabular structures inside a row of a third) and the edit drawer with a chip popover over it.
- **`before.spec.ts` follows the UI it photographs.** Its queries assertion still expected v0.1's table-at-every-width with a linked name; the name is now plain text and the table becomes a stacked list under 768 px. The committed "before" PNGs are untouched — the spec writes to a gitignored directory unless `E2E_BEFORE_DIR` says otherwise.

#### 6.5 review fixes (second pass)

- **Quiet hours is two fields again.** The section shipped as From / To / a full time-zone `<select>` plus a "Detected: UTC" line — the exact construct `docs/UI_PLAN.md` §12.11 lists as a generic-template tell to remove, and one control more than spec §5.2 ("two time fields with the detected timezone shown") asks for. The zone is now one muted line, `Asia/Shanghai (detected)` or `… (your account)`, and the select lives behind a **Change time zone** disclosure. _Deviation logged as §0.3 requires:_ the override survives, because an account read in a zone the browser is not in is a real case (travel, a shared machine) and deleting the control outright would lose it — but it is disclosure, not furniture.
- **Price drops reach the page.** `shouldNotify` fires on `diff.price_drops`, but `lastRunDiff` computed them and threw them away and `runResultText` decided from `new_cells`/`dropped_cells` alone, so a run whose only change was a price drop was reported as "no change" while the Telegram digest said prices fell. `RunDiffRows` gained `price_drops` (`{ row, before_miles, pct }` — additive, read-only, no schema change), the expanded row renders a third "Cheaper cells" section with a `−15% from 60,000` tag, and a delivered run with no cell movement now reads "prices dropped" instead of "no change" (`RunSummary.notified` was already on the wire and unused).
- **`calls_used` survives the refresh.** "Run now" is the only place a real call count exists (`query_runs` has no column for it), and the refetch that followed it overwrote the row's history with the server's nulls. `mergeRunCalls` (pure, tested) fills a null count from what the page already knew. "Run now" also recomputes `next_run_at`, so an overdue query stops saying "due now" the moment it runs. **Superseded:** `query_runs.calls_used` exists as of drizzle/0002, so the server's rows are authoritative and `mergeRunCalls` was deleted; `rememberRun` still shows a just-finished run before the refetch lands.
- **Inline confirmations return focus.** Dismissing one dropped focus on `<body>`, because the opener is unmounted while the question is up; `InlineConfirm` now takes `restoreFocusTo` and finds the re-rendered opener by selector. The two hand-rolled copies on Settings (remove a key, log out everywhere) were replaced by the same component, so Esc cancels there too — the same interaction no longer behaves differently on two pages of one product.
- **Registration checks the invite before argon2.** `registerWithInvite` hashed first, so anyone with no invite code could drive unlimited 64 MiB / timeCost-3 hashes through an unauthenticated route. A non-consuming `isInviteRedeemable` peek runs first (`consumeInvite` in the transaction is still the single-use gate), and `POST /api/auth/register` and `POST /api/auth/password` now carry the throttles login already had — the password route keyed on the user id, because a wrong `current` is an oracle for whoever holds a stolen session.
- **Radio indicators are drawn, not inherited.** Under `color-scheme: dark` Chromium paints an unchecked native radio as a filled disc and the checked one as a ring with a dot — the conventional reading inverted (spec §8). `appearance-none` plus an explicit ring / ring-and-dot reads the same in both themes. The two fieldsets also give their options a wrapping container, so a wrapped option stays in the option column instead of landing in the page gutter under the label.
- **The empty state's CTA is a button again.** `buttonVariants(...)` was called raw on a `<Link>`, so the cva base's `border-transparent` and the outline variant's `border-line-strong` both landed and equal-specificity cascade order made the border invisible. Wrapping it in `cn()` lets tailwind-merge resolve them.
- **Four settings screenshots were lies.** `e2e/settings.spec.ts` forced the dark theme radio before capturing `language-theme*`, so all eight PNGs were dark and the four named `-light` were byte-identical to their twins. Each project now drives its own theme radio.
- **Copy:** `error.invalid_key` dropped the "(401/403)" parenthetical, and the Telegram status says "Not linked" in mock mode too, with the server-configuration caveat on the muted line under it — a status answers "is my account linked?", not "how is this server configured?".

### 6.6 Responsive, a11y, visual suite, docs

- **The `visual` CI job is non-blocking until five consecutive green runs.** ~~Pending.~~ **Promoted 2026-09-07 — see "#33" under Post-v0.2 issues for the five run ids and for the two determinism defects that had to be fixed first.** It runs the `toHaveScreenshot` assertions on every push (`VISUAL=1 pnpm e2e -g visual`) and uploads the expected/actual/diff images as the `visual-snapshots` artifact — or, when no baselines are committed yet, generates the Linux set and uploads it as `visual-baselines` for a human to commit once — but `continue-on-error: true` keeps it out of the merge gate; it is promoted to required — and the promotion recorded here with the five run ids — only after five consecutive green runs on `main`. _Why:_ spec §11 pins the policy. A pixel suite that has never been observed across five runs cannot tell a real regression from font-rendering noise, and a gate that cries wolf on its first week gets ignored or disabled, which is worse than no gate. Non-blocking is not "ignorable": a red `visual` run is read before merging, and the diff artifact is the evidence.
- **Baselines are Linux-only, and the path has no platform suffix.** `snapshotPathTemplate` is `e2e/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}` (`playwright.config.ts`), so there is exactly one baseline per project and it is the Ubuntu/Chromium rendering committed from CI. macOS runs compare against those same files with the config's tolerance and are for iteration only; `pnpm e2e:update` on a Mac must never be committed. Every baseline update carries its reason in the commit message ("baseline: …"), never "update snapshots". _Why:_ font rasterisation, hinting and the CJK fallback all differ between macOS and Ubuntu, so a Mac baseline fails on CI for reasons that are not the UI; a platform suffix would instead invite two baselines per capture, one of which nothing ever checks. CI installs `fonts-noto-cjk` so the zh captures render the same faces on every run.
- **Screenshot naming: `docs/screenshots/v0.2/<page>/<state>-<viewport>-<theme>[-zh].png`.** `<page>` is one directory per surface; `<state>` is the page state from spec §3.7/§4/§5; `<viewport>` is `desktop` (1440 × 900) or `mobile` (390 × 844); `<theme>` is `light` or `dark`; `-zh` marks the Chinese capture. _Why:_ the file name is the state matrix, so a missing combination is visible in a directory listing, and a sort groups a state's four (or six) images together. Deriving viewport and theme from the project name makes it impossible for a capture to be labelled `-light` while the page is dark — exactly the defect found in the 6.5 settings captures. **Amended by #34:** the four page folders are `shell`, `grid`, `queries`, `settings` plus the frozen `before/` — the `chips/`, `cell-drawer/` and `ask-drawer/` detail folders are gone — and the per-spec `shot()` helpers are gone with them; `e2e/states.ts`'s `capture()` composes every name.
- **The captures under `docs/screenshots/v0.2/**` are for human review, not assertions.** They are plain `page.screenshot()` images regenerated by every `pnpm e2e` run; the pixel assertions are the separate `toHaveScreenshot` baselines under `e2e/__screenshots__/`. _Why:_ committing the review images as baselines would make every intentional UI change a 300-file diff and would fail the suite on any host with different fonts.
- **`LEGAL.md` stays English-only, and the page says so in markup.** The legal text is not translated; `/legal` keeps its localized `h1` (above) but wraps the rendered document in `lang="en"`, so a screen reader in the Chinese UI switches voice for it (WCAG 3.1.2) instead of reading English with a Chinese synthesiser. _Why:_ translating a legal notice is a legal act, not a string task, and it is outside this phase's scope; marking the language honestly is the accessible half that *is* in scope. A translated `LEGAL.zh.md` would be a content decision for the owner.
- ~~**The `--strict` half of `scripts/screenshot-index.ts` is not wired into CI yet.**~~ **Superseded by #34 below**, which folded the per-feature captures into the matrix and wired `--strict --check` into the `checks` job. The original entry, for the record: `--check` (missing or misnamed captures) is the promise the docs make; `--strict` additionally fails on a capture the matrix does not declare, and it currently exits 1 because the per-feature screenshot code in `grid.spec.ts`, `chips.spec.ts`, `cell-drawer.spec.ts`, `ask-drawer.spec.ts`, `queries.spec.ts`, `settings.spec.ts` and `shell.spec.ts` predates the matrix and was left alone: those files belong to other sub-phases and were being edited in the same working tree while 6.6 was captured. _Why:_ a guard that is red on the day it lands teaches people to skip it. The cleanup and the CI wiring are one `BACKLOG.md` item under "UI (deferred by Phase 6)", to be done in a pass that owns all seven specs at once.

### v0.2 screenshot review (#30) and Chinese copy review (#31)

Eyes-on review of the 156-image matrix under `docs/screenshots/v0.2/**` plus a native read of `zh.ts`. Everything below is a change made because a capture or a string showed the UI contradicting itself; the plan amendments are logged at the end of `docs/UI_PLAN.md`.

- **The Programs chip and the Programs editor said opposite things.** "All" is stored as the ABSENCE of a filter (`programs: []`), and the editor built its rows from that empty set — so the chip read "all 26" over 26 unticked boxes, in every programs capture. `ProgramsEditor` now expands "all" to `SEATS_SOURCES` before it draws, and a click from the all-on state removes that one program (25 left) rather than selecting only it. `toggleProgram`'s null-collapse semantics are unchanged; the model was right and the editor was lying about it.
- **Four `queries/edit-drawer-*.png` were photographs of a page with no drawer on it.** The panel mounts in its closed transform and slides in over 200 ms, and Playwright's `animations: "disabled"` freezes a running CSS transition where it is rather than completing it — so a capture taken inside those 200 ms catches the panel still off-screen at x = 1440. The cell and Ask drawers only escaped because their helpers wait for streamed content first. `capture()` now waits for every open drawer to reach `transform: none` before the shutter opens (`settleDrawers` in `e2e/states.ts`), which closes the whole class of race rather than this one instance. _Why it matters:_ the headline interaction of the Queries page was undocumented and, worse, documented as absent.
- **Sticky header ground and the highlight swapped roles.** See the UI_PLAN revision log: `--bg-raised` is the resting ground §2 always specified, and hover/focus is now a 1 px inset `--line-strong` edge. Two states cannot both be the same ground, so §7 is amended rather than quietly ignored.
- **`--scrim` is a token, not a derivation of `--fg`.** §6.3's "40 % `--fg`" is correct in light and inverted in dark (`#696969` over `#111111` — the dimmed page ends up the brightest surface on screen). The new token is black at 40 % in both themes: identical in light, a scrim again in dark. This is a plan departure, logged there too.
- **The top bar and the settings quota bar now count against the same denominator.** The header read "32 / 1,000 today" (the hard allowance) while the bar 300 px below read "32 of 950 used" and filled toward 950. The header follows the soft limit — the number the bar fills toward — and the 1,000 stays in the tooltip and the settings caption, which are the places that explain it.
- **The quota banner stopped describing a grid that was not there.** "Cached results are still shown" is a separate string now, appended only when a grid actually survives the failure; the no-cache case gets a left-aligned empty state instead of ~590 px of blank page.
- **The four page-level states that replace the grid look like each other.** `NoKeyState`, `StartState` and `NoResultsState` were a shadcn `<Alert>` and two dashed centred boxes at an 8 px radius that is not on the plan's three-value scale; they are the `.ag-empty` sentence-plus-accent-link treatment `GridEmptyResults` already used, and their links are `--accent` like every other link on the page.
- **Copy that could not be fixed in the dictionary was fixed in the component.** 里程 works as a unit after a number, 税费 does not — it is a category noun and has to precede its value — so the drawer's fee span orders itself by locale. Everything else in the Chinese pass is a dictionary edit; the key set is unchanged and `copy-rules.test.ts` still passes.
- **`grid.header.calls` said "render".** A React implementation word shown to end users, and the zh inherited it as 渲染, which is pure jargon in Chinese. It is "{n} calls this search" / 「本次搜索 {n} 次调用」 now.
- **The demo Ask stream has a Chinese script.** Every answered zh capture was an English answer body under Chinese chrome, so the record proved nothing about CJK line-breaking or CJK line height on the 20 px body grid — the one thing §1.6 asks the answer typography to prove. Both scripts also now carry a heading, an ordered list, a link and a fenced code block, so all four remaining branches of `answer.tsx` are photographed rather than assumed. The route stays inert without `ASK_DEMO_STREAM=1`.
- **The e2e suite followed the UI in five places** rather than the UI being bent to keep the suite green: the ask cap meter is one line, the delete confirmation names the query and offers Keep, and the top-bar quota assertion counts against the soft limit.

## Post-v0.2 issues

### #32 The grid on a real phone

Verified on an iPhone 17 Pro simulator (iOS 26.5, Mobile Safari/WebKit, 402 × 874 pt) against a
production build of the offline demo. Real touch, real momentum scrolling, real sticky behaviour —
not an emulated viewport. Momentum, both sticky axes, the hatch, the freshness marks' shapes, the
dark theme under the system setting, 16 px inputs, 40 pt targets and the date popover all held.
Long-pressing a cell raises no iOS selection callout: `user-select: none` already covers it.

- **The tooltip asks `:focus-visible`, not "did something focus this".** Armed from `mouseenter`
  and from focus, it opened after every tap and stayed: iOS synthesises `mouseenter` on tap and
  never sends the matching `mouseleave`, and closing the drawer hands focus back to the cell that
  opened it, so the tooltip landed over the row below with no pointer left to move away. The
  pointer path is now gated on `(hover: hover) and (pointer: fine)` and the focus path on
  `:focus-visible` — which is exactly the "did the keyboard put it here" question, so WCAG 2.1
  SC 1.4.13 keeps its hoverable tooltip and a tap gets none. `e2e/grid.spec.ts` had been SKIPPING
  this case with a comment claiming tooltips never open on touch; there is now a mobile test that
  checks it instead of asserting it in prose.
- **Columns snap clear of the sticky date column below 768 px.** With free-form touch scrolling a
  column rests half-hidden behind the sticky column and shows only the tail of its cells — the end
  of "84,000" renders as a miles value of 0, which is worse than ugly. `scroll-snap-type: x
  proximity` with `scroll-padding-left: var(--ag-rowhead-w)`; `proximity`, not `mandatory`, so a
  small deliberate drag can still rest where it lands. Playwright's programmatic scrolling lands
  on tidy offsets, which is why nothing caught this before a thumb did.
- **The grid chains its scroll to the page on touch.** `overscroll-behavior: contain` is right for
  a wheel over a desktop grid. On a phone the query block above the grid is far taller than the
  220 px reserved for it, so the grid is a letterbox in the middle of a scrollable page, and
  `contain` meant a swipe inside it stopped dead at the last row. `auto` below 768 px / on a
  coarse pointer: the grid scrolls first, the page follows at the boundary.
- **`100dvh`, not `100vh`.** On iOS Safari `100vh` is the height with the toolbars HIDDEN, so the
  scroll box was about 90 px taller than what is on screen and its last rows sat permanently under
  the floating toolbar. A `100vh` line stays above it as the fallback.
- **The 40 px touch floor is keyed to the pointer as well as the width.**
  `@media (max-width: 767px), (pointer: coarse)`. Width alone was the wrong question: the same
  phone in landscape is 874 px wide, and every control snapped back to its 24–32 px desktop size
  under the same thumb — as did every tablet. `pointer: coarse` is the PRIMARY pointer, so a
  touchscreen laptop (which reports `fine` with `any-pointer: coarse`) keeps the dense controls it
  is driven with. _Read from the CSS, not observed:_ the Simulator's rotate menu could not be
  driven from this environment and iPad access was not granted, so the landscape case is reasoned
  from the media query rather than seen.
- **The drawer's Open button uses the long program name.** `src/lib/grid/format.ts` states the rule
  in its own header — "the long names stay in SOURCE_NAMES for the drawer, CSV and digests" — and
  the button broke it, so the primary action read "Open in Singapore", naming a country. It now
  reads "Open in Singapore KrisFlyer". Same shape for Turkish, Ethiopian and Qatar.
- **Not changed:** the cell drawer leaves a large empty band between a single program row and the
  action block on a phone. `docs/UI_PLAN.md` §6.5 specifies a full-height sheet below 768 px, so
  this is the plan working, not a defect; sizing the sheet to its content would be a plan change.

### #34 One owner per capture, and the guard in CI

The §9 matrix and the seven feature specs had been photographing the same UI in parallel since
6.6. 394 PNGs sat under `docs/screenshots/v0.2/**` where the matrix declared 152, and
`screenshot-index.ts --strict --check` exited 1, so it was not wired into CI. Now: 238 declared
captures plus the 52 frozen `before/` files, every one of them written by
`e2e/screenshots.spec.ts`, and `--strict --check` runs in the `checks` job.

- **The feature specs assert; they no longer photograph.** Every `shot()`/`gridShot()`/`chipsShot()`
  helper is gone from `grid`, `chips`, `cell-drawer`, `ask-drawer`, `queries`, `settings` and
  `shell`; not one assertion moved. `e2e/matrix.ts` is the only place a capture is declared and
  `e2e/screenshots.spec.ts` the only place one is taken, so `--strict` can be a gate rather than a
  report. _Why:_ 21 of the 39 declared stems were being written by two specs to the same file name.
  Playwright runs them in the same worker but in an arbitrary order, so which writer's bytes
  survived was a race — and the two writers disagreed about `fullPage`, which is how
  `shell/legal-*.png` came to be viewport-sized (cut off mid-sentence on mobile) although the
  matrix declares it full-page. Deduplicating without picking a single owner would have left the
  race in place.
- **`settleDrawers` was answering "settled" for the exact window the defect lives in.** #30 fixed
  the four driverless `queries/edit-drawer-*.png` by waiting for every `[data-state="open"]` drawer
  to reach `transform: none` — but `DrawerShell` renders the panel `data-state="closed"` for two
  frames before it flips to `open`, so during entry there is no open drawer to check and `every()`
  over an empty list is `true`. The capture went back to being a Queries page with no drawer on it
  as soon as this pass made `screenshots.spec.ts` the only writer and the timing shifted. An
  entering panel is told apart from a leaving one by `inert` (`inert={!open}`), so the predicate
  now rejects both shapes of unsettled: closed-and-not-inert (mid-entry) and open-with-a-transform
  (mid-slide).
- **Detail folders are not a category, they are undeclared states.** `DETAIL_PAGES` existed so
  `chips/`, `cell-drawer/` and `ask-drawer/` could hold captures the completeness check skipped.
  Of the 27 stems in them, 13 photographed a state the matrix already declared — the drawer pixels
  in `cell-drawer/open-*` and `grid/cell-drawer-*` are byte-identical; only the grid behind them
  differed — and 14 were real states nobody owned. The 14 are declared on the page they belong to
  (`grid/ask-answered`, `grid/cell-drawer-error`, `grid/chips-manual`, …), the 13 are deleted, and
  `DETAIL_PAGES` is gone from `matrix.ts` and `screenshot-index.ts`. _Why:_ an exemption from the
  check is where undeclared states accumulate; there is no longer a folder that is allowed to hold
  one.
- **Three things the review caught after the consolidation, all fixed here.** `before/` was the
  one folder `--strict` did not police: `MATRIX_PAGES` drove the extras check, so a new state
  parked in the frozen record passed. `e2e/matrix.ts` now carries `BEFORE_FILES` (the 52 names,
  frozen), and `--strict` fails on anything else there — proved by copying a PNG in and watching
  it exit 1. `shell/topbar` was captured on `/queries`, so deleting `shell/topbar-grid` really did
  lose the state it showed; the capture moved to `/grid`, which is what that stem documented. And
  the four-second "Standing query saved" toast from `queries/edit-saved` was still on screen for
  `queries/run-now` and `queries/run-now-error` — eight files showing a confirmation the state
  does not produce — so the sequence waits it out, the same fix the cell drawer's "Details copied"
  already had.
- **The explicit theme choice is no longer photographed, and that is accepted.** The settings
  captures used to show Theme = Light because `settings.spec.ts` clicked the radio before shooting;
  a matrix helper must leave no mutation behind, so they now show Theme = System. The radio's
  behaviour is still asserted in `settings.spec.ts`; what is lost is a picture of a chosen radio,
  which the radio-indicator work in 6.5 already has a decision entry for. Declaring a
  `settings/theme-chosen` state would mean a helper that writes to the account, which is the one
  thing the capture helpers are not allowed to do.
- **The matrix learned a `clip`, because the top bar is a strip and not a page.** `shell/topbar`,
  `shell/topbar-menu` and `shell/topbar-user-menu` are the §2 furniture no page-level capture has
  as its subject. A viewport shot of the top bar is a photograph of whatever page is under it, so
  `MatrixShot.clip` takes the top N px at full width (48 for the bar, 160 for the account menu).
  `shell/topbar-grid` and `shell/theme-system` are deleted: on mobile `topbar-grid` is
  byte-identical to `topbar`, on desktop it differs only in which nav link is underlined, and
  `theme-system` differs from `topbar` by one hover colour on the button the test just clicked.
- **Two deliberate scope reversals, both because the record would otherwise be lost.** The zh grid
  was declared desktop-only ("the desktop pair is the record"); the mobile zh pair is now declared
  too, because it is the only capture in the tree that shows CJK wrapping in the query box and the
  Chinese chip row at 390 px — the desktop zh and the English mobile capture each show half of it.
  And the Chinese settings page, previously written by `settings.spec.ts` as
  `language-theme-zh-<viewport>-<theme>.png` — `-zh` before the viewport, which breaks the §9 order
  even though `FILE_RE` accepts it — is now `language-theme-<viewport>-<theme>-zh.png`, reached
  through the `ag_locale` cookie rather than by clicking the radio, so the capture no longer writes
  the account's language.
- **One capture makes a real write, and says so.** `saveEditQueryDrawer` (for `queries/edit-saved`,
  the "says so once" toast) saves the drawer untouched. `EditQueryDrawer.onSave` sends the chips
  only when they actually moved, so an untouched save PATCHes the form's own values back and the
  stored `QueryObject` keeps its JSON byte for byte. _Why not intercept it, like Run now:_ the
  drawer feeds `res.data.query` straight back into the row, so a stub would have to fabricate a
  `SavedQuerySummary` — a fake shape that could drift from the real one and photograph a row that
  the server would never produce.
- **Deleted, with the file that documents each state instead.** `chips/`: `parsed`, `reset` →
  `grid/results`; `origins-editor-open`, `dates-editor-open`, `programs-editor-open` →
  `grid/origins`, `grid/dates`, `grid/programs`; `modified` → `grid/modified`; `parse-failure` →
  `grid/parse-failure` (127 px apart, all of it the quota counter); `loading-skeleton` →
  `grid/loading`. `cell-drawer/`: `flights-loaded` → `grid/cell-drawer-flights`; `mobile-sheet` →
  `grid/cell-drawer-mobile-*` (0 px apart); `ask-from-cell` → `grid/ask-with-cell`. `ask-drawer/`:
  `streaming` → `grid/ask-streaming`; `cap` → `grid/ask-cap`; `mobile-bottom-sheet`, `open-empty` →
  `grid/ask-open`. In the matrix pages: `grid/partial-not-fetched` → `grid/not-fetched` (same
  state; the extra pixels are a collapsed "Notes (1)" row shifting the grid down 28 px);
  `grid/dynamic-off-filtered` → `grid/results` (5,878 px apart out of 1.3 M, all of it clock text —
  the declared `grid/results` already carries the `dyn`-tagged filtered cells with the toggle off);
  `queries/delete-confirm-inline` → `queries/delete-confirm` (50 px, one digit);
  `queries/run-now-result` → `queries/run-now`; `settings/keys-add-form`,
  `keys-validating-error`, `telegram-unlinked-qr`, `account-change-password` →
  `settings/keys-add`, `keys-error`, `telegram-unlinked`, `change-password` (same state, the
  feature spec shot it `fullPage` or element-clipped and the matrix entry is viewport-sized).
- **Not changed:** `grid/results` shows `dyn`-tagged cells while its own dynamic-pricing toggle
  reads off. That is what the state legitimately looks like once an earlier project has warmed the
  dynamic scope in the shared cache — the toggle governs fetching, the tag marks what came back —
  but the page does read as claiming two things at once, and it is a §3.4 question rather than a
  capture-ownership one.

### #35 Per-cabin cells in the grid

Issue #35 and `BACKLOG.md` asked literally for split ROWS — each date row becoming a J row and an
F row. This ships a stacked CELL instead, `Cells: Best | Per cabin` (docs/UI_PLAN.md §6.2b), and
closes #35 with it. §4, §5, §6.2b, §6.3, §6.4, §9 and §11 of the plan are amended.

- **Per-cabin cells, not a split axis.** Both prices at once is delivered by stacking one 16 px
  line per cabin inside the existing cell, not by splitting the date row or the route column.
  _Why:_ `types.ts` already documents `GridCell.all` as "every row for this (pair, date) across
  programs **and selected cabins**", and buildGrid's cell loop confirms it — both prices are
  already in the cell at render time and only the renderer throws one away. An axis split pays 2×
  rows or 2× columns for data the cell already holds, and it would spend the grid's density,
  which is the product. `buildGrid` returns the same `Grid`; `aria-rowcount` / `aria-colcount` /
  `aria-rowindex` / `aria-colindex`, `moveFocus` and `PAGE_ROWS`, the 400-cell and 24-column
  virtualization thresholds, `transposeGrid`, `cellAt`, `iterateCells`, `gridStats`, `csv.ts`, the
  `?q=` codec and the Queries page's `diff-cells.tsx` are all untouched.
- **Why the row split was rejected.** It was the honest runner-up and the best-verified proposal,
  but it interleaves J and F down one column: "cheapest business across 30 dates" becomes a read
  of every other row, ArrowDown stops meaning "next date", and a 30-day phone grid becomes 60 rows
  of 40 px with the row head widened 72 → 88 px out of 390. Its own status rule ("otherwise the
  parent's status verbatim") also gave an empty F subrow of a J-only date `status: "ok"` with
  `best === null`, so `data-state="ok"` would land on a cell the `[data-state="none"]` styling can
  never reach.
- **Why the column split was rejected.** It halves the route axis, which is the axis the product
  exists for (five routes become two and a half at 1440; one route is 296 px of a 390 px phone),
  and it changes `cellAt`'s indexing with no type error to catch it, so a mistake reaches
  `toCsv`, `gridStats` and `ascii.ts` silently. Its composite column keys ("HKG-SEA|J") also miss
  `useHeaderText`'s pair-keyed `unmonitored` set and `notFetched` map, which would have silently
  deleted the sub-label from exactly the columns that most need explaining.
- **The per-cabin line is the mobile line.** It carries the cabin tag, the miles, the `dyn` tag
  and the mark + age, and not the program name. _Why:_ that exact line is already shipped at the
  112 px minimum column in both languages, so there is no new padding token, no width rule and no
  new zh overflow risk. Adding the program would make it ellipse to a stub at the floor, which is
  worse than naming the program in the tooltip, the drawer and the aria label — all three of which
  do name it, per cabin.
- **Each cabin's aria clause is resolved before the clauses are joined.** `dropClause` and
  `replaceClause` in `src/lib/grid/aria.ts` build their `RegExp` with no `g` flag, so
  `String.replace` rewrites the first match only. Composing one sentence with two cabin clause
  groups and then dropping the empties leaked U+E000 / U+E001 / U+E002 into the announced text —
  reproduced before the fix, and `aria.test.ts` keeps the regression. `cabinClause()` builds and
  resolves one cabin at a time, where each sentinel appears at most once, so the non-global regex
  is correct by construction.
- **The freshness tier moved from the `<td>` to the line.** In per-cabin layout each line has its
  own age, so `data-tier` rides on `.ag-cabin-line` and the `<td>` carries none; the existing
  `.ag-cell[data-state="filtered"] .ag-miles` rule gained a
  `:not([data-layout="per_cabin"])` guard so a cell-level "filtered" status cannot mute the line
  that is not dynamic.
- **The layout is view state and is not in `?q=`.** Like `orientation`, it lives in
  `grid-app.tsx`. _Why:_ `?q=` encodes the query a run answered; the toolbar controls the view,
  and a display field inside `QueryObject` is data to `sameQuery`, `/api/find` caching and every
  standing-query row. _Cost, accepted:_ a J-vs-F comparison cannot be handed over as a link.
- **The control is absent below two cabins, not disabled**, and the mode is forced back to `Best`
  whenever the cabins drop below two — so flipping Both → J → Both returns the default, not the
  previous choice. _Why:_ a permanently dead control is worse than an absent one, and a mode
  surviving behind a control that is gone is hidden state. Adjusted during render rather than in
  an effect: the project's lint rules reject `setState` in an effect, and the render-time
  correction lands in the same commit, so no child ever sees the stale mode.
- **`CABIN_ORDER` moved to `src/lib/query/schema.ts`.** The canonical J F W Y display order lived
  only in `src/components/grid/state.ts` as `ALL_CABINS`, and `bestPerCabin` in `src/lib/grid/`
  needs it. A lib module must not import a component module and the order must not exist twice, so
  the schema owns it and `ALL_CABINS` re-exports it.
- **Open questions decided.** `cell.best` stays best-across-cabins, so `gridStats.cheapest`, the
  CSV `best` flag, the drawer's lead program and the Ask context pill keep naming one winner while
  the user looks at two — changing `best` to be cabin-aware would ripple into the standing-query
  diff and the notification digest, and is left for a later issue. A cell with nothing for any
  cabin keeps ONE centred en dash rather than one per cabin (the aria still names both cabins).
  Tablet rows grow 32 → 40 in this mode, about a fifth fewer rows on screen; the alternative —
  offering the mode only at ≥ 1280 and < 768 — is a control that vanishes at one breakpoint, which
  is worse. Three or four cabins push rows to 56 / 72 px and are still offered rather than capped
  at two: capping would be arbitrary in the other direction.
- **Not changed:** `docs/UI_PLAN.md` §6.2's wireframe annotates the desktop header band as 32 px
  although `.ag-table thead th { height: var(--ag-row-h) }` has made it 48 since 6.2. This change
  makes the drift more visible (the header grows with the rows in per-cabin mode) but does not
  touch it; it is a separate one-line plan fix.

### #37 Persist `calls_used` on query runs

- **`query_runs.calls_used` is nullable, and null means "not recorded", never zero.** `drizzle/0002_query_runs_calls_used.sql` adds one nullable integer column; `record()` in `src/lib/scheduler/run.ts` writes it on every path and `toRunSummary` reads it straight back. _Why nullable rather than `NOT NULL DEFAULT 0`:_ every row written before the column existed would then claim it made no calls, which is a fabricated number in a column whose only job is to be honest about quota. The UI already had the "not recorded" state (`run-history.tsx` prints an en dash with the reason in `title`); it now means what it says.
- **The failure paths record what is actually known.** A missing key and an exhausted quota are refused at reservation time, before a single request goes out (`src/lib/seatsaero/find.ts`, and `find.test.ts` asserts `fetch.calls` is empty for both), so those runs record an exact `0`. Any other throw happened after fetching had started and the facade does not report the pages it had already completed, so those record `null`. A run that merely *runs out* of headroom mid-way is not a throw at all — it returns a partial result and takes the success path with a real count.
- **`mergeRunCalls` is deleted.** It existed only because the server could not answer the question; it now can, so the refetch replaces the row's history instead of merging into it. `rememberRun` stays: it still shows a just-finished "run now" at the top of the list before the refetch lands.
- **The e2e seed carries real counts** (0 for the quota-refused run, 27 and 24 for the two that fetched), so the committed screenshots of the Queries page show the column doing its job rather than three en dashes.

### #33 (prerequisite) The queries table's columns stopped following the clock

- **Last run and Next run have a width floor.** Their text is a relative time — "due now",
  "in 22 minutes", "in 2 hours", "55 seconds ago" — and those are different widths. `queries.css`
  gives every column but the first `width: 1px`, so Name absorbs the slack: the columns breathed
  as the wall clock moved, every header to their left shifted, and a long query name wrapped from
  one line to two. It is the same failure the Actions rule already fixes for a different trigger.
- **This is why the `visual` job could not be promoted.** Main run 34058508996 (commit `0f3aa75`)
  failed `queries-expanded.png` on desktop-light and desktop-dark by 3 % of pixels, while the same
  tree had passed on the PR branch an hour before. `timeMasks` already masks both cells — masking
  paints over the READING, it cannot paint over the layout that reading produced, so the mask box
  itself moved. A required job that goes red on a schedule nobody controls teaches people to
  ignore it, which is worse than no gate.
- **A regression test, not a baseline update.** `e2e/queries.spec.ts` replaces the Next run cell's
  text with each of the three readings and asserts the Name column does not move. It fails without
  the CSS floor (verified by reverting the rule) and passes with it.
- **The quota seed writes tomorrow as well as today.** The daily quota is keyed by UTC day, so a
  suite that starts at 23:58 and reaches the quota tests at 00:05 asks about a day the seed never
  wrote: the "quota" user's 950 calls belong to yesterday, today reads 0, and every quota state
  silently becomes an ordinary grid. CI run 34068335365 hit exactly that — `grid-quota` failed in
  `axe`, `before`, `grid` and `screenshots`, in every project, for no reason but the clock. One
  extra row per user makes the seed correct on both sides of midnight. This is the same class of
  defect as the column widths above, and the same reason: a job that is going to be REQUIRED must
  not depend on what time it runs.

### #33 The visual comparison is blocking

Promoted 2026-09-07. `continue-on-error` is gone from the comparison step in `.github/workflows/ci.yml`;
it survives only on the generate path, which is a one-off bootstrap and must not block.

- **The five runs, each 24 passed / 0 failed on `main`:** `96eef58` (34098709246), `caa4ac6` (34100885712),
  `8fcfe5a` (34104426383), `403dd91` (34130621005), `06d4476` (34132693007). The 6.6 entry asked for these ids
  to be recorded before the promotion; here they are.
- **The count was never what was blocking it.** Two determinism defects made the comparison fail on a schedule
  nobody controlled, and both had to be fixed first. The queries table's `Last run` / `Next run` columns had no
  width floor, so they breathed as the clock moved and pushed every column to their left — `timeMasks` masked the
  reading but could not mask the layout that reading produced. And the e2e quota seed wrote only the UTC day it
  ran on, so a suite that started at 23:58 and reached the quota tests at 00:05 read 0 calls and every quota state
  silently became an ordinary grid. Fixed in #43 and #44.
- **How badly the non-blocking job hid things:** the clock defect reached `main` **twice** (`0f3aa75`, `974983e`)
  and nobody noticed either time. That is what `continue-on-error` buys — the job's own conclusion is `success`
  whatever the comparison did, so the only evidence is a line in a log nobody opens.
- **The other half of the issue cannot be done on this plan and is not pretended to be.**
  `gh api repos/LoganYe/awardgrid/branches/main/protection` and `/rulesets` both answer
  `403 Upgrade to GitHub Pro or make this repository public`. So "required check" in the branch-protection sense is
  unavailable; what a red job now buys is that it is red, which is what makes it visible to anyone merging through
  CI. Making it enforceable is an owner decision (Pro, or a public repository), not work.
- **What to do when it goes red.** Read the `visual-snapshots` artifact — expected, actual and diff — and decide
  whether the UI regressed or the baseline is stale. If the baseline is stale, take the `-actual.png` from that
  artifact (it is the Ubuntu/Chromium rendering the policy requires) rather than regenerating on a Mac, and say in
  the commit message what moved and why.

### #18 Mixed cabin (`min_cabin_pct`), and why it had to enter the cache scope

seats.aero's Cached Search, Bulk Availability and Get Trips all accept `min_cabin_pct` (0-100
integer, default 100). At 100 — the API's own default, and what every call this product made
before now — an itinerary is dropped unless the whole distance is flown in the requested cabin,
so a business trip with one regional economy leg comes back as nothing and the grid draws `none`.
That is indistinguishable from genuinely no availability. The `MixedCabinPct` badge that would
explain it already shipped in the drawer (`flights-list.tsx`) and was unreachable.

- **The field is a UI-only control, like `include_filtered`.** It is on `QueryObject` and
  deliberately NOT on `QueryObjectLLM`: never inferred from what the user typed.
- **`.default(100)`, not `.optional()`.** Every consumer then reads a concrete number, so the
  absent-vs-100 divergence can only be introduced at one place instead of seven. An old `?q=`
  link, a `saved_queries.query_json` written months ago and an LLM parse all decode to exactly
  100 — their meaning, and their cache scope, unchanged. Pinned by `src/lib/query/schema.test.ts`
  and by a scheduler test that runs a stored query with the key deleted.
- **The cache scope had to change, and this is the whole issue.** `min_cabin_pct` changes what
  the API RETURNS, exactly as `include_filtered` does, and — also exactly as with
  `include_filtered` — neither direction is a superset: a 100 pull is missing the mixed-cabin
  itineraries a 70 pull returns, and a 70 pull carries itineraries a 100 query must not be shown.
  Nothing can be filtered locally either way. Without it in the scope, a 70 % search is answered
  from the 100 % coverage record with zero API calls and the user stares at the same strict grid
  forever — the identical invisible failure the issue is about, just one layer down. It is
  therefore carried through `CacheQuery`, `rowKey`, `rowMatches`, `CoverageRecord`,
  `coverageSatisfies`, the runFind scope and the SQLite encoders, compared everywhere as
  `(x.min_cabin_pct ?? 100) === (y.min_cabin_pct ?? 100)`.
- **No migration, and here is why.** Both SQLite encoders append the new marker ONLY when the
  value is not 100: `encodeProgram` writes `alaska#pct70` (after any `#filtered`), and
  `encodeProgramsKey` appends a `pct70` flag. Every row and every `programs_key` already in the
  tables keeps its exact stored text and decodes to 100, which is what it always meant. The
  columns are the existing strings; no schema change, no backfill, no drizzle file.
- **The trap that came with it.** `scopeWhere`'s prefilter selected the default scope with
  `notLike(program, '%#filtered')`, anchored at the END. A row stored as `alaska#pct70` does not
  end in `#filtered`, so that predicate would have handed a 70 % row to a 100 % query.
  `rowMatches` is authoritative, but a prefilter that is wrong in that direction is a defect
  waiting for the day someone trusts it, so the prefilter is honest now: an explicit programs
  list is exact via `encodeProgram`, a non-default pct matches `%#pct<N>`, and the default scope
  excludes `%#pct%` outright. Both stores have a test asserting a 100 % query never sees a
  `#pct70` row.
- **Get Trips carries it too.** The drawer's flight list is fetched in the same scope the grid was
  produced in, or it would contradict the cell that opened it. `/api/trips/[id]` takes
  `min_cabin_pct` and refuses anything outside 0-100 with a 400 rather than clamping silently.
- **100 is emitted as nothing.** It is the API's own default, so every request this product makes
  at rest is byte-identical to what it sent before this change — which is also what keeps the
  cache of existing users warm rather than re-fetching everything once.
- **The CSV gets no `min_cabin_pct` column.** `ROW_HEADER` has a per-row `dynamic` column because
  `include_filtered` is a property of the ROW that came back (that row was filtered out of the
  default view), while `min_cabin_pct` is a property of the QUERY: every row in one export shares
  it, so a column would repeat one number on every line. Nothing in the CSV describes the query
  today — not the cabins, not the programs, not the date window — and adding a query field to a
  row format for this one parameter would be the wrong place to start. The cost is real and
  accepted: two exports taken either side of relaxing the setting are not distinguishable from
  their contents. If that becomes a problem the fix is a header comment or a sidecar line
  describing the whole query, not a repeated column.
- **The control is the eighth chip, not a toolbar switch.** Reasoning in `docs/UI_PLAN.md` §13
  ("Revision from issue #18"); the short version is that the toolbar runs the query on every
  click, which is wrong for a value found by trial against a 1,000-call daily budget, and that
  `include_filtered` earns its toolbar place only because the `dyn` cell tag makes its effect
  visible in the grid, which nothing does for this one.

### #49 The demo itinerary is sequenced on an absolute clock

- **The one-minute transpacific leg was a local clock carried across time zones.** The generator
  advanced one `cursor` in local minutes and clamped each arrival to `max(cursor + 1, …)`, because
  crossing the date line eastbound lands EARLIER in the local day than it departed and a connection
  must never depart before the leg that fed it. The sequencing constraint is real; expressing it in
  local time is what was wrong. On an absolute clock the constraint holds by construction, and every
  committed cell-drawer capture stops saying `NH914 ICN 13:06 → SEA 13:07`. The renderer half was
  already fixed in #30 (`flights-list.tsx` dates each leg side independently), which is what let the
  generator tell the truth.
- **Fixing the clock exposed two things the clamp had been hiding**, and both had to go with it or
  the honesty would only have moved:
  - _Distances were geography-blind._ A connecting leg drew `int(rand, 500, 1_800)` miles whatever
    the airports were, so HKG → SFO was a two-hour flight. With the clamp gone that surfaced as a
    segment departing the day BEFORE the itinerary did. Legs now add up: `hub → SEA` is the hub's
    own great-circle figure, `origin → hub` is what the direct distance has left over.
  - _Hubs were not on the way._ `NRT → TPE → SEA` was reachable, and TPE is further from SEA than
    NRT is, so the first leg floored at the 300-mile minimum and the drawer printed a 2,000-mile
    flight as four minutes. A hub must now be at least 300 miles closer to SEA than the origin.
    Every origin keeps at least two candidates and the generator throws if one ever does not.
- **The taxi constant went 15 → 30 minutes.** `distance / 8.6 + 15` made the 127-mile YVR → SEA hop
  a 29-minute flight — the same class of implausibility as the one-minute leg, just less obvious.
  Nothing else moves by more than a quarter hour. True elapsed time across all 664 segments is now
  44 min to 13 h 14, median 9 h 35.
- **Not changed:** `TotalDuration` is still flight plus layover in minutes and is zone-free either
  way, so the drawer's headline duration means what it did before.

### #52 A Get Trips fee is written back to the cell's row — without touching its freshness

Get Trips is the only source of a real fee, its currency and a booking link. `getTripsForUser`
computed all three (`tripsToFees`) and returned them to the one open drawer; nothing persisted
them, although `availability_cache` has held `fees_cents`, `currency` and `booking_url` since
Phase 1 and the upsert already sets them. The client patched its own in-memory grid
(`mergeTripsIntoGrid`), so the numbers survived exactly as long as the render did. The visible
consequence was that `fees_asc` — and the CSV's fee column — only ever saw fees for the handful
of cells expanded in that render, and everything else fell into the null tail with nothing saying
that is what had happened. **This makes fees durable; it does not make `fees_asc` honest.** A fee
still arrives only one expand at a time, so on a first render coverage is exactly zero and
`fees_asc` degenerates to `miles_asc` — `byFeesAscNullLast` returns 0 for every pair and the chain
falls through to `byMilesAsc`, which is where `miles_asc` starts. It climbs one expand, one cell
and one quota call at a time from there, and nothing in the grid, the sort control or the CSV
says where it stands. `fees_asc` cannot answer its
own question until fees arrive in bulk (`include_trips=true` on Cached Search, still an opt-in
executor flag) or coverage is surfaced — both in BACKLOG.md. Do not read this entry as fixing it.

`cacheFeesFromTrips` (`src/lib/server/find.ts`) now writes the priced row back through the
existing store. No migration: the columns exist.

- **The write does NOT touch `computed_last_seen`, or `fetched_at`.** This is the design question
  of the issue. `computed_last_seen` is what the grid's freshness mark reads, and to a reader that
  mark answers one question: *how old is what I am looking at?* The honest answer is the age of the
  oldest thing in the cell — the availability itself (does this award still exist, at these miles,
  with these seats), which Cached Search observed and Get Trips did not re-observe. Stamping a Get
  Trips fee onto that field would redate the whole row from a call that learned one field of it:
  a three-day-old availability would draw a filled "fresh" dot because someone priced it an hour
  ago. The converse is equally bad — a fee is not evidence the row got older, so nothing is aged
  down either. So the two clocks stay where they are, and a cell whose fee is an hour old and whose
  availability is three days old reads "3d", which is true of the cell as a whole and understates
  only the fee. Understating the fee's freshness is the safe direction: the mark never claims
  anything is fresher than it is. Get Trips also has its own cadence — a per-expand call the user
  pays for one cell at a time — so there is no rate at which it could keep a grid's marks honest.
  `fetched_at` is left alone for a second reason: it drives `fetched_at_min` and pairs with the
  `cache_coverage` record that decides refetching, and bumping one row's copy would make a scope
  look newer than the fetch that actually filled it.
  What makes "the mark never claims anything is fresher than it is" an invariant rather than a hope
  is `putRows`: its `onConflictDoUpdate` sets `feesCents: excluded.fees_cents` unconditionally
  (`db/stores/cache.ts`), so every Cached Search upsert wipes a learned fee along with the rest of
  the row. A fee therefore can never outlive the `computed_last_seen` it sits next to, and can
  never be older than it. That is the enforcement — not the delete, which under `direct_only: true`
  covers a subset of what the insert covers.
  **The residual gap, stated rather than hidden:** nothing in the product ever reports a fee's OWN
  age. Before this change that only mattered inside the render where the user had just clicked
  "Show flights"; it is now reachable with no click and no context, and `buildCopyDetails`
  (`copy-details.ts`) emits `$84.30 fees` and `seats.aero last saw this: 3 days ago` as consecutive
  self-describing facts in a block that reads as one snapshot at one time. Understating is still
  the safe direction, and a per-fee timestamp needs a column, so it is in BACKLOG.md.
- **Which row: the one the cell shows.** `tripsToFees(res, cabin)` picks the cheapest trip IN THE
  REQUESTED CABIN (miles, then taxes) — the number the drawer prints for that cabin's row — and the
  write goes to the cached row with that Availability ID and that cabin, so the fee stored is the
  fee shown. One availability yields one row per cabin (`availabilityToRows`), all sharing the ID,
  which is why the cabin is part of the address and not an afterthought. With no cabin requested,
  `tripsToFees` returns the cheapest trip across cabins; that is not any single cell's fee, so
  nothing is written at all rather than being attributed to a row it does not describe.
- **Scoped exactly like every other cache write.** Per user, and inside the scope the row was read
  in: `getRowsBySourceId(userId, sourceId, {include_filtered, min_cabin_pct})` — a mandatory
  argument, not an option — carries the drawer's own scope, which the route already threads through
  for the same reason (#18). A 70 % answer can never land on a 100 % row. The scope that matters is
  the ROW's, not the query's, and the two differ in exactly one place: a `dynamic: true` row
  borrowed into a plain grid, which `appendCachedDynamicRows` takes from the `include_filtered=true`
  cache scope. Get Trips was being asked in the QUERY's scope for those rows, so the write-back
  correctly refused (it may not invent a plain-scope row) and the fee was silently discarded —
  along with the quota the call cost — on precisely the rows whose real fees `fees_asc` most needs.
  `ProgramRow` now asks in `row.include_filtered ?? query.include_filtered` (same for
  `min_cabin_pct`), which is what the prop's own rationale always said: ask in the scope the row was
  cached in. The write then lands inside the scope the row was read in, the rule is unchanged, and
  the flight list stops being drawn from a scope that row never came from. Rows are addressed by
  `source_id` rather than by re-deriving (program, pair, date) from the
  trip payload: the availability id is the identity the request already carries, so a mismatch can
  only ever mean "not cached", never "write to the wrong row".
- **A targeted UPDATE, not a re-upsert of the row that was read.** Learning a fee is a
  read-modify-write across two awaits, and `/api/find` and `/api/trips` are concurrent handlers
  over the same synchronous better-sqlite3 handle, so a Cached Search refresh for the same user (a
  second tab, the scheduler) can land in that gap — a drawer expand overlapping a grid refresh is
  an ordinary thing to do. Re-upserting the whole row through `putRows` would then roll the refresh
  back: its new miles, seats and `computed_last_seen` would be replaced by the snapshot read a
  microtask earlier, and worse, a row the refresh had DELETED because the award is gone would be
  re-inserted with its stale miles — a phantom cell, served from a coverage record the refresh has
  just made fresh, until the TTL expires. That is also the one path that could contradict this
  entry's own freshness rule, by moving a row's mark backwards. So the store grew
  `updateRowFees(userId, key, fees)`: an `UPDATE` of exactly `fees_cents` / `currency` /
  `booking_url`, with **no insert fallback**, keyed on the PK plus `source_id`. Every other column
  keeps whatever the refresh put there; a deleted or re-identified row matches zero rows and
  nothing is written. The id is in the key on purpose — a fee describes one Availability, so if a
  refresh has replaced the cell with a different one the write must miss rather than mislabel it.
- **Nothing is written unless something was learned ABOUT THIS CABIN — the booking link included.**
  A call that throws never reaches the write. A trip list that is empty, or that has no trip in this
  cabin, yields `fees_cents: null`, and the whole write is skipped. The link is gated on the same
  evidence as the fee even though it does not come from the same place: `booking_links[]` is
  per-AVAILABILITY and ignores both the cabin filter and the trip list, so seats.aero returns one
  whether or not it found anything to book in the cabin being priced. Persisting it on that
  evidence is not free — `resolveDeeplink` prefers `row.booking_url` over every program builder,
  so an `american` J row that Get Trips says has no J itinerary would permanently show
  "Open booking link" instead of the AA award-search deeplink BACKLOG calls the boundary-correct
  answer, and the CSV's `booking_url` column would carry it too. A priced trip in the cabin is the
  evidence that write was waiting for. In the other direction a null still never lands on a good
  value: a priced trip whose response carries no link keeps the stored one. A store failure is
  logged by name only (§10) and the user still gets the answer they paid a call for.
- **The currency written is the one the fee was quoted in — verbatim, null included.** An amount and
  its label are one fact; they are read from the same trip and stored together. seats.aero sends
  `TaxesCurrency: ""` for USD (see "Fees per cell" and "TotalTaxes unit" above) and `tripsToFees`
  normalizes that to null, which is exactly what `availabilityToRows` already records for USD and
  what `formatFees` already renders as `$`. So an empty currency is not a gap to be filled: it is
  the answer. There were three options and only one is safe — refusing a fee with no explicit
  currency would discard most real answers, including every one in the docs' own example payload;
  *inheriting the row's previously stored currency* would quietly mislabel one (a J row holding
  `(1200, "EUR")` that is then priced at `TotalTaxes 9900 / TaxesCurrency ""` would render
  "99.00 EUR" for a $99.00 fee, in the grid, in `fees_asc` and in the CSV's `currency` column,
  while the drawer reading the same response printed `$99.00`). Only the fee's own currency is
  ever true of the fee. Not reachable in this repo's fixtures — the demo generator and the
  synthetic generator emit only `"USD"` or `""` — so it is covered by a unit test, not by e2e.
- **A partially-priced cell headlines the priced row, and that is the sort doing what it says.**
  This is the main user-visible consequence of persisting the fee and it deserves stating: under
  `fees_asc`, expanding ONE row in a cell can change which award that cell recommends. Measured on
  the synthetic fixture — HKG–SEA 2026-10-02 holds singapore/66,000 and alaska/75,500, both
  fee-null, and headlines singapore; expand alaska (fee $99) and re-run the same query from cache
  and the cell headlines alaska/75,500, 9,500 miles more. Before this change it could not happen,
  because no fee survived the render. Three options were on the table: rank within a cell only when
  every row's fee is known, fall back to `miles_asc` for a mixed cell, or leave it. We leave it.
  `byFeesAscNullLast` already carries the rule — "unknown fees sort after every known fee (we
  cannot claim they are cheap)" — and it is the only defensible one: a cell that silently reverted
  to `miles_asc` would be ignoring a fee the user paid a call to learn, and would make the sort's
  behaviour depend on a coverage condition the user cannot see. What is genuinely missing is not a
  different order but a MARK: "cheapest fee" and "only measured fee" render identically today. That
  is the same coverage gap as the opening paragraph, and it is in BACKLOG.md with it.
- **A Cached Search refresh still overwrites the learned fee** with the availability's own
  `{cabin}TotalTaxes` (usually null) when the TTL expires, because that path deletes and re-inserts
  the scope. That is correct precedence — the search is authoritative for the row it returns — and
  it means a learned fee is a within-TTL improvement, not a permanent one.
- **Amends "Fees per cell" (Phase 0):** a cell now shows a real fee for as long as the row it was
  learned on stays in the cache, not only in the render where the drawer was open.
- **It moves one committed visual baseline, and that is a real consequence, not test noise.**
  `e2e/cell-drawer.spec.ts` and `e2e/screenshots.spec.ts` click "Show flights" on the demo user's
  FIRST available cell, and `workers: 1` / `fullyParallel: false` means both run before
  `visual.spec.ts` against the same warm cache — so the drawer visual.spec photographs now carries
  the learned fee (`$72.30` → `$84.30`, aeroplan J on the first cell) and the booking deep link the
  seats.aero URL unlocks (`deeplinks/index.ts:53`). Measured on this Mac by photographing the four
  grid states before and after a Show flights, with a same-state control pair (own scratch
  directory; the committed Linux baselines were NOT regenerated or compared):
  `grid-results` / `grid-ask-drawer` / `grid-origins-editor` differ by 0.009 % of pixels
  (desktop-light and -dark; the fee glyphs of one cell, a 15 × 11 px box) and mobile-light by 0.000 %
  (its cells drop the fee line below 1280 px); `grid-cell-drawer` differs by 0.67 % on desktop and
  **4.5 % on mobile-light**, where the new booking link reflows the sheet. Against
  `maxDiffPixelRatio: 0.01` only the last one fails, so exactly one baseline has to be regenerated on
  Linux CI: `e2e/__screenshots__/mobile-light/visual.spec.ts/grid-cell-drawer.png`. The desktop pair
  passes at two thirds of its budget, which is worth knowing the next time that shot moves.

### #63 The front door: `/` branches on the session

The product had no entry point. `src/app/page.tsx` was `redirect("/grid")`, and `/grid` bounced an
unauthenticated visitor to `/login` — a password form that says nothing about what this is, that
there is no public signup, or that every search runs on a paid seats.aero Pro key the invitee has
to bring themselves. `README.md`'s step 2 is "send them the code and the URL", and the key
requirement first appears at step 3, after argon2id and a consumed single-use invite. The two
dictionary strings that would have said so, `auth.login.subtitle` and `auth.register.subtitle`,
are referenced nowhere in `src/` — and so was `app.tagline`, which is now the front door's `h1`.
**This closes the disclosure gap at `/` only.** The two auth subtitles are still orphans and
`/login` still explains nothing; that is a separate i18n sweep, recorded in BACKLOG.md.

- **`/` is a session branch on one route, not a route group, a middleware or a new nav item.**
  Signed in it is `redirect("/grid")` — the single hop it has always been, and the primary user
  opens this app to search. Signed out it renders the arrival page. The alternative considered was
  a signed-in dashboard at `/` (standing queries, last-run diffs, a `?text=` box): it moves
  `listSavedQueries` and the per-row `lastRunDiff` N+1 that `/queries` pays onto the search path,
  needs a second query surface `/grid` does not have, and contradicts UI_PLAN §6.1's three-item
  nav (the wordmark links to `/grid`, and `NAV_ITEMS` drives the underline, so a home destination
  would have none). Its "unread" accent was also not backed by data: `query_runs.notified` records
  that the Telegram digest went out, not that anyone read it. The signed-out half costs a
  signed-in user nothing, because they never render it.

- **`getCurrentUser` is wrapped in React `cache()`, and that is a prerequisite rather than an
  optimisation.** `src/app/layout.tsx:34` reads the user on every request and the page below it
  reads again. Two identical better-sqlite3 session reads per hit is the small half. The real
  reason is that two unmemoised reads happen at two different instants, so a session that expires
  between them answers signed-in to the layout and signed-out to the page — a signed-in top bar
  over a page that decided the visitor is not. (`getSessionUser` also deletes the expired row on
  whichever read is first past expiry, `session.ts:55-58`; the memoised version pays that once
  instead of twice, but the delete is a side effect, not the cause of the disagreement.)
  `getLocale` also reads a cookie twice per request and is deliberately **not** wrapped: it
  parses a cookie value with no I/O and no side effect, so memoising it would buy nothing and
  would put a second `cache()` in the codebase for symmetry rather than for a reason.
  _Cost, accepted:_ the cache stores the rejection too, so `layout.tsx`'s `.catch(() => null)`
  no longer shields the page's own lookup from a transient failure. That is why `page.tsx` has its
  own catch: without it, a SQLite blip would 500 the app's root URL.

- **The signed-out page is the disclosure, and the cap is the specification.** One title, one lead,
  three blocks, two links, and no more. Not on it, each for a reason: no screenshot or example
  grid; no feature list, changelog or user count; no price and no link to where the Pro plan is
  sold — naming the plan in plain text is the disclosure the invitee needs, and linking to the
  page that sells it is the funnel boundary 6 forbids; no analytics and no cookie banner; no
  airline or program name; no session-dependent content, so there is no "you still need a key"
  banner duplicating `grid.empty.no_key`; and no `?code=` forwarding, because an invite code is a
  single-use secret and a redirect hop would write it into the access log of the app's root URL.
  `/?code=…` is ignored: never read, never rendered.

- **"Byte-identical markup for `/?code=…`" was not achievable, and the acceptance criterion is
  corrected rather than quietly dropped.** Measured against a production build on this Mac, not
  predicted: the two documents differ by 87 bytes and the code appears **three times** in the
  inline flight payload — `"c":["","?code=…"]`, `"q":"?code=…"` and the page segment key
  `__PAGE__?{"code":"…"}`. Next serialises the request's canonical URL and its search into every
  dynamic document; declaring no `searchParams` does not prevent it, because it is router state,
  not the page's props. What is true, and is what the criterion was protecting: the rendered
  `<main>` is byte-identical, the value appears in no visible text, and the page never reads it.
  For scale, `/register?code=…` — the link the operator actually sends — embeds the same code
  **five** times today, so `/?code=…` is strictly less exposure than the existing path, not new
  exposure. `e2e/home.spec.ts` asserts the achievable statement.

- **Acceptance criteria 12 and 13 contradicted each other; 13 wins.** Criterion 13 requires both
  controls to render through `Button` with `nativeButton={false} render={<Link/>}`, and criterion
  12 says the page "imports nothing that is a client component" — but `@base-ui/react/button` is
  marked `"use client"`, so `Button` is a client boundary and `/` is the first server component in
  the repo to render one. 13 wins because it is the criterion with a user-visible consequence: the
  primitive emits `data-slot="button"`, which `globals.css:262` grows to `--row-touch` under
  `(max-width: 767px), (pointer: coarse)`, and that rule is the entire reason both controls clear
  40 px on a phone. Criterion 12 is read as what it was protecting: the page declares no
  `"use client"` of its own, no `searchParams`, no fetch and no client state. Worth knowing for
  the next reader: the spec justified `Button` by claiming a bare `<a class="link">` "would fail
  `e2e/responsive.spec.ts`'s measured floor". It would not — that file's `smallTargets` helper
  implements WCAG 2.5.8's inline-link exception and skips such an anchor. It would silently
  **be** under the floor while passing. The conclusion holds; the stated reason was the wrong one.

- **The secondary control needs `className="h-auto px-0"` spelled out.** `variant="link"` sets both
  in `button.tsx`, but cva emits size classes after variant classes and `cn` keeps the last
  conflicting utility, so tailwind-merge drops them and the control renders as a 32 px padded box
  with a centred label. Measured by running the repo's own cva and cn against the real variant
  table. `variant="link"` had no other user anywhere in `src/`, so nothing had ever exercised it.

- **`/` is deliberately absent from the capture matrix and the visual baselines.** `e2e/matrix.ts`
  types its pages as a closed union, and `scripts/screenshot-index.ts --strict --check` fails on a
  declared state with no PNG on disk — so declaring `/` without landing captures would break the
  `checks` job, and the captures could not be landed honestly anyway: `toHaveScreenshot` baselines
  carry no platform suffix and are generated on Linux CI only. What `/` gets instead is the axe
  audit on desktop-light, desktop-dark and mobile-light, the 40 px floor at 390 px on
  desktop-light (`responsive.spec.ts`, where only the width arm of the touch rule fires) and at
  874 px on the mobile projects, where the width arm is out of range and `(pointer: coarse)` holds
  the floor alone (`home.spec.ts`; 874 px is the landscape width issue #32 was filed about), the
  zh-leak sweep, and a wire-level spec for the redirect and the three bad cookie states.

- **A `/` test that does not name the page is a test of `/login`.** An adversarial pass over this
  change found that all three additions to `e2e/responsive.spec.ts` — the 40 px floor, the 390 px
  overflow sweep and the zh-leak sweep — passed unchanged when `src/app/page.tsx` was reverted to a
  redirect, because each only asserted "an h1 is visible" and `/login` has one too. They now assert
  the tagline, or the pathname after the navigation, and were watched to fail against the reverted
  page. The same pass found the mobile 40 px test proving nothing the desktop one did not: at
  390 px the `(max-width: 767px)` arm of the touch rule already matches, so `(pointer: coarse)` was
  never isolated. It measures at 874 px now, and asserts both media queries before it measures.

- **UI_PLAN §8's no-subtitle rule gains one scoped exemption, written into all three places it is
  stated.** The rule — "page subtitles that explain the product are removed; a page title needs no
  pitch under it" — is in UI_PLAN §8, again in §10's Headings row, and a third time as rule 6 of
  `docs/COPY.md`. Amending one and leaving the others would have shipped the contradiction the
  amendment exists to prevent. The exemption is scoped: the ban holds on every page a user reaches
  after signing in, and the front door's three blocks are constraints and limitations, never
  benefit claims.

- **The nine new strings needed no allowlist edit, which was checked rather than assumed.**
  `home.login_link` and `home.register_link` already match `CONTROL_KEY_PATTERNS`
  (`copy-allowlist.ts:61`), so they are linted as control labels — capitalised, no trailing period
  — and "seats.aero", "awardgrid", "Ask" and "Pro" are already in `PROPER_NOUNS`, which is what
  carries `home.lead` and `home.key.body` past the Title-Case check. Eight of the nine en values
  become leak candidates in `e2e/responsive.spec.ts`'s zh sweep on every page, not just `/` — all
  but `home.login_link`, whose "Log in" is five letters and under that helper's floor. The sweep
  was run over all seven routes it covers and none leaks.

- **No version bump.** `footer.tsx` renders `footer.version` from `package.json`, so the string is
  painted into every committed capture and Linux baseline whose frame reaches the footer — not all
  298 and all 24 (the 52 frozen v0.1 shots under `before/` carry a footer with no version at all,
  and a viewport-height capture may cut it off), but enough that bumping 0.2.0 would turn a text
  page into a rebaseline, and rebaselining is Linux-CI-only. There is no CHANGELOG and no bump
  convention to honour.

### The deployment: a Cloudflare Tunnel from the dev Mac, not a host on Cloudflare

- **The app cannot run on Cloudflare's own runtime, and that is not a configuration problem.**
  Rendering `/` alone traces two native N-API binaries — `.next/server/app/page.js.nft.json` lists
  167 files, of which `@node-rs/argon2-darwin-arm64/argon2.darwin-arm64.node` and
  `better-sqlite3/prebuilds/darwin-arm64.node` are `.node` addons. workerd cannot load either, so
  there is no "just the homepage" subset that avoids native code. Cloudflare Containers was the
  other candidate and is ruled out for a different reason: its disk is ephemeral by design, and
  this product keeps users, sessions, encrypted seats.aero keys and saved queries in the single
  SQLite file at `DATABASE_PATH`. A static export is unavailable too — `output: "export"` is a
  whole-app switch and `src/lib/i18n/server.ts:11` calls `cookies()` on every render, so every
  route is dynamic. What ships instead: `next start` bound to `127.0.0.1:3000` on the dev Mac,
  published by `cloudflared` at `awardgrid.dowhiz.com`. _Why:_ zero code change, and the repo was
  already built for it — `src/lib/server/rate-limit.ts:161` reads `cf-connecting-ip` behind
  `TRUST_PROXY_HEADERS`.

- **`dowhiz.com` moved to Cloudflare nameservers wholesale, because subdomain delegation is
  Enterprise-only.** Cloudflare's own documentation states it twice: "Subdomain setup is only
  available for Enterprise accounts." So serving `awardgrid.dowhiz.com` through a Tunnel meant
  moving the zone that also carries Google Workspace mail, a Postmark inbound MX, a Vercel apex
  and `www`, and `api` / `staging` on Azure. Two things made that safe rather than reckless.
  The import used GoDaddy's **BIND zone export**, not Cloudflare's scanner — the scanner looks for
  "common" records and would have missed `20260202230003pm._domainkey` (the Postmark DKIM key) and
  `dc-aa8e722993._spfm`, the SPF macro host the apex SPF includes by name; DMARC is `p=quarantine`,
  so a broken SPF chain would have quarantined real mail silently. And every record was diffed
  against the live zone by querying both nameservers **before** the switch: 16 of 16 matched.
  DNSSEC was confirmed off at the registry first, which is the failure that takes a domain dark.
  _Why:_ the risk was not that the migration was hard, it was that a missing record fails silently
  and days later. Measuring beats trusting the importer.

- **Every imported record is DNS-only; only `awardgrid` is proxied.** Cloudflare turns proxying on
  by default, which would have put Vercel, Azure and Postmark behind its edge uninvited. Proxying
  is required for the Tunnel hostname and for nothing else here. _Cost, accepted:_ the rest of the
  domain gets Cloudflare DNS and no Cloudflare protection, which is exactly what it had before.

- **Cloudflare Access is specified but NOT set up, and the gap is recorded rather than papered
  over.** Activating Zero Trust — free at this scale — requires a billing address, a payment method
  and accepting terms, which is the owner's to do. Until then the login page is reachable by anyone
  with the URL. What guards it meanwhile was probed against the live site, not assumed: a bad
  invite returns 400, an unknown login 401, registration is capped at 20 attempts per IP per
  15 minutes (`register/route.ts:5`), and the invite keyspace is 64^12. The app is not exploitable;
  it is merely visible.

- **The scheduler is deliberately not running.** No `pnpm worker` LaunchAgent, so standing queries
  do not run and no Telegram digest is sent. _Why:_ issue #47 — standing queries freeze their dates
  and go silent within 92 days — is unfixed, and starting the worker would begin accumulating runs
  against that defect rather than surfacing it. `docs/DEPLOYMENT.md` says so plainly.

## Phase 0 — the client-app pivot (spec: `docs/PIVOT.md`)

### The native-HTTP premise, measured

Full evidence in `docs/PHASE0.md`; the spike is `spikes/phase0-native-http/`, built to be deleted.

- **The premise holds: a Capacitor app reaches seats.aero over native HTTP, and a WebView in the
  same app cannot.** Both were run against the *same URL, seconds apart, in one build*. WKWebView
  `fetch()` → `TypeError: Load failed` (334 ms). The native adapter → **HTTP 401 with 17 readable
  response headers** (426 ms). The 401 is the point rather than a disappointment: that probe sends
  a deliberately invalid key, because what it tests is reachability, not authorisation, and a
  CORS-blocked request can report neither a status nor a header. _Why it was done as a differential:_
  a rendered grid does not say which stack fetched it, and the kickoff warned that a debugger-hosted
  run can execute `fetch` in a browser context and fail with CORS — looking like the premise is
  wrong when it is the harness that is wrong. Having both outcomes in one run is what makes either
  interpretable.

- **The proof is made from outside the app, because an app cannot certify its own networking.**
  `probe-server.mjs` copies seats.aero's CORS posture exactly — JSON, and not one `Access-Control-*`
  header — and records what arrives. It logged the WebView as `origin: capacitor://localhost` +
  `sec-fetch-mode: cors` + an `AppleWebKit/605.1.15` UA, and the adapter as
  `App/1 CFNetwork/3860.600.12 Darwin/25.3.0` with **no `Origin` and no `Sec-Fetch-*` at all**.
  That is a `URLSession` signature; WebKit always announces an origin on a cross-origin fetch and
  cannot be made not to. _Why:_ this converts "we believe it went native" into an observation by a
  third party that watched both requests land.

- **`AbortSignal` does not cancel the native request — only the promise — and the difference is
  quota.** Abort fired at 800 ms; the JS promise rejected at 803 ms with `AbortError`; **the server
  completed the entire 6 000 ms response at 6 002 ms** (reproduced at 6 003 ms). So an abandoned
  search still spends one of the 1 000 daily Pro-key calls, invisibly. This is not a theoretical
  gap: `src/lib/seatsaero/client.ts:312-313` builds its 20 s budget from an `AbortController` and
  `:327` classifies the failure by reading `signal.aborted`, and that whole mechanism is a no-op
  against the native transport. Ported unchanged it would stop the waiting but not the spending.

- **Native timeouts DO work, and they are the fix.** `readTimeout`/`connectTimeout` of 1 500 ms
  against a 6 000 ms hold: the server observed the client hang up at **1 507 ms** (reproduced at
  1 503 ms). The socket really closed. _Consequence, and it is a constraint rather than a preference:_
  the Phase-2 adapter must translate the client's timeout budget into native timeouts.
  `AbortController` alone fails silently, and the failure is invisible until the quota runs out early.

- **`CapacitorHttp.enabled` stays FALSE, and that is load-bearing rather than tidy.** Enabling it
  monkey-patches `window.fetch`; PIVOT §2 rejected relying on that patch because it falls back to
  WebView fetch in some call shapes. Keeping it off bought two things: `window.fetch` stayed the
  genuine WKWebView fetch, so the control probe is a real control and not a patched impostor —
  without this the whole differential would be circular — and nothing can reach seats.aero except
  explicitly through `src/nativeFetch.ts`.

- **CocoaPods, not SPM, and only because SPM did not work here.** `npx cap add ios` defaults to SPM
  on Capacitor 8. On this machine `xcodebuild` resolved and checked out `capacitor-swift-pm` 8.5.1
  and then sat at 0 % CPU with no open socket while `Capacitor.xcframework.zip` never downloaded —
  three clean attempts, caches cleared between them. The same zip fetches in 5 s with `curl`
  (6.6 MB, HTTP 200), so the network is not the cause. `--packagemanager CocoaPods` ran
  `pod install` in 5.07 s and built first time. _Recorded as an operational caveat, not a law:_
  one machine is not a sample, but Phase 2 should not assume the SPM default works.

- **P4's negative result is reported as a failing probe, not a passing measurement.** An earlier
  build marked it PASS because the *measurement* succeeded, which put a green tick next to
  "the native request kept running". _Why it was changed:_ a probe suite whose ticks certify that
  it ran rather than that the thing works is worse than no suite.

- **The live authenticated query (P6) is outstanding, and the reason is recorded rather than worked
  around.** The owner's seats.aero key is on this machine, AES-256-GCM encrypted in
  `data/runtime/awardgrid.db` under `MASTER_KEY`. Automated decryption of the credential store was
  refused by the environment's safety classifier and was **not** circumvented. _Why that is the
  right outcome:_ "decrypt the key store and use the result" should need a human in the loop even
  under a broad grant of authority. The key was never read, printed or written. What stays unproven
  is narrow — the authenticated response body, the row shape, and `X-RateLimit-Remaining` — since
  reachability, TLS, routing and header readability are all already measured by the 401.
  `spikes/phase0-native-http/README.md` carries the one command that closes it.

- **Phase 0 did not need the §0 legal answer; Phase 1 onward does.** Running this spike is the
  author using their own Pro key on their own machine, which is exactly the personal,
  non-commercial use `LEGAL.md:3` already describes. Distribution is a different act.
  `docs/PIVOT.md` §0 — whether seats.aero permits an app built on their non-commercial Partner API —
  is untouched by anything measured here and still gates the pivot.

### Phase 1 — `packages/core`, and the tests that were not allowed to change

- **The hard requirement was met, and git can prove it.** `packages/core` holds the six modules
  (`seatsaero`, `query`, `grid`, `qr`, `i18n`, `notices`) and its 25 test files run **281 tests, the
  same 281 that passed before the move, with not one byte edited**. `git diff --find-renames` records
  73 of the moved paths as pure renames with 0 insertions and 0 deletions. The kickoff's rule —
  a PR that edits any `*.test.ts` under `packages/core` is rejected on sight — is therefore not a
  promise in a commit message; it is checkable with one command. Totals are unchanged end to end:
  829 app + 281 core = 1,110, exactly the count before the split.

- **The package mirrors the repo's layout (`src/lib/…`, `test/fixtures/…`, `data/…`) because the
  constraint leaves no alternative, not because it is tidy.** Nine core tests reach their fixtures by
  relative path and `query/places.ts:16` reads `../../../data/places.json`, which mirroring fixes for
  free. The decisive file is `grid/ascii.test.ts:8`, which does
  `readFileSync(new URL("../../../test/fixtures/grid/…", import.meta.url))` — a **runtime filesystem
  read**. No `resolve.alias`, no tsconfig path and no bundler config can intercept it, so those three
  golden `.txt` files must physically sit three directories above the test. A symlink was the only
  other candidate and is worse: Vite and `tsc` both resolve symlinks by default, so the fixture's
  module identity would become a path inside the ROOT tsconfig's `include`, re-importing the very
  alias collision described below.

- **The `@` alias now belongs to the tests alone, and the package's own sources use relative
  imports.** This was forced by a measured failure, not taste: `paths` is a property of the
  *program*, not the file's directory, so when the root `tsc` follows an app import into the package
  it applies the ROOT `"@/*": ["./src/*"]` map to the package's internal imports — which resolve into
  the app's `src/`, where those modules no longer exist. 95 specifiers across 27 core source files
  were rewritten to relative paths. *Why not the obvious fix:* adding
  `"@/*": ["./src/*", "./packages/core/src/*"]` to the root also compiles, and is a trap — it
  silently shadows, so a straggling `@/lib/grid/pivot` in app code would typecheck green forever and
  the migration would stop proving its own completeness. Deleting `src/lib/grid/` is what makes every
  un-migrated import a hard error. The relative-import form is also the honest one: a package that
  ships source should not require its consumers to surrender their `@` namespace, and the Capacitor
  shell can now consume the core with no resolver config at all.

- **The app imports `@awardgrid/core/<module>`; 293 specifiers across 133 files were rewritten,
  and that churn was the point.** The cheaper option — mapping `@/lib/seatsaero/*` at the root and
  touching no app code — was rejected because it creates no dependency edge, cannot be enforced, and
  would leave a directory with a `package.json` rather than a package. 31 of those specifiers were
  *relative* (`../src/lib/i18n/dictionaries/en` in the e2e suite) and invisible to any `@/lib` search;
  they are the ones a rewrite like this loses.

- **`src/lib/i18n/server.ts` stayed in the app — it is the only file in all six modules coupled to
  Next.** Measured: the six modules' entire external surface is `zod`, `@anthropic-ai/sdk`, `react`,
  one `node:fs` in a test, and that single `next/headers`. Every `@/` import inside them already
  pointed back into the six; not one reached `auth`, `db`, `server` or `keys`. PIVOT §1's "the core
  is already portable" holds.

- **The boundary is enforced by lint in both directions, because measuring it once proves nothing
  about the next commit.** `packages/core` may not import `next/*`, `server-only` or `@/*`; the app
  may not import the six old `@/lib/…` roots. Both rules were verified to actually fire against
  deliberate violations, and to leave `@/lib/i18n/server` alone. Module roots are listed under
  `paths` rather than `patterns` because glob groups use gitignore semantics, where excluding
  `@/lib/i18n` also excludes everything beneath it and a `!@/lib/i18n/server` negation cannot
  re-include it.

- **Three ways the split could have gone green while being broken, all closed.** `pnpm test` would
  have run 84 files and exited 0 while executing none of the 281 core tests — the root vitest
  `include` never matched `packages/**`, and `--passWithNoTests` would have suppressed the only
  signal; `test` and `typecheck` now run the package too, and the package's own runner omits
  `--passWithNoTests`, so a zero-match include exits 1 (verified). `pnpm typecheck` would have
  stopped covering the 25 core test files entirely, since nothing imports them. And the Docker image
  would have built and then died on first import: `node_modules/@awardgrid/core` is a workspace
  symlink into `packages/`, which the runtime stage never copied.

- **The Dockerfile needed three changes and only CI can confirm them.** The deps stage now copies
  `packages/core/package.json` before `pnpm install --frozen-lockfile`, or `workspace:*` cannot
  resolve; the runtime stage copies `/app/packages` so the tsx-run worker and CLIs can resolve the
  core; and `COPY /app/data ./data` is **gone**, because `data/`'s only tracked file was
  `places.json` and moving it leaves a directory that does not exist in the build context — that
  `COPY` would have failed the build outright. `.dockerignore` also gained `**/node_modules`: the
  bare form matches only the top-level entry, so the workspace member's own host-specific pnpm
  symlinks would otherwise ride into the build context. _Not verified here:_ Docker is not installed
  on this machine, so these are reasoned from the file and rest on CI's `docker-smoke` job. The
  mechanism most likely to break — `tsx` resolving `@awardgrid/core` at runtime — **is** verified
  locally: `test/integration/find-entrypoint.test.ts` spawns the real `tsx` binary and passes.

- **What was verified locally:** 1,110 tests, `tsc` clean across app and package, `eslint` at 0
  errors (the one pre-existing TanStack warning unchanged), `next build`, the secret-in-bundle grep,
  and the standalone server actually booted — `/`, `/login` and `/api/health` all 200, which is the
  check that catches a core that resolves at build time and fails at runtime.

- **The e2e suite is green, and the failure that looked like a Phase 1 regression was not one.**
  A first run showed 50 failures, all "seats.aero returned an error (response)". The cause was the
  **Phase 0 probe server still listening on port 3999** — which is `E2E_MOCK_PORT`
  (`playwright.config.ts:21`). Playwright starts its mock with `reuseExistingServer: !isCI`, the
  probe server answers `/healthz` 200 like everything else, so it was silently adopted as the mock
  seats.aero and replied `{ok:true}` to every API path — a schema failure by construction. It had
  served 63 requests by the time it was caught. With it killed, the suite is **583 passed, 145
  skipped, 0 failed in 12.1 minutes**. The spike's default port moved to 4599 with the reason
  written at the top of `probe-server.mjs`, because the next person to leave it running deserves
  better than an hour of debugging a regression that is not there.

### Phase 2 — the client shell

Full detail in `apps/ios/README.md`; the app runs on a simulator today.

- **`apps/ios` is a shell and owns no core logic.** Parsing, planning, the cache scope algebra and
  the grid are all `@awardgrid/core`. What is new here is the ~700 lines the core cannot supply: a
  native transport, the Keychain, a device quota counter, JSON snapshots, and a single-user
  replacement for `src/lib/server/find.ts`'s 709 lines of multi-user orchestration. **44 tests, no
  device and no network**, using the same recorded seats.aero fixtures the core tests use — which
  is what Phase 1's `test-fixtures` subpath export was for.

- **Phase 0's measurements are encoded in the code, not just in a document.** The adapter ALWAYS
  sends a native `connectTimeout`/`readTimeout` and never trusts `AbortSignal` to stop anything,
  because Phase 0 measured that abort leaves the request running to completion. The product
  consequence is stated where it will be read: **the search screen has no cancel button.** A cancel
  that implied the call had been called off would be a lie about the user's quota, since the call
  completes and is charged either way.

- **The Keychain needs an entitlement even on the Simulator — found by running it, not by reading.**
  A `CODE_SIGNING_ALLOWED=NO` build has no entitlements, and the first key save returned
  `OSStatus -34018` (`errSecMissingEntitlement`) on screen. `ios/App/App/App.entitlements` now
  carries `keychain-access-groups` and is wired to the App target in `project.pbxproj`; builds pass
  `CODE_SIGN_IDENTITY="-"`. _Why it matters beyond the fix:_ nothing in the unit tests could have
  caught it — `MemoryKeyStore` passes happily — and the app would have shipped with a key store
  that silently refuses to store keys.

- **`afterFirstUnlockThisDeviceOnly`, and the `ThisDeviceOnly` half is the deliberate part.**
  `afterFirstUnlock` so a background refresh (PIVOT §3's "watch") can read the key while the screen
  is locked; `…ThisDeviceOnly` because the plain form migrates through encrypted backups, and a key
  pasted into one phone should not reappear on a restored device. The user can paste it again;
  that is the cheaper mistake.

- **The quota rule is written as one line of arithmetic, because "trust the header" is ambiguous
  enough to be a bug factory.** `used(day) = max(local count, 1000 − X-RateLimit-Remaining)`,
  monotonic within the day. Two things fell out of testing it rather than reasoning about it:
  `runFind` **refunds** unused reservations with a negative `increment`, which walked the count back
  below the header's floor — so the store now keeps a per-day floor a refund cannot cross; and the
  rate-limit observer had to move OUT of the native adapter and become a wrapper around whatever
  transport is in use, because an injected transport (a test today, a desktop or extension shell
  tomorrow) silently lost the reconciliation while still appearing to work.

- **`InMemoryAvailabilityCache` gained `snapshot()`/`restore()` in core rather than a mirror in the
  shell.** Its state is in `#private` fields, so persistence had to live either inside the class or
  as a parallel copy in the shell. A parallel copy would have meant re-deriving `rowKey`/`rowMatches`
  semantics by hand, and the `include_filtered` / `min_cabin_pct` scopes are exactly where that goes
  quietly wrong — two rows for the same program/pair/date/cabin at different scopes are different
  rows, not duplicates. Added as **a new test file** (`cache-snapshot.test.ts`, 7 tests): the
  kickoff forbids editing an existing core test, and this adds a capability rather than changing
  encoded behaviour. Core is now 26 files / 288 tests, the original 281 untouched.

- **The bundle carries `@anthropic-ai/sdk` and the grid lane never uses it.** `query/llm.ts` imports
  the SDK as a *value* (`instanceof Anthropic.AnthropicError`), and `query/parse.ts` imports from
  `query/llm.ts`, so importing `parseQuery` pulls it in — ~650 KB total. _Accepted for now, with the
  remedy recorded:_ import `query/deterministic` + `query/schema` directly and reimplement
  `parseQuery`'s ~45-line tail. Not done here, because duplicating that tail is a divergence risk
  for a cost that does not yet hurt on a phone.

- **Two layout bugs that only a device could show.** The safe-area insets were on `body`, which
  added the notch and home-indicator heights on top of a `100dvh` shell and pushed the
  "Data: seats.aero" attribution — a `LEGAL.md` requirement — off the bottom of the screen. And a
  flex child's default `min-width: auto` made the key input refuse to shrink, widening the page
  until the Save button sat off the right edge, untappable. Both are fixed and commented; the second
  is why the key input and its button now stack rather than sit side by side.

- **What is deliberately NOT built.** No watches (iOS cannot honour a schedule; PIVOT §3), no Ask
  lane (PIVOT §3 defers it to v1.1 and the grid lane needs no Anthropic key), no device SQLite
  (PIVOT §6 says it can wait), and no design system or real grid components — PIVOT §6 puts those in
  Phase 3, and `src/search/search.ts` keeps the `ApiResult`/`ApiFailureCode` shape from
  `src/components/grid/api.ts` exactly so that port is a small diff rather than a rewrite.

- **§0 is still unanswered and now matters more.** Phase 2's output is the thing that would be
  distributed. Building it is still the author's own personal use; listing it is not.

### Phase 3 — the design system, the landing site, the app screens

Full rationale in `packages/tokens/README.md`.

- **Not one existing token value changed, and that was forced rather than chosen.**
  `src/styles/tokens.test.ts` asserts the exact hex of all eleven colours, and 24 Playwright
  baselines plus 298 screenshots are pixel-compared by a **blocking** CI job whose baselines can
  only be generated on Linux CI. A redesign that moved `--bg` would be unverifiable from the machine
  making it. So Phase 3 is additive: `packages/tokens/tokens.css` is a `git mv` with **0 insertions
  and 0 deletions**, and everything new is a new token name. This is also exactly what PIVOT §4 asks
  for — "Change values, add tokens, rename nothing" — and §4 helpfully puts colour on the *shared*
  side of the fork, so no new colour was needed at all.

- **The tokens became a package because there were already two palettes.** Phase 2 shipped eight
  hand-picked hexes in `apps/ios/src/styles.css` that merely resembled the app's. That is a
  duplicate of a contrast-verified system, and the next person to adjust a colour would have
  adjusted one of the two. `packages/tokens` is now read by the Next app, the Capacitor shell and
  the landing site.

- **Two surface modes, taken from the reference's own behaviour rather than its look.**
  `restful.dowhiz.com` is glass throughout — `backdrop-filter: blur(18px)`, stacked translucent
  gradients, `0 24px 60px` shadows, 28px radii — and its two DATA components (`.fact-table`,
  `.compare-table`) switch every bit of it off: no blur, no shadow, flat fill, 1px hairlines,
  `overflow-x: auto`. Its radii already fork without being named as a system (28px glass, 20px
  data). That instinct is what `[data-surface="flat"]` / `[data-surface="rich"]` encodes. Both
  blocks set every token rather than inheriting, because a flat island has to nest inside a rich
  page — the grid on an onboarding screen — and a partial override would leak the outer blur inward.

- **A shadow in rich mode is a recorded departure, not an oversight.** `FINAL_REPORT.md:179` lists
  "no cards, no shadows anywhere" among the generic-template tells this product deliberately passed.
  Flat mode keeps that rule; rich mode reintroduces a shadow only on marketing and onboarding
  surfaces, which did not exist when the rule was written. It is composed from black at low alpha
  rather than from `--fg`: in dark, `--fg` is near-white and a shadow built from it lightens instead
  of darkens — the same inversion `tokens.css` already records for `--scrim`.

- **What was NOT copied from Restful, each for a stated reason.** Its colours (`#ffdb76` cream on an
  ink-to-navy gradient is precisely the "cream + serif + terracotta" tell). Its muted text
  (`#8aa0a3` against a ground that runs to light navy). Its `-0.08em` display tracking — awardgrid
  sets three-letter IATA codes in headlines and `SEA`/`NRT` collide at that tracking, so
  `--tracking-display` is `-0.02em`. And its absence of `prefers-reduced-motion` guards.

- **No webfont is named.** `docs/UI_PLAN.md:514` rejected a network font dependency, and the repo's
  convention is to self-host with the licence beside the binary. A system serif stack needs neither
  — `ui-serif` is New York on Apple platforms, a real display serif — and both stacks carry an
  explicit CJK serif, without which a Chinese eyebrow silently loses the serif voice in half the
  product. Inter is copied into `apps/ios/public/fonts/` with its licence rather than re-downloaded,
  because PIVOT §4 requires the data face to stay exactly what the web app ships: its tabular
  figures and CJK-after-Latin `unicode-range` stack are load-bearing.

- **The landing site ships zero JavaScript and makes zero network requests.** 7.6 KB of HTML and
  5.6 KB of CSS, with the palette inlined from `@awardgrid/tokens` at build time so it cannot drift.
  `LEGAL.md` promises "no telemetry or analytics", and a marketing page is exactly where that
  promise usually quietly dies, so there is no script tag at all to argue about later.

- **The landing page carries NO App Store badge, and says why on the page.** `docs/PIVOT.md` §0 is
  unanswered: seats.aero's Partner API is licensed for non-commercial personal use and nobody has
  confirmed that permits a distributed app. A "Download on the App Store" button would assert a
  listing that may not be permitted to exist. The page has a "Where this is up to" section stating
  the position plainly instead — which is both the honest option and the one that needs no rewrite
  when the answer arrives.

- **"Invite only" is gone from the copy and nothing else is.** PIVOT §4: "The voice does not
  change." The front door's blocks carry over almost verbatim; the one that had to go said there is
  no public signup and you need an invite from whoever runs the server, which was true of a shared
  host and is false of an app with no server. The "what it does not do" table got *longer*, not
  shorter — it now also names the absent schedule guarantee and the absence of any key of ours.

- **`contrast.mjs` is a manual pre-landing gate, not a CI step.** Worth writing down because it is
  easy to assume otherwise: `grep` finds no reference to it in `.github/`, `package.json` or
  `scripts/`. It was run for this change and passes. What CI actually enforces for a11y is
  `e2e/axe.spec.ts` across desktop-light, desktop-dark and mobile-light.
