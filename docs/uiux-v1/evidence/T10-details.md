# T10 · Plain itinerary details and return state — evidence

Scope verified: **unit (core, iOS) + iOS browser mock** (Chromium, fixture host 127.0.0.1:4310; 390 × 844 and 320 × 568; text scale 2; light and dark; English and Chinese; keyboard; clipboard). The Get Trips answers are the fixture host's synthetic itineraries. Not run: iOS Simulator / device (the native HTTP path for Get Trips, Safari hand-off of the outbound link, the WKWebView clipboard, VoiceOver on the dialog), live seats.aero Get Trips (not authorised — it spends a call). Worktree `/Users/yegaoyang/Desktop/workspace/awardgrid-uiux`.

## What was built

- `packages/core/src/lib/grid/deeplinks/trusted.ts`: `trustedExternalLink` (https to a named host only) and `detailLink` (the option's own primary booking link, else the row's, else the American search builder).
- `present.ts`: `localTimeLabel` (airport-local, never converted), `durationLabel`, `stopsLabel`, `detailsCopyText`; approved copy `details.load/copy/external`, `help.program/mixed`.
- `apps/ios/src/search/search.ts`: `SearchEngine.getTrips` — core `runGetTrips` on the engine's quota, cache and transport, with the search's failure mapping.
- `apps/ios/src/workspace/detail-service.ts`: trusted references only, one explicit call, joined when in flight, kept in memory for the run.
- `apps/ios/src/screens/DetailScreen.tsx` (+ CSS): the aggregate, "View flight itineraries", itinerary cards, the caveat and one trusted way out or "Copy search details", Esc/Back/browser back; the route `/detail/:snapshotId/:rowKey` under the Search screen (`App.tsx`), which stays mounted and inert (U-036).
- `AvailabilityCard` "View option" on the source-time line; the list, calendar day and matrix cell options pass it through; a one-option matrix cell opens its details on Enter/tap.
- `SearchScreen`: the details outlet, results inert while open, the quota line read again on close, the editor's return focus applied once per arrival, a focusable title for a fallback.
- Fixture host: synthetic Get Trips (test-only).

## Test-first record

| Step | Command | Result |
|---|---|---|
| Red | `pnpm exec playwright test --config=playwright.uiux.config.ts e2e/uiux/details.spec.ts` | exit 1 — 8 of 8 failed: no "View option" button, and `No route matches URL "/detail/…"` (`evidence/raw/t10-red.log`) |
| Core | deeplinks/trusted.test.ts, present.test.ts details cases | written before trusted.ts existed; green after |
| Service | detail-service.test.ts | 4, then 5 after the review |
| Green | details spec | 7 of 8 on the first run; the cache test: Esc did nothing once "View flight itineraries" was replaced (focus on `<body>`, Esc listened on the page) → Esc listened on the document, focus moved to the loaded itineraries |
| Screens | t10-details-*.png looked at | no side gutters (the gutter variables live on `.ag-results`, which the page is outside) → defined on the page; in English "Copy search details" wrapped in its (358 − 8) / 2 column → 8 pt side padding and the shorter "Program website"; the geometry test covers both languages |
| Review | adversarial review workflow (3 finders: data truth + spend + link safety, accessibility + tests, layout; one refuting verifier per finding) | 22 findings, all 22 confirmed (6 major), 0 refuted; every one fixed, below |

## Review (adversarial)

