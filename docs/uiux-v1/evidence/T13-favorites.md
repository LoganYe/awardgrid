# T13 · Local saved snapshots, capacity and recoverable persistence: evidence

**Scope verified:** unit tests (iOS) plus the iOS browser mock.
- Browser: Chromium, fixture host on 127.0.0.1:4310.
- Size, themes and languages: 390 × 844; light and dark; English and Chinese.
- Scenarios: `complete`, `favorite-snapshot` (seeded in this task), and `storage-failure`. Other states (read-only, unreadable items, full store, past dates) were written into the fixture's device files by the tests.
- Playwright's clock was used for the undo timing.

**Not run:**
- iOS Simulator or a device: the Capacitor Filesystem's real "file not found" rejection (`OS-PLUG-FILE-0008`, read from the plugin's Swift source), writes on a nearly full disk, VoiceOver on the undo and the save bar.
- No live request: nothing here spends a call except the confirmed "Search again", which went to the fixture's synthetic transport.

Worktree: `/Users/yegaoyang/Desktop/workspace/awardgrid-uiux`.

## What was built

- **`apps/ios/src/store/favorites-store.ts`** (U-045, U-047):
  - `FavoritesStore` in namespace `favorites-v1`: whole-list atomic writes, published only once written; 100 items / 5 MiB, refused as "capacity" with nothing dropped.
  - Loading never writes or fetches. Unreadable items are carried unchanged; a newer-version or unreadable file makes the store read-only.
  - Remove, undo and forget.
  - `favoriteFromSnapshot` and `favoriteSnapshot`.
- **`app/bootstrap.ts`** (U-046):
  - `persist()` saves each part on its own, never throws, and returns a report kept in `saveStatus`.
  - Ask reports an unsaved `ask.json`.
  - Favourites are loaded at launch.
- **Storage** (U-047): `store/persistence.ts` tells absent from unreadable; `workspace/slot-storage.ts` refuses to read around, or write over, what it cannot read.
- **Screens:**
  - `screens/FavoritesScreen.tsx`, `favorites-copy.ts` and `favorites.css`: the Saved list, empty, read-only and full states, and the undo bar in the chrome's slot.
  - `SavedScreen`: projected rows, the note and coverage, and "Search again" with past-date and no-key handling.
  - `QueryEditorScreen` can open seeded with a saved query.
  - `SearchScreen`: "Save results", with a message tied to its snapshot.
  - `App.tsx`: the fourth tab, and the compact save bar with retry.
  - `AvailabilityCard`/`List`: the compare checkbox is optional.
  - `results.css`: tab labels stop growing at 15/18.
- **Fixture:** the `favorite-snapshot` scenario is seeded.
- **Tests:**
  - New: `favorites-store.test.ts` (12), and `e2e/uiux/favorites.spec.ts` (15).
  - Changed: the bootstrap save tests (report, status, a cache-only failure), `slot-storage.test.ts` (+2; one T05 case changed, U-047), Ask save-failure tests (+1, +1 assertion), the chrome, harness and mobile-results tab tests, and the parity test (the Saved table).

## Test-first record

| Step | Command | Result |
|---|---|---|
| Red | `pnpm --filter @awardgrid/ios exec vitest run src/store/favorites-store.test.ts` | exit 1: `Cannot find module './favorites-store'` (`evidence/raw/t13-red.log`). This is the plan's Step 1 test verbatim, plus the plan's Step 4 cases (damaged, old version, full, failed write, undo, cold start) |
| Green (store) | same | 11 on the first run; 12 after the review (over the real slot storage) |
| Browser | favorites.spec.ts | Written alongside the UI, not run red first. First run: the Saved page threw because `all` was passed unbound to `useSyncExternalStore` (now a bound property) |
| Suite | full browser suite | 3 failures where three tabs were assumed. With four tabs at 320 and 200%, "Settings" overflowed its 80 pt tab: labels are now capped like a native tab bar (U-046) |
| Screens | t13-*.png looked at | List, snapshot, empty and undo states read correctly in both themes |
| Review | adversarial workflow (3 finders: storage and data safety; UX honesty, network and accessibility; layout), one refuting verifier per finding | 28 findings: 26 confirmed (9 major), 2 refuted. All 26 fixed, as below |

## Review (adversarial)

