# UI/UX v1 execution status

State: **M4 in progress**. T01–T17 are verified (unit, integration, iOS browser mock); T18 and T19 are verified (unit and Web mock). M1–M3 are complete in those scopes. A28's native half, and every Simulator, device and live-key check, have not been run. T20 is next.
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
| M3 context and persistence (T12–T17) | verified (unit + integration + iOS browser mock); Simulator/device unverified; A28 native half unverified | [T12](evidence/T12-selection-compare.md), [T13](evidence/T13-favorites.md), [T14](evidence/T14-watches.md), [T15](evidence/T15-ai-context.md), [T16](evidence/T16-proposals.md), [T17](evidence/T17-coordination.md) |
| M4 Web and release validation (T18–T22) | in progress: T18, T19 verified (unit + Web mock) | [T18](evidence/T18-web-isolation.md), [T19](evidence/T19-web-workspace.md) |

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
| T17 | Request coordination, stop, interruption recovery | verified (unit + integration + iOS browser mock) | [evidence](evidence/T17-coordination.md). A29 is verified; A28 is verified in mock integration, with the native half (a real kill, the native idle timeout) unverified. The Ask page's own lines are in Chinese too, so A21 is now met (U-052) |
| T18 | Web ports and account isolation | verified (unit + Web mock) | [evidence](evidence/T18-web-isolation.md). A30 is verified in those scopes: this worktree's real Next app, a stand-in seats.aero, two accounts on one browser. The core stores are shared with iOS; each signed-in account has its own namespace; logout empties every workspace, even for an answer that lands after it (U-053). A tab left open across a logout elsewhere is not covered (it never was on the Web). No live key |
| T19 | Web workspace, exclusive side panels, keyboard | verified (unit + Web mock) | [evidence](evidence/T19-web-workspace.md). A31 and A32 are verified in those scopes. The S10 geometry is measured in Chromium; one panel slot is docked at 1280 and up, an overlay below, a sheet below 768; the three views come from one projection; a palette and shortcuts can be switched off, with no key taken while typing or composing (U-054). The review's 26 confirmed findings are fixed. WebKit, Firefox, real devices, a real IME and screen readers are unverified |
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
| Unit (vitest) | run per task; T01–T19 green (root 949/2 skipped, core 960, ios 795) |
| Web mock — UI/UX Web surface (`playwright.uiux.config.ts`, T18+) | web-isolation 8 and web-layout 43 passed: this worktree's Next app on :4330, stand-in seats.aero on :4331; the `web-desktop` project (1440×900, fine pointer), a coarse-pointer block, widths 1920 to 320 |
| Web mock — existing web e2e (`pnpm e2e`) | re-run in the worktree for T19 after the review fixes: 583 passed / 145 skipped / 0 failed (same as the baseline; the grid's drawers use the changed DrawerShell) |
| iOS browser mock (`playwright.uiux.config.ts`) | whole run 254 passed, the Web surface's tests included (T19 added web-layout 43); iOS-only (`UIUX_WEB=0`) lists 203 |
| iOS Simulator | not run for the app yet. One T07 reviewer ran a scratch WKWebView probe on throwaway simulators to settle a locale question (DECISIONS U-026; evidence T07 Review): not an app verification |
| Physical device | not available to this session — unverified |
| Live seats.aero / Anthropic key | not authorized — not run |

## Known issues found so far (feed later tasks)

- Watches files: since T14 an unreadable or newer-version `watches.json` is held and never written over; a damaged one is copied aside (U-049).
- Persistence failures: resolved in T13. `persist()` never throws; a failed save is shown above the tab bar with "Try saving again" (U-046). The storage no longer passes an unreadable file off as absent (U-047).
- "Clear cached results" leaves saved workspace snapshots in place; the Settings copy says so (T11). Saved results (T13) are separate and are deleted one by one. No "clear everything saved" control was added, and none is in the spec.
- A theme chosen in Settings does not set the native status bar (U-042) → T21, with a Simulator check.
- Ask: fully translated since T17 (U-052); only text core writes (a failure's details) stays English, marked `lang="en"`.
- The seats.aero key check (Settings) spends a call outside the request queue (not one of D09's four entries; T17 review COORD-3).
- The save-failure bar (U-046) lives in the tab chrome, so it is not shown on the full-height Ask page or the editor; it shows on return (T15 review REG-06) → T21 to reconsider.
- iOS `GridTable` (seat count 0 as nothing, no fees, freshness from the local fetch time) is no longer used by the Search screen since T09; it stays for the Phase 5 driver (U-028) and its unit test — remove with the driver update in T21/T22.
- Before T09 the List and Calendar showed options above a search's own mileage cap (nothing on the snapshot path applied `max_miles`); fixed in the projection (U-035). The Web path still builds its grid with `buildGrid`, which applies it (T18–T20 to re-check when the Web reads the projection).
- The Phase 5 Simulator driver reads the pre-T07 layout (DECISIONS U-028) → T21/T22. Since T16 it also asks without an included search, whose searches the gate now refuses (U-051).
- Web `/api/parse` calls the LLM implicitly when deterministic parsing misses fields and a server key is set → T20 (ordinary search must not call AI silently). The T18 workspace does not use it: it takes a structured `?q=`.
- Web workspace: laid out in T19 (U-054). Still open: the headings step h1 → h3 in the list (T21's axe audit, best-practice only); a tab left open across a logout in another tab keeps its page, as the Web always has (U-053); 200% text at 390 (the Web has no text-scale setting; T21); the site header keeps the Web's old tokens and links to /grid, not the workspace (T20 decides where / and login land).
- The UI/UX run and `pnpm e2e` share the worktree's `.next`: run them one after the other.

## Current next action

T20 (plan 04): Web scheduling, settings and shared-consumer regression (A33, A34). Read plan 04 T20 first and write its Step 1 red test (`packages/core/src/lib/workspace/watch-capabilities.test.ts`, `capabilityMessageKey`). Notes:
- **Capability copy.** The approved rows `watch.foreground_only`, `watch.scheduled_with_push`, `watch.scheduled_only` and `watch.unavailable` are already in core's `COPY`. A configured scheduler is not proof of a recent successful run: say run health separately, as unknown when it is.
- **Web /queries.** Keep the page, its worker (`src/lib/scheduler/*`, `src/cli/worker*.ts`) and Telegram (`src/lib/notify/*`). Show its capability from the server's real configuration: env booleans only today, with no capability module.
- **/api/parse.** It calls the LLM when deterministic parsing misses fields and a server key is set. Ordinary search must not call AI silently. The T19 workspace never uses it; the grid's query bar does.
- **Regression.**
  - Run `pnpm build:landing` and the existing e2e (auth, login, register, legal, settings, queries).
  - Run the CLI with the synthetic fixture and the worker against the mock.
  - Check that old users' settings and links still work.
  - Decide and record where `/`, login and the header lead: the grid or the workspace.
- **Tokens.** The workspace aliases the Web's tokens only inside `.ag-ws` (U-054). Check that every old token consumer keeps its colours and theme logic.
