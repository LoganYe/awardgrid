# T09 · Pro matrix: whole columns, per-cabin slots, keyboard — evidence

Scope verified: **unit (core, iOS) + iOS browser mock** (Chromium, fixture host 127.0.0.1:4310; 390 × 844 and 320 × 720; text scale 1.3 and 2; light and dark; English and Chinese; keyboard; mouse-wheel scrolling standing in for touch). Not run: iOS Simulator / device (touch momentum scrolling and snap on WebKit, VoiceOver reading the grid, Dynamic Type through the system setting), live seats.aero (not authorised). Worktree `/Users/yegaoyang/Desktop/workspace/awardgrid-uiux`.

## What was built

- `packages/core/src/lib/workspace/projection.ts`: `matrixModel(snapshot, projected)` — the query's dates by its routes, each cell a slot per cabin asked in cabin order (D07), each slot its lowest miles (ties by fees within one currency) or why it is empty (hidden by the view filter, no matches, not monitored, not checked to the end, coverage unknown), with its coverage; `mobileColumns(contentWidth, routes, textScale)` (docs/04 S03); day coverage split into a per-route `routeCoverage`. The projection now applies the query's own row conditions (U-035) and counts dynamically priced rows it leaves out (`dynamicNotShown`). Types in `types.ts` (`MatrixModel`, `MatrixSlot`, `EmptyKind`).
- `present.ts`: `dayParts` (row headers), `programShortLabel` (the 26 seats.aero programs), `matrixCellName` (route, day, every slot, and selection).
- `apps/ios/src/components/results/AvailabilityMatrix.tsx` and `useMatrixFocus.ts`: the `<table role="grid">`, sticky header and date column, whole snapping columns, one tab stop and the APG keys, Enter/tap to the cell's options, Esc back, selection marks, focus kept across a new search (U-034). The older `GridTable` is no longer used by the Search screen.
- `SearchScreen.tsx`: the Matrix view is `AvailabilityMatrix`; the sticky block's height is measured for the page's scroll padding and the matrix's height; the dynamic-pricing note. Copy in `components/results/copy.ts`.
- Fixture host: `rerunShown()` on the test handle (test-only).

## Test-first record

| Step | Command | Result |
|---|---|---|
| Red | `pnpm exec playwright test --config=playwright.uiux.config.ts e2e/uiux/matrix.spec.ts` | exit 1 — 10 of 10 failed, each at `getByRole("grid")`: element not found (`evidence/raw/t09-red.log`); the searches before it succeeded |
| Core red | projection.test.ts matrix cases; present.test.ts matrix words | red first (`mobileColumns is not a function`, `dayParts is not a function`), then green |
| Green | matrix spec | 9 of 10 on the first run; the snap test: Chrome snaps a 60 pt wheel back to 0 (nearest), so the test scrolls 100 (nearest 135) and then 40 more |
| Geometry | matrix spec | scrollLeft settled at 137, not 135: the scroller's 1 pt side borders made its scrollport 356, too narrow for two whole 135 columns → no side border (358 = 88 + 2 × 135) |
| Screens | t09-matrix-*.png looked at | rows were ~120 tall with every empty slot on two lines → mark, cabin and reason on one line (J/F rows 88); the grid's header was hidden under the page's sticky block and the focused cell under the tab bar (a doubled scroll offset) → fixed, with a test |
| Review | adversarial review workflow (3 finders: data truth, accessibility + tests, layout; one refuting verifier per finding) | 17 findings, 13 confirmed (3 major), 4 refuted; every confirmed one fixed, below |

## Review (adversarial)

| Finding | What was wrong | Fix |
|---|---|---|
| DL-01 (major) | The matrix showed options above the query's own mileage cap — and so did T08's List and Calendar: nothing on the snapshot path applied `max_miles` | The projection applies the query's row conditions (U-035); browser test with a cap of 80,000 across List and Matrix; unit tests for cap, cabins, programs, nonstop, dynamic pricing |
| A11Y-01 (major) | A tap on a date or route header focused the table, whose hand-off jumped the grid back to the active cell | `mousedown` on anything but a cell does not focus the grid; browser test (and a mutation check: the test fails without the guard) |
| L-01 (major) | English "Seat count not provided" was nowrap and ran into the next route | Seats are words and wrap; a test that no cell's content is wider than its column |
| DL-02, A11Y-02 | The tick landed on the slot's lowest option when another was the one selected; selection was not in the cell's name | Tick and frame only for the shown option; "1 other selected" otherwise; both in the name (en/zh); render tests |
| A11Y-03 | A new search remounted the grid: focus to `<body>`, active cell reset | No remount; the coordinate is clamped; the opened options close and focus returns to the cell; browser test via the host's `rerunShown()` |
| A11Y-05 | The "no cropped miles" loop checked zero figures | The priced route in the middle column; the check counts what it checked (> 0) at rest and after the scroll |
| A11Y-06 | The "whatever the sort" tests would pass if a slot followed the list's sort | A unit case where the fee and seat orders pick a different row than the miles order, under all four sorts |
| L-02 | The sticky block was assumed to be 116; a long route or larger text makes it taller | Measured (`--results-sticky-h`); browser test with a ten-origin, four-destination search |
| L-03 | Esc back to the cell left the grid's header row off screen | Focus brings the whole scroller into view first, then the cell |
| L-04 | One route left an empty band beside a 135 column | Never more columns than routes (1 route → 270) |
| L-05 | Larger text spilled into the next column; the corner label overlapped | Columns scale with `--ag-text-scale` (1.3 → date 114 + 1 × 244; 2 → 176 + 1 × 182); lines and headers wrap, the figure never; tests at 1.3 and 2 |
| L-06 | The opened cell was a faint tint, which also hid the cabin chips | A 2 pt inset frame, no tint |

