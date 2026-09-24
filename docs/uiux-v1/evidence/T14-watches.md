# T14 · Structured watch migration and the foreground change loop: evidence

**Scope verified:** unit tests (core and iOS) and the iOS browser mock.
- Browser: Chromium, fixture host on 127.0.0.1:4310.
- Size, themes and languages: 390 × 844; light and dark; English and Chinese.
- Scenarios: `watch-baseline`, `watch-changes` and `watch-failure` (all seeded in this task), and `complete`. Tests wrote other states into the fixture's device files: v1 watches, damaged and newer-version files, and passed dates.

**Not run:**
- The iOS Simulator or a device. This covers a real foreground return (`visibilitychange` from iOS), the device Filesystem's real rejection for an unreadable `watches.json`, and VoiceOver on the cards, the switch and the "Watch saved" announcement.
- No live request. Every check went to the fixture's synthetic transport, or to the fake seats.aero in unit tests.

Worktree: `/Users/yegaoyang/Desktop/workspace/awardgrid-uiux`.

## What was built

- **Core `workspace/watch-migration.ts`** (U-048):
  - `dateRuleFromText` proves a date rule by reading the phrase on four days. Relative means "next N days". Fixed means the same dates on every reading. Anything else is unclear.
  - `migrateLegacyWatch(input, today)` implements the plan's interface. An unclear rule is marked for review and never guessed; an unreadable text keeps no draft.
  - `draftForWatch` gives a new watch the snapshot's own query, and a relative rule only on proof.
- **Core `watch/watch.ts`:**
  - `WatchChange` and `changesFrom`, with old and new values.
  - `overlapWindow` and `MAX_UNSEEN_CHANGES` (30).
  - `Watch.draft/review/unseenChanges`; `lastResult.compared/refused/unresolved`.
  - The `dates_passed` skip.
- **Core `workspace/types.ts`:** `SavedQueryV2.draft` can be null, and there is a `review` field (U-048).
- **`watch/runner.ts`:**
  - A structured watch runs `resolveDraft(draft, today)` through `searchQuery`. A watch under review, or one not migrated, reads its text.
  - Passed dates are skipped. A draft that does not resolve is never replaced by the text.
  - A refused key is recorded.
  - Changes are kept with their values over the compared dates.
  - An edit, restart, removal or mark-as-seen made while a check is out wins.
- **`store/watch-store.ts`:**
  - File version 2; version 1 is still read.
  - `unmigrated()`.
  - Duplicates are compared by conditions and date rule, ignoring the sort.
  - A newer or unreadable file is held (U-049), and entries this version cannot read are carried unchanged.
- **`store/persistence.ts`:** `readWatchesFile` tells absent, read, damaged and unreadable apart.
- **`app/bootstrap.ts`:**
  - `restoreWatches`: a damaged file is copied aside, and a newer or unreadable one is held.
  - `migrateWatches` backs up `watches.v1.json` once, then migrates.
  - `persist()` never writes a held store.
- **Screens:**
  - `WatchesScreen.tsx` is rewritten for S07. It has the approved platform line, and each card shows its route heading, conditions (with programs by name), review notice, unseen counts, "What changed" and the compared dates. The state line says each state only while it is true. There is a labelled switch, Edit, and Stop named in full with a sheet that shows the conditions. Held, kept-aside and carried notices appear when they apply. "Watch saved" is announced.
  - New files: `watches.css` and the `watches-copy.ts` additions, all en/zh.
  - `QueryEditorScreen.tsx` gains a watch mode: edit the conditions and date rule, save without sending, restart the baseline, and ask before leaving in the watch's own words.
  - `SearchScreen.tsx`: "Watch this search" stores the structured draft and gives the reason when watches are held.
  - `watchNeedsText` is removed.
- **Fixture:** `savedWatches` seeds the three watch scenarios (v2 files). `watch-failure` uses the failing transport.
- **Tests:**
  - New files:
    - `watch-migration.test.ts`: 11 tests, including the plan's Step 1 test verbatim.
    - `watches-status.test.ts`: 5 tests.
    - `e2e/uiux/watches.spec.ts`: 10 tests.
  - Changed:
    - `runner.test.ts`: +9 (22 in total). The stub engine gains `searchQuery`.
    - `watch-store.test.ts`: +4.
    - `bootstrap-watches.test.ts`: +5.
    - `query-editor.spec.ts`: a mixed-cabin search can now be watched.
    - `fixture-harness.spec.ts`: the unseeded example is now `ai-pending`.