| Finding | What was wrong | Fix |
|---|---|---|
| DS-01 (major) | seats.aero's MixedCabinPct (share flown BELOW the cabin) was worded as the share IN the cabin, and 100 hid the warning; the fixture had the same inversion | "Mixed cabin: 20% of the distance below this cabin" / "混合舱位：20% 航程低于此舱位" whenever given; fixture 20; browser assertion |
| DS-02, L-03 (major) | The outbound link could show before loading (American rows, a cached booking link) with no caveat | The approved caveat stands above the bottom buttons whenever there is a link; browser test on an American row before any load |
| A11Y-01 (major) | Closing details re-applied the editor's old return focus: focus jumped to "Edit search" and the page scrolled | Applied once per arrival (location key); the back test now reaches results through the editor |
| A11Y-04 (major) | Itinerary cards had no miles of their own (a 73,000 itinerary read as the option's 68,000) | A miles row on every itinerary; asserted 68,000 and 73,000 |
| L-01 (major) | At large text the header shrank to 52 and clipped the title | Header and footer never shrink; test at 320 × text 2 |
| L-02 (major) | The times row overflowed at 320 / text 2 | It wraps; test that no card or the body scrolls sideways |
| DS-03 | The results' quota line stayed stale after a details load | Read again when the details close; test |
| DS-04 | Reopened during a load, the page could send a second call | `load` answers from memory when loaded; `pending(ref)` lets a reopened page join; unit tests |
| DS-05 | Non-primary booking links (other programs) were used as a fallback | The option's own primary link only (the first when none is flagged), then the row's, then the builder; tests |
| DS-06 | `localhost.`, `intranet.`, `com.` passed the host check | Trailing dot stripped; two or more ASCII labels required; tests |
| DS-07, A11Y-05 | Segments showed times without dates | Each end with its airport-local date; asserted |
| A11Y-02, L-08 | The copy status was `display:none` until filled; a second copy changed nothing | Always in the tree; cleared and set again per copy, cleared after 4 s; test |
| A11Y-03 | Tests did not cover filter, calendar, matrix, editor path, inert tab bar, dialog role; some counts read too early | Tests for each, with waits before reading the request log |
| A11Y-06 | A missing carrier or flight number showed "—" | "Not provided" / "未提供" |
| A11Y-07 | A details URL opened directly closed with focus on `<body>` | Falls back to the results' status line or title; asserted |
| L-04 | Two filled accent buttons at once | One primary: loading until loaded, then the way out; asserted |
| L-05 | "View option" on its own row made every card 217 tall | On the source-time line, target overlapping the padding: cards 164 again (measured) |
| L-06 | The external icon shrank when the label wrapped; the card chevron rule matched nothing | Icons never shrink; the footer drops to one column when labels cannot fit; the rule targets the svg |
| L-07 | The itineraries heading showed the browser's focus ring | The accent ring, as the page title |

Also found while fixing: React Router warned about the index route under Search having no element → an explicit empty component; two test races (a box filled before the editor mounted; Esc pressed before the details mounted) → waits.

## Gates

Final run, after the review fixes, in the worktree (`export PATH="$HOME/.local/node-arm64/bin:$PATH"`):

| Gate | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm lint` | 0 errors, 1 warning — the existing web `grid-table.tsx`, untouched |
| `pnpm test` | root 919 passed / 2 skipped; core 906; ios 677 |
| `pnpm --filter @awardgrid/ios build` | pass; `check-fixture-free-bundle`: 18 files, no fixture markers |
| `pnpm build:landing` | pass |
| `pnpm build` (worktree only) | pass |
| `pnpm exec playwright test --config=playwright.uiux.config.ts` | 122 passed (harness 10, foundations 26, workspace 4, query editor 18, mobile results 14, views 15, matrix 16, details 19) |
| Evidence | `UIUX_EVIDENCE=1 … details.spec.ts -g "details with itineraries at 390"` → 2 passed (`evidence/raw/t10-evidence-run.log`) |

## Acceptance

- A17 — opening, closing (button, Esc, browser back), hovering, reopening and reading loaded itineraries send nothing (request log); only "View flight itineraries" sends one Get Trips (`trips` +1), through the engine's quota; the reference is resolved against the workspace's snapshots and the row's own source id, cabin and scope are sent (unit); an unknown reference is refused with nothing sent.
- A18 — javascript:, data:, http:, credentials, IP, localhost (with or without a trailing dot), odd characters and other programs' links are refused (unit); in the browser the option whose primary link is javascript: offers only "Copy search details" (and copies the right text), the safe option offers its program's page with the caveat; itineraries show only what seats.aero sent, and an empty answer is said, not invented.
- A19 — after each way back: view, sort, selection, local filter, page scroll, the calendar's chosen day, the matrix's scroll and focused cell are as they were, and focus is on the opener.

## Screens (looked at)

| File | What it shows |
|---|---|
| `screens/t10-details-light.png`, `-dark.png` | Chinese, 390, the 75,000 option after "查看具体航班": the summary (10月18日 · 周日 · 商务舱, HKG → SEA, 75,000 里程 · 税费待确认, 通过 Air Canada Aeroplan 兑换, 席位未提供), itinerary 1 (直飞 · 12 小时 10 分钟, 10:30 HKG → 07:40 SEA, 里程 75,000, XX · XX 120, USD 58.40, 席位未提供, 各机场当地时间), 数据与核验, the caveat above 复制查询条件 / 前往兑换网站 |

## Not verified here

- Simulator / device: Get Trips through the native HTTP adapter, the link handed to Safari, the clipboard in WKWebView, VoiceOver reading the dialog and returning to the opener, the home-indicator inset of the bottom bar.
- A live Get Trips response (not authorised: it spends a call); seats.aero's real Cabin strings are matched case-insensitively against "economy/premium/business/first".
