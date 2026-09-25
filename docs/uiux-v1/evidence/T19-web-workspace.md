# T19 · Web professional workspace, exclusive side panels, keyboard: evidence

**Scope verified:** unit tests and the Web mock.
- The Web mock is this worktree's real Next app, with a stand-in seats.aero and the synthetic accounts (U-053).
- Chromium was run in two setups:
  - the `web-desktop` project (1440 × 900, fine pointer, no touch), resized to 1920, 1280, 1024, 768 and 390;
  - desktop width with touch emulation, where `pointer: coarse` matches.
- Light and dark, English and Chinese.
- The existing Web e2e was re-run as a regression.

**Not run:**
- WebKit or Firefox, and a real touch device.
- VoiceOver or NVDA on the palette, the matrix grid or the panels.
- A real IME: the composition case is a synthetic keydown with `isComposing` and with keyCode 229.
- A live seats.aero key, and any Anthropic request: the assistant panel opens, but no question is sent.

Worktree: `/Users/yegaoyang/Desktop/workspace/awardgrid-uiux`.

## What was built

See U-054.
- **Pure rules**, each tested:
  - `panel-state.ts`: one slot, holding none, assistant or detail.
  - `keyboard.ts`: which key is a shortcut, never while typing or composing.
  - `commands.ts`: the palette's own actions.
  - `prefs.ts`: the view chosen by hand and shortcuts on or off, per account.
  - `query-draft.ts`: codes, the blank draft, errors in field order, and the local "today".
- **Components:**
  - `workspace-shell.tsx`: the 72 rail, a bottom bar below 768.
  - `workspace-app.tsx`: the page, one draft, one panel slot, the keyboard.
  - `query-bar.tsx`: the top query.
  - `results-toolbar.tsx`: conditions, view and sort.
  - The three views: `list-view.tsx`, `calendar-view.tsx` and `matrix-view.tsx`.
  - `detail-panel.tsx`: the 400 panel, with Get Trips only on request.
  - `command-palette.tsx`.
- **Shared, additive:**
  - `DrawerShell` gains a `container` prop (the docked mode) and its CSS.
  - `AskDrawer` gains a `panel` prop (title, width, container, test id, class).
  - The Web Ask prompt now says unreported seats and fees are unreported.
