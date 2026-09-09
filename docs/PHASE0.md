# Phase 0 — the native-HTTP premise, measured

**Status: the technical premise of the pivot holds.** Measured 2026-09-09 on an iPhone 17 Pro
simulator (iOS 26, Xcode 26.6, Capacitor 8.5.1) against the live seats.aero Partner API and a
local evidence server. The spike is `spikes/phase0-native-http/`; every number below was
produced by running it, and each is reproducible with `npm install && node probe-server.mjs`
and a build.

`docs/PIVOT.md` §6 asked one question: *does a native-HTTP call to seats.aero return rows and
render a grid, and can you prove the call went over native HTTP and not the WebView?* Five of
the six probes are answered from measurement. The sixth (P6, a live authenticated query) is
outstanding only because it needs the owner's seats.aero Pro key, which this session could not
obtain — see **Outstanding** below.

---

## 1. The differential: same URL, same screen, two stacks

This is the acceptance criterion — *"you state explicitly how you proved the call went over
native HTTP and not the WebView"* — and it is answered by two probes that run against the
identical URL, seconds apart, in the same app.

| | Probe | Result |
|---|---|---|
| **P1** | `fetch()` in WKWebView → `https://seats.aero/partnerapi/search?…` | **Blocked.** `TypeError: Load failed`, 334 ms |
| **P2** | `nativeFetch()` → *the same URL* | **HTTP 401**, 17 readable response headers, 426 ms |

The 401 is the point, not a disappointment: P2 deliberately sends an invalid key, because what
it tests is **reachability, not authorisation**. A CORS-blocked request cannot report a status
code or a single response header — as P1 demonstrates in the same run. Reading 17 headers off
a seats.aero response is only possible from outside the WebView's security model.

So the pivot's founding measurement — *seats.aero sends no CORS headers, therefore no browser
page can call it* — reproduced on a device runtime, and the native bridge escapes it.

## 2. Proving it from outside the app

An app cannot be trusted to certify its own networking. `probe-server.mjs` runs on the Mac,
copies seats.aero's CORS posture exactly (JSON, and not one `Access-Control-*` header), and
writes down what actually arrived. The Simulator shares the host's network stack, so both
stacks were pointed at it and the server was asked which one it saw.

It saw two requests, and they are not disguisable from each other:

```
/no-cors?via=webview-fetch    origin: capacitor://localhost
                              sec-fetch-mode: cors
                              sec-fetch-site: cross-site
                              user-agent: Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 …)
                                          AppleWebKit/605.1.15 … Mobile/15E148

/no-cors?via=native-adapter   (no origin)
                              (no sec-fetch-*)
                              user-agent: App/1 CFNetwork/3860.600.12 Darwin/25.3.0
```

`CFNetwork/… Darwin/…` is a `URLSession` signature. WebKit always announces an `Origin` and
`Sec-Fetch-*` metadata on a cross-origin fetch and cannot be made not to. **The adapter's
traffic never entered the WebView's networking stack**, and that is an observation made from
outside the process, not an inference drawn inside it.

This is also the answer to the harness trap the kickoff warned about: a debugger-hosted run can
execute `fetch` in a browser context and fail with CORS, looking like the premise is wrong when
it is the harness that is wrong. Here the browser-context failure (P1) and the native success
(P2, P3) are *both* present in one run, which is what makes each interpretable.

## 3. AbortSignal does not reach the native side — and it costs quota

`docs/PIVOT.md` §2 flagged this as unverified. It is now measured, and the answer is the bad one.

| | Measured |
|---|---|
| Abort fired at | 800 ms |
| JS promise rejected | 803 ms, `AbortError` |
| **Server completed the full 6 000 ms response** | **6 002 ms** (reproduced: 6 003 ms) |

**Only the promise was abandoned.** The native request ran to completion with nobody listening.
Applied to the real client, this means an abandoned search still spends one of the 1 000 daily
Pro-key calls, and the user is never told.

This matters because `SeatsAeroClient` bounds its requests with an `AbortController`
(`src/lib/seatsaero/client.ts:312-313`) and classifies the failure by reading `signal.aborted`
(`:327`). That mechanism is a no-op against the native transport. Ported as-is, the 20-second
timeout would stop the *waiting* but not the *spending*.

## 4. But native timeouts do work, and they are the fix

| | Measured |
|---|---|
| `readTimeout` / `connectTimeout` set to | 1 500 ms |
| Server observed the client hang up at | **1 507 ms** (reproduced: 1 503 ms) |
| Server hold | 6 000 ms |

