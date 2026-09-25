# AwardGrid UI/UX v1: implementation report

This report records what was built and how it was checked. Each verification scope is reported on its own; anything not run is listed as unverified, and nothing unverified is counted as passed.

## Scope and environment

- **Plan.** The UI/UX v1 plan from the handoff pack `/Users/yegaoyang/Desktop/workspace/awardgrid-claude-code-impl`: 22 tasks in four milestones, with acceptance items A01–A38.
- **Where.** Worktree `/Users/yegaoyang/Desktop/workspace/awardgrid-uiux`, local branch `uiux/quiet-precision-v1`, from `main` at `9c69c6c`. One local commit per task (T22's evidence has the ledger). Nothing was pushed, opened as a PR, or deployed. The main checkout stayed on `main`, because production runs from it (U-009, U-003).
- **Surfaces.**
  - The iOS shell: Capacitor 8, React 19, Vite, in `apps/ios`.
  - The Web: Next 16, in `src`.
  - The shared core in `packages/core` and the tokens in `packages/tokens`.
- **Toolchain.** arm64 Node 22 with pnpm 12.3.4 (STATUS.md); Xcode 26.6 with the iOS 26.5 and 18.3 Simulators.
- **Data.** Only synthetic data. There were no live seats.aero or Anthropic requests: they were not authorised, and none were made.

## Task and acceptance ledger

| Milestone | Tasks | State |
|---|---|---|
| M1 truthful foundations | T01–T05 | verified (unit, integration, iOS browser mock) |
| M2 iOS search flow | T06–T11 | verified (unit, iOS browser mock) |
| M3 context and persistence | T12–T17 | verified (unit, integration, iOS browser mock); A28's native half is unverified |
| M4 Web and release | T18–T22 | T18–T21 verified (unit, Web mock, regression); T22 verified in its scopes (see its evidence), with a Simulator pass |

Each task's state, scope and evidence are in [STATUS.md](STATUS.md). The A01–A38 rows are in [ACCEPTANCE.md](ACCEPTANCE.md). The decisions behind every difference from the plan are U-001 to U-059 in [DECISIONS.md](DECISIONS.md).

**Per task** (the full rows, with evidence links, are in STATUS.md):

| Task | Title | State and scope | Acceptance |
|---|---|---|---|
| T01 | Read-only baseline, evidence dir, isolated fixture harness | verified (browser mock + bundle) | A01 verified |
| T02 | Stable identity, source time, missing values | verified (unit) | A02 verified, A03 verified, A04 verified |
| T03 | Coverage evidence through cache and versioning | verified (unit + store integration) | A05 verified |
| T04 | Shared tokens and primitives, light/dark | verified (unit + iOS browser mock) | A06 verified, A07 verified |
| T05 | Versioned workspace and shared structured query entry | verified (unit + integration + iOS browser mock) | A08 verified, A09 verified |
| T06 | Query editor, date rules, explicit submit | verified (unit + iOS browser mock); A10 partial: typing a date a month at a time not exercised | A10 partial, A11 verified |
| T07 | Mobile nav, query summary, readable result cards | verified (unit + iOS browser mock); native part implemented_unverified (A12: safe area on the results screen of a notched device) | A12 partial |
| T08 | Same-snapshot projection: list and calendar | verified (unit + iOS browser mock) | A13 verified, A14 verified |
| T09 | Pro matrix: column snapping, per-cabin, keyboard | verified (unit + iOS browser mock); native parts implemented_unverified (A15 VoiceOver, A16 touch) | A15 partial, A16 partial |
| T10 | Plain itinerary details and return state | verified (unit + iOS browser mock) | A17 verified, A18 verified, A19 verified |
| T11 | Settings, onboarding, bilingual, keyboard | verified (unit + iOS browser mock); native part implemented_unverified (A20: the real keyboard, Keychain, clipboard) | A20 partial, A21 verified |
| T12 | Stable selection and 2–4 compare | verified (unit + iOS browser mock) | A22 verified |
| T13 | Local favourite snapshots, caps, recoverable persistence | verified (unit + iOS browser mock) | A23 verified |
| T14 | Structured watch migration and foreground change loop | verified (unit + iOS browser mock) | A24 verified, A25 verified |
| T15 | AI context and trusted result references | verified (unit + iOS browser mock) | A26 verified |
| T16 | Structured change proposals, tool-layer approval | verified (unit + iOS browser mock) | A27 verified |
| T17 | Request coordination, stop, interruption recovery | verified (unit + integration + iOS browser mock); native part implemented_unverified (A28: a real kill, the native idle timeout) | A28 partial, A29 verified |
| T18 | Web ports and account isolation | verified (unit + Web mock) | A30 verified |
| T19 | Web workspace, exclusive side panels, keyboard | verified (unit + Web mock) | A31 verified, A32 verified |
| T20 | Web scheduling, settings, shared-consumer regression | verified (unit + Web mock + regression) | A33 verified, A34 verified |
| T21 | Cross-size, accessibility, visual polish | verified (iOS browser mock + Web mock); native parts implemented_unverified (A35: WebKit past the first screen, a device; A36: VoiceOver) | A35 partial, A36 partial |
| T22 | Full regression, migration rollback, resumable handoff | verified (unit + iOS browser mock + Web mock + regression + old code + iOS Simulator); A37 partial; A28's native half still unverified (the Phase 5 harness stopped at stale steps) | A37 partial, A38 verified |

## The design (§01–23) and where it lives

| § | Design section | Where it is implemented (main files) | Tasks |
|---|---|---|---|
| 01 | Goals, scope, what is not done | the plan's scope; no booking, no cash totals, no push on iOS | all |
| 02–04 | Research and evidence limits | kept as reference; no code | — |
| 05 | Audit of the old implementation | the fixes in T02 (identity, time, missing values), T03 (coverage), T07 | T02, T03, T07 |
| 06 | One workspace, three views, AI on demand | core `workspace/` (store, projection, types); iOS `SearchScreen`; Web `src/components/workspace/` | T05, T08, T19 |
| 07 | Core task flows | the full path in `e2e/uiux/full-flow.spec.ts` | T06–T17, T22 |
| 08 | Colour: Quiet Precision | `packages/tokens/precision.css`, `tokens.css`; the contrast pairs test | T04 |
| 09 | Type, figures, units | the type and leading tokens; tabular figures; core `present.ts` | T04, T21 |
| 10 | Spacing, radii, touch, components | `apps/ios/src/components/ui/*`; 44-pt targets | T04 |
| 11 | Phone results at 390 | `apps/ios/src/components/results/*` (header, summary, cards, views) | T07 |
| 12 | Search editor and filters | `apps/ios/src/components/query/*`, `QueryEditorScreen`; core `query-editor.ts` | T06 |
| 13 | Result cards and details | `AvailabilityCard`, `DetailScreen`, `apps/ios/src/workspace/detail-service.ts`; Web `option-card.tsx`, `detail-panel.tsx` | T07, T10, T18, T19 |
| 14 | Calendar and matrix | `AvailabilityCalendar`, `AvailabilityMatrix`; core `projection.ts` (`matrixModel`, `mobileColumns`) | T08, T09, T21 |
| 15 | AI assistance: structured, not a chat shell | `AskScreen`, `ask/*`; core `ask/*` (context, proposals, gate) | T15, T16, T17 |
| 16 | Watches, favourites, first run | `WatchesScreen`, `FavoritesScreen`, `OnboardingScreen`; core `favorites-store.ts`, `watch-migration.ts` | T11, T13, T14, T22 |
| 17 | The Web workspace at 1440 | `src/components/workspace/*`, `src/styles/workspace.css` | T18, T19, T20 |
| 18 | Errors, empty results, honest copy | core `present.ts` COPY (approved rows); the honesty scans | T02, T07, T11 |
| 19 | Accessibility, languages, devices | `e2e/uiux/accessibility.spec.ts`, `responsive.spec.ts`, `layout-audit.ts`; `native/text-size.ts`, `native/appearance.ts` | T11, T21, T22 |
| 20 | Data contracts and engineering limits | core `workspace/types.ts`, `coverage.ts`; `drizzle/0003`, `0004` | T02, T03, T05 |
| 21 | Delivery layers and acceptance | this report; ACCEPTANCE.md; the evidence folder | T22 |
| 22–23 | Review conclusions; sources | reference only | — |

## Commands and results

Run in the worktree at 19:50–20:22 on 2026-09-24, one after another, on the tree being committed, after the T22 review's fixes. `evidence/raw/t22-gates.log` lists each command's start time and exit code. (An earlier full run at 19:03–19:22, before those fixes, is superseded.)

| Gate | Exit | Result |
|---|---|---|
| `pnpm typecheck` | 0 | root, core, iOS |
| `pnpm lint` | 0 | 0 errors; 1 warning in the existing web `grid-table.tsx`, untouched. (Before the final run, T22's `aria-description` on the Save button drew a second warning, `jsx-a11y/role-supports-aria-props`: it became `aria-describedby`, as on the Web, U-057) |
| `pnpm test` | 0 | root 960 passed / 2 skipped; core 966; iOS 811 (`raw/t22-unit.log`) |
| `pnpm --filter @awardgrid/ios build` | 0 | fixture-free: "18 files, 118 markers, none found in dist" |
| `pnpm build:landing` | 0 | built |
| `pnpm build` (worktree) | 0 | compiled; 22 pages |
| `pnpm exec playwright test --config=playwright.uiux.config.ts` | 0 | 317 passed (`raw/t22-full-run.log`); `UIUX_WEB=0` lists 257 (`raw/t22-ios-only-list.log`) |
| `pnpm e2e` (existing Web e2e) | 1 | 582 passed / 145 skipped / **1 failed** (`raw/t22-web-e2e.log`): `e2e/queries.spec.ts:78`, desktop-light, "the table's columns do not move when the clock does". Existing Web code and test, unchanged by T22. It ran at 02:59 UTC, in the minute before the seeded query's 3-hourly run, when Next run reads "in NN seconds": 98.84 px, over the column's 96 px floor (measured with a scratch test, since deleted). That test alone then passed 3 times in each desktop project (`raw/t22-web-e2e-queries-rerun.log`). An open issue in STATUS and FINAL_REPORT |
| `pnpm e2e`, re-run | 0 | 583 passed / 145 skipped / 0 failed, the same as the baseline (`raw/t22-web-e2e-rerun.log`); the tracked `docs/screenshots/v0.2` it rewrites were restored after each run |

**New tests in T22** (the existing ones are counted separately):
- iOS unit +13: the upgrade 4, appearance 7, text size 2 (798 → 811).
- UI/UX Playwright +11, all in `full-flow.spec.ts`: Step 1, the iOS path, the Web path, three Save option cases, two evidence captures, the bookmark's place in English and Chinese, and Saved telling two options apart (306 → 317).
- No existing test was removed. Two changed, with reasons (U-057): `favorites.spec.ts` for the test id, and `search-screen.test.ts` for a favourites stub.

**Per stage:** every task's commit, logs, exit codes where printed, counts and screenshots are in [evidence/T22-evidence-ledger.md](evidence/T22-evidence-ledger.md) (A37 is partial: some final gates of T07–T20 are recorded only in their docs).

**Baseline:** `main` at `9c69c6c` (evidence T01-baseline): root 818 / 2 skipped, core 669, iOS 577; the Web e2e 583 / 145 / 0. The branch adds 142 root, 297 core and 234 iOS unit tests, and the UI/UX Playwright suite of 317, while the existing Web e2e is unchanged in count.

## Verification scopes

| Scope | What ran | State |
|---|---|---|
| Unit and integration (vitest) | root, `packages/core`, `apps/ios`; synthetic fixtures and a fixed clock; fake transports, KeyStore and storage | run at every task; all pass at T22 (Commands and results) |
| iOS browser mock | the real iOS shell in Chromium through the fixture host (`playwright.uiux.config.ts`, `ios` project): synthetic seats.aero and Anthropic stand-ins, every request counted, real hosts blocked | verified per task; the whole suite passes at T22 |
| Web mock | this worktree's real Next app with a stand-in seats.aero (`:4330`/`:4331`), two accounts on one browser; the `web-desktop` project at 1440 | verified for T18–T22 |
| Existing Web e2e (`pnpm e2e`) | the repository's own suite, unchanged | 583 passed / 145 skipped / 0 failed at the baseline and after every Web task. T22's first run had 1 clock-dependent failure in the existing `/queries` test (open issues); its re-run passed |
| Old code against new data | the app at `9c69c6c` run in a throwaway worktree: it wrote the pre-UI/UX fixture, and read the new build's files and a migrated database | T22 (U-058) |
| iOS Simulator | T22: the production build on fresh iPhone 17 Pro (iOS 26.5) and iPhone 16 Pro (iOS 18.3) Simulators, driven with `xcrun simctl` (launch, settings file, appearance, text size, screenshots), no taps; the Phase 5 harness stopped at stale steps | first screen, appearance (U-042) and Dynamic Type verified; everything past the first screen, and A28's native half, unverified |
| Physical device | not available to this session | unverified: VoiceOver, touch, the real keyboard, Keychain, clipboard, safe areas on the results screen, WebKit rendering past the first screen |
| Live key (seats.aero, Anthropic) | not authorised | not run |

Browser-mock evidence is never counted as Simulator, device or live-key evidence. A row in ACCEPTANCE is `verified` only when every part of its method ran; otherwise it is `partial` and names what did not run.

## The visual implementation

- **Screenshots.** Every screenshot comes from the actual app: the iOS shell through the fixture host, the Web app of this worktree, or the Simulator. None is a design picture. They are in `evidence/screens/`, named per task. Each task's evidence doc lists them against the reference states and names the differences. For example:
  - T07 results light and dark against `results-light.png` / `results-dark.png`;
  - T09 against `desktop-matrix.png`;
  - T21 at 200% text;
  - T22 on the Simulator.
- **Deliberate differences from the reference pictures:**
  - fictional inventory is never copied;
  - large text wins over the reference's fixed sizes (U-056);
  - no reference exists for 320 wide or large text;
  - the phone bar's labels stop at 13 px;
  - selects end in an ellipsis;
  - the Web's `/queries` and `/settings` keep the older type tokens (they are not in the workspace).

## How to try it

- **The iOS shell on synthetic data** (fixture host, no network):
  - Run `pnpm --filter @awardgrid/ios exec vite --config vite.fixture.config.ts --host 127.0.0.1 --port 4310`.
  - Open `http://127.0.0.1:4310/?scenario=complete` (other scenarios: `packages/core/test/fixtures/uiux/scenarios.json`). The fixture's seats.aero and Anthropic are stand-ins; the real hosts are blocked.
  - The path:
    1. Type a search (for example "Synthetic HKG to SEA October business and first") and Run.
    2. Switch List / Calendar / Matrix.
    3. Open "View option".
    4. Tick two options, then "Compare selected options".
    5. Use "AI assistance" (the `ai-pending` scenario proposes a change; Apply runs it once).
    6. "Watch this search", then the Watches tab.
    7. "Save option" or "Save results", then the Saved tab.
  - The hard paths:
    - `no-seats-key`: the first-run welcome;
    - `no-ai-key`;
    - `partial`, `unmonitored`, `coverage-unknown`, `failed-old`, `inflight-old`, `quota-low`;
    - `complete-empty`: a search checked to the end with no matches, said as such;
    - `storage-failure`: a save fails, said, with "Try saving again";
    - `legacy-cache`.
- **The Web on synthetic data.** Run `bash e2e/uiux/start-web.sh`. It works only inside a linked worktree, never the production checkout. It serves this worktree's Next app on :4330, with the seats.aero stand-in on :4331 (`pnpm exec tsx scripts/uiux-web/mock-seatsaero.ts`). The accounts are in `scripts/uiux-web/accounts.ts`. Sign in, and open `/workspace`.
- **The Simulator.** Build as in T22's evidence: Pods present, `npm run build && npx cap copy ios`, then `xcodebuild … -sdk iphonesimulator`. Install on a fresh device with `xcrun simctl install`. With no key it opens on the welcome and sends nothing. A real key sends real requests, so only with the owner's consent.

## Migration and rollback

See U-058; T22's evidence has the runs against the old code.
- **iOS.** New data goes into new namespaces (`workspace-v1`, `favorites-v1`, `settings-v1`).
  - `watches.json` moves to version 2, after its v1 file is copied aside byte for byte.
  - `cache.json`, `quota.json` and `ask.json` stay version 1, with additive fields.
  - Keychain items are never written or cleared. Starting or migrating does not read them; opening the app reads the seats.aero key to check due watches, as the old build did.
  - An unreadable or newer file is held, never written over. A damaged one is copied aside.
- **The Web.** Two additive nullable columns (`0003`, `0004`). The previous server runs unchanged against them. A value it rewrites with the newer fetch reads back as unknown (tested in T22). One order was not covered, and the pre-merge check found it: if the previous server's fetch started before one of this build's and finished after it, the newer "complete" evidence stays on the older rows. That needs the two builds writing at once. There is one server process, and the rollback stops the new build first, so it cannot arise in the steps given here.
- **Rollback order:**
  1. Stop the new build.
  2. Keep a copy of the new files.
  3. Put `watches.v1.json` back as `watches.json`.
  4. Install the previous build, or redeploy the previous commit. No down-migration is needed.

  Keys and quota are never reset, and nothing is deleted. Watch changes made in the new build stay in the kept v2 copy.

## Unverified, open, and for the owner

**Unverified, and how to verify it** (NEXT_SESSION has the commands):
- **A28's native half:** a real kill during a request, and the native idle timeout. The Phase 5 Simulator harness needs its Settings, quota, Ask and layout steps brought up to date (U-028). Until then, the request coordination is verified in unit and mock integration only.
- **A35's native half past the first screen:** the results, editor, details, compare and Ask screens in WebKit at Dynamic Type sizes. Dynamic Type now drives the text scale (U-059). Their layout at 100–200% was verified in Chromium.
- **A36:** VoiceOver. **A15:** VoiceOver on the matrix grid. **A16:** touch scrolling of the matrix. **A20:** the real keyboard, Keychain and clipboard. **A12:** the results screen's safe area on a notched device.
- **Live seats.aero and Anthropic requests.** Not authorised; they need the owner's consent and key.
- **Not covered by the audits:**
  - iOS compare, the Anthropic key page, the example and an opened saved snapshot are outside the T21 layout audit;
  - compare, the key pages and the example are outside the axe scans;
  - WebKit and Firefox were not run on the Web.
- **A37 is partial:** some final gates of T07–T20 are recorded only in their docs (evidence T22).

**Known issues, with user impact:**
- **Rollback loses watch edits made in the new build.** They stay in the kept v2 copy of `watches.json`, not in the old file (U-058).
  - To reproduce: upgrade, add a watch, roll back as documented, and the old build shows the watches as they were at the upgrade.
- **The Web's `/queries` and `/settings` do not follow the text scale** (they keep the older type tokens), and are measured at 100% only (U-056).
- **At 200% on a phone:**
  - the phone bar's labels stop at 13 px;
  - long select values end in an ellipsis;
  - at 768 the Web list's table scrolls in its own frame.

  These are accepted differences (U-056).
- **The CLI prints unknown seats as 0** in its grid text (U-055). It is the operator's tool, unchanged here. It also uses the model to read a text when its environment has an Anthropic key, unlike the Web.
- **A Web tab left open across a logout in another tab keeps showing the page it had** until it navigates or reloads, as the Web always has (U-053). Nothing new can be fetched or saved there: the device epoch refuses it.
  - To reproduce: open `/workspace` as account A in two tabs; log out in one; the other still shows A's results until reloaded.
- **The seats.aero key check in Settings spends a call outside the request queue** (T17 review COORD-3). A check made while a search runs is not queued behind it. Both count against the same quota.
  - To reproduce: start a search, open Settings → seats.aero key, check the key.
- **The save-failure bar is not shown on the full-height pages** (Ask, the editor) and appears on return (T15 REG-06, kept in T21: those pages only save through the search they return to).
  - To reproduce: the `storage-failure` scenario, open AI assistance: no bar; back on Search, the bar.
- **"Clear cached results" leaves saved results and snapshots in place**, as the Settings copy says (T11). Saved items are deleted one by one; there is no "clear everything saved" (not in the spec).
- **Ask's failure details from core stay English**, marked `lang="en"`, on a Chinese screen (U-052).
- **`GridTable` is dead code** kept with its own unit test until the Phase 5 harness is finished (STATUS).
- **The Web's `/queries` table moves about 3 px in the last minute before a query runs** (existing Web code, not changed here). "in 55 seconds" is wider than the Next run column's 96 px floor. Its own e2e test failed once in T22 for that reason, and passed on re-run.
  - To reproduce: open `/queries` in the minute before a query's next run, or set the first Next run cell's text to "in 55 seconds": the Name column narrows from 251.25 to 248.41 px at 1440.

**For the owner:**
- **The live site.** The stylesheet 404 caused by a baseline build in the main checkout (U-003) is gone: the server was restarted at 16:33 on 2026-09-24, not by this work, and `/`, `/login` and their stylesheets returned 200 at 20:56 (read-only check).
- **CI.** Regenerate the `/queries` Linux visual baselines.
- **Entry points.** Decide where `/`, the header and login lead (the workspace or `/grid`).
- **The branch.** Review and merge or push `uiux/quiet-precision-v1`. It is local only.
- **Simulators.** The owner's test Simulator (`A480530B…`) got the T22 build once (U-059). The previous build was installed back, and it re-saved `cache.json` and `ask.json` in version 1.
