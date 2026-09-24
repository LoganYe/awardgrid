# Next session — how to resume UI/UX v1

Read first: the handoff pack's `CLAUDE_CODE_PROMPT.md` and `RESUME_PROMPT.md`, then this folder's `STATUS.md`, `DECISIONS.md`, `REPO_MAP.md`, `ACCEPTANCE.md`. Confirm state from git, not from these notes.

## Environment (every shell)

```sh
cd /Users/yegaoyang/Desktop/workspace/awardgrid-uiux   # the WORKTREE; never work in ../awardgrid (production runs from it)
export PATH="$HOME/.local/node-arm64/bin:$PATH"   # arm64 node + pnpm 12.3.4; the default node is x64/Rosetta
git status --short && git log --oneline -5
```

Never in the main checkout (`../awardgrid`): `pnpm build`, `next build`, `scripts/check-no-secrets-in-bundle.sh --build`, or `pnpm e2e` — the production LaunchAgent on :3000 serves its `.next` (DECISIONS U-003). In the worktree they are fine. A full `pnpm e2e` rewrites tracked `docs/screenshots/v0.2/**`: `git checkout -- docs/screenshots/v0.2` after. The UI/UX run and `pnpm e2e` share the worktree's `.next`: run them one after the other, never together.

## Where things stand

- Branch `uiux/quiet-precision-v1` in the worktree above, one local commit per finished task (see `git log`). Nothing pushed.
- T01–T17 verified (unit + integration + iOS browser mock): M1–M3 done in those scopes. T18 and T19 verified (unit + Web mock). T20 is next: see STATUS "Current next action".
- Carried forward:
  - **The Web surface (T18, U-053).**
    - `openScenario(page, id, "web")` signs an account in (`scripts/uiux-web/accounts.ts`) on this worktree's real Next app (:4330), and opens `/workspace?q=` with the synthetic search.
    - The server runs on the fixture's clock, and seats.aero is a stand-in on :4331. `webRequestLog(page, scenario)` counts what each account's key sent.
    - `start-web.sh` rebuilds `.next` when any build input is newer. The first run after a source change takes about 2 minutes longer.
    - `UIUX_WEB=0` runs iOS only.
  - **The Web workspace (T19, U-054):**
    - `src/components/workspace/`: one panel slot (`panel-state.ts`); `DrawerShell` docked into the page's column at 1280 and up (its `container` and `opener` props); views over core's projection; the palette; the keyboard rules (`keyboard.ts`, with the platform's modifier).
    - Web layout specs run in the `web-desktop` project (`e2e/uiux/web-layout*.spec.ts`). Use `test.use({ hasTouch: true })` for a coarse pointer at desktop width.
    - Overlays slide for 200 ms: wait before measuring. A client-side navigation resets the scroll.
  - **The Web's stores.** Core's `WorkspaceStore` and `FavoritesStore` run per account (`src/components/workspace/services.ts`) over `storage.ts`, under keys `JSON.stringify([store, userId, name])`.
    - Any logout or login path must call `clearAskSession()` and `forgetWorkspacesOnDevice()`.
    - Storage and search ports made before then refuse to write or publish (the device epoch).
  - Ask is fully translated (U-052); `ask/entry-labels.ts` holds a question's own lines per language, and `labels.ts` stays the English source.
  - Spending entries go through `AppServices.requests` (RequestCoordinator, U-052): the search port, watch runs, Ask tool calls, detail lookups. Never queue an operation from inside a queued one.
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
# T20: read plan 04 T20 first; write its red test (packages/core/src/lib/workspace/watch-capabilities.test.ts) before any code
# Evidence screenshots: run only the task's own spec with UIUX_EVIDENCE=1 (the harness spec rewrites T01's screenshots)
UIUX_EVIDENCE=1 pnpm exec playwright test --config=playwright.uiux.config.ts e2e/uiux/<task>.spec.ts
# UI/UX browser suite (fixture host on 127.0.0.1:4310)
pnpm exec playwright test --config=playwright.uiux.config.ts
# Gates
pnpm typecheck && pnpm lint && pnpm test && pnpm --filter @awardgrid/ios build
```

If port 4310, 4330 or 4331 is taken, a stopped Playwright run left a server behind: `lsof -nP -iTCP:4310 -sTCP:LISTEN` (and 4330, 4331). Stop it only if it is this worktree's fixture Vite, `next start` or `mock-seatsaero.ts`.
