# FINAL REPORT — awardgrid v0.1.0

> Written during the unattended run (Phases 0–5, 2026-09-05/06). §1 is the precondition check as found; §2–§8 reflect the tree at v0.1.0.

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

Each item is the exact command or step; run the commands from the repo root with
`export PATH="$HOME/.local/node-arm64/bin:$PATH"` (this Mac's arm64 Node 22).

- **Merge Phase 5** (the branch `phase-5-ship` holds README/FINAL_REPORT/DECISIONS/BACKLOG/ci.yml/next.config.ts edits plus the untracked `Dockerfile`, `docker-compose.yml`, `.dockerignore`; git writes were not permitted to the agents):
  `git add -A && git commit -m "feat(phase-5): ship — README, Docker Compose, CI docker smoke + bundle key scan, FINAL_REPORT" && git push -u origin phase-5-ship && gh pr create --fill && gh pr checks --watch`
  — wait for all four jobs (`typecheck · lint · test`, `gitleaks`, `docker smoke`, and the new build + bundle-scan step) — then `gh pr merge --squash --delete-branch` and confirm `gh run list --branch main --limit 1` is green. (Use the `feat(phase-5): …` title: PR #7 was squash-merged as `Phase 2: web app — …` without a conventional-commit type and `main` is not rewritten.)
- **Tag and release** (Definition of done): `git checkout main && git pull && git tag v0.1.0 && git push origin v0.1.0 && gh release create v0.1.0 --generate-notes`.
- **Open one GitHub issue per deferred item** (kickoff Phase 5; `gh issue list --state all` is empty). Suggested titles, one `gh issue create --title "<title>" --body "See BACKLOG.md / FINAL_REPORT.md §4"` each:
  `Docker local smoke: docker compose build/up never run on a dev machine` · `Live Ask smoke with a real ANTHROPIC_API_KEY (refresh test/fixtures/ask/smoke-result.json)` · `Record real seats.aero fixtures with a Pro key (≤ 40 calls): ComputedLastSeen, TotalDuration unit, Bulk envelope, quota reset` · `Deeplinks for non-AA programs` · `cpp_desc sort (needs Duffel cash reference)` · `Release-window standing-query mode` · `min_cabin_pct as an advanced setting` · `Revisit node:sqlite driver when drizzle-orm 1.0 is latest`.

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

- **CI on `main`**: green **since PR #5** (`3fd0f08`, run `33985339756`) through PR #9 (`af51e39`, run `34001665198`, both
  jobs incl. gitleaks). The very first push (`4dea592` "chore: repo skeleton", run `33981541466`) is recorded as a
  **failure** (pre-Phase-0 skeleton before the workflow was hardened) — so "green since #5", not "always green".
- **Conventional commits**: PRs #5, #6, #8, #9 are `docs(phase-0)` / `feat(phase-N)`; **PR #7** was squash-merged as
  `Phase 2: web app — auth, encrypted keys, grid page, settings (#7)` with no type prefix. `main` is not rewritten;
  the Phase 5 PR uses `feat(phase-5): ship — …` (§4).
- **Squash-merge PRs**: #5 (Phase 0), #6 (Phase 1), #7 (Phase 2), #8 (Phase 3), #9 (Phase 4); Phase 5 is the pending PR in §4.
- **Secrets**: gitleaks passed on every `main` run since #5; no `.env*` or SQLite file has ever been tracked (CI step +
  `git ls-files` check); the only Anthropic credential seen was never written to disk or printed.
