# UI/UX v1 execution status

State: **M3 in progress**. T01–T16 are verified (unit, integration, iOS browser mock). A21 is partial: a question's steps, endings, failures and meta line on the Ask page stay English (marked) until T17. Simulator, device and live-key checks have not been run. T17 is next.
Handoff pack: `/Users/yegaoyang/Desktop/workspace/awardgrid-claude-code-impl` (read in the order its `CLAUDE_CODE_PROMPT.md` sets).
Repository: `/Users/yegaoyang/Desktop/workspace/awardgrid`. Work happens in the worktree **`/Users/yegaoyang/Desktop/workspace/awardgrid-uiux`** on local branch `uiux/quiet-precision-v1` (from `main` at `9c69c6c`); the main checkout stays on `main` because production runs from it (DECISIONS U-009).
Design baseline: `2a1f353` is an ancestor of `9c69c6c`; the 4 commits after it are seats.aero decoding fixes, an Ask token-count fix and a docs entry. Nothing was reset or checked out.
Working tree at start: clean (`git status` showed nothing to commit), so no user changes needed protecting.
Authorization: local implementation and per-task local commits only. No push, PR, deploy, or live seats.aero / Anthropic request.

## Status values

`pending` · `in_progress` · `implemented_unverified` · `verified` · `blocked` (docs/07 definitions).

## Milestones

| Milestone | State | Evidence |
|---|---|---|
| M1 truthful foundations (T01–T05) | verified (unit + integration + iOS browser mock); Simulator/device unverified | [baseline](evidence/T01-baseline.md), [T01](evidence/T01-fixture-harness.md), [T02](evidence/T02-truth-identity.md), [T03](evidence/T03-coverage-evidence.md), [T04](evidence/T04-tokens-primitives.md), [T05](evidence/T05-workspace.md) |
| M2 iOS search flow (T06–T11) | verified (unit + iOS browser mock); Simulator/device unverified; A21 partial (Ask chrome English until T15–T17) | [T06](evidence/T06-query-editor.md), [T07](evidence/T07-mobile-results.md), [T08](evidence/T08-projection-views.md), [T09](evidence/T09-matrix.md), [T10](evidence/T10-details.md), [T11](evidence/T11-settings-onboarding.md) |
| M3 context and persistence (T12–T17) | in_progress | [T12](evidence/T12-selection-compare.md), [T13](evidence/T13-favorites.md), [T14](evidence/T14-watches.md), [T15](evidence/T15-ai-context.md), [T16](evidence/T16-proposals.md) |
| M4 Web and release validation (T18–T22) | pending | — |

## Tasks

