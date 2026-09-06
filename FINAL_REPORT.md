# FINAL REPORT — awardgrid

> Written during the unattended run (Phases 0–5, 2026-09-05/06). §1 is the precondition check as found; §2–§8 reflect the tree at **v0.1.0**. §9 covers the UI phase (Phase 6) and the tree at **v0.2.0**; where §9 and §2–§8 disagree about the interface, §9 is the current one.

## 1. Precondition check (§0.4) — 2026-09-06

| Precondition | Result | Action taken |
|---|---|---|
| `git` | ✅ 2.39.0 | — |
| `node` ≥ 20 | ✅ v22.23.2 (arm64, `~/.local/node-arm64`); default `/usr/local/bin/node` is v22.16.0 x64 under Rosetta | Used the arm64 build for all installs/builds (see DECISIONS) |
| `pnpm` | ❌ not installed | Enabled via corepack → pnpm 12.3.4 |
| `gh` authenticated | ✅ `LoganYe` (scopes: gist, read:org, repo, workflow) | — |
| `docker` + `docker compose` | ❌ not installed | Dockerfile/compose written; smoke test → "Needs human action" |
| `ANTHROPIC_API_KEY` | ⚠️ present, but **not a Messages-API key**: the value was the Claude Code host session token — HTTP 401 on the Messages API, 403 in the SDK subprocess (DECISIONS Phase 4) | parser fixture suite runs on a fake client; the Ask-lane "one real streamed answer" was **not** executed → §4 live smoke; never printed |
| `SEATS_AERO_API_KEY_TEST` | ❌ absent | fixtures from official docs examples; **0 / 40** test-key calls used |
| `TELEGRAM_BOT_TOKEN_TEST` | ❌ absent | mock transport |
| Working directory empty | ❌ `~/Desktop/workspace` holds other projects | built in `~/Desktop/workspace/awardgrid/` |

## 2. What works

Evidence is what a fresh clone can reproduce with `export PATH="$HOME/.local/node-arm64/bin:$PATH"` and no keys
(`pnpm test`: **79 files, 722 passed, 2 skipped** in ~9 s — the two skips are the live-gated Ask tests, §3).

