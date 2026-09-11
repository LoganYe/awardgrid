# Phase 5 — Ask on the Messages API, measured

This file holds Phase 5's measurements, the way `docs/PHASE0.md` holds Phase 0's. §1 is the transport on the
Simulator with no keys (step 3). Later steps add the end-to-end probes against the mocks, and the owner's-key probes
once that spend is approved (design §10.3, §10.5).

---

## 1. The transport, on the Simulator (step 3)

**Status: the streaming transport holds, and one probe failed its own criterion.** T1 shows the native idle timer
resets on bytes, and T2 shows the SDK's streamed request crossing the production adapter byte for byte and parsing on
the way back. So design §2.1 stands, and its non-streaming fallback is not needed. **A1b failed:** api.anthropic.com
answered the invalid key with a readable 401, but that response carried no `request-id` header, so `requestID` was
null in both runs. The adapter is not what lost it (§1.7). The lead's decision: A1b stays a FAIL against its own
criterion. The point design §10.4 needed it for, a readable response from the real host over the native adapter, it
did establish; whether a real `request-id` is readable on the device is left to the owner's-key probes (§1.7).

Measured 2026-09-11 on an iPhone 17 Pro simulator (iOS 26.5 runtime, Xcode 26.6, Capacitor 8.5.1,
`@anthropic-ai/sdk` 0.123.0). The probes ran against a local evidence server and, for A1b only, against
api.anthropic.com with a key Anthropic rejects. The harness is `apps/ios/probes/`.
`run-probes.sh` builds the probe app, runs it, performs T5's leaving and returning, restores the normal app and checks
R1. It ran twice, end to end: run 1 armed at 05:17:19Z and run 2 at 05:22:54Z. The only change between them is that A1b
began recording response headers. Every number below is from run 2, with run 1 beside it, and each is a line the probe
server wrote or a value the app posted to it.

The raw logs are not committed. The excerpts below are verbatim JSON lines from run 2's log, with the `header_names`
field removed (the lists are quoted separately where they matter). A long app line is shortened with `…`; nothing
inside a quoted value is changed.

| | Probe | Verdict | Run 2 | Run 1 |
|---|---|---|---|---|
| **A0** | Native GET to `http://127.0.0.1:4599` and `http://localhost:4599`, no ATS key | **PASS**, no key needed | 200 in 87 ms; 200 in 10 ms | 48 ms; 58 ms |
| **T1** | 5 s idle timeout vs. a 10-chunk drip at 2 s gaps; control `/slow` | **PASS** | completed 18,004 ms, 10,240 bytes in JS; control cut at 5,014 ms | 18,002 ms; 5,012 ms |
| **T2** | SDK stream over the production adapter | **PASS** | `tool_use`, fixture input, 142 tokens; no Origin, no Sec-Fetch; body sha256 equal | same, same hash |
| **T2b** | WebView fetch, same URL and body | **PASS** | preflight with `origin: capacitor://localhost` and Sec-Fetch-*; the POST never came | same |
| **T3** | `event: error` mid-stream | **PASS** | `overloaded_mid_answer` after 758 ms | 798 ms |
| **T4** | Stop at 800 ms into a 6 s replay | **PASS** | JS rejected 1 ms after the abort; server completed at 5,999 ms | 1 ms; 6,001 ms |
| **A1b** | Real api.anthropic.com POST, invalid key | **FAIL** | 401 `AuthenticationError`, **`requestID` null**; no `request-id` header | same |
| **A2** | WebView fetch to both hosts | **PASS** | both `NativeHttpRequiredError` | same |
| **X1** | Harness check for step 7: the seats.aero rewrite | **PASS** | mock answered 200 with `x-ratelimit-remaining: 812` | same |
| **T5** | Leave the app 3 s into a 60 s drip, return at 48 s | **PASS** | one outcome: resolved, 61,440 bytes at 59,028 ms | 59,023 ms |
| **R1** | The normal bundle | **PASS** | 0 in all 7 `.js` files | 0 |

### 1.1 How it was run

- **Probe build only.** `VITE_AG_PROBES=1` makes `main.tsx` open `#/probes` and makes `App.tsx` lazy-load
  `src/probes/ProbesScreen.tsx` and hand `src/probes/probe-transport.ts` to bootstrap. In any other build both are
  constant-false branches. The seven `.js` files of a normal build from this tree hash identically (sha256) to a build
  with HEAD's `App.tsx` and `main.tsx`, so the probe wiring adds no code to the app that ships. The source maps copied
  beside them do differ: `index-*.js.map` carries the new `App.tsx` and `main.tsx` source text, which names the probe
  modules. No map contains a probe host, `probe-server` or a key-shaped string (the R1 pattern counts 0 in all seven).
