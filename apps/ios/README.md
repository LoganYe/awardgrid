# `@awardgrid/ios` — the client shell

Phase 2 of `docs/PIVOT.md`: *"Vite SPA, react-router, the native-HTTP adapter with its startup
assertion, Keychain key storage, in-memory cache with a JSON snapshot. Device SQLite can wait for
watches."* Phase 3 put it on the shared design tokens; Phase 4 added watches; Phase 5 added Ask.

**There is no server.** No accounts, no sessions, no database, no key of ours. One device, your own
keys in its Keychain: a seats.aero Pro key, and an Anthropic key if you use Ask. That deletes the
~5,500 lines PIVOT §1 counted — `auth`, `server`, `keys`, `crypto`, `db` — because every one of them
existed to protect a shared host.

## What Phase 0 measured, and where it shows up here

Phase 0 (`docs/PHASE0.md`) was not a formality; two of its measurements are load-bearing:

| Measured | Consequence in this app |
|---|---|
| WKWebView `fetch()` → seats.aero fails (CORS); the native bridge does not | `capacitor.config.ts` keeps `CapacitorHttp.enabled: false`, so nothing reaches the API except explicitly through `src/native/http.ts`, and a missing bridge fails at **launch** |
| `AbortSignal` does not cancel a native request — only the promise | **There is no cancel button for a search.** One would imply the call had been called off; it has not, and the quota is spent either way. Ask's Stop says what it does: it sends nothing more and cannot recall a request already sent (`docs/PHASE5.md` §1.6, T4) |
| `readTimeout`/`connectTimeout` *are* honoured natively | The adapter always sends one, so an abandoned search is bounded natively rather than by an `AbortController` the native side ignores |

## The pieces

