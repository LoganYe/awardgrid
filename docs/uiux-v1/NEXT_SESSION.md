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

- Branch `uiux/quiet-precision-v1`, one local commit per finished task, **merged into `main` as `164afe7`, pushed and deployed** (FINAL_REPORT, "Merge into main"). The worktree above is left detached at `main`'s tip; start new work there on a new branch from `main` (`git switch -c <name> main`), never in the main checkout.
- **All 22 tasks are done and committed.** T01–T22 are verified in their browser, unit and integration scopes, and T22 in its Simulator scope. Every native, device, screen-reader and live-key part is listed in `FINAL_REPORT.md` under "Unverified" and in ACCEPTANCE as partial. There is no further plan task; what is left is verification the plan could not run here, plus owner decisions.
- **What is left, in order:**
  1. **The Phase 5 Simulator harness** (U-028, for A28's native half: a real kill, the native idle timeout).
     - Bring `apps/ios/src/probes/e2e-driver.ts` up to date past its search step: Settings (the five S08 groups, not `.settings-section`), the quota line, Ask (`.ask-send`, `.ask-suggestion`, entries since T15–T17), and the layout (A4) step.
     - Then the verdicts in `apps/ios/probes/probe-log.mjs`.
     - Run it on a fresh Simulator, never the owner's device `A480530B…`, which holds app data and a key.
     - The Pods must already be in `apps/ios/ios/App/Pods`, with `Podfile.lock` (copied from the main checkout). The harness's `npx cap sync` then gets a `pod` that does nothing, so it cannot reach the network:
       `mkdir -p <scratch>/shim && printf '#!/bin/sh\n[ "$1" = --version ] && echo 1.16.2\nexit 0\n' > <scratch>/shim/pod && chmod +x <scratch>/shim/pod`
       `PATH="<scratch>/shim:$PATH" SIM_UDID=<fresh device> SE_NAME="<a new name>" apps/ios/probes/run-probes.sh --e2e <scratch>/phase5-e2e`
     - Then remove `GridTable.tsx` and its test `grid-message.test.ts` together (STATUS).
  2. **WebKit past the first screen** (A35's native half): the results, editor, details, compare and Ask screens on the Simulator at Dynamic Type Large to AX xxxLarge. This needs taps, so the Simulator panel's access for a fresh device must be granted in the app, or use the owner's own tools.
  3. **A device.** VoiceOver (A15, A36), touch (A16), the real keyboard, Keychain and clipboard (A20), and the results screen's safe area (A12).
  4. **A live key, only with the owner's consent and on their machine.** One seats.aero search and one Anthropic question.
- **Owner decisions** (STATUS "Known issues"):
  - regenerate the `/queries` Linux visual baselines in CI;
  - where `/`, the header and login lead;
  - the CLI prints unknown seats as 0;
  - `/queries` and `/settings` stay on the older type tokens;
  - done: `main` pushed and deployed on 2026-09-24 (STATUS, "Deploy"); the Docker fix on `fix/docker-context-uiux` still needs merging and pushing so CI's docker smoke passes again.
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
  - **Watch capabilities (T20, U-055):**
    - Core `watch-capabilities.ts`: `capabilityMessageKey` and `runHealth`.
    - The worker's heartbeat file beside the database (`src/lib/scheduler/heartbeat.ts`). E2e stands in for a worker with `webHeartbeatFile()` from `e2e/uiux/helpers.ts`, and must remove it after.
    - `/api/parse` uses the model only with `use_llm`, from the grid's explicit, withdrawable offer.
  - **The Web's stores.** Core's `WorkspaceStore` and `FavoritesStore` run per account (`src/components/workspace/services.ts`) over `storage.ts`, under keys `JSON.stringify([store, userId, name])`.
    - Any logout or login path must call `clearAskSession()` and `forgetWorkspacesOnDevice()`.
    - Storage and search ports made before then refuse to write or publish (the device epoch).
  - Ask is fully translated (U-052); `ask/entry-labels.ts` holds a question's own lines per language, and `labels.ts` stays the English source.
  - Spending entries go through `AppServices.requests` (RequestCoordinator, U-052): the search port, watch runs, Ask tool calls, detail lookups. Never queue an operation from inside a queued one.
  - Ask's tools are gated to the included search, and anything else is a proposal the person applies (U-051). Scenarios `ai-pending` and `ai-stale` are seeded.
  - `/ask` is a full-height page (U-050). What a question sends is built once (`ask/context.ts`, `AskService.preview`), and each entry records it (`AskEntry.context`). Browser tests use `openScenario(..., { ai: true })` for the scripted Anthropic and `anthropicContexts(page)` for what it received. The stand-in keyboard is in `e2e/uiux/helpers.ts`.
  - **Cross-size and accessibility (T21, U-056):**
    - `e2e/uiux/layout-audit.ts` `auditLayout(page)` returns `{ overflowX, clipped, overlaps }`. It covers sideways overflow; cut, spilling or overdrawn text; words running out of their control; cut field values; and covered controls, stepping each screen-level scroller through its height. `documentScrolls(page)` must be 0 on iOS.
    - Hold a new screen to the audit at 320–1440 and 100–200% (`setTextScale`).
    - `audit-proof.spec.ts` shows the audit fails on each defect. Keep it passing when the audit changes, and add a case for any new blind spot.
    - Measure after two frames (`settle`) when a resize or a scale change switches a layout (the `/queries` table and cards).
    - A spec that opens the Web must skip under `UIUX_WEB=0`, as the T21 specs do (`WITH_WEB`); a test over both surfaces keeps its iOS half.
    - Look at every evidence image after the LAST capture: T21's review found overdraw in an image that had not been looked at again.
  - The appearance chosen in Settings reaches the native side since T22 (`AppViewController.swift`, `native/appearance.ts`; U-059, closing U-042). Dynamic Type drives `--ag-text-scale` (`native/text-size.ts`). Both are verified on the Simulator only.
  - Every new `Sheet` needs a translated `closeLabel`.
  - New shell copy goes into a per-language table that `apps/ios/src/locale-parity.test.ts` checks.
  - Approved sentences come through `copy("key", locale)`, which `honesty.test.ts` now scans.
  - Overlays over the Search screen (details, compare) are child routes of the Search layout. App.tsx's Chrome and SearchScreen both list them as "over Search".
  - The compare bar and the Saved undo bar are portalled into the chrome's `app-tray-slot`.
  - `persist()` returns a report and never throws. `saveStatus` drives the chrome's save bar.
  - `SlotFileStorage` throws on what it cannot read, and refuses to write over it (U-047). Callers must treat a read error as "unreadable", not "empty".
  - Watches are structured since T14 (U-048). A watch runs `resolveDraft(draft, today)`; one under review reads its text. The runner re-reads each watch after its request, so an edit wins. `watches.json` is v2; a newer or unreadable file is held, and a damaged one is copied aside (U-049).
- If the worktree's `node_modules` is missing: `for d in node_modules apps/ios/node_modules packages/core/node_modules sites/landing/node_modules; do cp -Rc ../awardgrid/$d $d; done`; vendor: `rsync -a --exclude=.git ../awardgrid/vendor/travel-hacking-toolkit/ vendor/travel-hacking-toolkit/`; then `pnpm build:plugin`.
- The live stylesheet 404 (U-003) is resolved: the server was restarted at 16:33 on 2026-09-24, and the stylesheets returned 200 at 20:56 (STATUS.md).

## Next commands

```sh
# The whole regression, as T22 ran it (evidence T22 has the counts):
pnpm typecheck && pnpm lint && pnpm test && pnpm --filter @awardgrid/ios build && pnpm build:landing && pnpm build
pnpm exec playwright test --config=playwright.uiux.config.ts          # the iOS fixture host, and the Web surface on :4330/:4331
pnpm e2e && git checkout -- docs/screenshots/v0.2                      # the existing Web e2e; never at the same time as the line above
# The upgrade from the app before UI/UX v1 (U-058):
pnpm --filter @awardgrid/ios exec vitest run src/app/upgrade-from-pre-uiux.test.ts
# The Simulator, offline (U-059): Pods copied from the main checkout, then
(cd apps/ios && npm run build && npx cap copy ios)
(cd apps/ios && xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Debug -sdk iphonesimulator -destination "id=<fresh device>" -derivedDataPath <scratch>/DerivedData CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=YES build)
xcrun simctl install <fresh device> <scratch>/DerivedData/Build/Products/Debug-iphonesimulator/App.app
```

The worktree's `apps/ios/ios/App/Pods` and `Podfile.lock` were copied from the main checkout (gitignored). The throwaway worktree at `9c69c6c` used for the rollback check has been removed (`git worktree list`). The Simulators "awardgrid T22 smoke" (iOS 26.5) and "awardgrid T22 smoke iOS18" were made for T22 and hold no keys; delete them with `xcrun simctl delete <udid>` when no longer needed.

If port 4310, 4330 or 4331 is taken, a stopped Playwright run left a server behind: `lsof -nP -iTCP:4310 -sTCP:LISTEN` (and 4330, 4331). Stop it only if it is this worktree's fixture Vite, `next start` or `mock-seatsaero.ts`.