- **Production transport.** Every probe uses `createNativeFetch` and `createAskClient`. The Anthropic probes differ
  only in `baseURL: "http://127.0.0.1:4599/sse"`, and A1b has none. The probe key is `sk-ant-probe-invalid-000000`, and
  the server logs only its length.
- **One run per launch.** The host POSTs `/arm`, and the app's first post consumes it. A launch nobody armed runs A0,
  which only touches loopback, and stops; it cannot send A1b again.
- **Servers.** `apps/ios/probes/probe-server.mjs` listens on 127.0.0.1:4599, and the seats.aero mock
  (`scripts/mock-seatsaero.ts --demo`) on 127.0.0.1:4597. The script refuses to start if either port is held, and
  stops both by the PIDs it started. The Simulator is addressed by UDID, because two other simulators were booted.
- **Reporting.** The app posts each result through the WebView's own fetch to `/log`, the one route with CORS headers.
  Every result in both runs arrived that way (`"posted_via":"webview-like"`).

### 1.2 A0 — the probe server is reachable without an ATS exception

| Production adapter, GET | `http://127.0.0.1:4599/log` | `http://localhost:4599/log` |
|---|---|---|
| Run 2 | 200, 1,381 bytes, 87 ms | 200, 1,816 bytes, 10 ms |
| Run 1 | 200, 48 ms | 200, 58 ms |

`App/Info.plist` has no `NSAppTransportSecurity` key, and neither run needed one. So `Info-Debug.plist`, the Debug
`INFOPLIST_FILE` change and `ios-config.test.ts` were not added, and `project.pbxproj` is untouched. This was an open
question: Phase 0's spike carried `NSAllowsLocalNetworking` (`spikes/phase0-native-http/ios/App/App/Info.plist:29-35`),
so its localhost success did not answer it. The WebView's plain-http posts to 127.0.0.1 were not blocked either.
Scope: the Simulator uses the Mac's network stack, and no probe reaches a Mac from a device.

```
{"seq":4,"at":"2026-09-11T05:22:58.174Z","t_ms":17116,"event":"request","method":"GET","path":"/log?probe=A0&host=ip","stack":"native-like","user-agent":"App/1 CFNetwork/3860.600.12 Darwin/25.3.0","origin":null,"sec_fetch":{},"content-type":null,"anthropic-version":null,"access-control-request-method":null,"x_api_key_length":null}
{"seq":5,"at":"2026-09-11T05:22:58.185Z","t_ms":17127,"event":"request","method":"GET","path":"/log?probe=A0&host=localhost","stack":"native-like","user-agent":"App/1 CFNetwork/3860.600.12 Darwin/25.3.0","origin":null,"sec_fetch":{},"content-type":null,"anthropic-version":null,"access-control-request-method":null,"x_api_key_length":null}
{"seq":6,"at":"2026-09-11T05:22:58.190Z","t_ms":17132,"event":"app","probe":"A0","pass":true,"values":{"ip":{"url":"http://127.0.0.1:4599/log","ok":true,"status":200,"bytes":1381,"ms":87},"localhost":{"url":"http://localhost:4599/log","ok":true,"status":200,"bytes":1816,"ms":10},"server_used_next":"http://127.0.0.1:4599"},"app_at":"2026-09-11T05:22:58.186Z","posted_via":"webview-like"}
```

### 1.3 T1 — the native idle timer resets on bytes

This is the measurement design §2.1 hangs on. `createNativeFetch({ timeoutMs: 5000 })` puts 5,000 ms into Capacitor's
single `timeoutInterval` for both requests.

| | Run 2 | Run 1 | PASS band |
|---|---|---|---|
| Drip: 10 chunks of 1,024 bytes, the first at once, then one each 2,000 ms | **server-completed at 18,004 ms** | 18,002 ms | 18,000 ± 1,000 |
| Bytes JS received | **10,240**, after 18,020 ms | 10,240, after 18,063 ms | 10,240 |
| Control: `/slow?ms=20000`, which sends nothing | **client-disconnected at 5,014 ms** | 5,012 ms | 5,000 ± 150 |
| JS error on the control | `The request timed out.` (`NSURLErrorDomain`), at 5,019 ms | 5,025 ms | |