```
src/native/http.ts          the fetch-shaped adapter over URLSession + the startup assertion
src/native/keychain.ts      the seats.aero key, afterFirstUnlockThisDeviceOnly, never synced, shown only as its last four
src/native/anthropic-key.ts the Anthropic key, its own Keychain item, whenUnlockedThisDeviceOnly, never synced
src/native/webview-fetch-guard.ts  refuses the WebView's fetch to seats.aero and Anthropic, installed at launch
src/store/quota-store.ts    the daily counter, reconciled against X-RateLimit-Remaining
src/store/watch-store.ts    watches on the device; no schedule field exists to render
src/store/ask-store.ts      ask.json, Ask's one conversation on the device
src/store/persistence.ts    cache.json, quota.json and watches.json under the app's Data directory
src/search/search.ts        the single-user replacement for src/lib/server/find.ts (709 lines)
src/search/last-search.ts   the last successful grid search, in memory only, for Ask
src/watch/runner.ts         checks every watch that may be checked, once, when called
src/watch/capabilities.ts   what a watch actually does here — the source of truth for every claim
src/ask/ask-service.ts      runs a question (core's loop) and owns it while screens come and go
src/ask/seats-port.ts       Ask's seats.aero calls, over the same transport, cache, routes and quota as search
src/ask/labels.ts           the labels and sentences the shell adds to Ask and Settings' Anthropic section
src/screens/AskScreen.tsx   #/ask, with components/AskEntry.tsx and components/AnswerText.tsx
src/app/bootstrap.ts        launch order: restore snapshots, wire the observer, build the engine
src/honesty.test.ts         fails CI on a cadence promise in this package, core's watch and Ask code, or the landing page
src/probes/                 the probe and e2e builds' code; compiled out of every other build
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
  return fresher data, so it is skipped; below 25 remaining calls it is skipped, so a watch does not
  start on the calls you opened the app to use. That is checked only when a check starts, and a check
  that starts can then spend below 25 (#76). Watches run one at a time with quota
  re-read between them.
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
string in this package, in core's watch and Ask code, and on the landing page through the TypeScript
AST and fails on any that promises a cadence ("every 3 hours", "next run", 定时, 每 3 小时) or — while
`WATCH_CHECKS.inBackground` is false — claims a background check. Its deny-list is derived from the web
app's own dictionaries, and its self-test pins both directions: it must catch those phrases and must
allow honest ones like "No guaranteed schedule".

## Ask

Ask is optional. It answers questions about award availability on your own Anthropic key, with Claude
Opus 5 (`claude-opus-5`, effort `medium`) and two tools, `search_awards` and `get_flights`, over the
grid lane's own seats.aero client, cache, routes catalog and quota. The loop, the tools, the prompt and
every bound are core's (`packages/core/src/lib/ask`); this package runs a question
(`src/ask/ask-service.ts`) and renders it. Search and watches work without an Anthropic key, and launch
reads none. Measurements are in `docs/PHASE5.md`, decisions in `DECISIONS.md` § "Phase 5 — Ask on the
Messages API".

**What has not been verified.** Every measurement so far ran on the Simulator with fake keys, against a
scripted server and the seats.aero mock. The only requests that reached api.anthropic.com were A1b's, with
a key Anthropic rejects, so none used a working Anthropic key. The checks on the owner's own keys
(K1-K6, #12) have not run, so real latency, cache reads, billing after Stop and a device's handling of a
request while the app is away are unmeasured. Ten of the twelve end-to-end verdicts pass, and E1 and E2 fail their own
criteria, both from how the app checks which routes seats.aero monitors (`docs/PHASE5.md` §2).

**Answers arrive whole.** The request goes out as a stream and the answer comes back in one piece,
because CapacitorHttp resolves one finished body and keeps no task handle. On the Simulator, T1 showed
that iOS's timeout is an idle interval that arriving bytes reset (an 18 s drip completed under a 5 s
timeout), and T2 showed the SDK's request crossing the native adapter unchanged (the body's sha256 equal
on both sides). The WebView's own fetch refuses both Anthropic and seats.aero: `main.tsx` installs a
tripwire that throws before it calls the WebView's fetch, A2 saw it reject both hosts, and lint keeps
`@anthropic-ai/sdk` out of `src/`.

**Limits**, all in `packages/core/src/lib/ask/limits.ts`:

| Bound | Value |
|---|---|
| One question | 1,000 characters |
| Questions per conversation | 8, and no new one once the last request of the latest question kept in the history sent more than 120,000 input tokens, or once `ask.json` is over 1,500,000 bytes |
| Model requests per question | 6; the 6th goes out with `tool_choice: none` and asks for an answer |
| Tool calls per question | 8, of which at most 4 searches and 3 flight lookups |
| seats.aero calls per question | 12; one search at most 3 pages plus 1 Get Routes call, over at most 12 airport pairs |
| Calls kept for your own searches | the last 25 of today's quota: Ask plans no spend into them, and waits for a watch run in flight before each tool call |
| Waiting on Anthropic | 90 s with no bytes (the native idle timeout); 450 s per request; no new step once a question has run 300 s |

**Stop and leaving.** Stop sends nothing more for the question. It cannot recall a request already
sent, which Anthropic may still finish and bill: in T4, Stop came at 800 ms and the probe server still
completed its stream at 5,999 ms. Leaving the Ask screen does not stop a question, because the service owns it,
and the nav reads "Ask (working)" from any screen. Leaving the app lets a request already out finish
(so far measured on the Simulator only), and the question pauses before its next step (the pause
itself not yet exercised, `docs/PHASE5.md` §2.11). A question the app was closed during comes back
unfinished, with Ask again. Nothing is retried automatically: Try again resends the identical request.
It is offered only after a failure core marks retryable, which is a rate limit, an overload, a 5xx or a
stream's error event, a connection failure, an unreadable response or the 450 s bound
(`packages/core/src/lib/ask/errors.ts:87-191`). So it is never offered after a failure that the
same request would meet again, such as a rejected key, a spend limit or a request too large, nor when
the resend would be the question's last request.

**The conversation** is `ask.json` in the app's Data directory (iOS's Documents directory); each step's
result is saved there before the next step goes out. A question joins the history resent to Anthropic
only when it ended with an answer; a stopped, failed or refused question stays on screen and is not
resent. New conversation removes `ask.json` and nothing else. Clear cached results and Remove key both
leave it.

**Cost.** Each answer shows tokens and seats.aero calls, never dollars. Anthropic bills your own
account, and Settings links to Anthropic's pricing page. The Anthropic key is its own Keychain item;
Settings saves it first, then checks it with `GET /v1/models/claude-opus-5`, which carries no question.

### Probe builds

Two builds exist only for measurement. Neither is what a person installs.

- `VITE_AG_PROBES=1` (step 3) opens `#/probes`. A launch the host armed runs the transport probes: A0,
  T1 to T5, T2b, A1b, A2 and X1; a launch nobody armed runs only A0, which touches loopback alone
  (`docs/PHASE5.md` §1.1). A1b sends one request to api.anthropic.com with a key Anthropic rejects.
