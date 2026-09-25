# T02 · Stable identity, source time, missing values — evidence

Scope verified: **unit** (vitest, core + root). Component-level rendering of these values (A02/A03 "component" half) is verified when the result cards use them (T07). Run in the worktree `/Users/yegaoyang/Desktop/workspace/awardgrid-uiux` (DECISIONS U-009), arm64 Node 22.23.2.

## What was built

- `packages/core/src/lib/workspace/types.ts` — every docs/03 contract type in one place (time evidence, coverage, snapshot, run state, ports, detail, AI context/proposal, watch capabilities, favourites).
- `packages/core/src/lib/workspace/semantics.ts`
  - `knownSeats` (safe positive integers only; 0 = not provided), `knownCurrency` (three ASCII letters, checked before case-folding), `knownFees` / `feesState` (`known` · `currency_missing` · `unknown`; explicit 0 kept, `-0` normalised).
  - `parseInstant` / `isRealDate`: field-by-field, arithmetic leap years, zone required, pre-1970 rejected (a backend zero time is "no time").
  - `toTimeEvidence`: ComputedLastSeen → UpdatedAt → local fetch → unknown; a time more than 60 s ahead of the device clock is dropped, never "just now". `ageMs` never negative.
  - `rowTimeEvidence`: reads what the row recorded at decode; a row with no recorded provenance is `unknown` (docs/03), distinct from `local_fallback` (provider sent no time).
- `packages/core/src/lib/workspace/identity.ts` — `scopeKey` (sorted/de-duplicated sets, encoded, programs `[]` ≡ all, `min_cabin_pct` absent ≡ 100, `max_miles` kept conservatively; excludes sort/text/language), `rowKey` (scope digest + every component encoded, so no value can forge a boundary).
- Decode path (`seatsaero/normalize.ts`): additive `time_basis` and `provider_updated_at` on `AvailabilityRow`; `computed_last_seen` unchanged for old consumers.
- Web SQLite cache: migration `drizzle/0003_availability_time_basis.sql` adds one nullable `time_evidence` text column (JSON `{basis, updated, at}`), read back only while `at` equals the row's `fetched_at` (rollback-safe).
- `packages/core/test/fixtures/uiux/factory.ts` — `fixtureSnapshot` (rows, keys, coverage all derived from the final query) and `fixturePrefs`.
- `packages/core/package.json` exports `./workspace/*`.

## Test-first record

| Step | Command | Result |
|---|---|---|
| Red | `pnpm --filter @awardgrid/core exec vitest run src/lib/workspace/` | exit 1 — modules not found (valid red: new modules) |
| Green 1 | same | exit 0 — 61, then 64 with the factory test |
| Full suite | `pnpm test` | exit 1 — root `src/lib/db/stores/find.test.ts` "cache hit equals fresh fetch": the web SQLite cache dropped `time_basis`. Fixed with migration 0003 |
| Worktree move | — | work moved out of the production checkout (U-009); worktree suites first showed 17 extra skips (vendor submodule + `build/plugin` absent) → populated from the pinned submodule commit and `pnpm build:plugin`; skips back to the baseline 2 |
| Independent review | 2 reviewers (semantics; data/migration) | 2 major + 11 minor, all with runnable probes: UpdatedAt lost behind an unusable ComputedLastSeen; legacy rows reported as local_fallback instead of unknown; `~`/airport-pair key collisions; years 0–99 read as 1900s; `-0` fees; unsafe integers; non-ASCII currency folding; no age helper; factory overrides inconsistent; rollback could leave a stale label. All fixed and each turned into a regression test |
| After fixes | `pnpm --filter @awardgrid/core exec vitest run src/lib/workspace/` | exit 0 — **84 passed** |
| Migration drift | `drizzle-kit generate` against a copy (`build/dk-check`) | "No schema changes, nothing to migrate" |

## Gates after T02

| Command | Exit | Result |
|---|---|---|
| `pnpm typecheck` | 0 | |
| `pnpm lint` | 0 | 0 errors, the 1 pre-existing warning |
| `pnpm test` | 0 | root 823 passed / 2 skipped (baseline 818/2; +5 new) · core 753 (669 + 84 new) · ios 577. No existing test file edited (`git diff 9c69c6c --name-status -- '*.test.ts'` shows additions only) |
| `pnpm --filter @awardgrid/ios build` | 0 | fixture-free bundle check passes |
| `pnpm exec playwright test --config=playwright.uiux.config.ts` | 0 | 10 passed (decode change does not disturb the harness) |

## Compatibility checked (from the data/migration review)

- `watch/diff.ts` `snapshot()`/`cellsHash` and `serializeSnapshot`: byte-identical with and without the new keys, so web `query_runs.cells_hash` is unaffected.
- CSV export, Ask tool payloads (positional), web grid state: read fields by name; unaffected. The CLI `--json` grid output now carries the two additive keys.
- iOS `cache.json`: restore spreads rows, so the keys survive; older snapshots read back with no provenance (`unknown`). `CACHE_SNAPSHOT_VERSION` stays 1 (additive).
- Old code on a migrated database: its migrator is a no-op and its explicit column lists ignore the new column; after a roll-forward, a row it rewrote reads back with no provenance rather than a stale one (test "ignores provenance written for a different fetch").

## Corrections (T22 evidence audit, 2026-09-24)

An audit of this record against its raw logs and git (evidence T22) found the following. The text above is left as written.
- The red and first green runs (`raw/T02/red.log`, `green-1.log`, `green-2.log`) ran in the main checkout's `packages/core` (vitest only), not in the worktree as this doc says. The later gates ran in the worktree. The commits are `7c093f5` (work in progress) and `a553b5d`.
- No log is kept for the failing full-suite run or for the "84 passed" directory run, and the `drizzle-kit generate` drift check has no exit code recorded.
