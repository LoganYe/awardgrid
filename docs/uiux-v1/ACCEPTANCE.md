# UI/UX v1 — acceptance record (A01–A38)

The 38 requirements from the handoff pack (`packages/core/test/fixtures/uiux/acceptance-cases.json`). A row is `verified` only when its method was actually run and the evidence is linked, and the verification scope is named. Browser-mock evidence is never counted as Simulator, device or live-key evidence. `pending` means not started; `blocked` names why.

| ID | Task | Category | Requirement | Method | State | Evidence |
|---|---|---|---|---|---|---|
| A01 | T01 | Safety | No external requests in fixture mode; normal build has no fixture-host route or fake key fallback | mock browser + bundle check | verified (browser mock + bundle) | [T01](evidence/T01-fixture-harness.md) |
| A02 | T02 | Data | 0/undefined seats renders unknown; null fee unknown; explicit 0 plus USD is zero, not unknown | unit + component | unit verified; component with T07 | [T02](evidence/T02-truth-identity.md) |
| A03 | T02 | Data | Fresh local fetch never hides stale or unknown provider time; future timestamp is not just now | unit + component | unit verified; component with T07 | [T02](evidence/T02-truth-identity.md) |
| A04 | T02 | Data | Same source id J and F has distinct row keys; array reordering preserves identities | unit | verified (unit) | [T02](evidence/T02-truth-identity.md) |
| A05 | T03 | Data | Partial/unknown coverage survives cache save/restore; missing legacy evidence never becomes complete | unit + integration | verified (unit + store integration) | [T03](evidence/T03-coverage-evidence.md) |
| A06 | T04 | Visual | Both themes match tokens and 32 contrast pairs; dark primary has dark on-accent text | computed CSS + contrast | verified (unit + iOS browser mock, Chromium) | [T04](evidence/T04-tokens-primitives.md) |
| A07 | T04 | Access | Coarse input ≥44 target; normal/pressed/disabled/focus/loading semantic styles exist | component + geometry | verified (component + iOS browser mock, Chromium); WKWebView/VoiceOver unverified | [T04](evidence/T04-tokens-primitives.md) |
| A08 | T05 | State | Late response cannot overwrite newer revision; failed run retains labelled old query and data | unit + browser | pending | — |
| A09 | T05 | Network | search(text,key) and searchQuery(query,key) share executor, quota and cache; no Anthropic request | unit + integration | pending | — |
| A10 | T06 | Query | Manual one-field change needs no LLM; typing/selecting months makes zero API requests | browser network | pending | — |
| A11 | T06 | Query | Strict dates, leap days, 92-span cap and explicit relative clock behave as fixtures specify | unit + browser | pending | — |
| A12 | T07 | UX | 390 default artboard uses 244 pre-result stack, ≥164 card, 16 gutter and safe area; no clipped core data | geometry + visual | pending | — |
| A13 | T08 | Data | List/calendar/matrix use same snapshot and effective filter; every min maps to displayed support rows | unit + integration | pending | — |
| A14 | T08 | Network | Views/sort/local filter change send zero requests and preserve selection | browser network | pending | — |
| A15 | T09 | Access | One grid tab stop; arrow/home/end/enter/escape; virtualized focus and total indices stay accurate | keyboard + screen-reader | pending | — |
| A16 | T09 | Visual | Mobile matrix settles to full numeric columns; no cropped price suffixes | touch + browser geometry | pending | — |
| A17 | T10 | Network | Only explicit trip-load spends; hover/back/cache-read do not; getTrips uses shared validated refs | integration | pending | — |
| A18 | T10 | Safety | Unsafe/untrusted links rejected; absent links offer copy; concrete details never fabricated | unit + browser | pending | — |
| A19 | T10 | UX | Return from details restores filter/view/scroll/selection | browser | pending | — |
| A20 | T11 | UX | Seats setup first; AI key optional; clipboard only on user action; keyboard never covers submit | browser + native | pending | — |
| A21 | T11 | Access | English and Chinese dictionary parity and no truncation; query local date not shifted by timezone | unit + browser | pending | — |
| A22 | T12 | UX | Select 2–4, fifth refused; phone compares 2 with accessible picker; no cross-program value score | browser | pending | — |
| A23 | T13 | Storage | Favorite snapshot opens offline; caps do not delete existing data; deletion undo; write failure recoverable | unit + browser | pending | — |
| A24 | T14 | Watch | Relative dates move; edited structured filters persist; legacy fixed dates retain meaning | unit | pending | — |
| A25 | T14 | Watch | First baseline no new-result alert, failed check unchanged, quiet check retains unread changes | unit + browser | pending | — |
| A26 | T15 | AI | Context bar equals actual payload, refs identify correct snapshot, newest at bottom without scroll hijack | integration + browser | pending | — |
| A27 | T16 | AI | Hard scope changes require trusted confirmation before HTTP; stale/replayed proposals spend zero | unit + integration | pending | — |
| A28 | T17 | Lifecycle | Stop prevents subsequent calls, never claims native recall; interrupted task not automatically resent | mock integration + native | pending | — |
| A29 | T17 | Quota | Search/watch/AI/detail coordinate same quota, no second counter/deadlock, unknown sent count not 0 | unit + integration | pending | — |
| A30 | T18 | Privacy | Web user B cannot see A cache/favorites/selection after logout; SSR never imports native secrets | integration + browser | pending | — |
| A31 | T19 | Visual | 1440 columns 72/24/936/24/360/24; detail400 mutually exclusive; <1280 overlay; <768 single column | geometry + browser | pending | — |
| A32 | T19 | Access | Visible alternatives for all shortcuts; no single-key capture while typing/IME; shortcuts disableable | keyboard | pending | — |
| A33 | T20 | Watch | iOS foreground/no push versus configured Web worker/Telegram follows real capabilities | unit + regression | pending | — |
| A34 | T20 | Regression | Existing Web auth/settings/legal/CLI/worker/landing remain usable after shared token/schema changes | integration + smoke | pending | — |
| A35 | T21 | Access | 320,390,430,768,1024,1280,1440 plus 100/130/160/200% text: no lost data/control; page no x overflow | responsive + native | pending | — |
| A36 | T21 | Access | Reduced motion, focus restore, modal containment and VoiceOver usable; color not sole state cue | browser + native manual | pending | — |
| A37 | T22 | Evidence | Actual command, exit code, test count, commit, environment and screenshot recorded per stage | evidence audit | pending | — |
| A38 | T22 | Honesty | Unit/Web mock/iOS simulator/device/live-key verification reported separately; blocked is never pass | evidence audit | pending | — |
