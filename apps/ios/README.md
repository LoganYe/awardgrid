# `@awardgrid/ios` — the client shell

Phase 2 of `docs/PIVOT.md`: *"Vite SPA, react-router, the native-HTTP adapter with its startup
assertion, Keychain key storage, in-memory cache with a JSON snapshot. Device SQLite can wait for
watches."* Phase 3 put it on the shared design tokens; Phase 4 added watches.

**There is no server.** No accounts, no sessions, no database, no key of ours. One device, one
seats.aero Pro key in the Keychain. That deletes the ~5,500 lines PIVOT §1 counted — `auth`,
`server`, `keys`, `crypto`, `db` — because every one of them existed to protect a shared host.

## What Phase 0 measured, and where it shows up here

Phase 0 (`docs/PHASE0.md`) was not a formality; two of its measurements are load-bearing:

| Measured | Consequence in this app |
|---|---|
| WKWebView `fetch()` → seats.aero fails (CORS); the native bridge does not | `capacitor.config.ts` keeps `CapacitorHttp.enabled: false`, so nothing reaches the API except explicitly through `src/native/http.ts`, and a missing bridge fails at **launch** |
| `AbortSignal` does not cancel a native request — only the promise | **There is no cancel button.** One would imply the call had been called off; it has not, and the quota is spent either way |
| `readTimeout`/`connectTimeout` *are* honoured natively | The adapter always sends one, so an abandoned search is bounded natively rather than by an `AbortController` the native side ignores |

## The pieces

```
src/native/http.ts          the fetch-shaped adapter over URLSession + the startup assertion
src/native/keychain.ts      the key, afterFirstUnlockThisDeviceOnly, never synced, never displayed
src/store/quota-store.ts    the daily counter, reconciled against X-RateLimit-Remaining
src/store/watch-store.ts    watches on the device; no schedule field exists to render
src/store/persistence.ts    cache.json, quota.json and watches.json under the app's Data directory
src/search/search.ts        the single-user replacement for src/lib/server/find.ts (709 lines)
src/watch/runner.ts         checks every watch that may be checked, once, when called
src/watch/capabilities.ts   what a watch actually does here — the source of truth for every claim
src/app/bootstrap.ts        launch order: restore snapshots, wire the observer, build the engine
src/honesty.test.ts         fails CI on any string that promises a cadence
```

Everything that decides *what a search means* — parsing, planning, the cache scope algebra, the
grid, the snapshot diff — is `@awardgrid/core` and is not reimplemented here. This package is a shell.

## The quota rule, stated exactly

PIVOT §2 says to trust seats.aero's own header over the local counter. Vaguely applied, that is a
bug factory, so `src/store/quota-store.ts` implements one rule:

```
used(day) = max(locally counted calls, 1000 - X-RateLimit-Remaining)
```

- **Monotonic within a day** — reconciliation only ever raises `used`. A retried or out-of-order
  response must not refund calls that were really made.
- **A refund cannot cross the floor.** `runFind` reserves calls up front and returns the unused
  ones with a negative increment; without a floor that walks the count back below what seats.aero
  said was spent.
- **Corrected on the first response after a reinstall**, which is the case PIVOT §2 names: local
  count 0, real remaining 400, so 600 are already gone and the app must not offer 950.

Over-counting costs a search the user could have run. Under-counting costs a 429 mid-grid. The
`max` picks the first.

## Watches

A watch is a search the user asked the app to keep an eye on. It is checked **when the app opens and
each time it returns to the foreground, and at no other time.** There is no background check; the
verified reasons are in `src/watch/capabilities.ts` and `docs/PIVOT.md` §3's amendment.

What a check does, and the rules it holds:

- **It re-parses the query text**, so "next 30 days" keeps meaning the next 30 days. The web app stores
  absolute dates, which is its issue #47: a standing query freezes and goes silent within 92 days.