| Phase | Delivered | Self-acceptance evidence (kickoff §9) |
|---|---|---|
| 0 — repo, docs, CI | Private GitHub repo, MIT license, `.github/workflows/ci.yml` (typecheck · lint · test · `next build` + bundle key scan · tracked-secret check · gitleaks v3 · `docker smoke`), dependabot, vendored toolkit submodule pinned at `2584743`, `ARCHITECTURE.md` (verified endpoints/SDK options/model IDs, 28-row docs-vs-prompt table), `DECISIONS.md`, `LEGAL.md`, `docs/reference/seatsaero/*.md` snapshots | PR #5 merged; every identifier in the client and the SDK options traces to a snapshot page |
| 1 — fast lane + CLI | `src/lib/query` (places seed with zh/en aliases and metro expansion, deterministic bilingual date/cabin parser, strict structured-output LLM fallback), `src/lib/seatsaero` (typed client for `/search`, `/availability`, `/trips/{id}`, `/routes`; cursor+skip pagination; per-user quota with atomic reserve, soft stop 950; per-user cache + coverage, 45 min; lazy Get Routes catalog, 7 d; Cached-vs-Bulk planner), `src/lib/grid` (pivot, ranking, freshness tiers, CSV, ASCII, AA deeplink + caveat), `pnpm grid` | `pnpm grid "香港,上海,东京,首尔到西雅图 未来一个月 头等" --fixture test/fixtures/seatsaero/synthetic-example-query.json` renders 31 dates × 7 pairs in **0.3 s** wall clock (kickoff target < 5 s) with the parsed query echoed on line 1 (`origins: HKG PVG SHA NRT HND ICN GMP …`) so a wrong expansion is visible; 36 bilingual parser cases in `test/fixtures/queries/cases.json` (`test/query/cases.test.ts`); `test/integration/find-cli.test.ts` (chips identical for every spelling, CSV, `--json`, exit codes 2/3/4, key never printed, on-disk routes cache reused) and `find-entrypoint.test.ts` |
| 2 — web app | Next.js 16 App Router: invite registration, argon2id passwords, hashed cookie sessions, login rate limits, same-origin guard (`src/proxy.ts`), AES-256-GCM key store showing `••••` + last 4, one quota-reserved validation call, `/grid` (query box, editable chips with provenance, dates × pairs grid, transposable, sticky first column, freshness tiers, cell drawer with every program + Get Trips on expand + AA deeplink + caveat, CSV export, `?q=` URLs, empty states), `/settings` (keys, quota bar, quiet hours, language), `/legal`, `/api/health`, EN/中文 toggle, "Data: seats.aero" footer, admin CLI, `scripts/seed-dev.ts`, `scripts/mock-seatsaero.ts` | `test/integration/two-users.test.ts`: two seeded users with two keys have independent caches and quotas, each request carries only its owner's key, neither key appears anywhere in the database; `scripts/check-no-secrets-in-bundle.sh` (run by the CI `checks` job after `pnpm exec next build`) — **PASS** on the whole `.next/` tree: none of the 17 fixture/seed key strings anywhere, `Partner-Authorization` absent from client chunks; `next.config.ts` `outputFileTracingExcludes` keeps tests, fixtures, scripts, `vendor/`, `docs/`, `src/` and `data/runtime/` (the local SQLite) out of `.next/standalone` (see §3); manual browser pass against the mock seats.aero (register → key → grid → chips → cell drawer → CSV) during the phase, not automated |
| 3 — standing queries + Telegram | `src/lib/scheduler` (5-field cron matcher, cell diff, `runSavedQuery` with the owner's key, TTL + quota respected, `skipped_reason` for quota / no key / upstream / quiet hours / send failure, cross-process run claim), `src/lib/notify` (Telegram HTML transport ≤ 4096 chars, mock transport, bilingual digest, quiet hours in the user's zone, one-time deep-link tokens, `/start` + `/unlink` long-polling poller), `pnpm worker` (node-cron master tick every minute UTC, clean shutdown), `/queries` page + API, Settings Telegram card, cron floor ≥ hourly | `test/integration/scheduler-harness.test.ts`: fake clock, two users; one new fixture cell for A → **exactly one** message to A's chat, none to B, run recorded; B's exhausted quota → run recorded `quota`, no upstream call, no message; `src/cli/worker-main.test.ts` covers startup/shutdown |
| 4 — Ask lane | `scripts/build-plugin.ts` + `plugin-manifest.ts` (27 kept / 21 pruned skills with reasons, pattern safety net, `PRUNED.md`), `src/lib/ask` (SDK options: local plugin, `skills` allowlist, `settingSources: []`, `strictMcpConfig`, 4 keyless MCP servers, replaced per-user env; `canUseTool` gate; `$2/day` budget hold + settle; 120 s abort; streaming adapter), `/api/ask` SSE + Ask drawer with grid/cell context, cost and daily remaining | `test/ask/init-assertions.test.ts` asserts the **recorded real init message** (`test/fixtures/ask/init-message.json`, Claude Code 2.1.260, model `claude-sonnet-5`): plugin `travel-hacker` loaded, all 27 kept skills present, none of the 21 pruned, all four MCP servers `connected`, no absolute path/key/user data; `test/ask/two-user-isolation.test.ts`: alice's and bob's session envs differ only in their own keys, and with the real `process.env` as host only `PATH`/`ANTHROPIC_API_KEY`/`ANTHROPIC_BASE_URL` pass through; `scripts/build-plugin.test.ts` fails the build on any kept skill mentioning docker/patchright/agent-browser/`_USERNAME`/`_PASSWORD`/`printenv` |
| 5 — ship | `README.md`, `LEGAL.md`, `BACKLOG.md`, this report; `Dockerfile` (multi-stage, standalone + full `node_modules`, curl/jq/tini, healthcheck), `docker-compose.yml` (app + worker, loopback-bound port, one volume), `.dockerignore`, CI `docker smoke` job | see §4 for the local compose smoke and release steps that need a human |

## 3. What is mocked / skipped and why

