# T18 · Web ports and account isolation: evidence

**Scope verified:** unit tests (root, core and iOS) and the Web mock.
- The Web mock is this worktree's real Next app, built and started by `e2e/uiux/start-web.sh` on 127.0.0.1:4330.
  - It uses a throwaway SQLite file and a stand-in seats.aero on :4331.
  - Accounts are signed in through the app's own login route.
- Browser: Chromium at 390 × 844. Light and dark, English and Chinese.
- The existing Web e2e (`pnpm e2e`) was re-run in the worktree as a regression.

**Not run:**
- No live seats.aero key: every request went to the stand-in, counted per account.
- No Anthropic or Telegram call.
- The Simulator and device are not relevant to this task: the Web only.
- Another browser engine (WebKit or Firefox) was not run.

Worktree: `/Users/yegaoyang/Desktop/workspace/awardgrid-uiux`.

## What was built

- **Core** (U-053): `workspace/workspace-store.ts` and `workspace/favorites-store.ts` were moved from iOS with `git mv`; iOS re-exports them from their old paths.
  - `workspace/snapshot-from-find.ts` is new.
  - `favoriteFromOption` and `optionOrigin` are new (additive).
- **Web pages:**
  - `src/app/workspace/` holds the layout (`requireUser`), `/workspace` and `/workspace/saved`.
  - `src/components/workspace/`:
    - `workspace-app.tsx`: the account's search through core's projection, with Save option.
    - `saved-app.tsx`: saved options with the approved `favorite.snapshot`.
    - `workspace-shell.tsx`: the interim nav with a visible Log out.
    - `option-card.tsx`
    - `services.ts`: per-account stores.
    - `search-port.ts`: `/api/find` to a `ResultSnapshot`.
    - `storage.ts`: per-account localStorage, logout clearing and the device epoch.
  - `src/styles/workspace.css` uses token colours only.
- **Logout and login:** the header's Log out, the workspace's Log out, Settings' Log out everywhere and the login form clear the Ask conversation and every account's workspace. Log out everywhere did not clear the conversation before T18.
- **Server:** the find answer gains `rows` and `coverage` (additive). Every legacy field is unchanged.
- **Copy:** `nav.workspace`, `nav.favorites`, `workspace.*` and `favorites.*` in English and Chinese.
- **Fixture (TEST-ONLY):**
  - `e2e/uiux/start-web.sh` and `e2e/uiux/web-clock.mjs`.
  - `scripts/uiux-web/`: `mock-seatsaero.ts`, `seed.ts` and `accounts.ts`.
  - `openScenario(page, id, "web")` in `e2e/uiux/helpers.ts`, and `webRequestLog`.
  - Two Web servers in `playwright.uiux.config.ts`.
  - `web-user-a` and `web-user-b` are seeded.
