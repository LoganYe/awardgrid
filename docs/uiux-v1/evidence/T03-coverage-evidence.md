# T03 · Coverage evidence through cache and versioning — evidence

Scope verified: **unit + store integration** (vitest: core in-memory store, root SQLite store, `runFind` end to end with fake transports). No UI in this task; coverage is first shown by the result views (T07/T08). Worktree `/Users/yegaoyang/Desktop/workspace/awardgrid-uiux`.

## What was built

- `packages/core/src/lib/workspace/coverage.ts`
  - `runEvidence(outcomes, {quotaBound})`: a run is `complete/exhausted` only if every planned request ran to its end; page-cap stop → `partial/page_cap`; a stop set by the day's remaining quota or a skipped request → `partial/quota`; an empty page that still said `hasMore` → `partial/upstream_error`.
  - `recordEvidence(records, pair, scope, ttl, now)`: on a cache hit, the newest record that satisfies the lookup AND proves completeness is the candidate; it stands only if no overlapping record written after it (same pair and row scope; intersecting dates, cabins, programs; `direct_only` either way) failed to prove completeness. Otherwise partial, or unknown for evidence-less records.
  - `coverageFor(query, pairs)`: one slice per pair; `unmonitored` when the provider's catalog proves it.
  - `parseScopeKey`, `restoreCoverage(input, expectedScope)`: persisted evidence is re-derived, never trusted; "complete" only if slices prove every pair × day × cabin × program of a readable scope; a stored partial/unknown is never upgraded. (Its production caller is the workspace snapshot store, T05.)
- `seatsaero/find.ts`: `FindResult.coverage` on both the fetch and the cache-hit path; coverage records carry `evidence`; the scope replace uses the store's atomic `replaceScope` when present.
- `seatsaero/client.ts`: `PagedResult.incomplete` (additive) for an empty page with `hasMore`.
- `seatsaero/cache.ts`: `CoverageRecord.evidence` (additive), `AvailabilityCacheStore.replaceScope?` (optional), `InMemoryAvailabilityCache.replaceScope`; snapshot `restore()` drops damaged rows/records individually instead of throwing (a single bad row used to stop the iOS app launching), rejects records with non-calendar dates or non-instant fetch times, and strips malformed evidence.
- Web SQLite: migration `drizzle/0004_coverage_evidence.sql` adds nullable `cache_coverage.evidence` (JSON tied to the cell's `fetched_at`); `replaceScope` runs delete + put + mark in one transaction; an older fetch that finishes after a newer one clears the cells' evidence unless it was itself complete; folding is unchanged (a rectangle carries its weakest cell's evidence).

## Test-first record

| Step | Command | Result |
|---|---|---|
| Red | `pnpm --filter @awardgrid/core exec vitest run src/lib/workspace/coverage.test.ts` | exit 1 — `./coverage` not found |
| Green 1 | same | 32 passed; full suite then failed 4 pinned `cache-snapshot` tests (my first restore check required fields the snapshot contract does not) → check narrowed to what restore needs |
| Web store | `pnpm exec vitest run src/lib/db/stores/` | evidence persisted with migration 0004 |
| Independent review | 2 reviewers (soundness; compatibility) | 1 blocker, 3 major, 6 minor, all reproduced by scripts: an older complete record outranked a newer overlapping capped fetch that had replaced its rows (4 scenarios, both stores); an older-started capped run finishing last (race); a save failure between delete and mark; empty-page `hasMore` read as exhausted; quota stop labelled page cap; junk dates restored; folding by evidence changed cache-hit decisions; missing 429 / save-failure tests |
| After fixes | core + root suites | a pinned Ask test (spies `deleteRows`) failed once because the in-memory `replaceScope` bypassed the public method → it now calls the three public methods back to back |

## Gates after T03

| Command | Exit | Result |
|---|---|---|
| `pnpm typecheck` | 0 | |
| `pnpm lint` | 0 | 0 errors, the pre-existing warning |
| `pnpm test` | 0 | root 836 passed / 2 skipped (+13 new) · core 799 (+46 new) · ios 577 · no existing test file edited |
| `pnpm --filter @awardgrid/ios build` | 0 | fixture-free bundle check passes |
| `pnpm exec playwright test --config=playwright.uiux.config.ts` | 0 | 10 passed |
| `drizzle-kit generate` against a copy | — | "No schema changes" (0003 + 0004 match the schema) |

Scenarios covered by tests: complete fetch and its cache hit; page cap on fetch and on hit; complete-empty vs unmonitored; legacy records → unknown; broader record reuse (complete and capped); S1–S4 overlapping later capped fetches (wider dates, more origins, all-programs vs one program, direct-only) on both stores; a later complete fetch superseding a partial; the race; a later evidence-less writer → unknown; 429 and 500 fail before any write; quota-bound stop; empty page with `hasMore`; save failure rolled back by the SQLite transaction; damaged snapshot entries and junk dates dropped.
