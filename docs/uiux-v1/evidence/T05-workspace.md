# T05 · Versioned workspace and one structured search entry — evidence

Scope verified: **unit + integration (bootstrap with fake transports) + iOS browser mock** (Chromium, fixture host on 127.0.0.1:4310). Not run: iOS Simulator, physical device, live seats.aero (not authorised). Worktree `/Users/yegaoyang/Desktop/workspace/awardgrid-uiux`.

## What was built

- `apps/ios/src/workspace/workspace-store.ts` — `WorkspaceStore({search, now, storage?, limits?})`:
  - `run(query, meta?)` takes the next revision and id `run-<revision>`, aborts the previous run's signal, refuses an invalid QueryObject (schema, or a date not on the calendar) as `invalid_query` before the port is called, and resolves to how THIS run ended (`published` / `failed` / `superseded`). Only the run still current may publish; a snapshot stamped with another revision is refused (`invalid_snapshot`). A failure changes the run state only; the shown snapshot keeps its own query and rows.
  - `showSnapshot(id)` and `setPreferences(patch)` change local state only; `history()` keeps at most 10 snapshots and under 5 MiB of snapshot JSON (UTF-8 bytes; the file's wrapper adds a few hundred bytes, the A/B slots double it on disk), dropping the oldest that is neither shown nor previous, then the previous one; the shown snapshot always stays (docs/02 D04). `wasRestored(id)` says whether a snapshot came back from disk.
  - `persist()` writes namespace `workspace-v1` only, and only when something saved changed; never throws; a failed write is reported and the last good file stays. `restore()` runs nothing, drops damaged snapshots individually (including a creation time that is not a real instant), re-derives coverage with `restoreCoverage` (a saved "complete" can only stay complete if its slices prove it), and continues the revision count.
  - `getState`/`subscribe` are bound, for `useSyncExternalStore`.
- `packages/core/src/lib/workspace/types.ts` — `SearchRun` (additive: optional `signal` and `meta` on the run handle).
- `apps/ios/src/workspace/search-port.ts` — the production `SearchPort`: runs through `SearchEngine.searchQuery` one at a time, skips a queued run whose signal was aborted before sending anything, reads the key when the run starts, hands each answer to `onAnswer` before the workspace can publish it, maps an engine failure to `SearchRunError(code)`, and builds the snapshot (`snapshotFromFind`: row keys from the query's scope, one per identity, time evidence per row; coverage unknown when it is missing, for another scope, or comes without rows). The engine's full answer is kept once for the caller (`takeResult`).
- `apps/ios/src/workspace/slot-storage.ts` — `SlotFileStorage` (U-018).
- `apps/ios/src/workspace/snapshot-view.ts` — the screen's view of a restored snapshot (U-017): an empty cell reads "no availability" only where a complete slice proves it; not monitored and not checked (partial, no evidence, or unproven coverage) say so; the call count is unknown (null).
- `apps/ios/src/search/search.ts` — `parseText` (key check + deterministic parse, sends nothing), `searchQuery(query, key)` (validates, then the shared executor), `search(text, key)` = `parseText` + the same executor. `FindValue` gains optional `rows` and `coverage`.
- `apps/ios/src/search/last-search.ts` — `SearchView`, `createWorkspaceLastSearch` (U-017).
- `apps/ios/src/app/bootstrap.ts` — `workspace` (restored at launch, nothing sent), `searchText(text)` (the typed text travels with the run as `meta`, and the answer is recorded for the screen and Ask before the workspace shows it), `lastSearch` over the workspace, `lastWorkspaceSave()`, `now()` (the app clock), workspace saved by `persist()`.
- `apps/ios/src/screens/SearchScreen.tsx` — follows the workspace: the run labels and Run's availability come from the workspace's run state (the same after leaving for Ask and coming back); the text box follows the shown snapshot unless edited; results whose query differs from the box say "Results for “…”"; Watch watches the shown search; a restored snapshot shows "Saved on this device <age>" by the app clock (U-019).
- `apps/ios/src/components/GridTable.tsx` — `saved` variant of the all-empty message ("…had nothing cached…" when fetched, not "right now").
- Fixture host: `inflight-old` and `failed-old` seeded (a workspace saved by an earlier launch + a stand-in that holds or fails a new search). The three coverage scenarios are now attributed to T07, where coverage is first shown (their refusal test updated).

## Test-first record

| Step | Command | Result |
|---|---|---|
| Red | `pnpm --filter @awardgrid/ios exec vitest run src/workspace/workspace-store.test.ts` | exit 1 — `Cannot find module './workspace-store'` (`evidence/raw/t05-red.log`) |
| Green | same | 19 → 23 passed as cases were added (outcome per run, no write when unchanged, retry after a failed write) |
| Engine | `vitest run src/search/search-query.test.ts` | 6 passed; one first failure was the test's own grid comparison (buildGrid stamps `generated_at` from the wall clock) |
| Bootstrap | `vitest run src/app/bootstrap-workspace.test.ts` | 6 passed |
| Existing test | `bootstrap-ask.test.ts` "keeps the last search in memory only…" | failed as expected once the contract changed; rewritten to the new contract (U-017) |
| Harness | `e2e/uiux/fixture-harness.spec.ts` storage test | failed once: the workspace wrote a file on a launch where nothing changed → persist now skips unchanged saves |
| Browser | `e2e/uiux/workspace.spec.ts` | 4 passed |
| Review | 3 lenses (run state, persistence, screen + test validity), each finding verified by an independent refuter | 16 findings: 11 confirmed (3 rated major — two lenses found the first one independently — and 8 minor, some overlapping), 5 refuted. Major: the screen's labels, Run button and text box lived in component state, so leaving mid-search lost them and a run published while away put new results under old text; a search from this session was briefly labelled "Saved on this device" because its entry was recorded after the snapshot was shown. Minor: superseded queued runs still spent calls; a bad saved `createdAt` crashed the screen on launch; the size limit did not bound shown + previous; the restored view carried the old call count; unproven restored coverage read as "none"; Watch watched the failed text; the saved age used the wall clock. Refuted (out of T05 scope, recorded below): Clear cached results leaves workspace files; a failed save is not shown yet; rollback deletes snapshots an older build cannot read; slot generation overflow; the browser tests reuse the saved query's text |
| After review fixes | ios unit + browser | workspace-store 26, search-port 8, slot-storage 7, snapshot-view 5, search-query 6, bootstrap-workspace 7, search-screen 3; `workspace.spec.ts` 4 with the leave-and-return, no-label-after-success, "Results for", Watch and dated-saved cases |

## Gates

| Command | Exit | Result |
|---|---|---|
| `pnpm typecheck` | 0 | |
| `pnpm lint` | 0 | the pre-existing warning only |
| `pnpm test` | 0 | root 919 passed / 2 skipped · core 799 · ios 33 files, 655 passed · one existing iOS test rewritten to the new contract (U-017), no core test edited |
| `pnpm --filter @awardgrid/ios build` | 0 | fixture-free bundle check passes |
| `pnpm build:landing` | 0 | |
| `pnpm build` (worktree `.next`) | 0 | main checkout's `.next/BUILD_ID` unchanged (Sep 23 19:13) |
| `pnpm exec playwright test --config=playwright.uiux.config.ts` | 0 | 39 passed (harness 10, foundations 25, workspace 4) |

Raw logs: `evidence/raw/t05-red.log`, `t05-gates.log`, `t05-evidence-run.log` (git-ignored).

## Screens (looked at)

| File | What it shows |
|---|---|
| `screens/t05-failed-old.png` | a failed new search: the failure, "Showing previous results; the new search failed.", "Results for “…”" naming the shown query, "Saved on this device 2 h ago", the previous grid; today's calls count the failed request (1 of 950) |
| `screens/t05-inflight-old.png` | a search in flight: Run disabled as "Searching…", "Searching; previous results remain available.", the previous grid |

## Known, left to later tasks (from the review, refuted as T05 defects)

- "Clear cached results" empties the availability cache only; saved workspace snapshots (rows and queries) stay until the user clears them. The Settings copy says only that cached results are cleared. → T11 (settings copy) / T13 (clearing saved results).
- A failed workspace save is recorded (`lastWorkspaceSave()`) but not yet shown. → T13 (recoverable persistence).
- A snapshot an older build cannot read is dropped at its first save after a rollback. → T22 (migration rollback).

## Acceptance

- A08 — late response cannot overwrite a newer revision (unit: `workspace-store.test.ts` "late response cannot replace a newer run", "a late failure of an older run…", "each caller learns how its own run ended"); a failed run keeps the labelled old query and data (unit: "a failed new run keeps the old snapshot and its query…"; integration: `bootstrap-workspace.test.ts`; browser: `workspace.spec.ts` failed-old and inflight-old).
- A09 — `search(text,key)` and `searchQuery(query,key)` share executor, quota and cache (unit: `search-query.test.ts` — the second entry is a cache hit with zero requests and no quota spent, both directions); no Anthropic request (every URL is `https://seats.aero/`; browser `anthropic: 0`).

## Not verified here

- iOS Simulator / device: restore at launch through Capacitor Filesystem, and the slot files on a real disk.
- Live seats.aero: not authorised.
