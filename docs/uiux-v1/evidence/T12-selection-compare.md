# T12 · Stable selection and 2–4 compare: evidence

**Scope verified:** unit tests (core and iOS) plus the iOS browser mock.
- Browser: Chromium, fixture host on 127.0.0.1:4310.
- Sizes: 390 × 844, 320 × 568, 1024 and 700 wide, and text at 200%.
- Themes and languages: light and dark, English and Chinese.
- Scenarios: `complete`, and `multi-program` (two programs).

**Not run:** iOS Simulator or a device (WebKit touch on the pickers, VoiceOver on the table and the refusal announcement). No live request of any kind is involved: comparing sends nothing.

Worktree: `/Users/yegaoyang/Desktop/workspace/awardgrid-uiux`.

## What was built

- **`packages/core/src/lib/workspace/selection.ts`**
  - `toggleSelection` (at most four; a fifth refused; a second press clears), `sameRef`, `refKey`.
  - `resolveSelection`: each option from its own snapshot, else from its kept copy, else gone.
  - `COMPARE_FIELDS`: the fixed order.
  - `compareNotes`: currencies, unknown fees and missing currencies through `feesState`, plus the programs.
  - `compareLayout`: the phone, one-column and wide layouts.
- **`apps/ios/src/workspace/workspace-store.ts`**: `setSelected` with the limit and unknown-reference refusal, kept copies, `clearSelection`, `selectionEntries`.
- **`apps/ios/src/components/CompareTray.tsx`**: the bar, drawn in the chrome's slot above the tab bar (`app/tray-slot.ts`, App.tsx).
- **`apps/ios/src/screens/CompareScreen.tsx`**, `compare-copy.ts` and `components/compare.css`: the comparison as a child route over the Search screen.
- **Search screen:** the limit notice, and the compare route treated like details.
- **`ui.css`:** `aria-disabled` buttons styled as unavailable.
- **Tests:**
  - New: `selection.test.ts` (14), `compare-screen.test.ts` (3), and `e2e/uiux/compare.spec.ts` (11).
  - Extended: the workspace store tests (+4) and the parity test (the compare table).

## Test-first record