## Test-first record

| Step | Command | Result |
|---|---|---|
| Red | `pnpm --filter @awardgrid/core exec vitest run src/lib/workspace/watch-migration.test.ts` | exit 1: `Cannot find module './watch-migration'` (`evidence/raw/t14-red.log`). This was the plan's Step 1 test, written first |
| Green (core) | same | 10 passed on the first implementation; 11 after the review (MIG-02) |
| Runner | `pnpm --filter @awardgrid/ios exec vitest run src/watch/runner.test.ts` | The structured block was written with the runner change. The first run failed because the fixture query named aeroplan while the fake rows were alaska; the fixture was corrected. 22 passed after the review |
| Browser | `watches.spec.ts` | Written alongside the screen. The change-line assertions were first too loose and now match exact strings |
| Screens | t14-watches-light/dark.png looked at | The first shot showed the stored English sentence as the heading on a Chinese screen. The heading is now the localised route, with the conditions below it |
| Review | adversarial workflow: 3 finders (migration and data safety; runner, network and quota; UX, a11y, l10n and layout), one refuting verifier per finding | 24 findings: 17 confirmed (7 major), 7 refuted. All 17 are fixed, as below. MIG-01 was refuted as pre-existing but is closed anyway, because Step 4 asks for it (U-049) |

## Review (adversarial)

| Finding | What was wrong | Fix |
|---|---|---|
| MIG-02 (major) | A month name or a date without a year, migrated before its dates, became fixed dates with no review | Four readings. Tests: "October", "十月", "December" and "Oct 1 - Oct 30" on 2026-09-24 go to review; ISO dates stay fixed on every day |
| RUN-01 (major) | A check in flight overwrote an edit, restart or mark-as-seen made meanwhile, so the next check reported false new and gone seats | The watch is re-read at its turn and after the request. An edited, restarted or removed watch gets nothing from that check, and unseen changes come from the current record. 3 runner tests edit the store from inside the fake transport |
| RUN-02, UX-02 (major) | After a failed or refused check, a return within 45 minutes said "cached results are still valid (last checked 3 h ago)" and hid the failure | The cached-skip line is said only after a success; a newer failure is still said. Unit tests |
| UX-03 (major) | After editing passed dates, the card still said the dates had passed | Said only while the current conditions have passed. Unit test, plus a browser flow: passed → Edit → new dates → "Not checked yet." |
| MIG-03, RUN-05, UX-06 | Watches checked before T14 said "could not compare: the dates did not overlap" | A missing `compared` is unknown, so neither sentence is shown. Browser test on a v1 watch |
| MIG-05, UX-07 | The same conditions sorted another way were accepted as a second watch | Duplicates ignore the sort. Store test |
| RUN-03 | A draft that did not resolve silently ran the old text, a different search | Not checked, nothing sent, "these conditions cannot be run", no attempt clock. Runner and status tests |
| UX-01 | Two watches on one route had identical headings, switch names, Stop names and Stop sheet | Programs by name in the conditions. The switch, Edit and Stop are named with the heading and conditions, and the sheet shows the conditions. Browser test |
| UX-04 | "Previous baseline kept" was said when there was none (a first check, or after an edit) | Said only when there was a baseline. Unit tests, en and zh |
| UX-08 | The Chinese low-quota line joined its sentences with ". " | The screen's own punctuation joins them. Unit test |
| UX-09 | The Chinese baseline state said 基准 where the approved copy says 基线 | "基线已建立（…）", and the browser expectation is updated |
| UX-10 | The editor's discard sheet said a watch's edits "have not been run" | "Your changes to this watch have not been saved." / "你对此关注的修改还没有保存。" Browser test |
| UX-12 | "Watch saved" was in the status region when it mounted, so it was not announced; it could also replay | Set 150 ms after mount into an empty region, and the history entry forgets it. The browser test records the region's text at insertion as "" |