| Finding | What was wrong | Fix |
|---|---|---|
| F2 (major) | On the device, an unreadable favourites file read as absent: the list looked empty, and the next save wrote over it | The storage tells absent from unreadable, and refuses to read around or write over the unreadable (U-047). Tested over the real storage |
| DATA-06 (major) | Items this build could not read were dropped at load and erased by the next write | Carried unchanged in every write, counted, and said on the Saved screen. Store test plus browser test |
| UX-01 (major) | A saved snapshot listed and counted rows the Search screen had left out (over the mileage cap, unrequested dynamic pricing), unsorted | Projected as Search does (`projectResults`); the counts use those rows |
| UX-02, LV-2 (major) | "Saved on this device." stayed beside newer, unsaved results | The message is tied to its snapshot; tested |
| A11Y-03, LV-3 (major) | The 5-second undo was not announced, was out of keyboard reach, and dropped focus when it expired | Announced in the status region; focus moves to Undo; held while focus or a pointer is in the bar; forgotten when leaving the screen. Tested with the clock: held at 8 s while focused, still there at 4.8 s, gone by 5.2 s |
| DATA-04, F3 (major) | An undo whose write failed lost the item: the bar was gone and the message said nothing had changed | Undo stays offered and the message says the item is still deleted; capacity has its own sentence |
| NET-05 (major) | "Search again" would spend calls on a range that has passed; the sheet showed no year | Full ISO dates. All past: said, with "Change the dates" (the editor, seeded) instead of Search. Partly past: said. Tested |
| F4 | The report could not show an `ask.json` failure | Ask exposes `saveFailed()`; the report includes it; unit tests |
| F5, UX-10, LV-8 | Only the item count was shown, though the 5 MiB limit can fill first | "N of 100 saved · X of 5.0 MB", with the approved full sentence at a limit |
| UX-07 | A second tap on Delete showed the read-only message | Delete is busy while removing; an "unknown" (already gone) result says nothing |
| UX-08 | A read-only store said "Nothing saved yet" | No empty state or CTA when read-only; tested |
| UX-09 | Leaving the screen within 5 s left the removed item in memory; overlapping deletes leaked tokens | The token is forgotten on leaving and when replaced (tracked in a ref) |
| UX-11 | Without a key, the sheet promised to send, then failed with no link | Search again is off with its reason, plus a link to add a key; tested |
| A11Y-12 | "View in Saved" and "Go to Search" dropped focus | Both carry the destination title as focus target; tested for "View in Saved" |
| A11Y-13 | "Try saving again" gave no feedback; its test proved nothing | Busy state; "Saved." / "Still could not save." in a persistent status region; on success focus goes to the title. The test checks the write count went up |
| TEST-14 | The undo test passed for anything from 0 to 15 s | Playwright clock with boundary checks |
| LV-1 | The save bar could fill the screen at large text or with the keyboard | One line, with the storage's words behind "Details" (scrollable), hidden while the keyboard is up |
| LV-4 | The save-failure callout on Search had no gutters | `.ag-results-callout` on it and on the no-key callout |
| LV-5 | The empty page used 20 pt gaps | 24 (S06) |
| LV-6 | Uneven spacing in the Search again sheet | Paragraph margins removed |
| LV-7 | Coverage warnings were plain grey text | `Notice` in warning tone, as on Search |

Refuted (2):
- Dropped items could not be triggered by this build. The verifier refuted it, but DATA-06 above made the same point from another angle, was confirmed, and is fixed.
- The tab badge at 200% overflows its pill. It predates T13, and nothing visible or usable breaks.

## Gates

Final run, after the review fixes, in the worktree (`export PATH="$HOME/.local/node-arm64/bin:$PATH"`):

| Gate | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm lint` | 0 errors, 1 warning: the existing web `grid-table.tsx`, untouched |
| `pnpm test` | root 919 passed / 2 skipped; core 927; iOS 721 |
| `pnpm --filter @awardgrid/ios build` | pass; `check-fixture-free-bundle`: 18 files, no fixture markers |
| `pnpm build:landing`, `pnpm build` (worktree) | pass |
| `pnpm exec playwright test --config=playwright.uiux.config.ts` | 166 passed: harness 10, foundations 26, workspace 4, query editor 18, mobile results 14, views 15, matrix 16, details 19, onboarding 18, compare 11, saved 15 (`evidence/raw/t13-full-run.log`) |
| Evidence | `UIUX_EVIDENCE=1 … favorites.spec.ts -g "Saved at 390"` → 2 passed (`evidence/raw/t13-evidence-run.log`) |

## Acceptance

- **A23** (verified in the iOS browser mock, and by unit tests):
  - A saved snapshot opens offline. After a relaunch the request log shows no calls and the quota file is untouched.
  - The limits never delete or overwrite anything. At 100 items, a save is refused with the approved sentence and all 100 stay; the byte limit is unit-tested.
  - Deletion can be undone, back in place, for 5 seconds (held while focused), and a failed undo stays offered.
  - A failed write is recoverable. It keeps the previous list, said beside the button and in the bar with "Try saving again". An unreadable or newer file is never written over (U-047), and unreadable items are carried unchanged.
- **Unverified here:** a device's real Filesystem errors, and VoiceOver.

## Screens (looked at)

All at 390, in Chinese, light and dark:

| File | What it shows |
|---|---|
| `screens/t13-saved-*.png` | 收藏: the intro, 已收藏 1/100 · 0.0/5.0 MB, a card (HKG → SEA, 10月1–30日 · 商务舱、头等舱 · 1 个计划, 收藏于 … · 收藏时 2 个选项, the fixed note, 打开 / 删除), and the fourth tab selected |
| `screens/t13-saved-snapshot-*.png` | The saved snapshot: 返回收藏, the conditions and saved time, the note and "结果不完整。未查完：HKG → SEA。" as warnings, two cards without checkboxes, 重新查询 |
| `screens/t13-saved-undo-*.png` | After a deletion: "已删除。5 秒内可以撤销。", the empty state (还没有收藏 / 去查票, 24 apart), and the 已删除。 · 撤销 bar above the tab bar |

## Not verified here

- **Simulator or device:**
  - The Filesystem plugin's actual rejection codes: an unreadable file must reject with something other than `OS-PLUG-FILE-0008`.
  - The two-slot write on a full disk.
  - VoiceOver on the undo announcement and focus, and on the save bar.
- **Not built in T13:**
  - AI assistance from a saved snapshot (T15).
  - A favourite button on the details page (U-045).