| Step | Command | Result |
|---|---|---|
| Red | `pnpm --filter @awardgrid/core exec vitest run src/lib/workspace/selection.test.ts` | exit 1: `Cannot find module './selection'` (`evidence/raw/t12-red-core.log`). This is the plan's Step 1 test verbatim, plus the cases it implies |
| Green (core) | same | 13, then 14 after the review |
| Store | workspace-store.test.ts | +4: limit, unknown reference, the same row in two searches, kept copy after eviction |
| Browser | compare.spec.ts | Written alongside the UI, **not run red first** (the plan's red step is the unit test above). The first run found that the `complete` search gives four options, so a fifth comes from a second search. The test now also covers choosing across searches |
| Screens | t12-*.png looked at | Three fixes. The picker labels picked up the table's divider (own class now). The picker text all began with the same route, so every closed picker read the same; it now leads with number, miles and program. "商务舱" broke onto its own line in the heading (heading re-split) |
| Checks of the checks | wide layout | At 700 wide the columns squeezed to 158: a table ignores `min-width`, so the width is now set explicitly. A resize race in the test was fixed with a poll; the test then passed three runs in a row |
| Review | adversarial workflow (3 finders: data and state; accessibility, bilingual and tests; layout), one refuting verifier per finding | 25 findings, 25 confirmed (5 major), 0 refuted; all fixed, as below |

## Review (adversarial)

| Finding | What was wrong | Fix |
|---|---|---|
| DT-1 (major), A11Y-3 | The same row chosen from two searches showed as identical columns, picker options and Remove names | Options are numbered in the order chosen. "From the search of …" appears when there are several searches, and the route when routes differ. Unit and browser tests check that names are unique |
| A11Y-1, L5 (major) | The refusal's live region was `display: none` while empty, so the refusal might not be announced | Hidden only visually while empty. The test checks it is in the tree before the refusal, and that repeated refusals are said again |
| A11Y-2, L1 (major) | The sticky bar hid focused controls near the bottom | The bar moved out of the scrolling area into its own slot above the tab bar. The test checks that the last results link, when focused, is above the bar |
| L2 (major) | The matrix's last rows and scrollbar were always under the bar | The matrix height subtracts the bar's measured height (`--compare-tray-h`) |
| L3 | The bar floated mid-screen on short pages and lifted at the end of long ones | Fixed by the slot. The test checks the bar's bottom meets the tab bar's top |
| L4 | Returning from the comparison remounted Search, losing its scroll and calendar day | The comparison is a child route over Search, like details. The test checks scroll and calendar day are kept |
| DT-2 | The notes read raw fee fields: a currency-less amount was called "not confirmed", and codes were not normalised | Built through `feesState`, with a separate "amount but no currency" note. Unit test with hard-coded values: lower-case code, `US$`, missing currency |
| DT-3 | Itineraries loaded for the same option in a later search were shown with no time | Always said with how long ago they were loaded on this device |
| DT-4 | A kept copy said "Open the option to load", which is impossible | Its own sentence ("cannot be loaded from here"); unit test |
| A11Y-4 | Remove dropped focus to `<body>` with no announcement | "Removed. N of 4 chosen." in a status region; focus goes to the page title; tested |
| A11Y-5 | The empty state's Back aimed at a bar that no longer existed | It is the same `back()`: focus goes to the results' title when nothing is chosen; tested |
| A11Y-6 | Remove buttons inside the column headers made every value's header long and command-like | The buttons are in their own row; tested (no button in `thead`) |
| A11Y-7, L7 | Focus rings of first-column controls were clipped in the scrolling layout | 4 pt of padding in the scroller, offset by a negative margin |
| L6 | Field names scrolled away sideways | They stay at the scroller's left edge (`position: sticky`) |
| L8 | At 440 wide in Chinese the pickers were not over their columns | A two-column grid 12 apart (16 on wide screens); the mode button has its own row |
| L9 | The closed pickers showed only the date and cabin, which were the same for several options | The text leads with number, miles and program |
| L10 | The cabin/program line was bold in cards and regular in the table | One weight; bold only where marked |
| L11 | Bar and page buttons were forced to 44 instead of the 48 primitive | The overrides were removed; the primitive's height applies |
| TEST-1 | "No value score" was tested only on one program | A browser test on `multi-program` (the note is present; nothing scores). Unit tests with two programs and two currencies |
| TEST-2 | Calendar and matrix choosing, repeated refusal, kept copy and missing were untested; a store test claimed a clear it never did | Refusals are tested from the calendar day and the matrix cell; repeated refusal is tested; unit render tests cover kept-copy and missing; the store test now clears |
| TEST-3 | The one-by-one screenshot was taken mid-switch | It waits for focus and checks the view is at the top and the button is in view |

## Gates

Final run, after the review fixes, in the worktree (`export PATH="$HOME/.local/node-arm64/bin:$PATH"`):

| Gate | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm lint` | 0 errors, 1 warning: the existing web `grid-table.tsx`, untouched |
| `pnpm test` | root 919 passed / 2 skipped; core 927; iOS 704 |
| `pnpm --filter @awardgrid/ios build` | pass; `check-fixture-free-bundle`: 18 files, no fixture markers |
| `pnpm build:landing`, `pnpm build` (worktree) | pass |
| `pnpm exec playwright test --config=playwright.uiux.config.ts` | 151 passed: harness 10, foundations 26, workspace 4, query editor 18, mobile results 14, views 15, matrix 16, details 19, onboarding 18, compare 11 (`evidence/raw/t12-full-run.log`) |
| Evidence | `UIUX_EVIDENCE=1 … compare.spec.ts -g "comparison at 390"` → 2 passed (`evidence/raw/t12-evidence-run.log`) |

## Acceptance

- **A22 (verified in the iOS browser mock; unit):**
  - Choose 2–4 from the list, a calendar day or a matrix cell. A fifth is refused and said so, and nothing is swapped out.
  - The selection is kept across views and searches.
  - The phone compares two at a time, with labelled 44 pt pickers (swap when both show the same option) and a one-by-one reading. At 320 or 200% text there is one column; wide screens show four side by side, 220 or more each, scrolling sideways when needed.
  - No ranking, score, total or CPP; the notes say why.
  - Nothing is sent: the request log is unchanged.
  - VoiceOver has not been run.

## Screens (looked at)

All at 390, in Chinese, light and dark:

| File | What it shows |
|---|---|
| `screens/t12-tray-*.png` | The results with 3 chosen (已选 on each card), and the bar 已选 3/4 · 清除 · 比较所选 above the tab bar |
| `screens/t12-compare-*.png` | 比较所选 3/4 项: the notes; pickers 第 1/2 列显示 ("1. 68,000 里程 · A…"); columns 选项 1 and 选项 2 with 移除 in their own row; fields in order, with 税费待确认 and 未载入 |
| `screens/t12-compare-end-*.png` | The same, scrolled to 席位 / 来源时间 / 兑换网站 (没有兑换网站链接) |
| `screens/t12-compare-one-by-one-*.png` | 逐项阅读: 并排比较 focused at the top, one card per option with every field |

## Not verified here

- **Simulator or device:** the native `<select>` picker on iOS, VoiceOver on the table's `headers` and on the refusal announcement, the bar's safe-area padding in landscape.
- **Not saved across a relaunch:** the selection itself (U-044; favourites are T13).
