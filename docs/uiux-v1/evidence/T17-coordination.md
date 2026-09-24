# T17 · Request coordination, stop and interruption recovery: evidence

**Scope verified:** unit tests (iOS), integration tests through the app's own services, and the iOS browser mock.
- Browser: Chromium, fixture host on 127.0.0.1:4310.
- Size, themes and languages: 390 × 844; light and dark; English and Chinese.
- Scenarios: `complete` with the scripted Anthropic (`ai: true`, which answers after 400 ms), and `ai-stopped`, seeded in this task.

**Not run:**
- The Simulator or a device. That covers the native HTTP idle timeout (unchanged; see A28), an app really killed during a request, and VoiceOver on the Stop and waiting lines.
- No live request.

Worktree: `/Users/yegaoyang/Desktop/workspace/awardgrid-uiux`.

## What was built

- **`workspace/request-coordinator.ts`** (U-052): `RequestCoordinator.run(kind, operation, { signal, onStart })` (the plan's interface).
  - One job at a time, in order.
  - A failure rejects only its own job.
  - A job stopped while it waits rejects at once and never starts; the queue keeps its place.
  - `active()`, `waiting()`, `idle()`.
- **Wiring (`app/bootstrap.ts`):** the search port (`coordinate`), `details.getTrips`, the watch run (one job), and Ask's tool calls (`coordinate`). `AppServices.requests` gives read-only access.
- **`ask/ask-service.ts`:**
  - Each tool call is queued with the question's Stop signal.
  - A call stopped before it started becomes a `stopped` step with 0 calls.
  - A call waiting its turn is the activity `queued`; it becomes a tool activity only at `onStart`.
- **Core `ask/tools.ts`:** the `stopped` outcome, additive.
- **`ask/entry-labels.ts`** (new): a question's own lines in English (`labels.ts`) and Chinese.
  - `labels.ts` gains `QUEUED_STEP`.
  - `stoppedLabel` treats a stopped, never-started step as "before the next step began".
  - `searchFromInput` is exported.
- **`components/AskEntry.tsx`, `screens/AskScreen.tsx`:**
  - The lines, announcements and waiting line follow the page's language, with core's details marked English.
  - Stop is the approved `ai.stop` / `ai.stop_note`.
- **Fixture:** `ai-stopped` is seeded.
- **Tests:**
  - New files:
    - `workspace/request-coordinator.test.ts`: 6 tests, including the plan's Step 1 test verbatim.
    - `app/bootstrap-requests.test.ts`: 3 tests.
    - `ask/ask-coordinated.test.ts`: 1 test.
    - `ask/entry-labels.test.ts`: 8 tests.
    - `e2e/uiux/ask-stop.spec.ts`: 5 tests.
  - Changed, each with its reason in U-052:
    - `screens/ask-screen.test.ts`
    - `e2e/uiux/ask.spec.ts`
    - `e2e/uiux/fixture-harness.spec.ts`

## Test-first record

| Step | Command | Result |
|---|---|---|
| Red | `pnpm --filter @awardgrid/ios exec vitest run src/workspace/request-coordinator.test.ts` | exit 1: `Cannot find module './request-coordinator'` (`evidence/raw/t17-red.log`). This was the plan's Step 1 test, verbatim |
| Green | same | 1, then 4, then 6 after the review |
| Step 4 | `bootstrap-requests.test.ts`, `ask-coordinated.test.ts` | Four entries at once (search, watch run and lookup through the real services; the four kinds in the unit test) never overlap and all finish. At the day's last call, at most one request goes out and the count stays within the limit. A request that threw is counted (the quota moved), never guessed as none. A tool call waiting behind a watch run never starts once Stop is pressed, sends nothing, and the question ends at once. First attempts: `Quota` has no setter, so the quota file and a restored search are seeded; `active()` is set on the queue's next turn, so the test waits for it |
| Browser | `ask-stop.spec.ts` | Stop's approved words; the request out finishes, and one request only; lower-bound counts. Closed mid-question: unfinished on relaunch, and 0 Anthropic requests after it. `ai-stopped` in Chinese |
| Screens | t17-stopped-light/dark.png looked at | The ending, the lower-bound meta and 重新提问, all in Chinese. The stored question is the one the seeded conversation asked, in English |
| Review | adversarial workflow: 3 finders (queue and wiring; Chinese lines and Stop wording; regressions and test integrity), one refuting verifier per finding | 13 findings: 5 confirmed (0 major after verification), 8 refuted. All 5 are fixed |

## Review (adversarial)

| Finding | What was wrong | Fix |
|---|---|---|
| COORD-1, REG-1 | Stop did not end a tool call waiting in the queue: the question stayed running, with Stop disabled, until the job ahead finished | A job stopped while it waits rejects at once; the queue keeps its place. Tests: the job ahead never settles, and the question still ends stopped at once and is no longer running |
| COORD-2 | While a tool call waited its turn, the page said "Searching seats.aero"; a Stop there said the step "finished" | A `queued` activity with its own line until `onStart`, and the ending reads "before the next step began". Tests |
| L10N-5 | The Chinese activity line did not check or normalise Claude's input as English does | It reads the input through the shared `searchFromInput`. Tests (lower case, padding, empty, null) |
| L10N-6 | Premium economy had a different Chinese name in the step lines | Core `cabinName` (超经舱). Test |

Refuted (8):
- **COORD-3** (the key check is not queued): not one of D09's four entries.
- **L10N-1** (the Chinese failure omits "may be billed"): core's words, with the caveat, follow the sentence.
- **L10N-2** (the Chinese unfinished line says more than English): English is unchanged from before T17; Chinese uses the approved row.
- **L10N-3:** the same point as COORD-2, which is fixed.
- **L10N-4** (a Chinese line for the proposal tool that English lacks): harmless.
- **REG-2** (the quota-edge test would pass without the queue): true and intended. Billing stays with the one Quota; the queue orders starts.
- **REG-3** (the e2e "nothing more is sent" could not fail, since there is no next step): the tool-step case is proven by `ask-coordinated.test.ts`.
- **REG-4** (old Stop copy left in `labels.ts`): cleanup only.

## Gates

Final run after the review fixes, in the worktree:

| Gate | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm lint` | 0 errors; 1 warning in the existing web `grid-table.tsx`, which is untouched |
| `pnpm test` | root 919 passed / 2 skipped; core 958; iOS 795 |
| `pnpm --filter @awardgrid/ios build` | pass; fixture-free |
| `pnpm build:landing`, `pnpm build` (worktree) | pass |
| `pnpm exec playwright test --config=playwright.uiux.config.ts` | 203 passed; T17 added ask-stop 5 (`evidence/raw/t17-full-run.log`) |
| Evidence | `UIUX_EVIDENCE=1 … ask-stop.spec.ts -g "stopped question in Chinese at 390"`: 2 passed (`evidence/raw/t17-evidence-run.log`) |

## Acceptance

- **A28** (verified in mock integration: unit tests and the iOS browser mock):
  - Stop prevents every later call: a queued tool call never starts, and nothing more goes to Anthropic.
  - The words never claim a recall: "the request already sent … still finishes and may be billed".
  - An interrupted question is not resent automatically (0 Anthropic requests after relaunch).
  - The native half is unverified: a real kill, and the native idle timeout. The adapter is untouched in T17.
- **A29** (verified in unit and integration tests):
  - Search, watch, Ask and detail start one at a time over the one Quota. There is no second counter and no nested acquisition.
  - An unknown sent count is not 0: a thrown request moves the quota, and meta lines say "at least" or "never reported".
- **A21** (verified by unit tests and the iOS browser mock): with T17 the Ask page's own lines are Chinese too. Only core's words stay English, marked `lang="en"`. Parity is checked for every outcome, ending, Stop moment and failure code (`entry-labels.test.ts`).

## Screens (looked at)

At 390 in Chinese, light and dark:

| File | What it shows |
|---|---|
| `screens/t17-stopped-*.png` | The saved stopped question: 随问题发送 · 仅附带查询条件。with the partial-coverage note; the entry reads 发送时附带了查询。, then 数据：seats.aero, then "Claude Opus 5 · 至少 1 次请求 · Anthropic 没有报告最后一个请求的用量", then 已停止后续步骤。本问题不会再发送任何内容。已发给 Anthropic 的请求仍会完成，并可能计费。, and 重新提问 |

## Not verified here

- The Simulator or a device: a real kill during a native request, the native idle timeout, and VoiceOver on the waiting and Stop lines.
- Live seats.aero and Anthropic.
