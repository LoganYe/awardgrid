# UI/UX v1 — plan paths vs this repository

Mapped read-only on 2026-09-23 at `9c69c6c` (branch `uiux/quiet-precision-v1`). "Exists" means the file or an equivalent is already in the repo; "new" means this work creates it. Where the plan named a path that does not exist, the right-hand column says what is used instead and why.

## Toolchain and commands

| Plan says | Here | Note |
|---|---|---|
| `pnpm …` | `export PATH="$HOME/.local/node-arm64/bin:$PATH"` first, then `pnpm …` | Default non-interactive `node` is x64 under Rosetta; `node_modules` is arm64. pnpm 12.3.4 via corepack. |
| where to work | worktree `/Users/yegaoyang/Desktop/workspace/awardgrid-uiux` | The main checkout stays on `main`: production runs from it and reads `drizzle/`, `LEGAL.md`, `build/plugin` at runtime (DECISIONS U-009). |
| `pnpm build`, `pnpm e2e` (web) | **Only in a separate git worktree** | The main checkout's `.next` is served by the production LaunchAgent on :3000 (`DECISIONS.md` #67). See `DECISIONS.md` U-003. |
| `pnpm exec playwright test --config=playwright.uiux.config.ts` | same (new file) | The existing `playwright.config.ts` now ignores `e2e/uiux/**` so the web suite does not pick these specs up. |
| core tests | `pnpm --filter @awardgrid/core exec vitest run <file>` | Existing `packages/core/**/*.test.ts` files are never edited (Phase 1 rule); only new test files are added. |

## Shared core (`packages/core`)

| Plan path | Status | Actual path / approach |
|---|---|---|
| `src/lib/query/schema.ts` (QueryObject, MAX_SPAN_DAYS=92, J/F default, min_cabin_pct=100) | exists | Same. `CABIN_ORDER` (J,F,W,Y) lives here, not in grid/types. `ISODate` accepts rolled-over dates (`2026-02-30`), so strict Gregorian checks are added in the new workspace layer, not by changing the schema. |
| `src/lib/seatsaero/` (planner, cache, quota, trips) | exists | `find.ts` `runFind`/`planFind`, `cache.ts` (`CoverageRecord`, `InMemoryAvailabilityCache`, `CACHE_SNAPSHOT_VERSION=1`), `quota.ts`, `trips.ts` (`runGetTrips`, `TripSummary`, `GetTripsResult`), `normalize.ts`, `not-fetched.ts`. `trips` and `not-fetched` are not in the barrel; import by subpath. |
| `src/lib/grid/` (rows, pivot, time, deeplinks) | exists | `types.ts` (`AvailabilityRow`, `CellStatus`, `GridMeta`), `pivot.ts`, `freshness.ts`, `format.ts`, `ranking.ts`, `aria.ts`, `keyboard.ts`, `deeplinks/`. `resolveDeeplink` does **no** scheme/host validation; the existing validator is `ask/markdown.ts askLinkHref`. |
| `src/lib/ask/`, `src/lib/watch/` | exist | Ask tool loop (`loop.ts`, `tools.ts`, `prompt.ts`, `limits.ts`); watch `diff.ts`, `watch.ts` (`Watch` stores raw `text`). No scope gate or proposal concept exists. |
| `src/lib/i18n/` | exists | en/zh dictionaries (≈600 keys each), `copy-rules.test.ts` (no `→`, ` · `, em dash, "please" in values). The iOS shell does not use it yet. |
| `src/lib/workspace/*` (types, semantics, identity, coverage, query-editor, projection, selection, proposals, watch-migration, watch-capabilities) | **new** | New directory; `package.json` gets a `./workspace/*` export. |
| `test/fixtures/uiux/` | **new** | Synthetic JSON copied verbatim from the handoff pack (`scenarios`, `availability-rows`, `query-cases`, `acceptance-cases`, `copy.zh-en`) plus `factory.ts` (T02). Must use relative imports (iOS vitest has no `@` alias). |

## iOS shell (`apps/ios`)