- **It diffs only the dates both checks covered.** A sliding window would otherwise report every date
  that aged out as a dropped seat and every date that entered as a new one.
- **It will not spend quota it cannot justify.** Inside the 45-minute cache TTL a check could not
  return fresher data, so it is skipped; below 25 remaining calls it is skipped so a watch never spends
  the calls you opened the app to use. Watches run one at a time with quota re-read between them.
- **The first check only sets a baseline.** Against an empty baseline every seat would look new.
- **Changes accumulate until you look.** Each check moves the baseline forward, so a quiet check must
  not erase an earlier one's news. The Watches tab shows a count; each watch says what changed "since
  you last looked".
- **A failed check never touches the baseline** — and if it may have reached seats.aero, it still starts
  the clock, so a failing watch cannot retry and spend on every open.

There are no local notifications. Every check runs while the app is open, so a change is on screen the
moment it is found. A notification would repeat the tab's count, and the permission prompt it needs
would tell you to expect alerts while the app is closed, which this app cannot send.

### The one lie this app must not tell

`docs/PIVOT.md` §3: *"Never print a next-run time … Promising a cadence the OS will not honour is the
one lie this product must not tell."* `src/honesty.test.ts` enforces it. It reads every user-visible
string in this package and on the landing page through the TypeScript AST and fails on any that
promises a cadence ("every 3 hours", "next run", 定时, 每 3 小时) or — while
`WATCH_CHECKS.inBackground` is false — claims a background check. Its deny-list is derived from the web
app's own dictionaries, and its self-test pins both directions: it must catch those phrases and must
allow honest ones like "No guaranteed schedule".

## Running it

```bash
pnpm install                       # from the repo root; this is a workspace member
pnpm --filter @awardgrid/ios test  # 198 tests, no device, no network
cd apps/ios && npm run build && npx cap sync ios
```

Then build and install on a booted simulator:

```bash
xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Debug \
  -sdk iphonesimulator -destination "id=<UDID>" -derivedDataPath ios/DerivedData \
  CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=YES build
xcrun simctl install booted ios/DerivedData/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch booted com.dowhiz.awardgrid
```

**Signing is not optional, even on the simulator.** A `CODE_SIGNING_ALLOWED=NO` build has no
entitlements, and every Keychain write then fails with `OSStatus -34018`
(`errSecMissingEntitlement`) — observed, not predicted. `ios/App/App/App.entitlements` carries the
keychain access group and is wired to the App target in `project.pbxproj`.

CocoaPods rather than SPM: Capacitor 8 defaults to SPM, and on this machine that stalled
reproducibly on the xcframework download (`docs/PHASE0.md` §6).

## Known costs, recorded rather than hidden

- **The bundle carries `@anthropic-ai/sdk` (~650 KB total).** `query/llm.ts` imports it as a
  *value*, and `query/parse.ts` imports from `query/llm.ts`, so importing `parseQuery` pulls the
  SDK in even though the grid lane never passes an `llmClient` and needs no Anthropic key. The
  remedy, when bundle size matters, is to import `query/deterministic` + `query/schema` directly
  and reimplement `parseQuery`'s ~45-line tail — deferred because duplicating that tail is a
  divergence risk for a cost that does not yet hurt.
- **The grid is not yet the web app's virtualised component.** `src/components/GridTable.tsx` is a
  flat, phone-sized reading of the core's `Grid`; `src/search/search.ts` keeps the `ApiResult` /
  `ApiFailureCode` shape from `src/components/grid/api.ts` exactly so the full port stays a small diff.
- **English only.** The shell has no i18n yet. When it does, the watch feature must not be called
  定时查询 — 定时 means "on a timer" — and the honesty test will reject it if it is.
- **No background check, and so no notifications.** See Watches above. If one is ever wanted, the
  honest route is a native Swift `BGAppRefreshTask` that reads the existing Keychain item — and the
  UI must still never print a next-run time.