- **Tests:**
  - New: `e2e/uiux/web-isolation.spec.ts` (8 tests, the first being the plan's Step 1 test, verbatim).
  - New: `src/components/workspace/storage.test.ts` (5 tests).
  - New: `src/components/workspace/search-port.test.ts` (3 tests).
  - New: `src/app/workspace/boundaries.test.ts` (3 tests).
  - New: core `workspace/favorites-option.test.ts` (2 tests).
  - No existing test was changed.

## Test-first record

| Step | Command | Result |
|---|---|---|
| Red | `pnpm exec playwright test --config=playwright.uiux.config.ts e2e/uiux/web-isolation.spec.ts` | Failed: the Web surface signed in `web-user-a`, and no `收藏选项` was found (`evidence/raw/t18-red.log`). This was the plan's Step 1 test, verbatim |
| Green | same | 1 test, then 5 with Step 4's cases, then 8 after the review and the screen check |
| Step 4 | `web-isolation.spec.ts`, `storage.test.ts`, `boundaries.test.ts` | These cases each pass: <ul><li>A and B on one browser search with their own keys: B's rows differ from A's for the same scope, so neither the cache nor the key is shared.</li><li>Nothing goes out under B's key while A searches.</li><li>At logout the workspace and the conversation leave the browser, and A's saved option stays under A's key.</li><li>B sees `Nothing saved yet.`, and A sees their own option again.</li><li>The page's HTML and the `/api/find` answer hold no key.</li><li>The legacy find fields are unchanged.</li><li>The Web never imports iOS, Capacitor or the fixture host.</li><li>The server and CLI never import the Web workspace.</li></ul> The test never empties the browser's storage between the accounts |
| Screens | `UIUX_EVIDENCE=1 … web-isolation.spec.ts -g "Chinese at 390"` | 2 passed (`evidence/raw/t18-evidence-run.log`); looked at |
| Review | adversarial workflow: 3 finders (account isolation; the fixture and harness; regressions), one refuting verifier per finding | 14 findings: 5 confirmed (2 major), 9 refuted. ISO-2 and REG-1 are the same defect. All are fixed |
| Review red | the two new logout tests, run against the build without the epoch | Both failed: A's workspace key was back on the browser after the held answer landed (`evidence/raw/t18-review-red.log`). With the fix, the whole spec passes (`evidence/raw/t18-review-green.log`) |
| Screen check red | `web-isolation.spec.ts -g "header quota"` | Failed: the server had counted 1 call and the header still read `0 of 950` (`evidence/raw/t18-quota-red.log`). Found while looking at the first screenshots, which showed 0/950 after a cold search. The workspace now tells the header to re-read the server's count when a search settles, answered or not. Green in the same run as above |
| Clock red | `UIUX_WEB_NOW=2026-07-01T08:30:00.000Z` (85 days behind real time), without the cookie reset | Timed out: signed out at `/login` (`evidence/raw/t18-review-clock-red.log`). With the reset, 3 of 3 pass (`evidence/raw/t18-review-clock.log`) |

## Review (adversarial)

| Finding | What was wrong | Fix |
|---|---|---|
| REG-1, ISO-2 (major) | A search in flight at logout put that account's whole workspace back on the browser when its answer landed | The device epoch: storage made before a logout or login writes nothing, and the port drops an answer that lands after one. Unit tests; browser tests through Log out and through Log out everywhere, with `/api/find` held |
| FIX-2 (major) | The session cookie's `Expires` comes from the server's shifted clock but is judged on real time. From 2026-11-17 every Web test would have failed at sign-in | The harness sets the cookie again as a browser-session cookie. `UIUX_WEB_NOW` moves both clocks; checked 85 days behind real time |
| FIX-3 | `UIUX_WEB=0`, the documented iOS-only run, still ran the Web specs, and all failed on a refused connection | They are left out, and the run says so. `openWebScenario` names the reason. `--list` gives 203 tests with no `web-isolation` (`evidence/raw/t18-review-ios-only-list.log`) |
| FIX-4 | The stale-build check missed `places.json`, core's exports map, the root config and deleted files | Every build input, directories included. Checked by touching `places.json` and by a file that came and went |

Refuted (9):
- **ISO-1:** a tab left open across a logout elsewhere. This is not new; the Web never passed a logout between tabs. See U-053.
- **FIX-1:** the plan's verbatim test may assert before the Saved route commits. Step 4's test waits for `Nothing saved yet.`.
- **FIX-6:** in a whole-file run, A's search can come from the server cache. The row difference still proves the key and cache are per account.
- **FIX-7:** the browser test cannot see a shared workspace key, because logout removes it first. That is the required behaviour, and the code keys by the session's account.
- **FIX-5, REG-5:** the UI/UX run and `pnpm e2e` share the worktree's `.next`. Run them one after the other (NEXT_SESSION).
- **REG-2:** the headings step from h1 to h3. This is an axe best-practice rule, not WCAG; it goes to T21.
- **REG-3:** the empty state points to the grid. That is true today; the workspace's own query bar is T19.
- **REG-4:** the interim nav repeats the header. The layout is T19.

## Gates

Final run after the review fixes, in the worktree:

| Gate | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm lint` | 0 errors; 1 warning in the existing web `grid-table.tsx`, which is untouched |
| `pnpm test` | root 930 passed / 2 skipped; core 960; iOS 795 (`evidence/raw/t18-unit-final.log`) |
| `pnpm --filter @awardgrid/ios build` | pass; fixture-free (the bundle check: 118 markers, none in `dist`) |
| `pnpm build:landing`, `pnpm build` (worktree) | pass |
| `pnpm exec playwright test --config=playwright.uiux.config.ts` | 211 passed; T18 added web-isolation 8 (`evidence/raw/t18-full-run.log`) |
| `pnpm e2e` (existing Web e2e, worktree) | 583 passed / 145 skipped / 0 failed, the same as the baseline, after the review fixes (`evidence/raw/t18-web-e2e.log`). The tracked `docs/screenshots/v0.2` it rewrites were restored |

## Acceptance

- **A30** (verified in the Web mock and unit tests):
  - User B on the browser A used cannot see A's cache (B's rows are B's own), A's saved options (B's list is empty, and A's reappear for A) or A's workspace. Selection lives in the workspace, and the workspace leaves the browser at logout.
  - The conversation leaves at logout too.
  - An answer landing after logout leaves nothing.
  - The page and the find answer carry no key.
  - The header's quota count follows a workspace search at once, as the server counts it.
  - The Web never imports the iOS shell's native modules (`boundaries.test.ts`).
- **Not verified here:**
  - Another tab left open across a logout elsewhere (ISO-1; not in A30's single-tab hand-over).
  - A real seats.aero key per account.

## Screens (looked at)

At 390 in Chinese, light and dark:

| File | What it shows |
|---|---|
| `screens/t18-web-workspace-*.png` | The interim nav (查票 selected, 收藏, 查询, 设置, 退出登录). 查票, HKG → SEA, 10月1–30日 · 商务舱、头等舱 · 1 个计划, and 1 个选项. The card reads 10月18日 · 周日 · 商务舱 · Air Canada Aeroplan, 75,000 里程, 税费待确认 · 席位未提供, 来源 1 天前更新, and the pressed 已收藏. The header quota reads 1/950, the call this cold search spent |
| `screens/t18-web-saved-*.png` | 收藏 with its intro (kept per account on this device; opening sends nothing), 已收藏 1/100, and the saved option with its search, its row, 收藏于 2026年10月18日 01:30, the approved 收藏快照，库存可能变化。, and 删除 |

## Not verified here

- A live seats.aero key and a real account's quota.
- WebKit and Firefox; a real phone's browser.
- The S10 layout, keyboard and panels (T19). Web scheduling, Telegram and settings regression (T20).