| Plan path | Status | Actual path / approach |
|---|---|---|
| `src/search/search.ts` | exists | `SearchEngine.search(text, key)` → `ApiResult<FindValue>`; deterministic parse only (no LLM). T05 adds `searchQuery(query, key)` on the same private executor. |
| `src/search/last-search.ts` | exists | In-memory only, deliberately never persisted (pinned by a test). The versioned workspace store is a new namespace beside it. |
| `src/app/App.tsx`, `bootstrap.ts` | exist | Hash router, top text nav (no tab bar), `BootstrapOptions` seams (`keys`, `snapshots`, `now`, `fetchImpl`, `anthropicKeys`, `anthropicFetch`, `visibility`). T01 adds optional `bootstrapOptions`/`onReady` props to `App` and an optional `assertNative` to `BootstrapOptions` so a test host can pass fakes; `main.tsx` is unchanged. |
| `src/screens/` | exist | `SearchScreen`, `AskScreen`, `WatchesScreen`, `SettingsScreen`. |
| `src/components/GridTable.tsx` | exists | Uses `fetched_at` (local time) for freshness; replaced by the new result views. |
| `src/components/ui/` | **new** | No React primitives exist today (CSS classes `.ag-button`, `.ag-input`… only). |
| `src/native/` | exists | `http.ts` (`createNativeFetch`, per-request `assertNativeHttpAvailable`), `keychain.ts` (`KeyStore`, `MemoryKeyStore`), `anthropic-key.ts`, `webview-fetch-guard.ts`. Unchanged boundaries. |
| `src/store/` | exists | `persistence.ts` (`FileStore`, `MemoryFileStore`, `SnapshotStore`; writes are not atomic), `quota-store.ts`, `watch-store.ts` (version mismatch discards), `ask-store.ts`. |
| `src/workspace/` | **new** | Workspace store, detail service, request coordinator. |
| `src/watch/capabilities.ts` | exists | `WATCH_CHECKS {onOpen:true, inBackground:false}` — the plan's `WatchCapabilities` maps onto it (T14/T20). |
| `scripts/uiux-fixture-host.ts` | **mapped** | `apps/ios/fixture-host/` (test-only Vite root) + `apps/ios/vite.fixture.config.ts`, served on 127.0.0.1:4310 by `playwright.uiux.config.ts`. Kept inside `apps/ios` because it mounts the real `App` with fake ports, and Vite is an `apps/ios` dependency, not a root one. Never imported by `src/main.tsx`; the production build is checked for its markers. |

## Tokens and styles

| Plan path | Status | Actual path / approach |
|---|---|---|
| `packages/tokens/tokens.css` | exists, **pinned** | Exact hex values, key set and block shape are asserted by `src/styles/tokens.test.ts` and by 24 blocking Linux visual baselines. Not changed in M1. |
| `packages/tokens/surfaces.css` | exists | Unchanged. |
| Quiet Precision tokens (`--ag-*`) | **new** | `packages/tokens/precision.css` (new export), all three blocks (`:root`, `[data-theme="dark"]`, system dark). `--ag-*` names avoid the existing local layout variables `--ag-row-h`, `--ag-rowhead-w`, `--ag-col-w`, `--ag-drawer-width`, `--ag-drawer-push`. See `DECISIONS.md` U-004. |
| `apps/ios/src/styles.css` | exists | Imports `precision.css` from T04 on. |
| `src/styles/` | exists (test only) | Web CSS is `src/app/globals.css` and component CSS files; web adoption is T19. |

## Web (`src/`)

| Plan path | Status | Actual path / approach |
|---|---|---|
| `src/app/` | exists | Pages `/`, `/grid`, `/login`, `/register`, `/settings`, `/queries` (web "watches"), `/legal`. Ask is a drawer inside `/grid`. |
| `src/components/grid/` | exists | Matrix only (no list/calendar), roving grid keyboard, virtualization, drawers (single slot: cell or ask). |
| `src/components/workspace/` | **new** (T19) | |
| `src/lib/db/` | exists | Drizzle schema + SQLite stores. T02 adds migration `0003_availability_time_basis.sql` (nullable `availability_cache.time_evidence`). |
| `src/lib/server/` | exists | `find.ts` (`findGridForUser`, `getTripsForUser`, `parseForUser` — the latter calls the LLM when deterministic parsing misses fields and a server key is set), `queries.ts`. |
| Web scheduling | exists | `src/lib/scheduler/*`, `src/cli/worker*.ts`, `src/lib/notify/*` (Telegram). No capability module; env booleans only. |
| Web AI | exists, different engine | Claude Agent SDK subprocess (`src/lib/ask/`), not `@awardgrid/core/ask`. |

## Tests and evidence

| Plan path | Status | Actual path / approach |
|---|---|---|
| `playwright.uiux.config.ts`, `e2e/uiux/*` | **new** | Separate config; fixture host on :4310 (does not collide with :3000 prod, :3400/:3999 web e2e, :4597/:4599 Simulator probes). |
| `e2e/*` (web) | exists | 15 specs; `pnpm e2e` rewrites tracked `docs/screenshots/v0.2/**` and `axe-summary.json`. |
| iOS unit tests | exist | vitest, node environment, no DOM library; screens are tested with `renderToStaticMarkup`. |
| iOS Simulator | exists | `apps/ios/probes/run-probes.sh [--e2e]` with mock seats.aero :4597 and probe server :4599; the booted iPhone 17 Pro holds the owner's real keys, so only the `VITE_AG_PROBES=e2e` build (memory key stores) is used there. |
| `docs/uiux-v1/evidence/` | new | Redacted summaries tracked; raw logs in `evidence/raw/` (git-ignored). |
