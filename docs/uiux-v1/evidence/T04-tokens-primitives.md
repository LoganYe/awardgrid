# T04 · Shared tokens and base controls, light and dark — evidence

Scope verified: **unit + iOS browser mock** (vitest; Playwright against the fixture host on 127.0.0.1:4310, Chromium, 390 × 844 @2x touch and 1280 × 800 fine pointer). Not run: iOS Simulator, physical device (WKWebView rendering, Dynamic Type and VoiceOver there stay unverified). No network, no key. Worktree `/Users/yegaoyang/Desktop/workspace/awardgrid-uiux`.

## What was built

- `packages/tokens/precision.css` (new, exported as `@awardgrid/tokens/precision.css`): every Quiet Precision colour role in light (`:root, [data-theme="light"]`), explicit dark (`[data-theme="dark"]`) and system dark (`prefers-color-scheme: dark` while unpinned), plus spacing, radius, sizes, type, motion and layers as `--ag-*`. Phone sizes by default; smaller controls only with a fine pointer from 768 px; desktop type from 768 px; every duration `0ms` under reduced motion; `color-scheme` follows the pinned or system theme. Type tokens are `calc(Npx * var(--ag-text-scale))` (U-015). `quiet-precision.json` and `quiet-precision-contrast.csv` are verbatim copies of the approved design files, the reference the guard compares against. `tokens.css` and `surfaces.css` are untouched (pinned by `tokens.test.ts` and the web visual baselines).
- `apps/ios/src/components/ui/`: `Button` (primary / secondary / quiet / danger; disabled with a visible, attached reason; loading keeps label and width, stays focusable via `aria-disabled` and ignores activation), `IconButton` (plain / outlined, required accessible name), `TextField` (label outside; help and error attached, error first), `Chip` (toggle / filter; 36 face in a 44 slot; check mark + fill when selected, no weight change), `SegmentedControl` (radio group, exactly one tab stop even when the checked option is disabled or missing, arrows / Home / End, disabled options skipped), `Notice` (four tones; live only when asked, and then mounted empty and filled on the next frame so the change is announced), `Sheet` (portal to `<body>`, background `inert`; focus to the title unless a field in it autofocuses; Tab wraps over the controls that really take focus; Esc anywhere except during IME composition; a completed tap on the scrim closes it; focus back to the element that had it before opening, or `<main>` when that is gone or cannot take focus), `theme.ts` (`applyThemePreference`: the theme provider seam; the stored three-way choice is plan 02 T11), `icons.tsx`, `ui.css` (tokens only, no hex; every state from spec §10: default, fine-pointer hover, pressed, selected, focus-visible 2 px accent ring with 2 px offset, disabled without opacity fade — `opacity: 1` set explicitly because iOS WebKit's own stylesheet fades disabled fields —, loading, error). Fields never go below 16 pt text, so iOS does not zoom into them on an iPad-width screen (U-016).
- `apps/ios/src/styles.css`: imports precision.css and ui.css; the old `.ag-button`/`.ag-input` definitions are gone (the class names stay, so existing screens and the Simulator driver keep their selectors); the older colour names alias Quiet Precision roles and native checkboxes take the accent (U-012); body uses the system face at 16 px with a 1.5 ratio (24 px lines; a ratio so older elements with their own size keep proportional lines); reduced motion is `0s` (U-013).
- Fixture host: `foundations` scenario renders `fixture-host/foundations.tsx` — the real primitives in every state — instead of the app; the production bundle check fails on its markers.
- `e2e/uiux/helpers.ts`: `evidenceShot(page, name, { fullPage })`, which polls the page height until it holds before a full-page capture.

## Test-first record

| Step | Command | Result |
|---|---|---|
| Red | `pnpm exec playwright test --config=playwright.uiux.config.ts e2e/uiux/foundations.spec.ts` | exit 1 — 10 failed: `Scenario "foundations" is not seeded by the fixture host yet (T04 (primitives page))` |
| Token guard | `pnpm exec vitest run src/styles/precision-tokens.test.ts` | written against `quiet-precision.json` and the CSV; recomputes all 32 contrast pairs (incl. the six control-border ≥ 3:1 pairs) from the CSS |
| Green 1 | foundations spec | 9 passed, 1 failed: reduced-motion `transition-duration` was `1e-05s` (the shell's `0.01ms` rule) → `0s` (U-013) |
| Review 1 | 2 independent reviewers (visual spec; accessibility and regression) | mixed palettes on real screens (old accent beside new button); icon button / chip / segment lacked disabled, pressed and hover; selected chip changed weight (width jump); Sheet not portalled, background reachable, Esc lost after clicking the sheet's padding, focus lost when opener unmounted; loading button dropped focus (`disabled`); segment labels overflowed at large text; no text-scale hook; pinned theme did not pin `color-scheme`; gallery not in the bundle guard; evidence was viewport-only |
| After fixes | foundations spec | 18 passed (8 new tests for the fixed behaviour) |
| Review 2 | 3 lenses (accessibility, CSS cascade, test validity), each finding verified by an independent refuter | 24 findings: 21 confirmed (1 major: closing from the scrim left focus on `<body>`; 20 minor), 3 refuted (reduced-motion assertion is not vacuous; nested sheets are outside "one modal layer"; iOS 15.0 floor is moot because the web bundle targets iOS 16.4). Confirmed: Tab wrap chose "last" by selector (a roving segment escaped the modal); opener lost when a field autofocuses; focus return failed silently for an unfocusable opener; Esc closed the sheet during IME composition; a segmented group lost its tab stop when the checked option was disabled; a live Notice mounted with its text (not announced); iOS fades disabled fields to 0.4; body line-height as a length made older text too loose; iPad-width fields at 14 pt (zoom on focus); no `accent-color`; the chip "width holds" claim was false (the check mark adds 20); the full-page settle wait did not wait; and gaps in the tests for Esc via the document listener, the focusin guard, the `<main>` fallback, Shift+Tab from the title, hover/pressed states, a wide touch screen, 5 of the 12 aliases, and real line wrapping |
| After review 2 fixes | foundations spec | 25 passed; 7 new tests (wide touch, hover/pressed, three Sheet cases, live notice, and the scrim/right-click case) and sharper assertions in 6 existing ones |

## Gates after T04

| Command | Exit | Result |
|---|---|---|
| `pnpm typecheck` | 0 | |
| `pnpm lint` | 0 | 0 errors, the pre-existing `grid-table.tsx` warning |
| `pnpm test` | 0 | root 919 passed / 2 skipped · core 799 · ios green (count with T05's first tests: 642; T04 alone: 595, below) · no existing test file edited by T04 |
| `pnpm --filter @awardgrid/ios build` | 0 | fixture-free bundle check passes (now also guards the gallery) |
| `pnpm build:landing` | 0 | |
| `pnpm build` (worktree `.next` only) | 0 | the main checkout's `.next/BUILD_ID` unchanged (Sep 23 19:13) |
| `UIUX_EVIDENCE=1 pnpm exec playwright test --config=playwright.uiux.config.ts e2e/uiux/foundations.spec.ts` | 0 | 25 passed |

These final runs were made on the worktree while T05's first files were already in it (uncommitted); the T04 commit alone is re-checked in a clean checkout of that commit — see "Isolation check" below. Raw logs: `evidence/raw/t04-gates.log`, `t04-gates-final.log`, `t04-evidence-run.log` (git-ignored).

## What the browser tests check (`e2e/uiux/foundations.spec.ts`)

Dark primary is `#63D2D6` with `#102326` text; in both themes every primitive's computed colours equal the tokens; touch sizes (48 buttons and fields, 44 icon buttons, 36 chips in 44 slots, equal 44 segments); fine pointer at 1280 gets 40 / 36; focus ring 2 px accent, 2 px offset; disabled keeps its reason attached and opacity 1; loading keeps width, keeps focus, ignores click / Enter / Space; disabled icon button, outlined icon button, chip and segment colours, arrows skip a disabled segment; selected chip keeps its weight, filter chip is quieter until on; text scale 2 doubles type and a long segment label wraps inside its third without horizontal scroll; pinned theme pins `color-scheme` both ways; segmented keyboard pattern; field label / help / error; sheet focus, Tab trap, Esc, focus return, portal, inert background, Esc after a click on padding; reduced motion 0; the real shell's older colour names resolve to Quiet Precision in both themes and the body uses the system face at 16/24.

## Screens (looked at, not only captured)

| File | What it shows |
|---|---|
| `screens/t04-foundations-light.png`, `-dark.png` | every primitive state, full page |
| `screens/t04-app-search-light.png`, `-dark.png` | the real Search screen on the new palette (one accent) |
| `screens/t04-app-settings-light.png`, `-dark.png` | the real Settings screen, full page; mixed control sizes and a `--line` field border remain there until T11 (U-014) |

## Isolation check

The commit `b000c03` alone, in a throwaway `git worktree` of it (node_modules cloned from the worktree, nothing installed), without any T05 file:

| Command | Exit | Result |
|---|---|---|
| `pnpm typecheck` | 0 | |
| `pnpm lint` | 0 | the pre-existing warning only |
| `pnpm --filter @awardgrid/ios test` | 0 | 27 files, 595 passed |
| `pnpm exec vitest run src/styles` | 0 | 90 passed (token guards, old and new) |
| `pnpm --filter @awardgrid/ios build` | 0 | fixture-free bundle check passes |
| `pnpm exec playwright test --config=playwright.uiux.config.ts` | 0 | 35 passed (harness 10 + foundations 25) |

Raw log: `evidence/raw/t04-isolation.log` (git-ignored). The worktree was removed afterwards.

## Not verified here

- iOS Simulator / WKWebView rendering of the same pages, Dynamic Type, VoiceOver: not run in T04 (first Simulator pass is planned with the rebuilt screens).
- Physical device: not available to this session.
- Web and landing visuals: nothing they load changed (`tokens.css`/`surfaces.css` untouched; the web never imports `precision.css`); `tokens.test.ts` passes and the landing build passes. The web e2e and its Linux visual baselines were not re-run for T04.

## Corrections (T22 evidence audit, 2026-09-24)

An audit of this record against its raw logs and git (evidence T22) found the following. The text above is left as written.
- `raw/t04-gates.log` records a failing first gate run, `exit=1 :: pnpm lint` (react-hooks/refs at `Sheet.tsx:31`), and `raw/T04/typecheck.log` records TS2769 in `primitives.test.ts`. Both were fixed before the final gates (`raw/t04-gates-final.log`, all exit 0), which ran on the uncommitted tree just before `b000c03`.
- The "`.next/BUILD_ID` unchanged" check has no command or output recorded. `raw/T04/tokens.log` is 2 files, 90 passed.
- `raw/T04/typecheck.log` ends in exit code 2 (15 × TS2769), where the gate table shows `pnpm typecheck | 0`. That 0 is the later run in `raw/t04-gates.log`.