- **Styles:** `src/styles/workspace.css` uses Quiet Precision tokens, with the Web's names aliased inside the workspace.
- **Copy:** `workspace.*` keys in en and zh; the approved rows come through `copy()`.
- **Tests:**
  - New: `src/components/workspace/t19-units.test.ts` (18).
  - New: `e2e/uiux/web-layout.spec.ts` (43; the first is the plan's Step 1 test verbatim, importing the harness's `./test`; 23 are the review's regression cases).
  - `src/lib/ask/options.test.ts`: one case added.
  - UI/UX config: the `web-desktop` project.

## Test-first record

| Step | Command | Result |
|---|---|---|
| Red | `pnpm exec playwright test --config=playwright.uiux.config.ts e2e/uiux/web-layout.spec.ts` | Failed: waiting for the `AI辅助` button (`evidence/raw/t19-red.log`). This was the plan's Step 1 test, verbatim |
| Green | same | 1 test, then 20 with Step 4's cases, then 43 with the review's |
| Step 4 | `web-layout.spec.ts` | See "Step 4 cases" below. First runs failed for four reasons, each fixed: <ul><li>Controls under 44 with a coarse pointer: the Web's global touch rule outranked the class, so inputs now take a height.</li><li>A 390 page wider than the screen in English: the long cabin-mix option, so selects and the conditions row now shrink.</li><li>The phone panel measured mid-slide: the test now waits.</li><li>A test's own click scrolled the page: the test now opens panels from controls already on screen.</li></ul> |
| Screens | `UIUX_EVIDENCE=1 … web-layout.spec.ts -g "evidence at 1440"` | 2 passed (`evidence/raw/t19-evidence-run.log`); looked at, then taken again after the review |
| Review | adversarial workflow (below) | 26 confirmed, all fixed; 4 refuted |

### Step 4 cases (`web-layout.spec.ts`)

- **Geometry, measured in the browser:**
  - At 1440: rail 72 at x 0; main 1320; with the assistant 936, then 24, then 360, ending 24 from the edge; with a detail 896, then 24, then 400.
  - The content stops at 1600 on a 1920 screen.
  - At 1280 the panel still docks.
  - At 1024 and 768 it overlays (modal), the results keep their width, and focus returns to the opener.
  - At 390 in Chinese and English: no sideways scroll, a fixed bottom bar with 44 × 44 targets, and a 390 × 844 sheet.
- **Opening and closing a panel** keeps the scroll, the view and the conditions, and posts nothing to `/api/ask`.
- **Three views:** list, calendar (every cabin) and matrix hold the same row keys of the same snapshot id, and switching sends no `/api/find`.
- **Default view:** more than one route opens on the matrix; a view chosen by hand survives a reload.
- **Hard conditions** (stops, arrival airports, cabins) send nothing until Find. The page says the conditions changed, "Discard changes" restores them, and Find sends exactly one `/api/find`. Nothing calls `/api/parse` or `/api/ask`.
- **A broken code** is named, takes focus and runs nothing.
- **Keyboard:**
  - `/` from the page focuses the query. Inside a field it is text. A composing key is left alone.
  - Cmd/Ctrl+Enter outside the query runs nothing; inside, it is one Find.
  - The palette: opened by Cmd/Ctrl+K and by the visible Commands button; modal; 560 wide, 48-high search, 44-high options; "rm -rf" matches nothing; Enter on 矩阵 switches the view; Esc returns focus.
  - Shortcuts turned off stay off after a reload; the hints disappear and every control remains.
- **Matrix:** one tab stop; arrows and Ctrl/Cmd+End move; Enter opens; Esc returns to the cell.
- **Details:** opening one sends nothing, and says what loading will cost. "View flight itineraries" sends one Get Trips, and the header re-reads `/api/usage`.
- **Coarse pointer at 1440:** every visible control is at least 44 tall, the panels' included (after the review).

## Review (adversarial)

Workflow: 3 finders (layout, panels, keyboard and a11y; product rules and honesty; regressions and test integrity), then one refuting verifier per finding, which reproduced each claim in the real app on private ports before confirming it.
- **Count:** 30 findings. 26 confirmed, 8 of them major after verification. 4 refuted.
- **Duplicates:** LAY-4 = REG-4, LAY-6 = REG-2, LAY-9 = REG-6, LAY-10 = REG-3, LAY-11 = REG-5.
- **All confirmed findings are fixed.** Each has a regression case: the browser cases in `web-layout.spec.ts` are named by the finding's id; LAY-7 and PRD-10 are unit cases in `t19-units.test.ts`, and PRD-1 is both.
- **Red evidence:** the verifiers' own reproductions on the unfixed build. Unlike T18, the fixes were not reverted one by one to re-run red.

| Finding | What was wrong | Fix |
|---|---|---|
| LAY-4, REG-4 (major) | Switching from one panel to the other gave the new panel the old one's opener, so Esc sent focus to the wrong control | The page passes each panel the control that opened it. DrawerShell hands focus back only if it is still in the closing panel or on the page body. Tested both ways |
| LAY-5 (major) | An absolutely placed screen-reader label in the list's header widened the page at 768–1005 | The table and matrix wrappers are positioned. `scrollWidth` is checked at 1024, 900 and 768, in English and Chinese, before and after a panel |
| LAY-6, REG-2 (major) | Below 768 the fixed bar covered the footer's Legal link | The bar's height is kept below the footer (`body:has(.ag-ws)`), and the bar is exactly that height (its line is a shadow). Tested on the workspace and on Saved |
| PRD-1 (major) | City codes (TYO) went out unexpanded, spent a call, and read as "not monitored" | Core `expandPlace` and `resolveAlias`: TYO becomes NRT and HND, names like Tokyo or 东京 work, and SHA is the metro, as the grid reads it. The bar shows "TYO means NRT, HND." Any other three-letter code is taken as an airport, as core does |
| PRD-3 (major) | Only the first coverage sentence was shown, without its routes, over the projected rows | Every `coverageNotices` entry, naming its routes, over the snapshot's own rows (U-031), plus a notice when dynamic-priced options are left out. The toolbar gains "Include dynamic-priced results", the condition that notice points to |
| REG-1 (major) | The ios project's own `testIgnore` replaced the config's, so iOS-only runs listed the Web specs again | The project repeats the UIUX_WEB=0 exclusion. `--list` gives 203 with UIUX_WEB=0 and 254 otherwise (`evidence/raw/t19-review-ios-only-list.log`) |
| REG-3, LAY-10 (major) | With a coarse pointer, the panels' Close, Ask's pills, suggestions, question and Send were 40; with a fine pointer, Close was 28 | 44 inside the workspace's panels for a coarse pointer (`.ag-ws-tokens`), and Close at least 36 with a fine one. The grid's drawers are unchanged. The coarse test now opens both panels |
| LAY-1 | Crossing 1280 with a panel open lost focus to the page. The trap also counted a disabled Send as its last stop, so Tab left a modal Ask | DrawerShell refocuses a panel drawn anew, and skips disabled and inert elements when trapping. The trap fix predates T19 and helps the grid's Ask too |
| LAY-2 | The palette's scrim sat under an overlay panel | The palette stacks above every drawer. Esc closes the palette, then the panel |
| LAY-3 | The palette's "Focus the query" put focus behind a modal panel | A modal panel closes first, then the query takes focus. The same applies to a Find error |
| LAY-7 | Ctrl+K on a Mac (delete to the end of the line) was taken | The platform's own modifier only. `aria-keyshortcuts` names it. Unit cases |
| LAY-8 | Arrowing through the palette left the active option out of view | It is scrolled into view |
| LAY-9, REG-6 | Esc in the Programs popover closed the panel behind it | The popover takes its own Esc (focus back to its summary) and closes when focus leaves it |
| LAY-11, REG-5 | At 1440×900 the docked assistant's composer began below the fold | The slot's height runs from where its column starts on screen (measured on scroll and resize) to 16 above the bottom. Tested in English and Chinese at scroll 0 |
| LAY-12 | At 320 and 390 the calendar's seven columns clipped every label | In a narrow month it is a list of full dates (a container query). The arrows move a day. Tested at 390 and 320 |
| PRD-5, PRD-6 | Edits made during a search were dropped when it landed, and during a search its own conditions were said to be "changed" | The draft tracks what it was made from and what is running. A draft edited since stays, and is said to differ; the running draft is not "changed" |
| PRD-7 | A mileage cap of 0 blocked Find with no word, and focus went to From | The error shows under the cap, which takes focus |
| PRD-8 | Find sent the sort the draft was made with, undoing the view's later choice (U-030) | Find carries the view's sort |
| PRD-10 | A new search defaulted to business only, over 31 days | Core's `DEFAULT_CABINS` (J and F), over 30 days including today |
| REG-7 | An Esc that belongs to an IME (keyCode 229) closed the docked panel | The Esc path ignores 229 too |

Refuted (4):
- **LAY-13** (200% text at 390): T21's cross-size task. The Web has no text-scale setting.
- **PRD-2** (a reload of an address with `?q=` runs its search): decided in U-053 and U-054, and the grid's convention since v0.2. The server cache usually answers.
- **PRD-4** (Enter in a query field searches): the form's implicit submit is the Find button itself, the explicit action.
- **PRD-9** (the Ask cell context has no fee currency): predates T19, in code T19 does not change.

Test flakes met while adding the cases. None were app faults:
- the overlay measured mid-slide;
- a key pressed before a heading's focus moved; that focus is now set in an effect, not a frame callback, which is also sturdier for people;
- a scroll during a client-side navigation.

## Gates

Final run after the review fixes, in the worktree:

| Gate | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm lint` | 0 errors; 1 warning in the existing web `grid-table.tsx`, which is untouched |
| `pnpm test` | root 949 passed / 2 skipped; core 960; iOS 795 (`evidence/raw/t19-unit.log`) |
| `pnpm --filter @awardgrid/ios build` | pass; fixture-free |
| `pnpm build:landing`, `pnpm build` (worktree) | pass |
| `pnpm exec playwright test --config=playwright.uiux.config.ts` | 254 passed; T19 added web-layout 43 (`evidence/raw/t19-full-run.log`). With `UIUX_WEB=0`, `--list` gives 203 and no Web spec (`evidence/raw/t19-review-ios-only-list.log`) |
| `pnpm e2e` (existing Web e2e, worktree) | 583 passed / 145 skipped / 0 failed, the same as the baseline, after the review fixes to the shared DrawerShell. The grid's cell and Ask drawers still pass (`evidence/raw/t19-web-e2e.log`). The tracked `docs/screenshots/v0.2` it rewrites were restored |

## Acceptance

- **A31** (verified in the Web mock):
  - The S10 columns at 1440 were measured.
  - The detail panel is 400 and the panels are mutually exclusive.
  - Below 1280 a panel overlays; below 768 the page is one column with a full-height panel.
  - The three views are equivalent over one snapshot.
- **A32** (verified in unit tests and the Web mock):
  - Every shortcut has a visible control.
  - No single key is taken while typing or composing (unit tests on the rule; a synthetic composition in the browser).
  - Shortcuts can be turned off and stay off.
  - A real IME and screen readers are unverified.

## Screens (looked at)

At 1440 unless stated, in Chinese, light and dark, with the `multi-program` account:

| File | What it shows |
|---|---|
| `screens/t19-web-1440-assistant-*.png` | The rail (查票 current), 查票工作区 with 命令 ⌘K and AI辅助 (pressed), the query (出发机场 HKG → 目的机场 SEA, 10/01–10/30, 商务舱 and 头等舱 checked, 查找兑换选项 ⌘↵), the conditions (1 个计划, 经停不限, 每一段都是所选舱位, 包含动态定价结果, 里程上限 不限) and 列表/日历/矩阵. Then 2 个选项 with 数据：seats.aero, and the list: 75,000 and 110,000 Aeroplan, 税费待确认, 席位未提供, 来源 1 天前更新, each with 查看选项 and 收藏选项. The assistant is docked at 360 on the right, its question box and 发送 in view at 1440×900 |
| `screens/t19-web-1440-matrix-*.png` | The matrix scrolled to 10月18日: that cell outlined, 75,000 商务舱 and 110,000 头等舱, Aeroplan · 席位未提供. The other days read 商务舱 无匹配 / 头等舱 无匹配 (complete coverage). The docked assistant stays in view |
| `screens/t19-web-1024-overlay-*.png` | At 1024: the detail panel over a scrimmed page. HKG → SEA, 10月18日 · 周日 · 商务舱, 75,000 里程, the program with the approved help line, 税费待确认, 席位未提供, 来源 1 天前更新, 请在计划网站核验库存与税费。, 收藏选项, 复制查询条件, then 查看具体航班 with its cost note first |
| `screens/t19-web-palette-*.png` | At 1024: the palette (输入命令) with the page's own actions and their keys (/, ⌘↵, Esc), and the note that a search runs only through 查找 |

## Not verified here

- WebKit, Firefox and real touch devices; real IMEs; screen readers.
- `/grid` is unchanged. Whether the header links to the workspace, and where `/` and login land, are T20 (U-054).
- A live seats.aero key; the assistant answering (no Anthropic request is authorised).

## Corrections (T22 evidence audit, 2026-09-24)

An audit of this record against its raw logs and git (evidence T22) found the following. The text above is left as written.
- The Step 1 red ran in the `ios` project (`raw/t19-red.log`: `[ios] › e2e/uiux/web-layout.spec.ts:7:1`), before the `web-desktop` project existed.