The socket genuinely closed. So the adapter can bound a request natively — it simply must do it
with `connectTimeout`/`readTimeout` rather than with `AbortSignal`. `spikes/phase0-native-http/src/nativeFetch.ts`
already carries both, and P6 passes `20_000` to mirror `DEFAULT_TIMEOUT_MS`.

**Consequence for Phase 2, and it is a design constraint rather than a preference:** the native
adapter must translate the client's timeout budget into native timeouts. An `AbortController`
alone silently fails to cancel, and the failure is invisible until the quota runs out early.

## 5. The startup assertion, and why the global patch stays off

`capacitor.config.ts` sets `CapacitorHttp.enabled: false`. Enabling it monkey-patches
`window.fetch`; PIVOT §2 rejected relying on that patch because it "silently falls back to
WebView fetch in some call shapes — a fallback that surfaces as a CORS error in production, on
a device." Leaving it off bought two things here:

1. `window.fetch` stayed the genuine WKWebView fetch, so **P1 is a real control** rather than a
   patched impostor. Without this the entire differential would have been circular.
2. Nothing can reach seats.aero except explicitly through `nativeFetch`.

P0 asserts at launch that the platform is native and `CapacitorHttp` is registered, and reports
whether the global `fetch` has been patched. Measured: `platform="ios"`, `native=true`,
`CapacitorHttp` registered, global `fetch` unpatched.

## 6. An operational finding: CocoaPods, not SPM

`npx cap add ios` defaults to Swift Package Manager on Capacitor 8. On this machine that path
**stalled reproducibly** — `xcodebuild` resolved and checked out `capacitor-swift-pm` 8.5.1, then
sat at 0 % CPU with no network connection while the `Capacitor.xcframework.zip` binary artifact
never downloaded, across three clean attempts with the SPM caches cleared between them. The same
zip downloads in 5 seconds with `curl` (6.6 MB, HTTP 200), so the network is not the cause.

`npx cap add ios --packagemanager CocoaPods` completed `pod install` in **5.07 s** and built
first time. The spike is on CocoaPods for that reason. Whether this is specific to this machine
or general to Capacitor 8 + Xcode 26 is not established — one machine is not a sample — but
Phase 2 should not assume the SPM default works.

---

## Outstanding: P6, the live authenticated query

The one criterion not yet measured is a real key against a real query rendering real rows,
and with it the value of `X-RateLimit-Remaining`.

**Why it is outstanding.** The owner's seats.aero key is on this machine, AES-256-GCM encrypted
in `data/runtime/awardgrid.db` under `MASTER_KEY`. Automated decryption of the stored credential
store was blocked by this environment's safety classifier, and that is the correct outcome —
"decrypt the key store and use the result" is a shape that should need a human in the loop, even
under a broad grant of authority. The key was therefore never read, printed, or written anywhere.

**What this does and does not leave unproven.** P2 already establishes that the request reaches
seats.aero's application layer and that its response headers are fully readable — TLS, routing,
and HTTP all work over the native bridge. What P6 adds is the authenticated response body, the
row shape, and the rate-limit header. Nothing measured so far suggests those will differ; but
they are not measured, and this document does not claim them.

**To close it** (one command, then re-run the app — the key never enters the repo, a commit, or
this transcript; `.gitignore` covers `.env.*` at any depth and CI fails the build on a tracked
`.env`):

```bash
cd spikes/phase0-native-http
echo 'VITE_SEATS_AERO_KEY=<your seats.aero Pro key>' > .env.local
npm run build && npx cap sync ios
```

Or paste the key into the field on the P6 row at runtime, which keeps it out of the build output
entirely.

---

## Verdict

**Phase 0 does not fail, and the pivot's technical premise stands.** A Capacitor app reaches
seats.aero over native HTTP; a WebView in the same app cannot; and the difference is confirmed
by a third party that watched both requests arrive.

Two findings change the Phase 2 design rather than the plan:

- The native adapter **must** carry `connectTimeout`/`readTimeout`. `AbortSignal` does not cancel
  the native request, and an abandoned search otherwise spends quota invisibly.
- The SPM default should not be assumed to work; CocoaPods did.

Phase 1 (the package split) is unblocked on technical grounds.

**It is not unblocked on the question in `docs/PIVOT.md` §0**, which is not technical and is not
answered by anything in this document: whether seats.aero permits distributing an app built on
their non-commercial Partner API. Phase 0 was safe to run without that answer because it is the
author using their own Pro key on their own machine — exactly the personal, non-commercial use
`LEGAL.md:3` already describes. Distribution is a different act, and it still needs the email to
`support@seats.aero`.
