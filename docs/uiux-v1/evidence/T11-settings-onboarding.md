# T11 · Settings, first run, both languages, the keyboard: evidence

**Scope verified:** unit tests (core and iOS) plus the iOS browser mock.
- Browser: Chromium, fixture host on 127.0.0.1:4310.
- Sizes: 390 × 844, and 320 × 568 with text at 130, 160 and 200%.
- Themes and languages: light and dark, English and Chinese.
- The keyboard is a stand-in visualViewport. The clipboard is a stand-in that counts reads.
- Key checks went to the fixture's synthetic seats.aero and Anthropic transports.

**Not run:**
- iOS Simulator and a device: the real software keyboard, the Keychain, the WKWebView clipboard, VoiceOver, and the status bar under a chosen theme (U-042).
- A live seats.aero key check. It was not authorised, because it spends a call.

Worktree: `/Users/yegaoyang/Desktop/workspace/awardgrid-uiux`.

## What was built

**Core**
- `packages/core/src/lib/seatsaero/key-check.ts`: checks a seats.aero key with one counted call. It separates a malformed key and a used-up day from a refused key, and nothing in it throws (U-041).
- `present.ts` COPY: all 47 approved rows, in both languages (U-037).

**iOS shell and settings**
- `app/settings-store.ts`: language and appearance, saved on the device.
- `ShellEffects` (App.tsx): applies the theme, `<html lang>` and the keyboard inset to every route (U-039, U-040).
- `app/keyboard.ts`: the keyboard inset (U-040).
- `app/WithTail.tsx`: marks the English messages that end a translated sentence.
- `app/focus.ts`: page titles take focus on arrival.
- `screens/SettingsScreen.tsx`, `settings-copy.ts` and `settings.css`: the five S08 groups, the seats.aero key page, and the Anthropic key page (U-038).

**First run and translation**
- `screens/OnboardingScreen.tsx`: the welcome and the made-up example.
- The query editor, text search and Watches are translated: `components/query/labels.ts` and `screens/watches-copy.ts`. Watches' stop confirmation is now a sheet.
- `components/results/copy.ts`: the no-key callout is now a "Connect seats.aero" link, and the chrome's data line is translated. That line is hidden on Settings and on the example.
- The Ask screen shows "Connect Anthropic" in the screen's language. Ask's own chrome stays English, marked `lang="en"`, until T15–T17 (U-039).
- `Sheet.closeLabel` is required.

**Tests**
- New: `locale-parity.test.ts` (every copy table in both languages, Han characters required in Chinese, parser-readable Chinese examples), `keyboard.test.ts`, `settings-store.test.ts`, `key-check.test.ts`, and `e2e/uiux/onboarding.spec.ts` (18 tests).
- Extended: `honesty.test.ts` now scans the `copy()` rows the shell renders (U-043).

## Test-first record

| Step | Command | Result |
|---|---|---|
| Red | `pnpm exec playwright test --config=playwright.uiux.config.ts e2e/uiux/onboarding.spec.ts` | exit 1, 9 of 9 failed: no welcome, no key page, no "连接 Anthropic", no radio groups (`evidence/raw/t11-red.log`) |
| Core | key-check.test.ts; present.test.ts (all 47 approved rows, placeholder parity) | written before the code; green after |
| Green | onboarding spec | 7 of 9 on the first run. Ask still showed the old English callout, and the radio test read label text from the input; both fixed |
| Old tests | full browser suite | 3 failed where the old behaviour was asserted: the harness no-key test, its Anthropic positive control, and mobile-results no-key. Rewritten, with the reason in U-038. The T01 `<html lang>` check and the Chinese text-search check were updated for U-039 |
| Screens | t11-*.png looked at | Three fixes. The example carried "Data: seats.aero" (untrue) and is now hidden there. Settings showed that line twice (About already says it), so the chrome line is hidden on Settings. The example program was English on a Chinese screen and is now "示例计划". The Chinese example chip that wrapped onto two lines was shortened. The Anthropic page title was too small, because the older heading rule overrode it; fixed |
| Checks of the checks | overflow detector, the keyboard tests | An injected overflow is caught. Removing `useKeepInView` or the focused-field reveal makes its test fail (566 vs ≤ 494.5; 503 vs ≤ 409.5; 419 vs ≤ 389.5) |
| Review | adversarial workflow (3 finders: data, keys and spend; accessibility, bilingual and tests; layout and keyboard), one refuting verifier per finding | 24 findings: 21 confirmed (4 major), 3 refuted. 20 fixed, as below. One is a recorded native gap (U-042) |

