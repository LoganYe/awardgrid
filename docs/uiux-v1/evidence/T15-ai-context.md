# T15 · AI context and trusted result references: evidence

**Scope verified:** unit tests (core and iOS) and the iOS browser mock.
- Browser: Chromium, fixture host on 127.0.0.1:4310.
- Size, themes and languages: 390 × 844, plus 390 × 600, 390 × 700 and 320 × 568; light and dark; English and Chinese.
- Anthropic: the fixture's scripted transport (`ai: true`). It answers one synthetic text and records each question's context shape, never its text, key or headers.
- Scenario: `complete`, with a stand-in keyboard where stated.

**Not run:**
- No real Anthropic or seats.aero request: a live key is not authorised.
- No iOS Simulator or device: the WKWebView keyboard, VoiceOver on the page and its references, and the real follow and "New content" behaviour under touch scrolling.

Worktree: `/Users/yegaoyang/Desktop/workspace/awardgrid-uiux`.

## What was built

- **`apps/ios/src/ask/context.ts`** (U-050):
  - `buildAIContext` (the plan's interface).
  - `attachedRows`: R1… with seats.aero's values and null unknowns.
  - `lastSearchOf`, which now carries all the search's conditions.
  - `entryContext` and `readEntryContext`.
- **`ask/ask-service.ts`:**
  - The context comes from the workspace's displayed snapshot and selection.
  - `preview()` is the builder a question uses.
  - `ask(text, includeSearch, attachRows, shown)` refuses a search that changed after it was shown.
  - Each entry records what went with it (`context`).
  - Ask again sends the results it was sent with, or nothing.
  - Earlier questions are counted as questions.
  - The page is redrawn on workspace changes.
- **Core** (additive; no existing core test edited):
  - `prompt.ts`: `AttachedRow`, and the conditions, coverage and attached-results lines.
  - `loop.ts`: passes `attached` and `coverage` through.
  - `conversation.ts`: `EntryContext` and `AskEntry.context`.
- **The page:**
  - `screens/AskScreen.tsx`, `ask.css` and `ask/ask-copy.ts` (en/zh): a full-height page with its header, the context panel (approved `ai.query_only` / `ai.selected` rows), the conversation oldest first with the `ai.new_content` button, and the composer. New conversation asks first.
  - `components/AskEntry.tsx`: what went with each question, and its references as 44pt links to their cards. Actions are translated; the engine's lines are marked English.
  - `App.tsx`: `/ask` is a full page.
  - `SearchScreen.tsx`: the Ask links carry their return focus.
  - `DetailScreen.tsx`: "Return to AI assistance" when details were opened from Ask.
  - `styles.css`: the old Ask container rule is removed.
- **Fixture:** `ai=1`, `scriptedAnthropicFetch`, and `FixtureRequestLog.anthropicContext` (a shape only).
- **Tests:**
  - New files:
    - `ask/context.test.ts`: 15 tests, including the plan's Step 1 test verbatim.
    - core `ask/prompt-context.test.ts`: 3 tests.
    - `e2e/uiux/ask.spec.ts`: 13 tests.
  - Changed:
    - `ask-screen.test.ts`: +2, others updated (U-050).
    - `onboarding.spec.ts`: +1; the keyboard test was split (U-050).
    - `workspace.spec.ts`.
    - `locale-parity.test.ts`: the Ask table was added.
    - `helpers.ts`: the `ai` option, `anthropicContexts`, and the stand-in keyboard.

## Test-first record

| Step | Command | Result |
|---|---|---|
| Red | `pnpm --filter @awardgrid/ios exec vitest run src/ask/context.test.ts` | exit 1: `Cannot find module './context'` (`evidence/raw/t15-red.log`). This was the plan's Step 1 test, verbatim |
| Green | same | 1 test, then 11 with the Step 4 counter-examples (wrong ref, empty selection, cap, nulls, query-only payload, search off, mismatch sends nothing, partial coverage, Ask again), then 15 after the review |
| Browser | `ask.spec.ts` | First run: 3 failures. The expected search summary was wrong (the scenario's clock gives Oct 18–31, with no program), and the details page's Back is named "Return to results". Opened from Ask it now says "Return to AI assistance", and focus returns to the reference |
| Suite | full browser suite | 2 failures where Ask was assumed to have the tab bar. Both tests were updated with reasons (U-050) |
| Screens | t15-ask-light/dark.png looked at | The first shot showed a resize grip on the text box (fixed) |
| Review | adversarial workflow: 3 finders (payload truth; UX, a11y, l10n and layout; regressions and test integrity), one refuting verifier per finding | 27 findings: 21 confirmed (7 major), 6 refuted. All 21 are fixed, as below |

## Review (adversarial)

| Finding | What was wrong | Fix |
|---|---|---|
| CTX-1, REG-02 (major) | The earlier-questions count was committed messages ÷ 2, so a question that used a tool counted twice, on the page and in ask.json | Committed user turns that start with text. Unit test with a tool round; the fixture counts the same way |
| CTX-2 (major) | The context line listed a mileage cap, mixed-cabin % and dynamic pricing that were never sent | They are now sent, on their own line when set, and the seven-field JSON keeps its bytes (an existing core test pins it). Unit tests |
| CTX-3, UI-9, REG-05 (major) | The page did not redraw when the displayed search changed, so it could name A and send B | The service redraws on workspace changes, and `ask()` carries the snapshot shown: a different one on screen sends nothing (`search_changed`). Unit test |
| UI-1 (major) | Back from Ask dropped focus to `<body>` | Both Search links carry their id; Back returns focus there. Browser test for both links |
| CTX-4, UI-5, REG-03 | A selection from an earlier search vanished without a word | `preview().selected` counts the raw selection, and the page says it cannot be attached. Unit render test and browser test |
| UI-2 | With the keyboard at 320 × 568 the header went off screen and no conversation showed | The context panel shrinks (30%, then 64 while typing), the conversation keeps at least 96, and New conversation gives way while typing. Browser test with the stand-in keyboard |
| UI-3 | At 320 and 200% the title collapsed under New conversation | The header wraps and the title is sized by its words. Browser test |
| UI-4 | Reference links were 16 px tall | The whole row is one 44pt link. Browser test |
| UI-6, REG-01 | Answers and failure lines were in the secondary grey | Only secondary lines are grey. Browser test comparing computed colours |
| UI-7 | The old `.ask-screen` rule added gaps and a 720 column | Removed. Browser test that the header, context, conversation and composer meet edge to edge |
| UI-8 | A missing-key callout below a saved conversation was out of view | The follow logic includes the callouts. Browser test |
| REG-07 | The only check that the tab bar gives way to the keyboard was removed | Moved to the Anthropic key page |
| REG-09 | A refusal was asserted inside try/catch | `toThrow(objectContaining({ code }))` |
| REG-10 | The wiring view offered a New conversation that did nothing | Not offered there. Unit test |
| REG-11 | The page used its own wording where approved rows exist | `ai.query_only`, `ai.selected` and `ai.new_content` |

Refuted (6):
- **CTX-5** (Ask again ignores the page's checkbox): unchanged from before T15. Ask again repeats the entry's own choice.
- **REG-04** (the Search scroll position is lost after Ask): it was also lost at HEAD. Focus now brings the link back into view.
- **REG-06** (the save-failure bar is not on the Ask page): Ask is a full page like the editor, and the bar shows on return. Recorded as a known issue.
- **REG-08** (a test stand-in without `preview`): test tidiness, no wrong behaviour.
- **REG-12** (the reasons for test changes were not recorded yet): the records are written at the end of each task; U-050 has them.
- **REG-13** (the Phase 5 device driver reads the first entry): that driver is already recorded as out of date (U-028, carried to T21/T22).

## Gates

Final run after the review fixes, in the worktree:

| Gate | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm lint` | 0 errors; 1 warning in the existing web `grid-table.tsx`, which is untouched |
| `pnpm test` | root 919 passed / 2 skipped; core 941; iOS 762 |
| `pnpm --filter @awardgrid/ios build` | pass; fixture-free (18 files) |
| `pnpm build:landing`, `pnpm build` (worktree) | pass; no tracked file changed |
| `pnpm exec playwright test --config=playwright.uiux.config.ts` | 190 passed; T15 added ask 13 and onboarding +1 (`evidence/raw/t15-full-run.log`) |
| Evidence | `UIUX_EVIDENCE=1 … ask.spec.ts -g "Ask with attached results at 390"`: 2 passed (`evidence/raw/t15-evidence-run.log`) |

## Acceptance

- **A26** (verified in unit tests and the iOS browser mock):
  - The context panel equals the payload. The scripted Anthropic records exactly the search, R1/R2 and the earlier count the page said.
  - The unit tests prove the query-only, attached, search-off, partial-coverage, full-conditions and refused cases through the real service.
  - References identify the right snapshot: each R-link opens that row's card in its snapshot, and focus comes back.
  - The newest is at the bottom, and a reader scrolled up is not moved and gets "New content".
  - Opening the page sends nothing.
  - Leaving it does not stop a question (Search shows "AI assistance (working)").
- **A21** remains partial. Ask's page is translated; a question's steps, endings, failures and meta line stay English, marked, until T17.
- **Not verified here:** a live Anthropic answer, and the WKWebView keyboard and touch scrolling on a device.

## Screens (looked at)

At 390 in Chinese, light and dark:

| File | What it shows |
|---|---|
| `screens/t15-ask-*.png` | The 询问 Claude header with 新对话. 随问题发送 · 附带查询条件及2个所选选项。 · 查询：HKG → SEA · 10月18–31日 · 商务舱、头等舱 · 还会发送本次对话中之前的 1 组问答。 · the two choices checked. The entry: 比较这两个。, 发送时附带了查询和 2 个结果：, R1/R2 as full-width links to their cards, the synthetic answer in the reading colour, 数据：seats.aero, and the meta line (English, marked). The composer is at the bottom |

## Not verified here

- The Simulator or a device: the keyboard, touch scrolling and VoiceOver.
- Live Anthropic: the answer's own use of R1/R2.
- Tool-layer approval of changed conditions is T16; Stop wording and interruption are T17.