| Task | Title | State | Evidence / notes |
|---|---|---|---|
| T01 | Read-only baseline, evidence dir, isolated fixture harness | verified (browser mock + bundle) | [evidence](evidence/T01-fixture-harness.md); A01 verified |
| T02 | Stable identity, source time, missing values | verified (unit) | [evidence](evidence/T02-truth-identity.md); A04 verified; A02/A03 unit-verified, component half with T07 |
| T03 | Coverage evidence through cache and versioning | verified (unit + store integration) | [evidence](evidence/T03-coverage-evidence.md); A05 verified; `restoreCoverage` gets its production caller in T05 |
| T04 | Shared tokens and primitives, light/dark | verified (unit + iOS browser mock) | [evidence](evidence/T04-tokens-primitives.md); A06, A07 verified in those scopes; Simulator/device rendering, Dynamic Type and VoiceOver unverified |
| T05 | Versioned workspace and shared structured query entry | verified (unit + integration + iOS browser mock) | [evidence](evidence/T05-workspace.md); A08, A09 verified in those scopes |
| T06 | Query editor, date rules, explicit submit | verified (unit + iOS browser mock) | [evidence](evidence/T06-query-editor.md); A10, A11 verified in those scopes; Simulator/device (date picker, keyboard) unverified |
| T07 | Mobile nav, query summary, readable result cards | verified (unit + iOS browser mock) | [evidence](evidence/T07-mobile-results.md); A12 verified in that scope, A02/A03 component half verified; Simulator/device (safe areas, Dynamic Type, VoiceOver) unverified |
| T08 | Same-snapshot projection: list and calendar | verified (unit + iOS browser mock) | [evidence](evidence/T08-projection-views.md); A13, A14 verified in those scopes; Simulator/device (native sort picker, VoiceOver on the calendar, system Dynamic Type) unverified; no iOS local-filter control (U-032) |
| T09 | Pro matrix: column snapping, per-cabin, keyboard | verified (unit + iOS browser mock) | [evidence](evidence/T09-matrix.md); A15, A16 verified in those scopes; Simulator/device (WebKit touch snap, VoiceOver on the grid) unverified; Enter opens the cell's options until T10 |
| T10 | Plain itinerary details and return state | verified (unit + iOS browser mock) | [evidence](evidence/T10-details.md); A17, A18, A19 verified in those scopes; native Get Trips, Safari hand-off, clipboard and VoiceOver on a device unverified; live Get Trips not run (spends a call) |
| T11 | Settings, onboarding, bilingual, keyboard | verified (unit + iOS browser mock) | [evidence](evidence/T11-settings-onboarding.md). A20 is verified in those scopes; the real keyboard, the Keychain, the clipboard and VoiceOver on a device are unverified. A21 is partial: Ask's chrome is English (marked) until T15–T17 (U-039). The status bar under a chosen theme is a native gap (U-042 → T21). No live key check was run (it spends a call) |
| T12 | Stable selection and 2–4 compare | verified (unit + iOS browser mock) | [evidence](evidence/T12-selection-compare.md). A22 is verified in those scopes; VoiceOver and the native picker on a device are unverified. The selection is in memory only (U-044) |
| T13 | Local favourite snapshots, caps, recoverable persistence | verified (unit + iOS browser mock) | [evidence](evidence/T13-favorites.md). A23 is verified in those scopes. The device's Filesystem error codes (U-047) and VoiceOver are unverified |
| T14 | Structured watch migration and foreground change loop | verified (unit + iOS browser mock) | [evidence](evidence/T14-watches.md). A24 and A25 are verified in those scopes. A real foreground return, the device Filesystem (U-049) and VoiceOver are unverified. Web watches are unchanged (T20) |
| T15 | AI context and trusted result references | verified (unit + iOS browser mock) | [evidence](evidence/T15-ai-context.md). A26 is verified in those scopes with the fixture's scripted Anthropic. No live Anthropic request. The device keyboard, touch scrolling and VoiceOver are unverified. `/ask` is a full-height page (U-050) |
| T16 | Structured change proposals, tool-layer approval | verified (unit + iOS browser mock) | [evidence](evidence/T16-proposals.md). A27 is verified in those scopes with the scripted Anthropic; refusals are counted at the fake seats.aero (0 requests). Ask without an included search now proposes instead of searching (U-051). No live Anthropic request |
| T17 | Request coordination, stop, interruption recovery | pending | |
| T18 | Web ports and account isolation | pending | |
| T19 | Web workspace, exclusive side panels, keyboard | pending | |
| T20 | Web scheduling, settings, shared-consumer regression | pending | |
| T21 | Cross-size, accessibility, visual polish | pending | |
| T22 | Full regression, migration rollback, resumable handoff | pending | |

## Environment facts that change how commands are run

