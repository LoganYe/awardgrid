# `@awardgrid/ios` — the client shell

Phase 2 of `docs/PIVOT.md`: *"Vite SPA, react-router, the native-HTTP adapter with its startup
assertion, Keychain key storage, in-memory cache with a JSON snapshot. Device SQLite can wait for
watches."*

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
src/native/http.ts        the fetch-shaped adapter over URLSession + the startup assertion
src/native/keychain.ts    the key, afterFirstUnlockThisDeviceOnly, never synced, never displayed
src/store/quota-store.ts  the daily counter, reconciled against X-RateLimit-Remaining
src/store/persistence.ts  cache.json + quota.json under the app's Data directory
src/search/search.ts      the single-user replacement for src/lib/server/find.ts (709 lines)
src/app/bootstrap.ts      launch order: restore snapshots, wire the observer, build the engine
```

Everything that decides *what a search means* — parsing, planning, the cache scope algebra, the
grid — is `@awardgrid/core` and is not reimplemented here. This package is a shell.

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

## Running it

```bash
pnpm install                       # from the repo root; this is a workspace member
pnpm --filter @awardgrid/ios test  # 44 tests, no device, no network
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
- **The grid is a placeholder.** `SearchScreen` renders the `Grid` as JSON. PIVOT §6 puts the real
  virtualised components in Phase 3; `src/search/search.ts` keeps the `ApiResult` / `ApiFailureCode`
  shape from `src/components/grid/api.ts` exactly so that port is a small diff.
- **No watches.** PIVOT §3: iOS cannot honour a schedule, so the feature is a *watch* and nothing
  here prints a next-run time. The screen says "last checked", never "checks again at".