## Review (adversarial)

| Finding | What was wrong | Fix |
|---|---|---|
| KEYS-1, ERR-9 (major) | With the day's quota used up, `reserve` threw before the check's `try`. "Check and save" stopped with no message, and the rejection went unhandled | "quota" outcome with nothing sent; engine and screen never throw; translated sentence; unit test at the soft limit |
| L/F1 (major) | The keyboard was detected from the covered part, so a view panned up to a field (320 × 568, 260 pt, panned 180) read as closed, and the submit went under the keyboard | Open from the keyboard's own height; inset = covered part; unit cases and a panned browser test |
| L/F2 (major) | After the editor shrank, the field being typed in sat behind the footer that moved up; the test only checked focus | The focused field is revealed when the keyboard opens; the tests assert that the field is above the footer (and fail without the fix) |
| L/F3 (major) | At 320 wide and 200% text, "seats.aero" ran into "Key on file ending in …" | The label and value wrap onto separate lines. The row keeps them apart. Tested at 1–2× in English and Chinese with keys on file: no overlap, and no text past its box |
| KEYS-2 | A key with an inner space was reported as "seats.aero did not accept this key", though nothing was sent | "malformed": its own sentence, nothing sent |
| KEYS-3 | Removing the seats.aero key reported success without reading the Keychain | Read again; "still on this device" / "could not confirm" otherwise |
| KEYS-4 | The Connect Anthropic panel and About understated what goes to Anthropic | The full list (question, earlier turns, the included search, the results Ask reads) |
| A11Y-1 | The Anthropic page marked its own Chinese results `lang="en"` | Only the service's English sentences, and English tails, are marked; zh unit test |
| I18N-2 | The discard sheet's close button was named "Close" in English | `closeLabel` required; translated "关闭"; every sheet passes one |
| I18N-3 | Stopping a watch used `window.confirm`, whose iOS buttons are English | An in-app sheet, in Chinese; browser test (no native dialog) |
| I18N-4 | English engine and Keychain messages inside Chinese sentences were unmarked | `WithTail` marks them `lang="en"` (Watches status, both key pages) |
| A11Y-5 | Focus was lost on the key pages: on arrival, after save, after removal, and on the way back | Titles focused on arrival; "Start searching" after a save; the field after a removal; the row on return; the welcome's link on return from the example; asserted |
| A11Y-6, L/F7 | The Anthropic page had no h1 and fixed 13/15 px text | h1 page title; text sizes that grow with the text size; added to the 320/130–200% sweep |
| TEST-7 | The honesty scan could not see `copy()` rows | Scans every literal `copy()` key in both languages (U-043). It caught "Keep watching" / "继续关注" |
| TEST-8 | The parity test counted a Chinese colon as Chinese | A Han character is required; a test of the check itself |
| TEST-11 | Removing one key and keeping the other was not tested | A browser test in both directions |
| L/F5 | Two filled buttons after a save when a new key was typed | "Start searching" only while the field is empty |
| L/F6 | "Connect Anthropic" was styled and announced as an error | A plain card with a labelled heading; no alert |
| L/F4 | A chosen Light/Dark theme does not set the iOS status bar | Not fixed. It needs native code that can only be checked on a device: U-042, carried to T21 |