A response that took 18 seconds finished under a 5-second timeout. One that stayed silent was cut at 5 seconds. So on
iOS the timeout is an idle interval that arriving bytes reset, as `NSURLRequest.h` describes, not a total budget.
`ANTHROPIC_IDLE_TIMEOUT_MS` (90 s) therefore fires only after 90 seconds with no byte. With pings and deltas flowing,
a long answer is not cut. Assumption AS2 holds on the Simulator.

```
{"seq":7,"at":"2026-09-11T05:22:58.193Z","t_ms":17135,"event":"request","method":"GET","path":"/drip?chunks=10&every=2000&bytes=1024&probe=T1","stack":"native-like","user-agent":"App/1 CFNetwork/3860.600.12 Darwin/25.3.0","origin":null,"sec_fetch":{},"content-type":null,"anthropic-version":null,"access-control-request-method":null,"x_api_key_length":null,"chunks":10,"every":2000,"bytes":1024}
{"seq":8,"at":"2026-09-11T05:22:58.193Z","t_ms":17135,"event":"drip-write","req":7,"chunk":1,"at_ms":0,"bytes_written":1024}
{"seq":9,"at":"2026-09-11T05:23:00.194Z","t_ms":19136,"event":"drip-write","req":7,"chunk":2,"at_ms":2001,"bytes_written":2048}
{"seq":17,"at":"2026-09-11T05:23:16.195Z","t_ms":35137,"event":"drip-write","req":7,"chunk":10,"at_ms":18002,"bytes_written":10240}
{"seq":18,"at":"2026-09-11T05:23:16.197Z","t_ms":35139,"event":"server-completed","req":7,"path":"/drip?chunks=10&every=2000&bytes=1024&probe=T1","completed_after_ms":18004,"chunks_written":10,"bytes_written":10240,"note":"the server sent the whole response"}
{"seq":19,"at":"2026-09-11T05:23:16.217Z","t_ms":35159,"event":"request","method":"GET","path":"/slow?ms=20000&probe=T1","stack":"native-like","user-agent":"App/1 CFNetwork/3860.600.12 Darwin/25.3.0","origin":null,"sec_fetch":{},"content-type":null,"anthropic-version":null,"access-control-request-method":null,"x_api_key_length":null,"held_ms":20000}
{"seq":20,"at":"2026-09-11T05:23:21.232Z","t_ms":40174,"event":"client-disconnected","req":19,"path":"/slow?ms=20000&probe=T1","disconnected_after_ms":5014,"note":"the client hung up before the response was sent"}
{"seq":21,"at":"2026-09-11T05:23:21.253Z","t_ms":40195,"event":"app","probe":"T1","pass":true,"values":{"timeout_ms":5000,"drip":{"ok":true,"status":200,"bytes":10240,"ms":18020},"control":{"ok":false,"ms":5019,"error":{"name":"Error","constructor":"hT","message":"The request timed out.","status":null,"request_id":null,"type":null,"code":"NSURLErrorDomain","host":null,"cause":null}}},"app_at":"2026-09-11T05:23:21.233Z","posted_via":"webview-like"}
```

### 1.4 T2 and T2b — the same request, two stacks

**T2.** The production client sent a Messages request to the probe server through the production adapter, with the
adapter's 90 s timeout. The request used the real `ASK_SYSTEM_PROMPT` and `ASK_TOOLS`, `max_tokens` 16,000, and the
question "Cheapest business class from SEA to Tokyo (東京) in October?", so the body contains non-ASCII text. A wrapper
hashed the exact string the SDK handed the adapter, with `crypto.subtle` (a secure context, `secure_context: true`).
The server replayed `tool_use_search`, one event per second with a ping each second.