- `pnpm` is not on the non-interactive PATH. It is pnpm 12.3.4 via corepack (matches `packageManager`).
- The default non-interactive `node` (`/usr/local/Cellar/node@22/22.16.0`) is an **x64 build running under Rosetta** on an Apple M3, while `node_modules` holds **arm64** native bindings (installed with nvm's arm64 Node 22.22.2). Under the x64 node, `pnpm test`, the Vite builds and `next build` fail on missing `@rolldown/binding-darwin-*` / `lightningcss.darwin-x64.node`. That is an environment mismatch, not a code failure.
- Fix used (no install, no system change): the project's own documented toolchain, `export PATH="$HOME/.local/node-arm64/bin:$PATH"` (arm64 Node 22.23.2 + pnpm 12.3.4), before every command. The same toolchain runs the production LaunchAgent and `apps/ios/probes/run-probes.sh`.
- `next build` kept failing for one more run after switching to arm64 because Turbopack's persistent build cache had stored the failed PostCSS evaluation from the x64 run; a run with a changed environment rebuilt it and plain `pnpm build` has passed since.

- **Production `.next` incident (open, owner decision):** the checkout's `.next` is what the production LaunchAgent serves on :3000; a baseline `pnpm build` in this checkout rewrote it, and the live `/login` stylesheet now 404s. Restarting `com.awardgrid.app` would serve a fresh build of `main` — a deploy, left to the owner. No web build runs in this checkout any more (DECISIONS U-003).

## Verification scopes

| Scope | State |
|---|---|
| Unit (vitest) | run per task; T01–T16 green (root 919/2 skipped, core 958, ios 777) |
| Web mock — existing web e2e (`pnpm e2e`) | baseline 583 passed / 145 skipped / 0 failed; not re-run (no web change yet, and it must run in a worktree from now on) |
| iOS browser mock (`playwright.uiux.config.ts`) | 190 passed (harness 10, foundations 26, workspace 4, query editor 18, mobile results 14, views 15, matrix 16, details 19, onboarding 19, compare 11, saved 15, watches 10, ask 13, proposals 8) |
| iOS Simulator | not run for the app yet. One T07 reviewer ran a scratch WKWebView probe on throwaway simulators to settle a locale question (DECISIONS U-026; evidence T07 Review): not an app verification |
| Physical device | not available to this session — unverified |
| Live seats.aero / Anthropic key | not authorized — not run |

## Known issues found so far (feed later tasks)

- Watches files: since T14 an unreadable or newer-version `watches.json` is held and never written over; a damaged one is copied aside (U-049).
- Persistence failures: resolved in T13. `persist()` never throws; a failed save is shown above the tab bar with "Try saving again" (U-046). The storage no longer passes an unreadable file off as absent (U-047).
- "Clear cached results" leaves saved workspace snapshots in place; the Settings copy says so (T11). Saved results (T13) are separate and are deleted one by one. No "clear everything saved" control was added, and none is in the spec.
- A theme chosen in Settings does not set the native status bar (U-042) → T21, with a Simulator check.
- Ask: the page is translated since T15; a question's steps, endings, failures and meta line (`ask/labels.ts`) and core's messages stay English, marked `lang="en"` (U-039, U-050) → T17. A21 stays partial until then.
- The save-failure bar (U-046) lives in the tab chrome, so it is not shown on the full-height Ask page or the editor; it shows on return (T15 review REG-06) → T21 to reconsider.
- iOS `GridTable` (seat count 0 as nothing, no fees, freshness from the local fetch time) is no longer used by the Search screen since T09; it stays for the Phase 5 driver (U-028) and its unit test — remove with the driver update in T21/T22.
- Before T09 the List and Calendar showed options above a search's own mileage cap (nothing on the snapshot path applied `max_miles`); fixed in the projection (U-035). The Web path still builds its grid with `buildGrid`, which applies it (T18–T20 to re-check when the Web reads the projection).
- The Phase 5 Simulator driver reads the pre-T07 layout (DECISIONS U-028) → T21/T22. Since T16 it also asks without an included search, whose searches the gate now refuses (U-051).
- Web `/api/parse` calls the LLM implicitly when deterministic parsing misses fields and a server key is set → T18/T20 (ordinary search must not call AI silently).

## Current next action

T17 (plan 03): request coordination, stop and interruption recovery (A28, A29). Read plan 03 T17 first and write the red test from its Step 1 (`apps/ios/src/workspace/request-coordinator.test.ts`: `RequestCoordinator.run(kind, operation)` serialises without losing failures or deadlocking). Local mapping notes:
- What coordinates today (bootstrap.ts): `checkWatches` has an in-flight guard (`inFlight`), and Ask's tool steps wait for it (`whenWatchesIdle`, core loop.ts:197). Workspace searches (`workspace.run`, which aborts the previous run), details (`detail-service.ts`, which joins a load in flight) and Ask tool calls otherwise run independently. Quota is the one counter (`engine.quota`); keep it.
- Do not wrap an operation that calls another coordinated one (Ask's tool calls run inside a question: coordinate at the tool-call/HTTP level, not the whole question, or the watch wait deadlocks).
- Stop: core loop Stop already sends nothing more and says it cannot recall a request (STOP_NOTE). S09: 'Stop' reads "Stop subsequent steps" (approved `ai.stop`, `ai.stop_note`). Unfinished: `markUnfinished` on relaunch; approved `ai.unfinished`. Nothing is retried automatically.
- Translate Ask's step, ending, failure and meta lines (`ask/labels.ts`) in this rework (U-039, U-050); then A21 can be re-checked.
- Seed `ai-stopped` (a stopped question whose request may still complete) and move the harness's unseeded example to `long-labels` (T21).
