# T07 · Mobile navigation, query summary and readable result cards — evidence

Scope verified: **unit (core, iOS) + iOS browser mock** (Chromium, fixture host 127.0.0.1:4310; 390 × 844 and 320 × 720 touch; light and dark; English and Chinese). Not run: iOS Simulator / device (safe areas on a notched phone, Dynamic Type, VoiceOver), live seats.aero (not authorised). Worktree `/Users/yegaoyang/Desktop/workspace/awardgrid-uiux`.

## What was built

- `packages/core/src/lib/workspace/present.ts`: the sentences every surface uses for a snapshot, in English and Chinese — miles (grouped), calendar days and ranges in UTC (never shifted by the device's zone), fees (known with currency; amount without currency says so; unknown is "not yet confirmed"; a real 0 is 0.00), seats (0 or none is "not provided"), source time (the provider's with its age; a local fetch said to be this device's; else unknown), program names, the query's route and subline, the option count, and coverage (partial, unknown, complete-empty, not monitored). Approved copy strings are used verbatim (a test compares them with `copy.zh-en.json`).
- `apps/ios/src/components/results/`: `AvailabilityCard` (route, day and weekday, cabin in words, miles, fees, program, seats, source time; a 44 pt selection checkbox beside the content, never inside another control), `QuerySummary` (the shown snapshot's query; opens the editor; not a link while a search runs), `copy.ts` (the screen's labels, en/zh), `results.css`.
- `apps/ios/src/screens/SearchScreen.tsx`: the S01 stack (U-025); filters open the editor at their condition, the view switch offers List and Matrix (the older grid, U-027); the status line says how many options, how fresh (saved on this device with its age / from this device's cache / N calls) and "Data: seats.aero"; run and coverage notices sit between the status and the cards; actions after the list (Search again, Watch this search, Ask about this search) and today's quota. Empty state: a text search and "Build a search".
- `apps/ios/src/app/App.tsx`: the tab chrome (Search, Watches with its unseen count, Settings; AI assistance from the Search header); `locale.ts` and `AppServices.locale` (U-026); `WorkspaceStore.setSelected`.
- `apps/ios/src/components/query/TextSearch.tsx`: typed search (deterministic parser, no AI), on the empty Search screen and at the top of the editor (secondary there: one primary per screen); the editor opens at `?section=`.
- Fixture host: `missing-values`, `partial`, `coverage-unknown`, `legacy-cache` seeded as workspaces saved by an earlier launch; the scenario's `lang` reaches the app.

## Test-first record

| Step | Command | Result |
|---|---|---|
| Red | `pnpm exec playwright test --config=playwright.uiux.config.ts e2e/uiux/mobile-results.spec.ts` | exit 1 — 10 of 11 failed: `Scenario "missing-values" is not seeded` (the no-key case already passed and stays as a guard) (`evidence/raw/t07-red.log`) |
| Core | `pnpm --filter @awardgrid/core exec vitest run src/lib/workspace/present.test.ts` | 10 passed; one first failure was ICU's zh-CN month-day ("10/18") → Chinese dates built from the UTC parts |
| Green | mobile-results spec | 11 passed; one first failure was the test measuring the 20 pt box instead of its 44 pt label |
| Regression | the earlier specs (harness, workspace, editor) | rewritten to the new screen (shared `searchByText`); three test-side fixes (exact names: the editor's examples contain "business" and "next 60 days") |
| Visual | reference `results-*.png` vs `t07-results-*.png` | the English "Ask Claude about this search" and engine messages on a Chinese screen → translated labels, `lang="en"` on engine text |
| Review | adversarial review workflow (3 finders: truth, accessibility + tests, layout; one refuting verifier per finding) | 36 findings, 33 confirmed, 3 refuted; every confirmed one fixed, below |
| Review fixes | mobile-results, query-editor, harness specs; search-screen and present unit tests | results spec 11 → 14; editor spec 17 → 18; present 10 → 16; one harness assertion follows the new card order |

## Review (adversarial, after the first green)

Three finders read the diff against plan 02 T07, docs/04 S01, the spec (§11, §13, §18, §19) and the approved copy; each finding then went to a verifier told to refute it. 36 findings, 33 confirmed (8 major), 3 refuted. Several were found twice from different angles, merged here.

| Finding(s) | What was wrong | Fix |
|---|---|---|
| DL-01 (major) | The view row said "Miles, lowest first" while cards came in engine/cache order | `sortedRows` (core `compareRows` + row key tiebreak) orders the cards; `sortLabel` names the query's sort. The harness now looks for its row anywhere in the list, not in the first card |
| DL-02 (major) | Coverage used the overall state only: a mixed unmonitored/complete search said nothing about the unmonitored pairs | `coverageNotices` reads the slices: unmonitored, not checked to the end, not proven, each naming its routes |
| DL-03, A11Y-04, L06, DL-09 (major) | English-only parts (engine messages, the text search, the matrix, sr strings) inside `lang="zh-CN"` | `lang="en"` on engine messages, TextSearch and the Matrix wrapper; the tab badge, nav label and Watch reasons translated instead |
| DL-07, A11Y-02, L08 (major) | Cards and checkboxes named by route only: every checkbox "Select HKG → SEA" | `resultName`: route, day, cabin, program, miles, fees, seats; the card article carries it, the checkbox is "Select …"; a selected card shows a "Selected" badge |
| A11Y-01, L03 (major) | Mid-run the summary is not a link and had no return-focus id; focus fell to `<body>` | The waiting summary keeps `id="edit-search"`, `tabIndex=-1`, described by its wait note |
| A11Y-03 (major) | A typed search that fails in the editor was silent | TextSearch renders the error as `role="alert"` and moves focus to the text box |
| L02 (major) | "Build a search" stayed live during the first search | A disabled button with its reason while searching |
| A11Y-05, L12 | Back from a chip's editor section returned focus to the summary; the Programs sheet closed to `<main>` | Chips pass `state.from`; the editor returns focus to its opener; closing the Programs sheet opened by the chip focuses the Programs row |
| DL-05 | The summary dropped mixed cabin and dynamic pricing | `querySubline` adds "mixed cabin ≥ N%" / "混合舱位 ≥ N%" and "dynamic pricing included" / "含动态定价" |
| DL-06, A11Y-09 | Local fetch shown as HH:MM only; a provider time in the future read "just now" | Future beyond the skew → unknown, paired with "fetched on this device at <day, time>" |
| DL-08, A11Y-11 | A saved age later than the clock; a test that could not fail | Freshness drops an age it cannot compute; `api_calls_used` null says "calls not known"; unit tests for 3 calls / unknown / cache age / future save |
| A11Y-06, L10 | The chip row overflowed at 390 English with no hint | Measured with ResizeObserver; `data-overflow` fades the edge and pads the end; the 320 test checks gutters or the hint |
| A11Y-08 | h1 then h3 | Card route is an h2 |
| A11Y-10 | The zone test ran only in UTC | A describe that sets `TZ=Pacific/Honolulu` and proves it is in effect |
| A11Y-13, L13 | `searchByText` split `evidenceShot` from its doc comment | Moved above it |
| DL-10, L05 | Evidence screenshots older than the code; full-page capture cut at the viewport after `.app-main` became the scroller | Capture expands `.app-main` and the viewport for the shot; screenshots regenerated after the fixes and looked at |
| L01 | Header fixed height clipped at larger text | `min-height` |
| L04 | Overflow checks read the document, not `.app-main` | `overflows()` checks both |
| L07 | Card line heights and gaps differed from S01/§13 | Spacing tokens on the card lines |
| L09 | One scroll offset shared by all tabs | Scroll position remembered per path |
| L11 | Sticky block stayed on in landscape (§11) | `max-height: 500px` makes it static |

Refuted (no change):
- DL-04 — "an English-only bundle hides the device language from the page". The verifier built a scratch WKWebView probe with the app's bundle settings and ran it on throwaway simulators (iOS 26.5 and 18.3) set to zh-Hans-CN: `navigator.language` was "zh-CN" either way; in English, "en-US". The scratch simulators were deleted. Not tested below iOS 18.3 (deployment target 15). The in-app language setting is T11.
- A11Y-07 — safe area and the sticky header are Simulator-layer checks (docs/06); the fixture page has no inset, and this file already records them as not verified.
- A11Y-12 — the fixture host picks legacy vs unknown coverage by row count, not scenario id; every current scenario gets the right state, and changing that needs an edit to the handoff's scenarios.json.

## Gates

Final run, after the review fixes, in the worktree (`export PATH="$HOME/.local/node-arm64/bin:$PATH"`):

| Gate | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm lint` | 0 errors, 1 warning — the existing web `src/components/grid/grid-table.tsx` virtualizer (`react-hooks/incompatible-library`), untouched here |
| `pnpm test` | root 919 passed / 2 skipped; core 842; ios 659 |
| `pnpm --filter @awardgrid/ios build` | pass; `check-fixture-free-bundle`: 18 files, no fixture markers |
| `pnpm build:landing` | pass |
| `pnpm build` (worktree only, never the main checkout) | pass |
| `pnpm exec playwright test --config=playwright.uiux.config.ts` | 72 passed (harness 10, foundations 26, workspace 4, query editor 18, mobile results 14); nothing left loopback |
| Evidence | `UIUX_EVIDENCE=1 … mobile-results.spec.ts -g "results at 390"` → 2 passed (`evidence/raw/t07-evidence-run.log`) |

## Acceptance

- A12 — 390 default: header 52 at y 0, summary 64, filters 44, view 44, status 28, first card at 244, x 16, width 358, every card ≥ 164; 320 wide: no horizontal overflow, miles not clipped (browser, Chinese).
- A02 / A03 component half — on the actual card: unknown fees "税费待确认" / "Fees not yet confirmed", seat count 0 "席位未提供" / "Seat count not provided", an explicit zero fee "USD 0.00", provider time "Source updated 1 d ago", legacy rows "Source update time unknown" (browser); the sentences themselves in both languages (core unit).

## Screens (looked at, against reference/screens/results-light.png and results-dark.png)

| File | What it shows |
|---|---|
| `screens/t07-results-light.png`, `-dark.png` | Chinese, 390, full page (regenerated after the review fixes): header with AI辅助, summary, filters (计划 · 1, 经停不限, 更多筛选), 列表/矩阵 with 里程升序, status (2 个选项 · 本机保存于 2 小时前 · 数据：seats.aero), two cards in miles order (75,000 with 税费待确认 / 席位未提供; 82,000 with USD 0.00 / 1 席), actions, today's quota, the tab bar |

## Not verified here

- Simulator / device: notch and home-indicator safe areas around the sticky header and the tab bar; Dynamic Type; VoiceOver reading the cards and the language switch.
- The Phase 5 Simulator driver still reads the pre-T07 layout (U-028).