| | What the app saw | What the server received |
|---|---|---|
| `stop_reason` | `tool_use` | |
| Tool input | `search_awards`, deep-equal to the fixture | |
| `usage.output_tokens` | 142 (fixture's final `message_delta`: 142) | |
| `origin` | | **null** |
| `sec-fetch-*` | | **none** |
| `user-agent` | | `Anthropic/JS 0.123.0` |
| `content-type` | | `application/json` |
| `anthropic-version` | | `2023-06-01` |
| `x-api-key` | 27 characters | length **27** |
| Body | 5,289 UTF-8 bytes, sha256 `9768dfc1…4a7e6dd` | 5,289 bytes, sha256 **`9768dfc1…4a7e6dd`** |
| Stream | resolved after 12,083 ms | completed at 12,001 ms: 13 events, 11 pings |

Run 1 sent the identical request, with the same hash, and took 12,176 ms in JS (server: 12,008 ms). The header names
that arrived with T2 were:

```
accept, accept-encoding, accept-language, anthropic-dangerous-direct-browser-access, anthropic-version, connection,
content-length, content-type, host, user-agent, x-api-key, x-stainless-arch, x-stainless-helper-method,
x-stainless-lang, x-stainless-os, x-stainless-package-version, x-stainless-retry-count, x-stainless-runtime,
x-stainless-runtime-version, x-stainless-timeout
```

The body the SDK built is the body that arrived, which is A5's on-device proof. The SDK's own user agent reached the
wire. A plain adapter GET carries URLSession's `App/1 CFNetwork/3860.600.12 Darwin/25.3.0` instead (A0, T1). The SSE
parse worked on a body CapacitorHttp handed over whole, so the §2.1 fallback's second trigger does not fire either.

**T2b.** The WebView's own `fetch` sent the same body to the same URL, plus `?probe=T2b`. What arrived was a CORS
preflight, never the POST:

```
{"seq":40,"at":"2026-09-11T05:23:33.379Z","t_ms":52321,"event":"request","method":"OPTIONS","path":"/sse/v1/messages?probe=T2b","stack":"webview-like","user-agent":"Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148","origin":"capacitor://localhost","sec_fetch":{"sec-fetch-site":"cross-site","sec-fetch-mode":"cors","sec-fetch-dest":"empty"},"content-type":null,"anthropic-version":null,"access-control-request-method":"POST","x_api_key_length":null,"preflight":true}
{"seq":42,"at":"2026-09-11T05:23:33.400Z","t_ms":52342,"event":"app","probe":"T2b","pass":null,"values":{"ms":9,"settled":"rejected","error":{"name":"TypeError","constructor":"TypeError","message":"Load failed","status":null,"request_id":null,"type":null,"code":null,"host":null,"cause":null},"body_is_t2_body":true},"app_at":"2026-09-11T05:23:33.390Z","posted_via":"webview-like"}
```

This is Phase 0's differential again, now for the Ask client. Twelve seconds apart in one log, the production client's
request carried neither Origin nor Sec-Fetch-*, and the WebView's carried both, plus a Safari user agent. The probe
server, like seats.aero, sends no CORS headers on that route, so the WebView never sent the POST and JS saw
`Load failed` (9 ms; run 1: 28 ms).

```
{"seq":23,"at":"2026-09-11T05:23:21.333Z","t_ms":40275,"event":"request","method":"POST","path":"/sse/v1/messages","label":"T2","item":"tool_use_search:every=1000:ping=1000","stack":"native-like","user-agent":"Anthropic/JS 0.123.0","origin":null,"sec_fetch":{},"content-type":"application/json","anthropic-version":"2023-06-01","access-control-request-method":null,"x_api_key_length":27,"body_length":5289,"body_sha256":"9768dfc1b1a8daa27f4a1a53d40533d3f35fcc4539611e7099444bcd14a7e6dd","body_json":true,"model":"claude-opus-5","stream":true,"max_tokens":16000,"messages_length":1,"message_sha256":["e3ad16a4ba9a704f642432ed6f0e1a0128c65747ea86786759b2395f9260832c"],"system_sha256":"ceedb54277a747f432df22b352d2f41b66db0e917538cf82d4c9a9463738323a","tools_sha256":"1811d0ebd35dfb295d00157b0f6d58aa54b975a1229c50e0849171c141778a92"}
{"seq":37,"at":"2026-09-11T05:23:33.335Z","t_ms":52277,"event":"server-completed","req":23,"label":"T2","script":"tool_use_search","completed_after_ms":12001,"events_written":13,"pings_written":11,"note":"the server sent the whole stream"}
{"seq":38,"at":"2026-09-11T05:23:33.370Z","t_ms":52312,"event":"app","probe":"T2","pass":true,"values":{"ms":12083,"stop_reason":"tool_use","tool_name":"search_awards","tool_input":{"origins":["SEA"],"destinations":["TYO"],"date_from":"2026-10-01","date_to":"2026-10-31","cabins":["J"],"programs":null,"direct_only":false,"max_miles":null},"tool_input_equals_fixture":true,"output_tokens":142,"fixture_output_tokens":142,"js_body_sha256":"9768dfc1b1a8daa27f4a1a53d40533d3f35fcc4539611e7099444bcd14a7e6dd","js_body_utf8_bytes":5289,"js_body_type":"string","secure_context":true},"app_at":"2026-09-11T05:23:33.355Z","posted_via":"webview-like"}
```

### 1.5 T3 — an error event partway through a 200 stream

The server replayed `overloaded_mid`: `message_start`, a text block start, one text delta, then `event: error` with
`overloaded_error`, and completed at 750 ms. `finalMessage()` rejected after 758 ms (run 1: 798 ms) with an `APIError`
whose `type` is `overloaded_error`, `status` null, and `requestID` `req_probe_0044`, read from the stream response's
own header. `describeAskError` returned `overloaded_mid_answer`, retryable, with the copy "Anthropic became overloaded
partway through the answer. What Claude had already generated may still be billed."

```
{"seq":49,"at":"2026-09-11T05:23:34.160Z","t_ms":53102,"event":"server-completed","req":44,"label":"T3","script":"overloaded_mid","completed_after_ms":750,"events_written":4,"pings_written":0,"note":"the server sent the whole stream"}
{"seq":50,"at":"2026-09-11T05:23:34.173Z","t_ms":53116,"event":"app","probe":"T3","pass":true,"values":{"ms":758,"error":{"name":"Error","constructor":"e","message":"{\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}","status":null,"request_id":"req_probe_0044","type":"overloaded_error","code":null,"host":null,"cause":null},"code":"overloaded_mid_answer","retryable":true,"message":"Anthropic became overloaded partway through the answer. What Claude had already generated may still be billed.","request_id":"req_probe_0044"},"app_at":"2026-09-11T05:23:34.164Z","posted_via":"webview-like"}
```

### 1.6 T4 — Stop stops the waiting, not the request

| | Run 2 | Run 1 |
|---|---|---|
| Abort fired at, with reason `"stop"` | 800 ms | 801 ms |
| JS promise rejected | **1 ms after the abort**: "Request was aborted.", classified `stopped` | 1 ms |
| Server | **wrote all 8 events and completed at 5,999 ms**; no disconnect | 6,001 ms |

This is Phase 0 §3 again, now for a streamed Messages request through the SDK. Only `message_start` had been written
when the app stopped listening. The native request still ran to its last event with nobody reading it. The Stop copy
already says so: "The request already sent to Anthropic still finishes and may be billed." T4 confirms that copy; the
hopeful outcome, a cancelled request, did not happen.

```
{"seq":53,"at":"2026-09-11T05:23:34.182Z","t_ms":53124,"event":"sse-write","req":52,"label":"T4","index":1,"type":"message_start","at_ms":0}
{"seq":54,"at":"2026-09-11T05:23:35.039Z","t_ms":53981,"event":"sse-write","req":52,"label":"T4","index":2,"type":"content_block_start","at_ms":858}
{"seq":60,"at":"2026-09-11T05:23:40.181Z","t_ms":59123,"event":"sse-write","req":52,"label":"T4","index":8,"type":"message_stop","at_ms":5999}
{"seq":61,"at":"2026-09-11T05:23:40.181Z","t_ms":59123,"event":"server-completed","req":52,"label":"T4","script":"text","completed_after_ms":5999,"events_written":8,"pings_written":0,"note":"the server sent the whole stream"}
{"seq":62,"at":"2026-09-11T05:23:40.801Z","t_ms":59743,"event":"app","probe":"T4","pass":true,"values":{"abort_at_ms":800,"settled":"rejected","settled_after_abort_ms":1,"error":{"name":"Error","constructor":"vm","message":"Request was aborted.","status":null,"request_id":null,"type":null,"code":null,"host":null,"cause":null},"code":"stopped"},"app_at":"2026-09-11T05:23:40.780Z","posted_via":"webview-like"}
```

### 1.7 A1b — the real host, at zero cost: FAIL on `requestID`

The production client, with no `baseURL`, sent `send()` with the one-word message "Hello" to
`https://api.anthropic.com/v1/messages` through the production adapter, using the probe key, which Anthropic rejects
before any model runs.

| | Run 2 | Run 1 |
|---|---|---|
| Outcome | rejected after 1,890 ms | rejected after 2,891 ms |
| `status` | 401 | 401 |
| Class | same prototype as the SDK's error for the probe server's 401 (`AuthenticationError`), not its 529 | same |
| Body, as the SDK saw it | `{"type":"error","request_id":null,"error":{"type":"authentication_error","message":"API key is invalid."}}` | the same content, keys in another order: iOS parses a JSON response natively and `http.ts` serializes it again |
| **`requestID`** | **null** | **null** |
| `describeAskError` | `anthropic_key_rejected` | same |

**The criterion was a 401 with a non-null `requestID`, and it failed in both runs.** Run 2 recorded what the adapter
handed back. The real 401 came with eight headers: `cf-cache-status: DYNAMIC`, `cf-ray: a3943dee2e09f64e-SJC`,
`content-length: 106`, `content-security-policy`, `content-type: application/json`, `date`, `server: cloudflare` and
`x-robots-tag`. None of them is `request-id`, and the body's own `request_id` is null as well. In the same run, through
the same adapter, the probe server's control 401 arrived with six headers including `request-id: req_probe_0064`. So
the adapter does pass that header on: this response had none to pass. The simplest reading is that Anthropic's edge
refused the key before a request ID was assigned. The probe cannot see behind Cloudflare to confirm that, and no second
request was made to Anthropic to find out.

What A1b does establish is the §10.4 point it exists for. A POST to api.anthropic.com over the native adapter came
back with a readable status, body and headers, while A2 shows the WebView's fetch to that host is refused. What it does
not establish is that a real Anthropic `request-id` is readable on the device. Two things remain untested: an
authenticated response, which K3 or any owner's-key probe records; and whether an invalid key shaped like a real one
(`sk-ant-api03-…`; this probe used `sk-ant-probe-invalid-000000`) is refused further inside Anthropic's stack, with an
ID. The lead left A1b a FAIL and gave the question to K3, rather than send more requests to Anthropic from the harness.

Consequences as built:
- For this failure, `describeAskError` returns `requestId: null`, and the shell then shows no request-ID line
  (`apps/ios/src/ask/labels.ts:331`).
- The rejection message is "API key is invalid.", not the "invalid x-api-key" the core error tests script. The 401 copy
  is fixed text, so no copy depends on the difference.

```
{"seq":70,"at":"2026-09-11T05:23:42.724Z",…,"event":"app","probe":"A1b","pass":false,"values":{"ms":1890,"error":{"name":"Error","constructor":"Cm","message":"401 {\"type\":\"error\",\"request_id\":null,\"error\":{\"type\":\"authentication_error\",\"message\":\"API key is invalid.\"}}","status":401,"request_id":null,"type":"authentication_error",…},…,"code":"anthropic_key_rejected","same_class_as_probe_401":true,"same_class_as_probe_529":false,"responses":[{"url":"https://api.anthropic.com/v1/messages","status":401,"header_names":["cf-cache-status","cf-ray","content-length","content-security-policy","content-type","date","server","x-robots-tag"],"header_values":{"cf-cache-status":"DYNAMIC","cf-ray":"a3943dee2e09f64e-SJC","content-length":"106","content-type":"application/json","server":"cloudflare"}}],"control_401_responses":[{"url":"http://127.0.0.1:4599/sse/v1/models/claude-opus-5","status":401,"header_names":["connection","content-type","date","keep-alive","request-id","transfer-encoding"],"header_values":{"content-type":"application/json","request-id":"req_probe_0064"}}],…}
```

### 1.8 A2 — the tripwire

| WebView `fetch(…)` | Run 2 | Run 1 |
|---|---|---|
| `https://api.anthropic.com/v1/models` | rejected, `NativeHttpRequiredError`, host `api.anthropic.com`, 1 ms | same, 1 ms |
| `https://seats.aero/partnerapi/routes?source=united` | rejected, `NativeHttpRequiredError`, host `seats.aero`, 0 ms | same, 0 ms |

The guard `main.tsx` installs throws before it calls the WebView's fetch (`src/native/webview-fetch-guard.ts`), and
both rejections came within a millisecond. That neither request left the app is read from that code, not observed at
either host. With the guard in place, a regression that pointed the SDK at the WebView's fetch would fail loudly
instead of reaching Anthropic with an Origin header.

```
{"seq":71,"at":"2026-09-11T05:23:42.731Z","t_ms":61673,"event":"app","probe":"A2","pass":true,"values":{"anthropic":{"url":"https://api.anthropic.com/v1/models","settled":"rejected","ms":1,"error":{"name":"NativeHttpRequiredError","constructor":"mk","message":"api.anthropic.com must be reached over native HTTP (src/native/http.ts), never the WebView's fetch.","status":null,"request_id":null,"type":null,"code":null,"host":"api.anthropic.com","cause":null}},"seats":{"url":"https://seats.aero/partnerapi/routes?source=united","settled":"rejected","ms":0,"error":{"name":"NativeHttpRequiredError","constructor":"mk","message":"seats.aero must be reached over native HTTP (src/native/http.ts), never the WebView's fetch.","status":null,"request_id":null,"type":null,"code":null,"host":"seats.aero","cause":null}}},"app_at":"2026-09-11T05:23:42.726Z","posted_via":"webview-like"}
```

### 1.9 T5 — leaving the app during a request

After the app posted `t5_ready`, it sent `GET /drip?chunks=60&every=1000` through the adapter with Anthropic's 90 s
idle timeout. The host waited in the server's log for that request. About 3 s after it arrived, the host ran
`xcrun simctl launch <udid> com.apple.Preferences`; about 48 s after, `xcrun simctl launch <udid> com.dowhiz.awardgrid`.

| ms after the server logged the request | Run 2 | Run 1 |
|---|---|---|
| Host opens Settings (mark written just before the command) | 3,142 | 3,160 |
| JS sees `visibilitychange` → `hidden` (JS clock, from the call) | 4,918 | 6,953 |
| Host returns to awardgrid (mark) | 48,087 | 48,223 |
| JS sees `visibilitychange` → `visible` | 48,880 | 49,065 |
| Server: 60th chunk written, `server-completed` | 59,001; 61,440 bytes, no gap, no disconnect | 59,002 |
| **JS outcome** | **exactly one: resolved, 200, 61,440 bytes, at 59,028 ms, while visible** | one: resolved, 61,440 bytes, 59,023 ms |
| App process | the same PID at launch and at return (12775) | the same (10407) |

**PASS: the promise settled exactly once, with the whole body, after the return.** What T5 does not show is that the
request kept being read while awardgrid was away. The server wrote every chunk on time, but 61 KB fits in socket
buffers whether or not anyone reads it. The app was not terminated. On the Simulator, leaving for 44 seconds in the
middle of a request made no visible difference. A device may suspend an app's networking differently (AS13), and E7
and K4 measure that. Design §2.5 claims nothing either way.

```
{"seq":75,"at":"2026-09-11T05:23:42.753Z","t_ms":61695,"event":"request","method":"GET","path":"/drip?chunks=60&every=1000&bytes=1024&probe=T5","stack":"native-like","user-agent":"App/1 CFNetwork/3860.600.12 Darwin/25.3.0","origin":null,"sec_fetch":{},"content-type":null,"anthropic-version":null,"access-control-request-method":null,"x_api_key_length":null,"chunks":60,"every":1000,"bytes":1024}
{"seq":79,"at":"2026-09-11T05:23:45.757Z","t_ms":64699,"event":"drip-write","req":75,"chunk":4,"at_ms":3004,"bytes_written":4096}
{"seq":80,"at":"2026-09-11T05:23:45.895Z","t_ms":64837,"event":"host-mark","label":"T5:host-opens-Settings"}
{"seq":81,"at":"2026-09-11T05:23:46.481Z","t_ms":65423,"event":"host-mark","label":"T5:Settings-launch-returned"}
{"seq":82,"at":"2026-09-11T05:23:46.754Z","t_ms":65696,"event":"drip-write","req":75,"chunk":5,"at_ms":4001,"bytes_written":5120}
{"seq":126,"at":"2026-09-11T05:24:30.754Z","t_ms":109696,"event":"drip-write","req":75,"chunk":49,"at_ms":48001,"bytes_written":50176}
{"seq":127,"at":"2026-09-11T05:24:30.840Z","t_ms":109782,"event":"host-mark","label":"T5:host-returns-to-awardgrid"}
{"seq":128,"at":"2026-09-11T05:24:31.443Z","t_ms":110385,"event":"host-mark","label":"T5:awardgrid-launch-returned"}
{"seq":129,"at":"2026-09-11T05:24:31.753Z","t_ms":110695,"event":"drip-write","req":75,"chunk":50,"at_ms":49000,"bytes_written":51200}
{"seq":139,"at":"2026-09-11T05:24:41.755Z","t_ms":120697,"event":"drip-write","req":75,"chunk":60,"at_ms":59001,"bytes_written":61440}
{"seq":140,"at":"2026-09-11T05:24:41.755Z","t_ms":120697,"event":"server-completed","req":75,"path":"/drip?chunks=60&every=1000&bytes=1024&probe=T5","completed_after_ms":59001,"chunks_written":60,"bytes_written":61440,"note":"the server sent the whole response"}
{"seq":141,"at":"2026-09-11T05:24:46.924Z","t_ms":125866,"event":"app","probe":"T5","pass":true,"values":{"timeout_ms":90000,"waited":"settled","settle_count":1,"outcomes":[{"outcome":"resolved","status":200,"bytes":61440,"at_ms":59028,"visibility":"visible"}],"visibility":[{"state":"hidden","at_ms":4918},{"state":"visible","at_ms":48880}]},"app_at":"2026-09-11T05:24:46.785Z","posted_via":"webview-like"}
```

The app posted T5 about 5 s after its request settled, because the probe keeps watching for a second outcome before it
reports. The launch commands printed `com.dowhiz.awardgrid: 12775` at the first launch and again at the return.

### 1.10 X1 — a harness check for step 7

X1 is not a design probe. The probe build's `withSeatsMock` sends `https://seats.aero/partnerapi/routes?source=united`
to the mock and adds `x-ratelimit-remaining: 812`. The app saw status 200, `812` and 1,171 bytes in 4 ms (run 1:
33 ms), and the mock logged `GET /partnerapi/routes?source=united 200 1ms`. So the rewrite E1 relies on works on the
device. Bootstrap wraps whatever it is handed as `fetchImpl` in the rate-limit observer (`src/app/bootstrap.ts:139`,
`seatsTransport`), so the rewrite sits below it; `probe-transport.test.ts` pins that the observer reads the added
header when the two are stacked that way.

```
{"seq":72,"at":"2026-09-11T05:23:42.741Z","t_ms":61683,"event":"app","probe":"X1","pass":true,"values":{"ms":4,"status":200,"x_ratelimit_remaining":"812","bytes":1171},"app_at":"2026-09-11T05:23:42.737Z","posted_via":"webview-like"}
```

### 1.11 R1 — nothing from the probe build ships

After run 2, the script stopped both servers, rebuilt the normal app (`npm run build && npx cap sync ios`), reinstalled
it on the Simulator, and ran `grep -c "127.0.0.1:45\|localhost:45\|probe-server\|sk-ant-"` over the bundle:

| `apps/ios/dist/assets/` | Bytes | Count |
|---|---|---|
| `base-CIYbgsL2.js` | 2,542 | 0 |
| `index-Czz3kBAM.js` | 719,407 | 0 |
| `native-Bp8350NI.js` | 770 | 0 |
| `node.browser-5AoK4WNd.js` | 1,830 | 0 |
| `node.browser-wr9qDllY.js` | 381 | 0 |
| `web-BK6vcar_.js` | 802 | 0 |
| `web-DcG45cNs.js` | 8,479 | 0 |

The probe build had two more chunks, `ProbesScreen-*.js` and `probe-transport-*.js`, and neither exists here. The main
chunk is 719,407 bytes against design §10.3's 667,441-byte baseline, which is 51,966 bytes of growth: under the 60 KB
at which growth is investigated. The probe wiring contributes none of it, because the `.js` files hash identically
when `App.tsx` and `main.tsx` are HEAD's (§1.1).

### 1.12 What §1 does not show

- **Anything about a device.** Every probe ran on the Simulator, whose networking is the Mac's.
- **A readable `request-id` from Anthropic** (A1b above).
- **Anything that needs a working Anthropic key:** real streaming latency, whether Opus 5 accepts every parameter,
  billing after Stop (AS7). See design §10.5-§10.6.
- **What iOS does to a request when an app is really suspended** (T5 above).
- A3-A5 and E1-E8, which later steps run.

### Reproducing §1

```bash
apps/ios/probes/run-probes.sh <scratch-dir outside the repository>
node apps/ios/probes/probe-log.mjs summary <scratch-dir>/probe-log.jsonl
```

The script needs Xcode, CocoaPods, Node at `$HOME/.local/node-arm64/bin`, the Simulator named by `$SIM_UDID` (default
`A480530B-3036-4B12-80D4-F37A6130D898`), and free ports 4599 and 4597. It writes the probe log, the build logs,
Simulator screenshots, `summary.txt` and `r1.txt` under the scratch directory. `probe-log.mjs summary` re-derives
every verdict above from the log alone.