- `VITE_AG_PROBES=e2e` (step 7) opens `#/ask` and drives the Ask service through A3-A5 and E1-E8
  against the probe server's scripted SSE and the seats.aero mock, with fake keys in memory. It sends
  nothing to Anthropic.

```bash
apps/ios/probes/run-probes.sh <scratch-dir outside the repository>
R1_BASELINE=<sha256 list of a normal build> apps/ios/probes/run-probes.sh --e2e <scratch-dir outside the repository>
node apps/ios/probes/probe-log.mjs summary-e2e <scratch-dir>/probe-log.jsonl --mock <scratch-dir>/mock-seats.out
```

The script needs Xcode, CocoaPods, Node at `$HOME/.local/node-arm64/bin` and the Simulator named by
`$SIM_UDID`; `--e2e` also uses an iPhone SE (3rd generation) named by `$SE_NAME`, which it creates if
none exists. It starts the probe server on 127.0.0.1:4599 and the seats.aero mock on 127.0.0.1:4597,
refuses to start if either port is held (exit 3), and stops only the processes it started. It refuses a
scratch directory inside the repository (exit 2). At the end it rebuilds and reinstalls the normal app
and runs R1, and exits 7 if R1 fails. With `--e2e`, a phase that timed out, a wait that failed or a
summary that did not finish exits 9, after the restore and R1; a scenario FAIL is a result and leaves
the exit at 0. `probe-log.mjs summary` (step 3) and `summary-e2e` re-derive every verdict from the log.

**Release check: a normal build carries no probe code and no probe host.** R1 is that check. After a
normal `npm run build`, no chunk in `dist/assets/` may be named `*[Pp]robe*` or `*e2e*`, and
`grep -c "127.0.0.1:45\|localhost:45\|probe-server\|sk-ant-"` must count 0 in every `.js` file there.
`run-probes.sh` exits 7 when either fails, or when the `.js` files differ from `R1_BASELINE`.

## Running it

```bash
pnpm install                       # from the repo root; this is a workspace member
pnpm --filter @awardgrid/ios test  # 566 tests in 25 files, no device, no network
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
  divergence risk for a cost that does not yet hurt. Since Phase 5, Ask builds its client from the
  SDK too (core's `createAskClient`), so that remedy would no longer take the SDK out of the bundle.
- **The main chunk has grown past the point where growth is investigated.** After Phase 5 it is
  746,386 bytes, 78,945 over the Phase 5 design's 667,441-byte baseline and past its 60 KB threshold
  (`docs/PHASE5.md` §2.12). Recorded, not investigated yet (#92).
- **One route list that fails fails the whole search.** In E2 one route list answered 500, and a grid
  search failed outright with "seats.aero unavailable (HTTP 500): {}" and drew no table
  (`docs/PHASE5.md` §2.4). The app uses core's `RoutesCatalog` (`src/app/bootstrap.ts:149`), which does
  not survive a failed list the way the web's `ResilientRoutesCatalog` does. Ask's searches use the same
  catalog, so such a search reaches Claude as a failed tool call; no run exercised that
  (#89).
- **Two layout defects Phase 5's measurements found.** The screenshots show scrolled pages passing
  under the transparent status bar and the Dynamic Island (#90), and the measured control
  sizes show some under 44 pt: the nav link "Ask" is 26.4 pt wide, and four Settings controls and
  Search's Run, Watch this search and example chips, all older than Phase 5, are 27 to 41.8 pt tall
  (`docs/PHASE5.md` §2.2; #91).
- **The grid is not yet the web app's virtualised component.** `src/components/GridTable.tsx` is a
  flat, phone-sized reading of the core's `Grid`; `src/search/search.ts` keeps the `ApiResult` /
  `ApiFailureCode` shape from `src/components/grid/api.ts` exactly so the full port stays a small diff.
- **English only.** The shell has no i18n yet. When it does, the watch feature must not be called
  定时查询 — 定时 means "on a timer" — and the honesty test will reject it if it is.
- **No background check, and so no notifications.** See Watches above. If one is ever wanted, the
  honest route is a native Swift `BGAppRefreshTask` that reads the existing Keychain item — and the
  UI must still never print a next-run time.
