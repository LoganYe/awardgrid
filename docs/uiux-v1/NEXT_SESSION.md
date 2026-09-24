# Next session — how to resume UI/UX v1

Read first: the handoff pack's `CLAUDE_CODE_PROMPT.md` and `RESUME_PROMPT.md`, then this folder's `STATUS.md`, `DECISIONS.md`, `REPO_MAP.md`, `ACCEPTANCE.md`. Confirm state from git, not from these notes.

## Environment (every shell)

```sh
cd /Users/yegaoyang/Desktop/workspace/awardgrid-uiux   # the WORKTREE; never work in ../awardgrid (production runs from it)
export PATH="$HOME/.local/node-arm64/bin:$PATH"   # arm64 node + pnpm 12.3.4; the default node is x64/Rosetta
git status --short && git log --oneline -5
```

Never in this checkout: `pnpm build`, `next build`, `scripts/check-no-secrets-in-bundle.sh --build`, or `pnpm e2e` when `.next/BUILD_ID` is missing — the production LaunchAgent on :3000 serves this `.next` (DECISIONS U-003). Web builds/e2e for M4 go in a separate git worktree. A full `pnpm e2e` also rewrites tracked `docs/screenshots/v0.2/**`; restore them after.

## Where things stand

- Branch `uiux/quiet-precision-v1` in the worktree above, one local commit per finished task (see `git log`). Nothing pushed.
- T01–T16 verified (unit + iOS browser mock). T17 is next: see STATUS "Current next action".
- Carried forward:
  - Ask's page is translated (T15); its steps, endings, failures and meta line are T17's (U-039, U-050; A21 partial until then).
  - Ask's tools are gated to the included search, and anything else is a proposal the person applies (U-051). Scenarios `ai-pending` and `ai-stale` are seeded.
  - `/ask` is a full-height page (U-050). What a question sends is built once (`ask/context.ts`, `AskService.preview`), and each entry records it (`AskEntry.context`). Browser tests use `openScenario(..., { ai: true })` for the scripted Anthropic and `anthropicContexts(page)` for what it received. The stand-in keyboard is in `e2e/uiux/helpers.ts`.
  - The status bar under a chosen theme is for T21 (U-042).
  - Every new `Sheet` needs a translated `closeLabel`.
  - New shell copy goes into a per-language table that `apps/ios/src/locale-parity.test.ts` checks.
  - Approved sentences come through `copy("key", locale)`, which `honesty.test.ts` now scans.
  - Overlays over the Search screen (details, compare) are child routes of the Search layout. App.tsx's Chrome and SearchScreen both list them as "over Search".
  - The compare bar and the Saved undo bar are portalled into the chrome's `app-tray-slot`.
  - `persist()` returns a report and never throws. `saveStatus` drives the chrome's save bar.
  - `SlotFileStorage` throws on what it cannot read, and refuses to write over it (U-047). Callers must treat a read error as "unreadable", not "empty".
  - Watches are structured since T14 (U-048). A watch runs `resolveDraft(draft, today)`; one under review reads its text. The runner re-reads each watch after its request, so an edit wins. `watches.json` is v2; a newer or unreadable file is held, and a damaged one is copied aside (U-049).
- If the worktree's `node_modules` is missing: `for d in node_modules apps/ios/node_modules packages/core/node_modules sites/landing/node_modules; do cp -Rc ../awardgrid/$d $d; done`; vendor: `rsync -a --exclude=.git ../awardgrid/vendor/travel-hacking-toolkit/ vendor/travel-hacking-toolkit/`; then `pnpm build:plugin`.
- Open owner decision: restart `com.awardgrid.app` to fix the live stylesheet 404 (STATUS.md).

## Next commands

```sh
# T17: read plan 03 T17 first; write its red test before any code
# Evidence screenshots: run only the task's own spec with UIUX_EVIDENCE=1 (the harness spec rewrites T01's screenshots)
UIUX_EVIDENCE=1 pnpm exec playwright test --config=playwright.uiux.config.ts e2e/uiux/<task>.spec.ts
# UI/UX browser suite (fixture host on 127.0.0.1:4310)
pnpm exec playwright test --config=playwright.uiux.config.ts
# Gates
pnpm typecheck && pnpm lint && pnpm test && pnpm --filter @awardgrid/ios build
```

If port 4310 is taken, a stopped Playwright run left its fixture Vite behind: `lsof -nP -iTCP:4310 -sTCP:LISTEN`, and stop it only if it is this worktree's `vite.fixture.config.ts`.
