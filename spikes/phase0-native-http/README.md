# Phase 0 — does a native-HTTP call reach seats.aero?

Throwaway spike for `docs/PIVOT.md` §6, Phase 0. It exists to retire one risk and then be
deleted. Nothing here is meant to survive into `packages/core` or the shell.

**The question.** seats.aero sends no `Access-Control-Allow-Origin` from any origin, so no
browser page can call it. Capacitor's JavaScript runs inside WKWebView, which enforces CORS
exactly like a browser. The pivot's whole premise is that routing the request through the
native bridge to `URLSession` escapes that. Phase 0 either measures that or kills the plan.

**Why this is not just "call the API and screenshot the rows".** The kickoff is explicit:
*"You state explicitly how you proved the call went over native HTTP and not the WebView."*
A rendered grid does not prove which stack fetched it, and a debugger-hosted run can execute
`fetch` in a browser context and fail with CORS — looking like the premise is wrong when it
is the harness that is wrong. So the proof is made from **outside** the app.

## How the proof works

`probe-server.mjs` runs on the Mac and copies seats.aero's CORS posture: it returns JSON and
not one `Access-Control-*` header. The iOS Simulator shares the host's network stack, so the
app reaches it at `http://localhost:4599`. The server writes down what actually arrived.

The two stacks are not disguisable from each other at the wire:

| | WKWebView `fetch()` | native `URLSession` |
|---|---|---|
| `Origin` | `capacitor://localhost` | absent |
| `Sec-Fetch-Mode` / `-Site` / `-Dest` | present | absent |
| `User-Agent` | Mobile Safari | `CFNetwork/… Darwin/…` |
| reads a CORS-less response | **no** | yes |

So the app fires the *same request through both stacks* and then asks the server which one it
saw. That is an observation, not an inference.

`capacitor.config.ts` sets `CapacitorHttp.enabled: false` on purpose. Enabling it monkey-patches
`window.fetch`; leaving it off keeps a genuine CORS-enforcing `fetch` in the WebView, which is
what makes the A/B a real control, and guarantees nothing reaches seats.aero except explicitly
through `src/nativeFetch.ts`.

## The probes

| | Asks | A pass means |
|---|---|---|
| P0 | Is the native bridge live? | Native platform, `CapacitorHttp` registered, global `fetch` unpatched |
| P1 | WebView `fetch()` → seats.aero | It **fails**. A pass here would refute the pivot |
| P2 | `nativeFetch()` → the same URL | HTTP status + readable headers. 401 is fine: this tests reachability, not auth |
| P3 | Which stack sent it? | The server logged a native-like request with no `Origin` |
| P4 | Does `AbortSignal` cancel the **native** request? | The server saw the client hang up, not just an abandoned promise |
| P5 | Is `readTimeout` honoured on iOS? | It rejected early instead of waiting out the full hold |
| P6 | Real key, real query | HTTP 200, rows rendered, `X-RateLimit-Remaining` read off the response |

P4 and P5 are money questions, not curiosities. `SeatsAeroClient` builds its 20 s timeout from
an `AbortController` (`src/lib/seatsaero/client.ts:312`) and classifies the failure by reading
`signal.aborted` (`:327`). If neither abort nor `readTimeout` reaches the native side, an
abandoned search still spends one of the 1,000 daily quota calls.

## Running it

```bash
cd spikes/phase0-native-http
npm install
node probe-server.mjs          # leave running in its own terminal
npm run build && npx cap sync ios
npx cap run ios
```

Or build and install straight onto a booted simulator:

```bash
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -sdk iphonesimulator -destination "id=<UDID>" \
  -derivedDataPath ios/DerivedData CODE_SIGNING_ALLOWED=NO build
xcrun simctl install booted ios/DerivedData/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch booted com.dowhiz.awardgrid.phase0
```

P0–P5 need no API key. Only P6 does.

### Supplying the key

The key never enters the repo, the transcript, or a commit. Write it to `.env.local`, which
`.gitignore` already covers via `.env.*`, and which CI's "no secrets tracked" grep would fail
the build over if it were ever committed:

```bash
echo 'VITE_SEATS_AERO_KEY=<your seats.aero Pro key>' > .env.local
npm run build && npx cap sync ios
```

You can also paste it into the field on the P6 row at runtime, which keeps it out of the
build output entirely.

## Simulator or device?

The Simulator is sufficient, and the reason is structural: **CORS is a WebView policy, not a
network-stack policy.** It is enforced by WebKit in the renderer, above the socket. `URLSession`
has no notion of an origin and never consults one, on either the Simulator or a device. What
the Simulator does differ on — code signing, entitlements, push, background refresh — is not
in the path of an HTTPS GET.

The one thing a Simulator run genuinely cannot settle is App Store review behaviour, which is
`docs/PIVOT.md` §5's problem and not Phase 0's.

## What this spike is not

No design system, no package split, no router, no Keychain, no `packages/core`. PIVOT §6 puts
those in Phases 1–3, and starting them before Phase 0 answers would be building on an
unmeasured premise. The UI here is deliberately plain.

`ios/App/App/Info.plist` carries an ATS exception for `localhost` so the app can reach the
probe server over cleartext HTTP. It is scoped to `localhost`; HTTPS enforcement for
seats.aero is untouched. **A shipping app must not carry that key.**