Refuted (7):
- **MIG-01** (an unreadable, damaged or newer watches file overwritten): it predates T14, but it is closed in T14 anyway (U-049).
- **MIG-04** (the migration goes ahead when the v1 backup fails): no field is lost, because every v1 field is written into v2.
- **MIG-06** (editing a watch into a copy of another): the spec does not ask to prevent it.
- **RUN-04** (passed dates reported as low quota, no key or cached): each of those reasons is true when it is shown.
- **UX-05** (changes found while the screen is open are not marked seen): unchanged from before T14, and not in the spec.
- **UX-11** (an unparsed watch opens a blank editor): the spec does not require otherwise. The card shows its words.
- **UX-13** (the capability mapping inverted): the branch cannot be reached on iOS.

Optional follow-ups the verifiers mentioned and that were not done:
- Clearing the attempt clock when a new seats.aero key is saved. A corrected key is tried after 45 minutes, as with any failure.
- A duplicate check on editor save (MIG-06 was refuted).

## Gates

Final run after the review fixes, in the worktree (`export PATH="$HOME/.local/node-arm64/bin:$PATH"`):

| Gate | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm lint` | 0 errors; 1 warning in the existing web `grid-table.tsx`, which is untouched |
| `pnpm test` | root 919 passed / 2 skipped; core 938; iOS 744 |
| `pnpm --filter @awardgrid/ios build` | pass; `check-fixture-free-bundle` found no fixture markers in 18 files |
| `pnpm build:landing`, `pnpm build` (worktree) | pass; no tracked file changed |
| `pnpm exec playwright test --config=playwright.uiux.config.ts` | 176 passed; T14 added the watches spec, 10 tests (`evidence/raw/t14-full-run.log`) |
| Evidence | `UIUX_EVIDENCE=1 … watches.spec.ts -g "Watches with changes at 390"`: 2 passed (`evidence/raw/t14-evidence-run.log`) |

## Acceptance

- **A24** (verified by unit tests, and in the iOS browser mock):
  - A relative date moves: the plan's test, plus a runner test where the window moves two days later.
  - Edited structured filters persist and are what a check runs: nonstop, mixed cabin and the mileage cap go through `searchQuery`, and the text is never re-read.
  - Old fixed ISO dates keep their meaning on any day.
  - Unclear phrases go to review.
  - In the browser: a mixed-cabin watch keeps 75%, and is edited and saved as conditions with no request.
- **A25** (verified by unit tests, and in the iOS browser mock):
  - The first check sets a baseline and reports nothing new.
  - A failed check leaves the baseline and the unseen changes, and says so.
  - A quiet check keeps the unseen changes, shown with old and new values and the compared dates.
  - Changes are marked seen when the Watches screen opens.
  - The quota, cache-period, passed-date and refused-key reasons are said accurately (unit tests).
  - One check per launch or return is unchanged from before T14 (App.tsx, and the run guard in bootstrap). The browser tests cover the launch check; a return was not simulated here.
- **Not verified here:** a real iOS foreground return, the device Filesystem, and VoiceOver.

## Screens (looked at)

At 390 in Chinese, light and dark:

| File | What it shows |
|---|---|
| `screens/t14-watches-*.png` | 你关注的查询: the approved platform line, the no-background and 45-minute lines, and a card. The card shows HKG → SEA; 10月1–30日 · 商务舱、头等舱 · Aeroplan; 自你上次查看以来：新增 1 个，降价 1 个; the open 变化 list (新增…75,000 里程; 降价…120,000 里程 → 110,000 里程); 比较范围：10月1–30日（两次检查都覆盖的日期）; 上一次检查：刚刚; and the 关注中 switch, 编辑 and 停止关注 |

## Not verified here

- **Simulator or device:**
  - iOS delivering `visibilitychange` on return.
  - The Filesystem's rejection for an unreadable `watches.json` (U-049, as in U-047).
  - VoiceOver on the switch names, the Stop sheet and the "Watch saved" announcement.
- **Web watches** (scheduling, Telegram) are unchanged and belong to T20.