Also found while fixing: with a cell focused (grid scrolled down), sideways scrolling stopped unsnapped — Chrome only counts snap areas in view across the other axis, and the sticky header's cells are not → every data cell is a snap area.

Refuted (no change):
- DL-03 — "the caption says lowest while cells beside hidden rows are 'lowest shown'": the hidden-by-filter note sits above, and each cell's name says "lowest shown"; no requirement asks the caption to repeat it.
- DL-04 — "retired brands in the short names": the names follow the program names already used across the codebase (`SOURCE_NAMES`, from well before T09).
- A11Y-04 — "on touch the opened options cannot be closed": the spec asks for Esc back to the cell (done); the options are part of the page, scrolled past or replaced by another cell.
- A11Y-07 — "keys the tests do not press": every key the plan and A15 name is tested; PageUp and the top/left edges are exercised by the model but not pressed in a test (noted below).

## Gates

Final run, after the review fixes, in the worktree (`export PATH="$HOME/.local/node-arm64/bin:$PATH"`):

| Gate | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm lint` | 0 errors, 1 warning — the existing web `grid-table.tsx`, untouched (a `setState` in an effect was caught and replaced by derived state) |
| `pnpm test` | root 919 passed / 2 skipped; core 877; ios 672 |
| `pnpm --filter @awardgrid/ios build` | pass; `check-fixture-free-bundle`: 18 files, no fixture markers |
| `pnpm build:landing` | pass |
| `pnpm build` (worktree only) | pass |
| `pnpm exec playwright test --config=playwright.uiux.config.ts` | 103 passed (harness 10, foundations 26, workspace 4, query editor 18, mobile results 14, views 15, matrix 16) |
| Evidence | `UIUX_EVIDENCE=1 … matrix.spec.ts -g "the matrix at 390"` → 2 passed (`evidence/raw/t09-evidence-run.log`) |

## Acceptance

- A15 — one tab stop (one cell with tabindex 0; Tab leaves the grid); ArrowRight/Down, End, Home, Ctrl+End, Ctrl+Home move by true indices (`aria-rowcount` 31 / 93, `aria-colcount` 4); Enter opens the cell's options with focus on their heading, Esc returns to the cell; a 92-day × 3-route grid: Ctrl+End reaches row 93, the focused cell stays wholly on screen; focus survives a new search. Not virtualized (U-034): every index is the real one.
- A16 — 390: date 88, data columns 135, header 44, J/F rows ≥ 88; a sideways scroll settles on a whole column (135), and every figure in view is uncropped before and after; 320: one column of 200; larger text: fewer, wider columns, no cell wider than its column; no page overflow.

## Screens (looked at)

| File | What it shows |
|---|---|
| `screens/t09-matrix-light.png`, `-dark.png` | Chinese, 390, keyboard focus on 10月18日 HKG → SEA: the grid's own header (出发日期 · HKG → SEA · PVG → SEA) below the page's sticky block, empty slots with their reasons ("— J 无匹配", "— J 未监测"), the focused cell with 75,000 J and 110,000 F, "Aeroplan · 席位未提供" wrapping inside the column, above the tab bar |

## Not verified here

- Simulator / device: WebKit touch scrolling and snap settling, VoiceOver reading the grid's cells and indices, Dynamic Type through the system setting (the tests set `--ag-text-scale`).
- PageUp, and the top and left edges, are in the key model but not pressed in a test; Space-to-select and the relative-change tint are not built (U-034).
- The e2e "whatever the sort" check uses a slot with one option (no fixture scenario has two options in one slot whose fee and miles orders disagree); the unit test covers that case.