Refuted (3): the Chinese examples search different routes than the English ones (not a defect: each language's examples read completely); the language-switch test cannot tell a remount apart (the code switches in place, and the test's claim holds); no tab is marked current on the example (the same pattern as the other sub-pages).

## Gates

Final run, after the review fixes, in the worktree (`export PATH="$HOME/.local/node-arm64/bin:$PATH"`):

| Gate | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm lint` | 0 errors, 1 warning: the existing web `grid-table.tsx`, untouched |
| `pnpm test` | root 919 passed / 2 skipped; core 913; iOS 696 |
| `pnpm --filter @awardgrid/ios build` | pass; `check-fixture-free-bundle`: 18 files, no fixture markers |
| `pnpm build:landing` | pass |
| `pnpm build` (worktree only) | pass |
| `pnpm exec playwright test --config=playwright.uiux.config.ts` | 140 passed: harness 10, foundations 26, workspace 4, query editor 18, mobile results 14, views 15, matrix 16, details 19, onboarding 18 (`evidence/raw/t11-full-run.log`) |
| Evidence | `UIUX_EVIDENCE=1 … onboarding.spec.ts -g "first run and settings at 390"` → 2 passed (`evidence/raw/t11-evidence-run.log`) |

## Acceptance

- **A20: seats.aero first, AI key optional, clipboard only when asked, keyboard never covers submit.**
  - The first run offers "Connect seats.aero" first and never asks for the Anthropic key. The key is asked for only at the first AI entry, and search, results and watches work without it.
  - "Paste" is the only clipboard read: a count of 0 before it and 1 after.
  - The check's cost is stated before the check. It sends exactly one request. Only an accepted key is saved, and only its last four characters are shown afterwards.
  - Removing one key leaves the other and keeps today's call count.
  - Keyboard (browser stand-in only): the editor's submit and the typed-in field stay above the keyboard, including when the view is panned at 320 × 568. Ask's button comes up with its box, and the tab bar gives way.
  - Not checked with a real keyboard.
- **A21: parity, no truncation, dates not shifted.**
  - Every shell copy table has the same keys in English and Chinese, and every Chinese entry has Han characters.
  - Nothing runs off the side or is cut at 320 × 130/160/200% on the first run, the example, Settings, both key pages, the editor and Watches.
  - Settings rows keep label and value apart at up to 200% text.
  - The query's UTC day is covered by T06's test.
  - **Partial:** Ask's own chrome is English (marked) until T15–T17 (U-039).

## Screens (looked at)

All at 390, in Chinese, light and dark:

| File | What it shows |
|---|---|
| `screens/t11-welcome-*.png` | The first run: what the app does, 连接 seats.aero (primary), 查看示例 |
| `screens/t11-settings-*.png` | The five groups; the key rows "未连接"; theme and language radios; the cache note and what it keeps; About with the full list of what goes where; no duplicated data line |
| `screens/t11-seats-key-*.png` | 连接 seats.aero: purpose, where to get a key, the 48 pt password field and 粘贴, the approved cost sentence, 检查并保存 |
| `screens/t11-anthropic-key-*.png` | The Anthropic key page: its title as the page title, use, what is sent, pricing link, the field |
| `screens/t11-example-*.png` | 示例结果: 虚构示例数据，并非实时库存 above and below; 示例计划; fees known and unknown; no source time; no data line |
| `screens/t11-editor-*.png` | 编辑查询 in Chinese: the text search with Chinese examples, the fields, 查找兑换选项 |

## Not verified here

- **Simulator or device:**
  - The real software keyboard: visualViewport in WKWebView, panning, rotation, and an iPad hardware keyboard.
  - Keychain saves and removals, and the clipboard permission prompt.
  - VoiceOver on the radio groups, sheets and English tails.
  - The status bar under a chosen theme (U-042).
- **A live seats.aero key check:** not authorised, because it spends a call. seats.aero's real response to the smallest Cached Search is assumed from the documented API and the web's `validateSeatsAeroKey`.