- **seats.aero payloads**: `SEATS_AERO_API_KEY_TEST` was never present, so the planned ≤ 40-call smoke did not run. `test/fixtures/seatsaero/{search,availability,trips__id,routes}.json` are the official docs' example payloads verbatim; `synthetic-example-query.json` is generated by `generate-synthetic.ts` (seeded, byte-identical) in the official Cached Search shape for the canonical query. Consequences: `ComputedLastSeen`, the `TotalDuration` unit and the Bulk Availability envelope remain unverified (ARCHITECTURE §8) and the client is lenient about them.
- **Telegram**: `TELEGRAM_BOT_TOKEN_TEST` absent → `MockTransport` (same interface, in-memory + JSONL sink with hashed chat ids) is what tests and the token-less worker use. The real `TelegramTransport` (`sendMessage`, `getMe`, `getUpdates`) is exercised only against a fake `fetch` in `src/lib/notify/*.test.ts`.
- **Ask lane live turn**: the only Anthropic credential in this environment was the Claude Code host session token, which the Messages API rejects (401) and the SDK subprocess rejects (403). `scripts/ask-smoke.ts` therefore recorded a **real init message** (plugin, skills, MCP status — the assertion the kickoff asks for) but `test/fixtures/ask/smoke-result.json` records the model turn honestly as `error: 403 Request not allowed`, `cost_usd: 0`. Re-running with a real key is a one-liner in §4.
- **Two `it.skipIf` tests** (the "2 skipped" in `pnpm test`): `src/lib/ask/session.test.ts` "runs one real session against the built plugin" and `test/ask/two-user-isolation.test.ts` "two-user isolation (live)". Both need `ANTHROPIC_API_KEY` + `AWARDGRID_LIVE_SMOKE=1` and are skipped by design so CI never spawns the SDK. One more `it.skipIf(!exists)` in `src/lib/ask/gate.test.ts` runs only after `pnpm build:plugin` (it walks the built skills' ```bash blocks). No test is `.skip`ped for failing.
- **Docker**: not installed locally. The compose smoke runs in the CI job `docker smoke` (build, `up -d app`, `/api/health` 200, `/login` 200, `down -v`) with a throwaway `.env`; the worker container was never run under Docker here (the worker command was run outside Docker against the same layout).
- **Standalone tracing (fixed in Phase 5)**: Next's file tracing follows `src/lib/ask/skills.ts`'s `readdirSync(<cwd>/build/plugin)` ("Dynamic filesystem access causes tracing of the whole project") and used to copy the entire repo — test files with fake keys, `vendor/`, the local `data/runtime/awardgrid.db` — into `.next/standalone/`, so `scripts/check-no-secrets-in-bundle.sh` failed on the server tree. `next.config.ts` now sets `outputFileTracingExcludes` so the standalone tree holds only `server.js`, `.next/`, `node_modules/`, `LEGAL.md`, `LICENSE`, `drizzle/`, `data/places.json` and `build/plugin/`; it was booted from that tree (`/api/health`, `/login`, `/legal`, `/register` → 200) and the scan passes; CI runs it on every push. Two things remain by Next's design, not by tracing: a local `.env` / `.env.production` is copied into `.next/standalone/` (`.dockerignore` excludes `.env*` from the image context, and `.next/` is gitignored), and the Dockerfile still copies only `server.js`, `.next/standalone/.next` and `.next/static` from it.
- **Browser smoke**: done by hand against the mock seats.aero during Phases 2–4; there is no Playwright suite and no screenshot in the repo (mobile check is a BACKLOG item).
- **`gh issue create` per deferred item**, the Phase 5 PR, the `v0.1.0` tag and the GitHub release (kickoff Phase 5 / Definition of done): git and `gh` **writes were not allowed** in the sessions that finished Phase 5 (the tree is on branch `phase-5-ship`, uncommitted), so these are the first four items of §4 with the exact commands.

## 4. Needs human action

_Completed after the Phase 5 merge (no human action needed): PR #10 merged, `main` green (run 34002684389 incl. the Docker smoke), tag `v0.1.0` + GitHub release created, issues #11–#20 opened — one per deferred item; see §8._

Each item is the exact command or step; run the commands from the repo root with
`export PATH="$HOME/.local/node-arm64/bin:$PATH"` (this Mac's arm64 Node 22).


- **Docker smoke test (local)**: Docker is not installed here, so the image was never built on this machine. The CI job `docker smoke` (`.github/workflows/ci.yml`) performs the build + `/api/health` + `/login` check on every push; to confirm locally install Docker Desktop (or OrbStack), then:
  `docker compose build && docker compose up -d && curl -fsS localhost:3000/api/health && docker compose down -v`.
  What was verified without Docker: the runtime layout the Dockerfile produces (standalone `server.js` + `.next/` + full `node_modules`, migrate via `tsx`) boots and serves `/api/health`, `/login`, `/legal` with 200, and the worker command starts and exits 0 on SIGTERM.
- **Set `MASTER_KEY` and `ANTHROPIC_API_KEY`** (never commit `.env`):
  `cp .env.example .env && node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` → paste as `MASTER_KEY=`; paste your Anthropic key as `ANTHROPIC_API_KEY=`. Rotating `MASTER_KEY` later invalidates every stored user key (users re-enter them in Settings).
- **Rotate the dev seed**: if `scripts/seed-dev.ts` was ever run against the deployment database, delete `alice`/`bob` (`sqlite3 data/runtime/awardgrid.db "DELETE FROM users WHERE username IN ('alice','bob')"`) or start from a fresh `DATABASE_PATH`; the seed's `MASTER_KEY` fallback (`d`×64) must never be the production key.
- **Create the Telegram bot**: in Telegram open @BotFather → `/newbot` → copy the token; put `TELEGRAM_BOT_TOKEN=<token>` and `TELEGRAM_BOT_USERNAME=<bot_username>` in `.env`; start `pnpm worker` (or `docker compose up -d worker`); each friend clicks **Link Telegram** in Settings and presses Start. Without the token alerts only go to the mock JSONL sink.
- **Put it behind Tailscale or Cloudflare Access — never public**: e.g. `tailscale serve --bg 3000` on the host (then `COOKIE_SECURE=false` if you stay on plain HTTP, or `TRUST_PROXY_HEADERS=1` behind `tailscale serve` / Access TLS) and set `APP_URL` to the URL friends use. `docker-compose.yml` already binds `127.0.0.1:3000` only.
- **Each friend generates their own seats.aero Pro key**: seats.aero → Settings → API (Pro plan); mint their invite with `pnpm admin invite --for <name>`; they register at `/register` and paste the key in Settings → API keys (one validation call on their quota).
- **Live Ask smoke — the Phase 4 self-acceptance "one real streamed answer" was not executed** (≤ $0.50; needs a real Messages-API key, see §1; refreshes `test/fixtures/ask/smoke-result.json`):
  `pnpm build:plugin && AWARDGRID_LIVE_SMOKE=1 ANTHROPIC_API_KEY=<key> pnpm exec tsx scripts/ask-smoke.ts && pnpm test`
  (with the key already in the environment: `AWARDGRID_LIVE_SMOKE=1 pnpm exec tsx scripts/ask-smoke.ts`; the same two variables un-skip the two live tests in `pnpm test`). Expected: a streamed answer to "which program should I book the cheapest SEA→NRT F cell with, and what transfers into it?" and `cost_usd > 0` in the fixture.
- **seats.aero fixture recording — the §0.4 ≤ 40-call smoke never ran** (`SEATS_AERO_API_KEY_TEST` absent; every fixture under `test/fixtures/seatsaero/` is a docs example or marked `_synthetic`). With your own Pro key, ≤ 40 calls total:
  `SEATS_AERO_API_KEY=<key> pnpm grid "SEA to NRT next 7 days F" --json > /tmp/live-search.json` (Cached Search + Get Routes, ≈ 2–4 calls), then one Bulk page and one trip: `curl -s -H "Partner-Authorization: $SEATS_AERO_API_KEY" "https://seats.aero/partnerapi/availability?source=aeroplan&take=50" > /tmp/live-availability.json` and `curl -s -H "Partner-Authorization: $SEATS_AERO_API_KEY" "https://seats.aero/partnerapi/trips/<ID of one availability row in live-search.json>" > /tmp/live-trips.json`. Confirm `ComputedLastSeen`, the `TotalDuration` unit, the Bulk response envelope and the quota-reset boundary (ARCHITECTURE §8), scrub IDs, replace the `_synthetic` files in `test/fixtures/seatsaero/`, and re-run `pnpm test`.
- **Telegram real-bot check** (never run: no `TELEGRAM_BOT_TOKEN_TEST`): after the bot exists, `set -a && . ./.env && set +a && pnpm worker` in one terminal; in the app Settings → **Link Telegram** → press Start in the chat → Settings shows "Linked"; then `/queries` → **Run now** on a saved query whose fixture/mock has a new cell → one digest arrives in that chat (and nothing in `data/runtime/notify-mock.jsonl`).

## 5. Test-key calls actually used

- seats.aero: **0 of 40** (`SEATS_AERO_API_KEY_TEST` absent; every seats.aero test runs on the docs' example fixtures or the synthetic fixture; the mock server accepts any non-empty key).
- Anthropic: **0 billable calls, $0.00**. The parser fixture suite uses a fake client (`src/lib/query/llm.test.ts`, `test/query/cases.test.ts`); the one `scripts/ask-smoke.ts` run recorded the SDK init message and then failed authentication (host token, HTTP 403) before any model turn — `test/fixtures/ask/smoke-result.json` shows `cost_usd: 0`, `num_turns: 1`, `duration_ms: 294`. The two live-gated tests were skipped.
- Telegram: **0** (no token; mock transport).

## 6. Estimated monthly cost for 10 users

Assumptions: 10 users, 30 days, 30 grid queries per user per day, **20 % of queries** need the LLM fallback (the
deterministic parser handles the canonical Chinese/English phrasings, city lists, cabins and relative/explicit dates;
holidays and free-form dates fall through), 2 Ask questions per user per day. Prices from ARCHITECTURE §4.

| Item | Arithmetic | Per month |
|---|---|---|
| Parser fallback — `claude-haiku-4-5-20251001`, $1 / $5 per MTok | System prompt with the places seed = 4,929 chars (`buildSystemPrompt`, `data/places.json` is 5,989 chars) ≈ **1,650 tokens** at 1 token ≈ 3 chars, + JSON schema ≈ 300 + user text ≈ 60 ≈ **2,000 input tokens**; output ≈ 150 tokens. Per call: 2,000 × $1/M + 150 × $5/M = $0.0020 + $0.00075 ≈ **$0.0028**. Calls: 30 × 20 % = 6 per user per day × 10 users × 30 days = **1,800** | **≈ $5** |
| Ask lane — `claude-sonnet-5`, $2 / $10 per MTok | Realistic: 2 questions × $0.15 (toolkit skill reads + a couple of `curl` tool turns ≈ 50K input / 5K output) = $0.30 per user per day × 10 × 30 | **≈ $90** (hard ceiling: $2 cap × 10 × 30 = $600) |
| Hosting | Home box behind Tailscale: $0. Small VPS (1–2 vCPU, 2 GB; the image + SQLite need < 1 GB): ≈ $6 | **$0 – $6** |
| seats.aero Pro | Each user's own subscription and own 1,000 calls/day; not a project cost | $0 to the project |
| Telegram Bot API, GitHub (private repo, Actions minutes for a personal account) | free tier | $0 |
| **Total** | | **≈ $95 – $100 / month**, worst case ≈ $605 + hosting if every user hits the Ask cap every day |

Sensitivity: the parser is negligible even at 100 % LLM fallback (≈ $25); the Ask lane dominates, and its ceiling is
whatever `ASK_DAILY_COST_CAP_USD` is set to × users × 30.

## 7. Run locally in 5 lines

```sh
export PATH="$HOME/.local/node-arm64/bin:$PATH" && git clone --recurse-submodules <repo-url> awardgrid && cd awardgrid && pnpm install
cp .env.example .env && node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # paste as MASTER_KEY=, add ANTHROPIC_API_KEY=
pnpm db:migrate && pnpm admin invite --for me                                                        # prints the invite code
pnpm exec tsx scripts/mock-seatsaero.ts &                                                            # optional: fixture-backed seats.aero on :3999, zero quota
SEATS_AERO_BASE_URL=http://127.0.0.1:3999/partnerapi/ pnpm dev                                       # http://localhost:3000/register → Settings → paste any key (mock) or your Pro key (drop the env var)
```

Offline sanity check without any of the above: `pnpm test` and
`pnpm grid "香港,上海,东京,首尔到西雅图 未来一个月 头等" --fixture test/fixtures/seatsaero/synthetic-example-query.json`.

**Do not copy-paste the kickoff's `pnpm find "<query>"`**: pnpm ≥ 10 reserves the bare `find` for registry search
(`pnpm search`) and built-ins win over `package.json` scripts, so it would send the query text to npm. Use `pnpm grid`
(or `pnpm run find`, the kept alias) — DECISIONS "Phase 1 — review fixes".

## 8. Conventions and CI history (kickoff §10 / Definition of done)

- **CI on `main`**: green **since PR #5** (`3fd0f08`, run `33985339756`) through PR #10 (`2d94152`, run `34002684389`, all
  jobs incl. gitleaks and the Docker smoke). The very first push (`4dea592` "chore: repo skeleton", run `33981541466`) is recorded as a
  **failure** (pre-Phase-0 skeleton before the workflow was hardened) — so "green since #5", not "always green".
- **Conventional commits**: PRs #5, #6, #8, #9 are `docs(phase-0)` / `feat(phase-N)`; **PR #7** was squash-merged as
  `Phase 2: web app — auth, encrypted keys, grid page, settings (#7)` with no type prefix. `main` is not rewritten;
  the Phase 5 PR (#10) used `feat(phase-5): ship — …`.
- **Squash-merge PRs**: #5 (Phase 0), #6 (Phase 1), #7 (Phase 2), #8 (Phase 3), #9 (Phase 4), #10 (Phase 5). `main` run `34002684389` (`2d94152`) is green on all three jobs — `typecheck · lint · test` (incl. the build + bundle key scan), `gitleaks`, `docker smoke`.
- **Release**: tag `v0.1.0` → https://github.com/LoganYe/awardgrid/releases/tag/v0.1.0 (generated notes).
- **Deferred items → issues**: #11 Docker local smoke · #12 live Ask smoke · #13 real seats.aero fixtures · #14 parser model live check · #15 non-AA deeplinks · #16 cpp_desc sort · #17 release-window mode · #18 min_cabin_pct setting · #19 node:sqlite revisit · #20 Telegram real-bot check (labels `deferred` / `needs-human`).
- **Secrets**: gitleaks passed on every `main` run since #5; no `.env*` or SQLite file has ever been tracked (CI step +
  `git ls-files` check); the only Anthropic credential seen was never written to disk or printed.

## 9. UI phase (v0.2.0)

Phase 6 was frontend-only and fully offline: no key, no network, no seats.aero call and no model turn anywhere in it.
Everything below reproduces from a fresh clone with `export PATH="$HOME/.local/node-arm64/bin:$PATH"` and no `.env`.
The design record is `docs/UI_PLAN.md`, the working manual is `docs/UI.md`, the copy contract is `docs/COPY.md`.

### 9.1 What changed, per sub-phase

| Sub-phase | PR | Delivered |
|---|---|---|
| 6.0 Audit and plan | #23 | "Before" screenshots of the v0.1 UI (52 PNGs, frozen); `docs/UI_PLAN.md` — eleven colour tokens per theme with computed WCAG ratios, type roles and the CJK fallback stack, spacing/density/radii, freshness encoding, wireframes for every page and both drawers, interaction and copy rules, and an adversarial review against spec §1.2 with the log of what it changed; `fixtures/demo/` (deterministic generator, every value invented) and the `DEMO=1` mode of the mock seats.aero; the Playwright + axe harness (four projects, throwaway SQLite, seeded scenario users) |
| 6.1 Design system and shell | #24 | `src/styles/tokens.css` and the Tailwind/shadcn mapping; self-hosted Inter with `unicode-range` and tabular figures; light and dark with `ag_theme` + `users.theme` persistence and no flash; the 48 px top bar (nav, quota indicator from the new `GET /api/usage`, language and theme toggles, user menu, mobile menu) and the one-line footer with "Data: seats.aero"; auth pages restyled; the copy audit applied to both dictionaries |
| 6.2 Grid | #25 | Cell anatomy and the six states (each with a pattern and a label), the freshness module as one source of truth with the fourth `unknown` tier, sticky header and first column, roving-tabindex keyboard model, hover tooltip, virtualization, per-cell `aria-label`, rows toggle, cabin tag, the dynamic-pricing state derived from the cached scope at zero API cost |
| 6.3 Query bar and chips | #26 | The growing query bar with "Parsed from" and the Examples popover; the seven chips in spec order with a popover editor each (including a hand-written two-month calendar with the 92-day clamp); the modified state, Reset to parsed, the URL-encoded `QueryObject`, the parse-failure state and the loading skeleton in the query's real shape |
| 6.4 Drawers | #27 | One drawer shell for both (push / overlay / sheet / bottom sheet by breakpoint, focus trapped only where the page is really inert), one slot so "mutually exclusive" is structural; the cell drawer with Get Trips, the caveat line above the action, Copy details, Save as standing query and Ask about this cell; the Ask drawer with context pills, suggestions, streaming markdown, tool activity, Stop, the cost meter and the cap state — plus the review fixes (closing Ask aborts the stream, one live region, history cleared at log-out, `safeHref` hardened) |
| 6.5 Queries and Settings | #28 | The standing-queries table with human schedules, next run, inline delete confirmation, the expanded row rendering the last diff with the real grid-cell component, and the edit drawer with the grid's own chips (`PATCH …{query}` made it actually save); Settings' four sections — keys with offline validation, Telegram with the dependency-free QR and two-field quiet hours, Account with change-password, Language and theme — plus the second review pass (price drops reach the page, drawn radio indicators, focus returned by inline confirmations, registration throttled before argon2) |
| 6.6 Responsive, a11y, visual suite, docs | #29 | The three responsive bands pinned by `e2e/responsive.spec.ts` (cells, rows, drawers, the Filters sheet, chip wrapping, 40 px touch targets, no sideways scroll, reduced motion, zh completeness); the axe floor asserted by default across every page and state on three projects; the capture matrix declared once (`e2e/matrix.ts` + `e2e/states.ts` + `e2e/screenshots.spec.ts`) with the contact sheet generated by `scripts/screenshot-index.ts`; `e2e/visual.spec.ts` and the non-blocking `visual` CI job; `docs/UI.md`, this section, the README UI section, `BACKLOG.md` and the `DECISIONS.md` § 6.6 entries |

### 9.2 Evidence

| Claim | How to see it |
|---|---|
| Unit tests | `pnpm build:plugin && pnpm test` → **104 files, 1,046 passed, 2 skipped** in ~9 s (the two skips are the live-gated Ask tests, §3) |
| End-to-end | `pnpm build && pnpm e2e` → **14 spec files, 600 tests: 484 passed, 116 skipped** in ~11 min across the four projects (desktop and mobile × light and dark), offline against the `DEMO=1` mock. The skips are deliberate project gates, not failures: the keyboard walk and the responsive sweep are contracts walked once on desktop-light, the hover tooltip and the zh grid captures are desktop-only, and every `visual` assertion is inert without `VISUAL=1` |
| Accessibility | `e2e/axe.spec.ts` audits every page and state — login, register, legal, grid results, the seven chip editors, both drawers, quota, no key, empty results, parse failure, queries (list, expanded, edit drawer, empty), settings — on desktop-light, desktop-dark and mobile-light, and since 6.6 the §8 floor is **asserted by default** (`E2E_AXE_STRICT=0` downgrades it to a report). The last recorded summary, `docs/screenshots/v0.2/axe-summary.json`, is **69 page audits (23 states × 3 projects), zero violations at every impact** — not just zero serious/critical. Each entry carries the time it was audited, and an entry the suite can no longer produce (a project it stopped auditing, a renamed state) is dropped on the next run rather than left behind as a stale zero. The 6.0 baseline in `before/axe-summary.json` had one serious `color-contrast` violation with 84 nodes on the grid; that is the one the design system removed |
| Keyboard | The model is pure and unit-tested (`src/lib/grid/keyboard.ts`, `keyboard.test.ts`: arrows, Home/End, Ctrl/Cmd+Home/End, PageUp/PageDown by 7 rows); the mouse-free walk from the query bar to an opened booking link is written out in `docs/UI.md` § 8, and `e2e/keyboard-walk.spec.ts` performs exactly those steps — asserting `document.activeElement` after each key press, and never clicking anything |
| Responsive | `e2e/responsive.spec.ts` — the three §6 bands in one pass (1440 / 1024 / 390): the cell at three, two and one line; the drawer pushing, overlaying and becoming a sheet; the Filters sheet; chip wrapping; the reduced top bar; the sticky date column under sideways scroll; 40 px touch targets; no sideways overflow on any route; and "nothing animates" under `prefers-reduced-motion` |
| Screenshots | `docs/screenshots/v0.2/` — the matrix is **39 states → 152 PNGs** (4 pages × states × 2 viewports × 2 themes, grid also in zh), plus the per-feature detail folders (`chips` 48, `cell-drawer` 30, `ask-drawer` 42) and the frozen `before/` 52. `pnpm exec tsx scripts/screenshot-index.ts --check` fails on a missing or misnamed file and writes nothing; adding `--strict` also fails on a capture the matrix does not declare (the per-feature detail folders and the feature specs' own extra captures still make that non-zero, so `--strict` is not wired into CI yet — `BACKLOG.md`) |
| Visual regression | `e2e/visual.spec.ts` — 8 states × 3 projects = 24 `toHaveScreenshot` comparisons, clock readings masked, inert without `VISUAL=1`. **Linux baselines committed** in `e2e/__screenshots__/` (generated by CI run 34042101483; macOS rasterises differently, so they are never generated locally). The job compares on every run and stays non-blocking until five consecutive green runs. |
| No brand colours | `src/styles/tokens.test.ts` fails if an airline or program name appears in the token file; program names are text from `SOURCE_NAMES` everywhere else |
| Both languages complete | `src/lib/i18n/i18n.test.ts` — **569 keys in each dictionary**, identical key sets and placeholders; `copy-rules.test.ts` enforces `docs/COPY.md` § 1; `e2e/responsive.spec.ts` checks no English string leaks through in Chinese |

### 9.3 What is mocked in this phase

- **The demo dataset.** Every number on every screenshot comes from `fixtures/demo/` — a deterministic generator whose values are plausible and **invented** (`fixtures/demo/README.md` says so). The `DEMO=1` mock seats.aero serves it, and the seeded user's fake key selects the scenario (full dataset, empty, slow, one program not fetched, quota exhausted), so every page state is reachable with zero API calls. Nothing on a capture was fetched from seats.aero.
- **The Ask stream.** The e2e app runs with no `ANTHROPIC_API_KEY`, so the streaming UI could not otherwise be exercised or photographed. `src/app/api/ask/demo` replays a fixed, obviously synthetic SSE script framed exactly like `POST /api/ask`; it is gated by **both** `ASK_DEMO_STREAM=1` on the server and `?askdemo=1` on the page, reaches no model, and is off in every real deployment. Extra switches (`&askcap=1`, `&askerr=<code>`) produce the cap and failure states.
- **Telegram.** Mock transport as in v0.1; the capture of the linking state intercepts the one POST that would mint a deep link (the route needs a bot token), so no state is written.
- **Not mocked, and worth saying:** the parser, the grid pivot, the freshness module, the CSV export, the QR encoder, the quota accounting and every API route are the real ones. Only the upstream data and the model turn are fixtures.

### 9.4 Needs human action

- **Merge 6.6, then cut v0.2.0.** The sub-phase engineers may not touch `package.json` and may not run a git write
  command, so the last three steps of §10 are the orchestrator's. In order: open and squash-merge the 6.6 PR (before/after
  screenshot links and the §9 review checklist in the description) and put its number into § 9.1 where the table still
  says "this PR"; wait for `main` to go green; then
  `npm version 0.2.0 --no-git-tag-version` (or edit `"version"` by hand), commit, `git tag v0.2.0` and
  `gh release create v0.2.0 --generate-notes`. Until that bump lands the footer renders **v0.1.0** — it reads
  `package.json` rather than a literal, so nothing else needs editing, but the committed PNGs were captured before the
  bump and show the old string. Re-run `pnpm build && pnpm e2e -g screenshots && pnpm exec tsx scripts/screenshot-index.ts`
  after the bump (≈ 2 min, idempotent) so the matrix shows the released version.
- **Committed: the Linux `toHaveScreenshot` baselines.** Done in this phase — `e2e/__screenshots__/` carries the 24
  snapshots the CI runner generated (run 34042101483); the `visual` job now compares instead of generating. What is left
  for a human is only the promotion below.
- **Look at the screenshots.** Automation proves the states exist, are named correctly, are keyboard-reachable and pass axe; it cannot tell you the UI looks right. Run `pnpm build && pnpm e2e`, then `pnpm exec tsx scripts/screenshot-index.ts`, and read `docs/screenshots/v0.2/README.md` — both themes, both viewports, and the Chinese grid captures in particular (line breaks and truncation are what a lint cannot see).
- **Promote the `visual` job to required after five consecutive green runs.** It ships non-blocking on purpose (spec §11). Watch five `main` runs; if they are green, make the job required in the branch protection and record the five run ids in `DECISIONS.md` § 6.6. If it is flaky, fix the flake or narrow the baselined set — do not raise the tolerance.
- **Native-speaker pass on the Chinese copy.** `copy-rules.test.ts` enforces the mechanical half (full-width punctuation, no half-width comma against a Chinese character, no italics, one term per concept, no missing translation) and the glossary in `docs/COPY.md` § 2 fixes the vocabulary — but no test can judge whether 「保存为定时查询」 or 「seats.aero 于 2 小时前查看」 reads naturally to someone who speaks the language. Read `src/lib/i18n/dictionaries/zh.ts` end to end against the glossary, and check the zh captures for strings that overflow their control.
- **Try the grid on a real phone.** 390 × 844 is emulated in a desktop browser; momentum scrolling, the sticky column under a real touch scroll and the 40 px targets under a real thumb have never been checked on hardware (`BACKLOG.md`).

### 9.5 §1.2 self-check

Checked against the spec's list of generic-template tells before this PR: no cream + serif + terracotta and no near-black + acid accent (neutrals are strictly achromatic, `#FFFFFF` / `#111111`); no hairline "broadsheet" zero-radius everywhere (three radii by role — 4 px controls, 6 px surfaces, 0 only for the grid, which is a table); no SaaS card kit (no cards, no shadows anywhere, borders only between different kinds of information); no tracked-out ALL-CAPS eyebrows (the `DET`/`LLM`/`required` badges are gone, provenance is one sentence-case word); no middle-dot meta strings (the copy lint fails on `" · "`); no "WORD — fragment" labels (the lint fails on `—` in en and `——` in zh); no tinted near-black standing in for black; no `→` appended to a control label (the arrow appears only as route data in a column header); no 01/02/03 markers; no accented word in a heading (and the accent is never a fill at all) — **pass**.
