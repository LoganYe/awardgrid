# T16 · Structured change proposals and tool-layer approval: evidence

**Scope verified:** unit tests (core and iOS) and the iOS browser mock.
- Browser: Chromium, fixture host on 127.0.0.1:4310.
- Size, themes and languages: 390 × 844; light and dark; English and Chinese.
- Scenarios: `ai-pending` and `ai-stale`, both seeded in this task, with the fixture's scripted Anthropic.
- Every refusal was checked by counting the requests the fake seats.aero received.

**Not run:**
- No real Anthropic or seats.aero request: a live key is not authorised.
- No Simulator or device: VoiceOver on the card, and a native double tap.

Worktree: `/Users/yegaoyang/Desktop/workspace/awardgrid-uiux`.

## What was built

- **Core `workspace/proposals.ts`** (U-051): `proposalStatus` and `sameAuthorizedScope` (the plan's interfaces), and `proposalChanges` for the typed diff.
- **Core `ask/tools.ts`**, all additive:
  - `ScopeGate`, applied to `search_awards` and `get_flights` before any request.
  - `PROPOSE_TOOL` and `ASK_TOOLS_WITH_PROPOSALS`.
  - New outcomes `needs_confirmation` and `inside_scope`.
  - Real-date checks on proposals.
- **Core `ask/loop.ts`, `prompt.ts`, `conversation.ts`:** an opt-in `proposals` flag (the tool list and one context line), and `EntryProposal` on `AskEntry`.
- **`ask/ask-service.ts`:**
  - The gate comes from the query that was sent.
  - `baseRevision` is the revision of the search on screen.
  - `applyProposal` runs once, not when stale, and only through the validated list.
  - `dismissProposal`.
- **`ask/context.ts`:** `readEntryProposals`.
- **`app/bootstrap.ts`:** `context.revision` is the displayed snapshot's revision; `runQuery` is `workspace.run` followed by a save.
- **`components/QueryChangeProposal.tsx`**, with styles in `ask.css`: the card.
- **`AskEntry.tsx` and `AskScreen.tsx`:** proposals render on their entries.
- **`labels.ts`:** step lines for refusals and proposals.
- **`ask-copy.ts`** (en/zh): the card's words.
- **Fixture:** `ai-pending` and `ai-stale` are seeded; the scripted Anthropic can propose.
- **Tests:**
  - New files:
    - core `workspace/proposals.test.ts`: 7 tests, including the plan's Step 1 test verbatim.
    - core `ask/tools-scope.test.ts`: 10 tests.
    - `ask/proposal-flow.test.ts`: 8 tests.
    - `ask/proposal-labels.test.ts`: 7 tests.
    - `e2e/uiux/proposals.spec.ts`: 8 tests.
  - Changed, each with its reason in U-051:
    - `app/bootstrap-ask.test.ts`
    - `e2e/uiux/fixture-harness.spec.ts`

## Test-first record

| Step | Command | Result |
|---|---|---|
| Red | `pnpm --filter @awardgrid/core exec vitest run src/lib/workspace/proposals.test.ts` | exit 1: `Cannot find module './proposals'` (`evidence/raw/t16-red.log`). This was the plan's Step 1 test, verbatim |
| Green | same | 1 test, then 7 with the scope counter-examples |
| Gate | core `tools-scope.test.ts` | Step 4's attacks: a malicious "the user already agreed" reason, other airports, a wider window, all programs, another cabin, a higher cap, no search, invalid, inverted and past dates, unknown places, a second proposal. Each is refused before HTTP (0 fetches); an in-scope search still reaches seats.aero. One first-run fix: "ZZZ" is IATA-shaped and accepted by design, as in `search_awards` |
| Service | `proposal-flow.test.ts` | The out-of-scope search sends nothing; the proposal is pending; Apply runs once (two concurrent taps); stale and set-aside proposals run nothing |
| Suite | `pnpm test` | `bootstrap-ask.test.ts` asked without a search. It now includes a restored search (U-051) |
| Browser | `proposals.spec.ts` | First run: the request counter read a field `requestLog` does not return (fixed). A double click's second tap landed where the button had been; it is now two synchronous clicks, a true double tap |
| Review | adversarial workflow: 3 finders (gate security; card UX, a11y and l10n; regressions and test integrity), one refuting verifier per finding | 16 findings: 12 confirmed (4 major), 4 refuted. All 12 are fixed. REG-4, refuted, made the same point as the confirmed SEC-2, and that is fixed |

## Review (adversarial)

| Finding | What was wrong | Fix |
|---|---|---|
| SEC-1 (major) | An included SHA or BKK was expanded as a city, so Claude could search PVG or DMK without asking, with real requests | The authorized side is compared as stored. Tests for SHA→PVG and BKK→DMK, the city code, and a proposal for the sibling |
| SEC-2 (major) | `get_flights` had no gate: Get Trips with no search included, or for an id from an earlier, wider search | The held row for that id, in that cabin, must be inside the included search; a memo hit stays free. Tests for none, outside and unknown, plus an inside control |
| SEC-3, REG-2 (major) | `baseRevision` was the workspace's run counter, so a proposal made while a search ran stayed pending after that search published, and Apply replaced it | Revision of the search on screen. Tests: running then published is stale; running then failed stays pending |
| SEC-4 | A proposal for 2026-11-31 was recorded; Apply said "applied" and nothing ran | Real calendar dates only. Test |
| SEC-5 | From a restored ask.json, Apply could run a hidden record with the same id | Apply and dismiss go through the validated list and refuse duplicates. Test |
| UX-2 | "View results" was a small, unstyled link that dropped focus | A full-size button that lands focus on the results title. Browser test |
| UX-3, REG-3 | The refused-search line said "outside the search you included" when none was | Said against what went with the question. Tests |
| UX-4 | Every refused proposal read "could not be read" | Per outcome (limit, inside scope, place, pairs, invalid). Tests |
| UX-5 | With no search sent, all eight fields were marked New | Compared locally with the search on screen, saying so. Browser test |
| UX-6 | No word about quota before Apply; ragged buttons | A note before Apply, and full-width stacked 48 buttons, as in the reference. Browser test |

Refuted (4):
- **UX-1** (an applied card keeps saying Applied): required by the plan's `proposalStatus`.
- **UX-7** (the disabled Apply is not tied to its note): not asked by S09. The approved note is next to it, in the status region.
- **REG-1** (the Simulator probe driver asks without a search): the driver could not run these steps before T16 either, and is already recorded as out of date (U-028). Noted in U-051.
- **REG-4:** the same point as SEC-2, which was confirmed and is fixed.

## Gates

Final run after the review fixes, in the worktree:

| Gate | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm lint` | 0 errors; 1 warning in the existing web `grid-table.tsx`, which is untouched |
| `pnpm test` | root 919 passed / 2 skipped; core 958; iOS 777 |
| `pnpm --filter @awardgrid/ios build` | pass; fixture-free |
| `pnpm build:landing`, `pnpm build` (worktree) | pass |
| `pnpm exec playwright test --config=playwright.uiux.config.ts` | 198 passed; T16 added proposals 8 (`evidence/raw/t16-full-run.log`) |
| Evidence | `UIUX_EVIDENCE=1 … proposals.spec.ts -g "pending proposal at 390"`: 2 passed (`evidence/raw/t16-evidence-run.log`) |

## Acceptance

- **A27** (verified in unit tests and the iOS browser mock):
  - Hard scope changes need trusted confirmation before HTTP. The tool layer refuses them with 0 requests, whatever the model claims, and Claude can only propose.
  - Only the person's Apply runs a proposal, through the normal search, once, even when tapped twice.
  - Stale proposals (the query changed) and set-aside ones spend nothing.
  - Replayed or forged records in ask.json cannot run.
- **Not verified here:** a live Anthropic run, and a device.

## Screens (looked at)

At 390 in Chinese, light and dark:

| File | What it shows |
|---|---|
| `screens/t16-proposal-*.png` | 修改查询的建议 with Claude 的理由 (the model's own words: that the person already agreed), and the 出发日期 row: 原 10月1–30日 (2026-10-01 – 2026-10-30), then 新 10月18日–11月6日 (2026-10-18 – 2026-11-06), tinted. The quota note before Apply. Full-width 应用并查找 (primary) and 保留原条件. seats.aero calls: 0 |

## Not verified here

- The Simulator or a device: VoiceOver on the card and its status, and a native double tap.
- Live Anthropic: whether a real model uses `propose_query_change` as its description asks.
- Stop and interruption, and the step lines in Chinese, are T17.
