# UI/UX v1 execution status

State: **M1 in progress** — T01–T03 verified; T04 next.
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
| M1 truthful foundations (T01–T05) | in_progress | [baseline](evidence/T01-baseline.md), [T01](evidence/T01-fixture-harness.md), [T02](evidence/T02-truth-identity.md), [T03](evidence/T03-coverage-evidence.md) |
| M2 iOS search flow (T06–T11) | pending | — |
| M3 context and persistence (T12–T17) | pending | — |
| M4 Web and release validation (T18–T22) | pending | — |

## Tasks

| Task | Title | State | Evidence / notes |
|---|---|---|---|
| T01 | Read-only baseline, evidence dir, isolated fixture harness | verified (browser mock + bundle) | [evidence](evidence/T01-fixture-harness.md); A01 verified |
| T02 | Stable identity, source time, missing values | verified (unit) | [evidence](evidence/T02-truth-identity.md); A04 verified; A02/A03 unit-verified, component half with T07 |
| T03 | Coverage evidence through cache and versioning | verified (unit + store integration) | [evidence](evidence/T03-coverage-evidence.md); A05 verified; `restoreCoverage` gets its production caller in T05 |
| T04 | Shared tokens and primitives, light/dark | pending | |
| T05 | Versioned workspace and shared structured query entry | pending | |
| T06 | Query editor, date rules, explicit submit | pending | |
| T07 | Mobile nav, query summary, readable result cards | pending | |
| T08 | Same-snapshot projection: list and calendar | pending | |
| T09 | Pro matrix: column snapping, per-cabin, keyboard | pending | |
| T10 | Plain itinerary details and return state | pending | |
| T11 | Settings, onboarding, bilingual, keyboard | pending | |
| T12 | Stable selection and 2–4 compare | pending | |
| T13 | Local favourite snapshots, caps, recoverable persistence | pending | |
| T14 | Structured watch migration and foreground change loop | pending | |
| T15 | AI context and trusted result references | pending | |
| T16 | Structured change proposals, tool-layer approval | pending | |
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
| Unit (vitest) | run per task; baseline, T01–T03 green (root 836/2 skipped, core 799, ios 577) |
| Web mock — existing web e2e (`pnpm e2e`) | baseline 583 passed / 145 skipped / 0 failed; not re-run (no web change yet, and it must run in a worktree from now on) |
| iOS browser mock (`playwright.uiux.config.ts`) | 10 passed (T01 harness, re-run at T02, T03) |
| iOS Simulator | not run yet |
| Physical device | not available to this session — unverified |
| Live seats.aero / Anthropic key | not authorized — not run |

## Known issues found so far (feed later tasks)

- Persistence failures surface only as unhandled promise rejections (`App.tsx` `void services.persist()`), nothing shown to the user → T05/T13 (docs/02 D04).
- iOS `GridTable` shows seat count 0 as nothing, never shows fees, colours freshness from the local fetch time → replaced in T07/T08.
- Web `/api/parse` calls the LLM implicitly when deterministic parsing misses fields and a server key is set → T18/T20 (ordinary search must not call AI silently).

## Current next action

T04: Quiet Precision tokens (`packages/tokens/precision.css`, draft in the session scratchpad `t04/`) and iOS primitives; red test first: `pnpm exec playwright test --config=playwright.uiux.config.ts e2e/uiux/foundations.spec.ts` (in the worktree).
