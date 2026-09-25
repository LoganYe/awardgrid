# T08 · Same-snapshot projection: List and Calendar — evidence

Scope verified: **unit (core, iOS) + iOS browser mock** (Chromium, fixture host 127.0.0.1:4310; 390 × 844 and 320 × 720; text scale 1.3; light and dark; English and Chinese). Not run: iOS Simulator / device (the native sort picker, VoiceOver on the calendar table, Dynamic Type through the real system setting), live seats.aero (not authorised). Worktree `/Users/yegaoyang/Desktop/workspace/awardgrid-uiux`.

## What was built

- `packages/core/src/lib/workspace/projection.ts` (docs/03 §2): `projectResults(snapshot, prefs)` — the rows the local filter lets through, in the view's sort; one day per date of the query's range for the calendar's cabin, with the keys of its rows, its minimum and what the search proved for it (`coverage`: complete / partial / unknown / unmonitored, from the slices covering that day, cabin and every program asked on every route, never stronger than the snapshot's own verdict); one matrix cell per route, day and cabin with rows; the snapshot's coverage unchanged; `hiddenByFilter`; each day and cell also carries the rows the filter hides there. `calendarCabinFor` (D07: the chosen cabin if asked, else the first in cabin order), `feeGroup`, `sortRows` (fees within one currency only; unknown fees and seat counts after known ones; a total order). Additive fields in `types.ts`: `ProjectedDay.coverage` and `.hidden`, `ProjectedCell.hidden`, `ProjectedResults.hiddenByFilter`.
- `present.ts`: `compactMiles` (U-031), `monthLabel`, `weekdayHeads`, `calendarDayName`, `emptyDayKind` / `emptyDayLabel`, `sortShortLabel`, approved copy `result.min_partial`; `sortedRows` removed (replaced by the projection's order).
- `apps/ios/src/components/results/AvailabilityList.tsx` (cards; fee groups under the fee sort), `AvailabilityCalendar.tsx` (cabin switch, caption, month grid or date list, a mark per kind of empty day and its legend, the chosen day's options — under its row in the list), `AvailabilityCard` heading level; `SegmentedControl` reserves each label's bold width (U-033).
- `SearchScreen.tsx`: List / Calendar / Matrix from one projection; the sort control (a native picker under a short visible label); the hidden-by-filter note with "Show all" (focus to the status line, announced); the Matrix (older grid until T09) rebuilt from the projection's rows, picked by miles under the fee sort and not drawn under a view filter (U-032); coverage notices count the snapshot's rows.
- `WorkspaceStore`: a search that asks for a new order sets the view's sort (U-030); `QueryEditorScreen` and `rerunShown` carry the view's sort into their query.

## Test-first record

| Step | Command | Result |
|---|---|---|
| Red | `pnpm --filter @awardgrid/core exec vitest run src/lib/workspace/projection.test.ts` | exit 1 — `Cannot find module './projection'` (`evidence/raw/t08-red.log`) |
| Core | projection.test.ts | 16 passed; one test-side fix (my expectation for cabins [F, W] ignored CABIN_ORDER J, F, W, Y) |
| Core words | present.test.ts, new calendar cases | red first (`compactMiles is not a function`), then green |
| Store | workspace-store.test.ts, sort adoption | red first (`Expected "fees_asc", Received "seats_desc"`), then green |
| Browser | e2e/uiux/results-views.spec.ts | written after the components, not red first; 9 passed, 15 after the review |
| Honesty | apps/ios/src/honesty.test.ts | caught "每日最低里程" as a cadence phrase → caption reworded "各日期最低里程" / "Lowest miles by date"; the test was not changed |
| Width | scratch spec measuring `.ag-cal-min` | "≈6.85万" 57 pt, "≈110.5K" 62 pt in a 46 pt cell → U-031; widest new forms ≤ 43 pt, kept as a check in the 390 test |
| View row | mobile-results 390 geometry | failed at 56 (segments wrapping mid-word) → short sort label, narrower segment padding (8 pt, then 6 pt with the bold-width fix, U-033), sort wraps at 320 instead of breaking words; a test for both |
| Review | adversarial review workflow (3 finders: data truth, accessibility + tests, layout; one refuting verifier per finding) | 21 findings, 20 confirmed (1 major), 1 refuted; every confirmed one fixed, below |
| Review fixes | projection 16 → 19; present 21 (the day-name case extended); store sort cases 1 → 2 (a superseded run added to the first); render 5 → 8; browser views 9 → 15 | one test-side slip: an extra brace in primitives.test.ts made vitest skip that file silently in a filtered run; caught by `pnpm typecheck`, fixed, 20 passed |

## Review (adversarial)

| Finding(s) | What was wrong | Fix |
|---|---|---|
| L-02 (major) | In the date list a chosen day's options rendered below the whole list, off screen on a phone | The row is a disclosure (`aria-expanded`, `aria-controls`); its options open right under it. Browser test at 320 × 568 |
| DL-01, A11Y-01, L-07 | A day or cell whose rows the local filter hides read "no matches"; the Matrix read "No availability" | `hidden` counts on days and cells; the "∗ hidden by your view filter" mark and name; "lowest shown" beside hidden rows; the Matrix is not drawn under a filter and says why. Browser test with a saved filter across all three views |
| DL-03, L-06 | Days on routes the source does not monitor read "no matches"; partial and unknown shared "?" | A day coverage `unmonitored`; one mark per kind ("–", "…", "?", "⊘", "∗"), each in the legend; the list's other-days line says each kind |
| DL-06 | Day coverage ignored slice programs and the snapshot's verdict | Slices prove a day only for the programs they cover (all programs only by an all-programs slice); unknown verdict → unknown days |
| DL-02 | Search again flipped a chosen sort back to the one the words asked for | Adoption only for an order the search on screen did not already ask for; `rerunShown` carries the view sort. Store test |
| DL-04 | The Matrix picked cells with core ranking, comparing fees across currencies | Under the fee sort the Matrix picks by miles and says so |
| A11Y-02, L-03 | The grid/list switch measured the padding box, keeping a too-narrow grid at larger text | Content box; browser cases 390 × 1.15 and 430 × 1.3 → list |
| A11Y-03 | A month arrow disabled at the range's end dropped focus to `<body>` | `aria-disabled`, still focusable; browser test over Oct–Nov 20 |
| A11Y-04 | "Show all" removed itself and focus fell to `<body>`, silently | Focus to the status line; an always-mounted `role="status"` says "Showing all N options." |
| A11Y-05 | "Choose a day" and an empty list when no day had options | Only when a day has options; no empty list |
| A11Y-06 | A render assertion about Next month could not fail (attribute order) | The arrow's whole tag is extracted and checked; the mirror case (opening on the last month) added |
| A11Y-07, A11Y-08 | No test with a local filter, "Show all" or the Matrix's numbers; titles that overclaimed; no superseded-run or monitored-partial case | Seeded-filter browser test; Matrix values tied to the list; cabin switch with a selection; superseded and monitored-partial cases; retitled test; editor-sort browser test |
| L-01 | The view row wrapped to 88 at 390 in English with Calendar chosen (bold label wider) | Bold width reserved in every segment (U-033), 6 pt padding; a test over every view × sort in both languages |
| L-04 | Calendar notes had double gutters | Own class, margin 0 |
| L-05 | Four cabins broke words ("Busines\|s J") | No word breaks in the cabin switch; four cabins two by two; test at 390 and 320 checking each word is on one line |

Refuted (no change): DL-05 — "amounts with no currency are ordered by amount". They form their own named group ("Currency not provided"), after every known currency and before unknown fees; ordering inside that group by raw amount is "排序原始数值", nothing is compared with a known currency, and the repo records that seats.aero often omits TaxesCurrency for USD.

Known interim (T09): the Matrix is still the older grid. Under the miles, seats and date sorts its cell pick uses core ranking's fee tiebreak, which can compare two currencies when miles are equal; T09 builds the Matrix from the projection's cells.

## Gates

Final run, after the review fixes, in the worktree (`export PATH="$HOME/.local/node-arm64/bin:$PATH"`):

| Gate | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm lint` | 0 errors, 1 warning — the existing web `src/components/grid/grid-table.tsx` (`react-hooks/incompatible-library`), untouched |
| `pnpm test` | root 919 passed / 2 skipped; core 866; ios 670 |
| `pnpm --filter @awardgrid/ios build` | pass; `check-fixture-free-bundle`: 18 files, no fixture markers |
| `pnpm build:landing` | pass |
| `pnpm build` (worktree only) | pass |
| `pnpm exec playwright test --config=playwright.uiux.config.ts` | 87 passed (harness 10, foundations 26, workspace 4, query editor 18, mobile results 14, views 15); nothing left loopback |
| Evidence | `UIUX_EVIDENCE=1 … results-views.spec.ts -g "the calendar at 390\|opens right under its own row"` → 3 passed (`evidence/raw/t08-evidence-run.log`) |

## Acceptance

- A13 — same snapshot and effective filter; every minimum maps to rows: core (every day's and cell's keys are rows of the same filtered projection; the day's minimum is the lowest of those rows; filter leaves coverage alone; days and cells do not move with the sort) and browser (Oct 18 Business shows 75K, opens to one 75,000 card; First shows 110K, opens to 110,000; the Business-only day is empty for First).
- A14 — view, sort, calendar cabin and the local filter's "Show all" send zero seats.aero, trips or Anthropic requests and keep the selection (a checked card stays checked in the calendar's day list, across a cabin switch, after Matrix, back in List, after a fee sort, and after Show all); the chosen view and sort survive a relaunch without a request. The local filter has no iOS control (U-032): it is exercised from a saved workspace.
- A13 also at view level: the Matrix shows the list's 75,000 and 82,000; with a saved filter every view shows only what it lets through and says what it hides.

## Screens (looked at)

| File | What it shows |
|---|---|
| `screens/t08-calendar-light.png`, `-dark.png` | Chinese, 390, full page: 列表/日历/矩阵 with 里程升序, the cabin switch 商务舱 J / 头等舱 F, caption "各日期最低里程 · 商务舱 J", October 2026 Monday-first, 18 (75K, chosen) and 20 (82K), "–" days with the legend "– 无匹配", the chosen day's heading and card |
| `screens/t08-calendar-list-320.png` | English, 320: the view row with the sort on its own line, the date list, Oct 18 open with its card right under its row, Oct 20, "28 other days: no matches in the checked range." |

## Not verified here

- Simulator / device: the native picker for the sort, VoiceOver reading the calendar table and its day buttons, Dynamic Type through the system setting (the browser test sets `--ag-text-scale` directly).
- A calendar over more than one month in the browser (the fixture range is October only); the arrows and week alignment are covered by the render test.

## Corrections (T22 evidence audit, 2026-09-24)

An audit of this record against its raw logs and git (evidence T22) found the following. The text above is left as written.
- A14's "survive a relaunch" is a browser page reopened with its storage kept (`openScenario(…, { preserveStorage: true })`), not a native kill and relaunch, which is unverified.
