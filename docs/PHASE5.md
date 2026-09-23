# Phase 5 — Ask on the Messages API, measured

This file holds Phase 5's measurements, the way `docs/PHASE0.md` holds Phase 0's. §1 is the transport on the
Simulator with no keys (step 3). §2 is Ask end to end on the Simulator against the probe server and the seats.aero
mock, with fake keys (step 7). The owner's-key probes follow once that spend is approved (design §10.3, §10.5).

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
- A3-A5 and E1-E8, which §2 runs.

### Reproducing §1

```bash
apps/ios/probes/run-probes.sh <scratch-dir outside the repository>
node apps/ios/probes/probe-log.mjs summary <scratch-dir>/probe-log.jsonl
```

The script needs Xcode, CocoaPods, Node at `$HOME/.local/node-arm64/bin`, the Simulator named by `$SIM_UDID` (default
`A480530B-3036-4B12-80D4-F37A6130D898`), and free ports 4599 and 4597. It writes the probe log, the build logs,
Simulator screenshots, `summary.txt` and `r1.txt` under the scratch directory. `probe-log.mjs summary` re-derives
every verdict above from the log alone.

---

## 2. Ask end to end, on the Simulator (step 7 part B)

**Status: ten of twelve verdicts pass. E1 and E2 fail their own criteria.** The failures come from how the app
checks which routes seats.aero monitors, not from the transport or the Ask screen. On a fresh launch, Ask's one
`search_awards` call for SEA to Tokyo spent a Get Routes call as well as the search. So the step read "2 calls." where
E1 expects "1 call.", and the quota line read 189 of 950 where E1 expects 188 (§2.3). Under `demo-key-partial`, the
tool result listed no unmonitored pair and no pair that was not read in full, and a grid search failed outright instead
of marking cells "not monitored" and "not checked" (§2.4). Stop, a relaunch after Stop, Try again after a 529, the spend
limit, the rate limit, follow-ups, leaving the app mid-request and a killed process all behaved as specified. So did the
no-key states, the layout on both phones, and R1. §2.12 re-runs every scenario after fixes to three untrue lines (E2's
tool-result warning, E6's missing attribution, E8's meta line): every verdict is unchanged, E1 and E2 still fail, and
apart from timings the only differences are those three lines and the rewritten warning that later requests resend.

Measured 2026-09-15 (UTC) on the iPhone 17 Pro simulator from §1 (`A480530B-3036-4B12-80D4-F37A6130D898`) and on an
iPhone SE (3rd generation) simulator this step created, `awardgrid iPhone SE (3rd generation)`
(`A0409F2C-0404-498D-8FED-EEEE016FEB55`). Both use the iOS 26.5 runtime, with Xcode 26.6, Capacitor 8.5.1 and
`@anthropic-ai/sdk` 0.123.0. The harness is `apps/ios/probes/run-probes.sh --e2e`. It ran end to end three times:

- **Run 1** (armed 03:43:27Z) created the SE simulator. It failed R1's byte-identity check, because the probe wiring
  left an empty effect in the normal bundle (§2.10). `App.tsx` was changed.
- **Run 2** (03:49:29Z) passed R1.
- **Run 3** (03:52:41Z) added the two A5 states the Part A reviewers asked for (§2.2).

Every number below is from run 3, with run 2 beside it where it differs. Every verdict is re-derived from the logs by
`node apps/ios/probes/probe-log.mjs summary-e2e`, and re-deriving all three runs with the final summary gives the same
verdicts. Run 1's own summary had failed A4, because its first version also held the nav links to 44 pt (§2.2).

The raw logs are not committed. Excerpts are verbatim JSON lines from run 3's probe log. As in §1, a long line is cut with
`…`, and `header_names` and `message_summaries` are dropped. Screenshots are in `docs/screenshots/phase5/`, byte for byte
as `xcrun simctl io <udid> screenshot` wrote them (1206 × 2622 on the 17 Pro, 750 × 1334 on the SE). Three pairs are
byte-identical, because what was on screen was the same:

- `e1-answered` and `e2-ask`: the same scripted replay, scrolled to the same place. Their `dom:` facts are identical
  too. What sets E2 apart is the tool result in the request, which the scripted answer does not use.
- `e3-stopped` and `e3-after-relaunch`: both scrolled to the end. The stopped page is 56 pt taller, because it still
  has the "Include my last search" row above the fold. Its status region reads "Stopped" and the relaunched one is
  empty, but that region is visually hidden.
- `a4-se-ask-answered-entry` and `a4-se-footer`: the SE page was already scrolled to the end (305 of 972).

| | Scenario | Verdict | Run 3 | Run 2 |
|---|---|---|---|---|
| **A3** | No Anthropic key: Ask refuses, and a grid search works | **PASS** | notice shown, composer and Ask disabled, 0 Anthropic requests; grid of 30 dates × 3 pairs, 44 cells priced, 1 call | same |
| **A4** | Layout on the 17 Pro (402 pt) and the SE (375 pt) | **PASS** on both | nav in one row under the brand, scrollWidth = clientWidth in all 7 states, footer on screen, 12 named controls ≥ 44 pt. Not judged, and under 44 pt: the nav link "Ask" (26.4 wide), 4 older Settings controls (32 to 41.8 tall), the Search screen's Run, Watch this search and example chips (27 to 41 tall) | same |
| **A5** | Names and roles, status region, per state (automated only) | **PASS** | 32 states, 0 unnamed controls, one visually hidden status region on every Ask state | 30 states |
| **E1** | A question end to end | **FAIL** | step "…, business. **2 calls.**"; the mock logged search + `routes?source=eurobonus`; quota line **189 of 950** | same |
| **E2** | Empty-cell reasons with `demo-key-partial` | **FAIL** | tool result `unmonitored: []`, `not_read_in_full: []`; grid search failed: "seats.aero unavailable (HTTP 500): {}" | same |
| **E3** | Stop during the second request, then a relaunch | **PASS** | stopped 2,003 ms in; server completed at 7,004 ms; stopped entry kept; next request = same 2 history hashes + new turn | 7,003 ms |
| **E4** | 529, then Try again | **PASS** | Overloaded copy + Try again; resend body sha256 `b8ec4e9c…` equals the first; answered | same hash |
| **E5** | Spend limit; rate limit with `retry-after: 7` | **PASS** | spend copy, 1 request, no Try again; rate-limit copy with the 7-second sentence, Try again | same |
| **E6** | A follow-up is append-only | **PASS** | follow-up's 5 messages start with the 3 of question 1's last request + its answer; system and tools hashes equal | same |
| **E7** | Settings at 3 s into a 40 s request, back at 30 s | **PASS** | one terminal state; no request logged while away; second request 40,178 ms after the first | 40,044 ms |
| **E8** | Process killed during a slow request | **PASS** | entry reads UNFINISHED with Ask again; server saw the client hang up 3,212 ms in | 3,393 ms |
| **R1** | The normal bundle | **PASS** | grep 0 in all 7 `.js`; no probe or e2e chunk; all 7 `.js` hash identical to a build made at HEAD `1c6bd22` | same (run 1: **FAIL** on the hash check) |

### 2.1 How it was run

- **A second probe mode, not a second harness.** `VITE_AG_PROBES=e2e` makes `main.tsx` open `#/ask` and makes
  `App.tsx` bootstrap with `e2eBootstrapOptions()` (`src/probes/probe-transport.ts`). Once the services exist, it
  lazy-loads `src/probes/e2e-driver.ts`. In any other build every branch is the constant false, and R1 checks that
  (§2.10). `run-probes.sh` keeps its step 3 behaviour, which was not re-run because it includes A1b's request to
  api.anthropic.com. With `--e2e` it sources `e2e-phases.sh` for the middle steps instead, and shares the servers, the
  builds, the restore and R1.
- **The app as shipped, with its hosts rewritten below the SDK.** The Ask service builds its client with no base URL,
  so `withAnthropicProbe` wraps the native adapter handed to bootstrap as `anthropicFetch`. It sends
  `https://api.anthropic.com/` to `http://127.0.0.1:4599/sse/` and refuses any other URL naming anthropic.com.
  `withSeatsMock` (§1.10) sends seats.aero to the demo mock on 4597 and adds `x-ratelimit-remaining: 812`. All 21
  Anthropic requests in run 3 (20 in run 2) were `POST /sse/v1/messages`, `native-like`, with
  `user-agent: Anthropic/JS 0.123.0`, no Origin, and an `x-api-key` of 27 characters. None was unscripted.
- **Fake keys, in memory.** The e2e build's two key stores are `MemoryKeyStore`s, empty at every launch. It never reads
  or writes the Simulator's Keychain. The Anthropic key is §1's `sk-ant-probe-invalid-000000`, and the seats.aero keys
  are the mock's `demo-key-normal` and `demo-key-partial`.
- **No taps.** The driver calls `services.ask` the way the screens do: `ask`, `stop`, `retry` and `newConversation`.
  A grid search is the Search screen's own code, so the driver types into the query box through React's value setter
  and calls `.click()` on Run. Everything the verdicts read from the screens is read back from the DOM.
- **One phase per launch.** The host POSTs `/arm?phase=…` and launches the app, and the app runs that phase. The
  phases are `a3`; `e1` (E1, E2 and E3 up to Stop); `e3_relaunch` (E3, then E4, E5, E6 and A5's 413); `e7`; `e8`;
  `e8_relaunch`; `layout:17pro`; and `layout:se`. Each launch after a relaunch is a new process: E3 went from PID 19745
  to 20205, and E8 from 22409 to 22441. The last phase before each fresh start (`a3`, `e3_relaunch`, `e7`,
  `e8_relaunch`, both layouts) ends by clearing the conversation, the cache, the seeded watches and today's count.
- **Screenshots at the right moment.** For a screenshot the app posts `host:shot:<name>`, and `apps/ios/probes/e2e-host.mjs`
  runs `xcrun simctl io <udid> screenshot`. The app waits on `GET /host-done` before it goes on. Each screenshot's page
  facts are posted as `dom:<name>`. `host:mocklines:<name>` records the mock's log length, so each scenario's
  seats.aero requests can be cut out of the mock's own log. E7's leaving and returning, and the terminations in E3 and
  E8, are timed from the server's log by the script.
- **Waits.** Every wait in the scripts polls a log, a port or an endpoint with a timeout. `e2e-host.mjs` reads the log
  every 200 ms until the script stops it, and the app's wait on `/host-done` polls with a timeout. The driver has
  three fixed waits. Before each screenshot it waits two animation frames, then 400 ms for the WebView to paint. The
  other two are part of what they measure: Stop comes 2 s into E3's second request, and after E7's answer the driver
  listens 5 s more for a second terminal state.
- **Servers.** They are the same as §1's, refused if a port is held and stopped by PID. The probe server gained
  `/arm?phase=`, `/host-done`, a `label=` per queued item, and a short summary per message of each Messages request:
  roles, block types, text heads, and a tool_result's `spent`, `unmonitored`, `not_read_in_full` and `warnings`.

### 2.2 A3, A4 and A5 — the screens without and with keys

**A3 PASS.** The Anthropic store was empty and the seats.aero store held `demo-key-normal`. Ask opened with the
NO_ANTHROPIC_KEY notice as its one alert. The question box, Ask and both suggestions were disabled, and no request
reached the probe server's Anthropic route during the phase. A grid search for "HKG, SHA to SEA, next 30 days, business
and first" drew a table: 30 dates by HKG-SEA, PVG-SEA and SHA-SEA, 44 of 90 cells priced, "1 seats.aero call · checked
just now", "seats.aero calls today: 188 of 950". The mock logged one request, `GET /partnerapi/search?origin_airport=HKG,PVG,SHA&destination_airport=SEA&…&cabins=business,first 200`.
Screenshots: `a3-ask-no-anthropic-key.png`, `a3-search-grid.png`.

```
{"seq":8,"at":"2026-09-15T03:52:48.171Z",…,"event":"app","probe":"A3-ask","pass":null,"values":{"anthropic_key_on_file":false,"seats_key_on_file":true,"alerts":[{"className":"ask-callout","text":"Ask needs your own Anthropic API key. Add one in Settings. Search and watches work without it. Open Settings"}],"composer_disabled":true,"ask_button":{"text":"Ask","disabled":true},"suggestions_disabled":[true,true],"ask_state":{"entries":0,"notice":null,"running":false}},…}
{"seq":16,"at":"2026-09-15T03:52:50.306Z",…,"event":"app","probe":"A3-search","pass":null,"values":{"query":"HKG, SHA to SEA, next 30 days, business and first","ms":543,"table":true,"columns":["Date","HKG-SEA","PVG-SEA","SHA-SEA"],…,"cells_total":90,"cells_with_miles":44,"not_monitored":0,"not_checked":0,"dash":46,…,"calls_line":["1 seats.aero call · checked just now"],"quota_line":"seats.aero calls today: 188 of 950","ask_about_search_link":true,"mock_lines":{"before":2,"after":3},"anthropic_key_on_file":false},…}
```

**A4 PASS on both phones.** Each phone's layout phase ran one grid search, which gives Ask its "Include my last search"
row. It then photographed seven states: Settings' Anthropic section; Ask idle; the nav with 12 seeded unseen watches
while a question ran; the running entry; Ask answered, at the top and at the entry; and the page scrolled to the
footer. The numbers are CSS px from `getBoundingClientRect`, which are points here (devicePixelRatio 3 and 2).

| | iPhone 17 Pro | iPhone SE (3rd gen.) |
|---|---|---|
| Viewport | 402 × 874 | 375 × 667 |
| Header while running | brand on row 1, nav on row 2 in **one row**: "Search", "Ask (working)", "Watches (12)", "Settings"; last link ends at x = 351.2 | the same row, ending at 351.2 |
| `scrollingElement.scrollWidth` / `clientWidth` | 402 / 402 in all 7 states; header 402 / 402 | 375 / 375 in all 7 states; header 375 / 375 |
| Elements past the right edge (the grid's own scroller excluded) | none | none |
| Footer, scrolled to the end | "Data: seats.aero · your own keys, on this device", y 778.3-840.3 of 874 | the same text, y 629.3-667.3 of 667 |
| Named controls measured | 12; smallest 44 tall. Anthropic key field 370 × 44, Save 69.4 × 44, Check key 108.8 × 44, Remove key 120.5 × 44, the checkbox row 370 × 44, suggestions 370 × 60 / 60 / 44, question box 370 × 87.3, Ask and Stop 96 × 44, New conversation 162.8 × 44 | 12; the same, at width 343; checkbox row 343 × 63 |
| Not judged: nav links (the named set is the Ask screen's buttons, link-buttons, fields and checkbox row, and the Anthropic section's controls) | 44 tall each; **"Ask" is 26.4 pt wide** (27.5 when Ask is the current page; Search 49.6, Watches 61.1, Settings 57.5) | the same |
| Not judged: controls on the same Settings screen outside the Anthropic section, which predate step 7 | **under 44 pt:** seats.aero Pro key field 370 × 41.8, Save seats.aero key 67.4 × 39, Remove key for seats.aero 100.5 × 32, Clear cached results 152.5 × 32 | the same, field width 343 |
| Not judged: the checkbox itself | 20 × 20, inside its label row, which is the measured target: the whole row is the `<label>` and toggles it | the same |
| Not judged: inline links | the pricing link, 17 pt tall. No answer in these runs carried a booking link | the same |

The same named controls in the E and A5 states, all on the 17 Pro, were at least 44 pt too: Try again 101.3 × 44, Ask
again 103.9 × 44, Open Settings 121.9 × 44, "Ask Claude about this search" 242.3 × 44. That last link is on the Search
screen, where the controls that predate step 7 were **under 44 pt and not judged**: Run 64.1 × 39, Watch this search
155.9 × 41, and the three example searches 27 tall (303.6, 214.7 and 192.1 wide), in `a3-search-grid`,
`e1-search-quota`, `e2-grid` and `e2-grid-normal-key` (Watch this search in the first and last only). The Part A spec
names no size for nav links, so they do not decide A4. Still, "Ask" gives a 26.4 × 44 pt target on both phones.

These unjudged controls were in run 3's log from the start: the `interactive` boxes at seq 17, 318 and 355. The first
version of §2 left them out, because `summary-e2e` reported only the named set, the nav links and the inline links.
After run 3 it was extended to list every other rendered control under 44 pt: `not_named_by_the_spec_under_44`, and
`other_states_not_named_under_44` for the 17 Pro's other states. Compared leaf by leaf with the summaries stored for
runs 2 and 3, the extended summary only adds lists. No value changes, and runs 1 to 3 keep their verdicts. The
Simulator was not run again.

One more thing the screenshots show and A4 does not judge: the header is not fixed, and nothing opaque covers the status
bar. On a page scrolled down, text passes under the clock and, on the 17 Pro, the Dynamic Island. In `e4-overloaded`
the nav runs into the clock and the island. In `a4-17pro-settings-anthropic` the seats.aero "On file" line meets the
clock. In `a3-search-grid` the island hides the grid's HKG-SEA and PVG-SEA column headers. The header's safe-area padding
(`.chrome-top`) dates from Phase 2. Screenshots:
`a4-{17pro,se}-{settings-anthropic,ask-idle,nav-working,ask-running-entry,ask-answered,ask-answered-entry,footer}.png`.

**A5 PASS, automated only.** At every screenshot the app posted each interactive element's role and accessible name,
taken from the DOM with an approximation of the accessible-name rules, together with the text of every `role=status`
and `role=alert` region and `aria-busy`. No VoiceOver pass was made, on a device or on the Simulator.
Across 32 states, no control lacked a name. Every Ask state had exactly one visually hidden status region. What it
held matched design §6.5's transitions-only rule:

- "Waiting for Claude" while a request was out.
- "Answer ready", "Stopped" or "Ask failed" when that ending happened on screen.
- Empty on a screen opened onto an ending that was already there: after the E3 and E8 relaunches, and in Settings.

`ask-entries` carried `aria-busy="true"` only while a question ran. The names per state, as recorded:

| State | Interactive elements (role: name) | Status region | Alerts |
|---|---|---|---|
| `a5-ask-no-keys` | link Search, link Ask, link Watches, link Settings, 2 suggestion buttons [disabled], textbox Question for Claude [disabled], button Ask [disabled], **link Open Settings, link Open Settings** | "" | both no-key notices |
| `a3-ask-no-anthropic-key` | the nav; 2 suggestions [disabled]; textbox [disabled]; button Ask [disabled]; link Open Settings | "" | NO_ANTHROPIC_KEY |
| `a4-*-ask-idle` | the nav; checkbox "Include my last search: HKG, PVG, SHA to SEA, 2026-09-15 to 2026-10-14, business and first"; 3 suggestions; textbox; button Ask [disabled, empty box] | "" | none |
| `a4-*-nav-working` | link Ask (working), link Watches (12); checkbox; textbox; button Stop; button New conversation [disabled] | "Waiting for Claude" | none |
| `e1-answered`, `e4-after-retry`, `e6-follow-up`, `e7-after-return` | the nav; textbox; button Ask [disabled]; button New conversation | "Answer ready" | none |
| `e3-stopped` | … button Ask again; button New conversation | "Stopped" | none |
| `e3-after-relaunch`, `e8-unfinished` | … button Ask again; button New conversation | "" | none |
| `e4-overloaded`, `e5-rate-limit` | … button Try again; button Ask again; button New conversation | "Ask failed" | the failure line with its request ID |
| `e5-spend` | … button Ask again; button New conversation (no Try again) | "Ask failed" | the spend line |
| `a5-too-large` (a scripted 413) | … button Ask again; **button New conversation; button New conversation** | "Ask failed" | "This conversation is too large to send. Start a new conversation. Anthropic request ID: req_probe_0253" |
| `a4-*-settings-anthropic` | textbox (password) seats.aero Pro key; button Save seats.aero key [disabled]; button Remove key for seats.aero; link "Anthropic's pricing page lists what these tokens cost."; textbox (password) Anthropic API key; button Save Anthropic key [disabled]; button Check key; button Remove key for Anthropic; button Clear cached results | "" | none |

Names that repeat within one state, as recorded:

- "Ask" in every idle or ended Ask state: the nav link and the Ask button, which have different roles.
- "Open Settings" twice with no keys: one link per notice.
- "New conversation" twice after the 413: the failure's own button and the one under the conversation.

`probe-log.mjs summary-e2e` lists every state in full.

### 2.3 E1 — a question end to end: FAIL

Setup: a fresh launch, today's count at 0 on disk, the seats.aero key `demo-key-normal`, and scripts `tool_use_search`
then `text`. The question was "Cheapest business class from SEA to Tokyo (東京) in October?", with no search included.

| Criterion | Measured | |
|---|---|---|
| Step "Searched seats.aero: … 1 call." | **"Searched seats.aero: SEA to NRT, HND, 2026-10-01 to 2026-10-31, business. 2 calls."** (state and DOM agree) | **FAIL** |
| The answer | "I'll search seats.aero for business class from Seattle to Tokyo in October." and "The cheapest business seats in this search are on Alaska: 75,000 miles …", status answered, committed | pass |
| "Data: seats.aero" under it | present, after the last answer in document order; meta "Claude Opus 5 · 2 requests · 8,360 input tokens (3,956 read from cache) · 238 output tokens · seats.aero calls: 2" | pass |
| The mock's log shows exactly the planned requests | planFind planned one `search` (estimated 1 call). The mock logged that search **and `GET /partnerapi/routes?source=eurobonus 200`** | **FAIL** |
| Search screen afterwards: "seats.aero calls today: 188 of 950" | before the question "0 of 950"; afterwards **"189 of 950"** | **FAIL** |
| Transport | both requests `native-like`, both `server-completed` (48 ms, 10 ms) | pass |

The driver calls planFind after the question returns, with the route catalog as it is then, eurobonus loaded. That
catalog changes a plan only when the query names programs (`bulkRequestsFor` in
`packages/core/src/lib/seatsaero/find.ts`), and this query names none. So the plan is the same as one made before the
search, and a plan never includes the Get Routes calls `runFind` makes after it.

What happened, in order:

1. The demo data has flights into Seattle only, so SEA to NRT and SEA to HND came back with no rows.
2. For zero-row pairs, `runFind` loads route lists. Ask caps that at one Get Routes call per search
   (`SEARCH_ROUTES_CAP`), and the catalog is in memory and was empty at launch, so one of the 26 lists was fetched.
3. That made the step's two calls.
4. The injected header reached the quota store: the count went from 0 to at least 188.
5. The Get Routes reservation was made after the first response had set the floor at 188, and the harness sends 812
   on every response, so the count settled at 189. Two real responses would also leave 189 (811 remaining).

The singular label itself did render on the Simulator. In E3, with every route list already loaded by E2's comparison
search, the same search read "Searched seats.aero: SEA to NRT, HND, 2026-10-01 to 2026-10-31, business. 1 call."

```
{"seq":23,…,"event":"app","probe":"E1-before","pass":null,"values":{"quota":{"used":0,"remaining":950,"softLimit":950,"resetAt":"2026-09-16T00:00:00.000Z"},"quota_line":"seats.aero calls today: 0 of 950"},…}
{"seq":27,"at":"2026-09-15T03:52:54.569Z",…,"event":"request","method":"POST","path":"/sse/v1/messages","label":"E1-r1","item":"tool_use_search:label=E1-r1","stack":"native-like","user-agent":"Anthropic/JS 0.123.0","origin":null,"sec_fetch":{},…,"x_api_key_length":27,"body_length":5566,"body_sha256":"b8ec4e9c8e306911940ef15eab51cfaee18696bcb88c3b8b1576742060dd0b19",…,"messages_length":1,…,"system_sha256":"ceedb54277a747f432df22b352d2f41b66db0e917538cf82d4c9a9463738323a","tools_sha256":"1811d0ebd35dfb295d00157b0f6d58aa54b975a1229c50e0849171c141778a92"}
{"seq":41,"at":"2026-09-15T03:52:54.617Z",…,"event":"server-completed","req":27,"label":"E1-r1","script":"tool_use_search","completed_after_ms":48,"events_written":13,"pings_written":0,…}
{"seq":58,…,"event":"app","probe":"E1-search-quota","pass":null,"values":{"quota":{"used":189,"remaining":761,"softLimit":950,"resetAt":"2026-09-16T00:00:00.000Z"},"quota_line":"seats.aero calls today: 189 of 950"},…}
```

The mock's log between the app's two `mocklines` marks:

```
GET /partnerapi/search?origin_airport=SEA&destination_airport=NRT,HND&start_date=2026-10-01&end_date=2026-10-31&take=1000&order_by=lowest_mileage&cabins=business 200 0ms
GET /partnerapi/routes?source=eurobonus 200 0ms
```

The system and tools hashes equal §1.4's T2 request. Screenshots: `e1-answered.png`, `e1-search-quota.png`.

### 2.4 E2 — empty-cell reasons with `demo-key-partial`: FAIL

In the same launch as E1, the conversation and cache were cleared, the key became `demo-key-partial`, and the same
question was asked. The second request carried this tool result:

```
{"role":"user","blocks":[{"type":"tool_result","is_error":false,"chars":785,"fields":{"spent":{"seats_aero_calls":2,"from_cache":false,"question_calls_left":10,"today_calls_left":759},"rows_total":0,"unmonitored":[],"not_read_in_full":[],"warnings":["Couldn't check whether seats.aero monitors 2 empty pair(s): 24 program route list(s) skipped to stay within today's quota."]},…}]}
```

- **Tool result: neither list names a pair.** The one Get Routes call went to the next unloaded list,
  `routes?source=virginatlantic`, and the other 24 were skipped. So `runFind` makes no "not monitored" claim, and
  nothing marks a pair "not read in full", because the pull was not cut short. The warning Claude reads blames today's
  quota. With 759 calls left, what skipped them was Ask's one-call cap.
- **Grid: no cells at all.** A grid search for "HKG, ICN to SEA, next 30 days, business" loaded route lists in
  `SEATS_SOURCES` order. `routes?source=aeroplan` answered 500 (the partial scenario), and the whole search failed with
  the alert "seats.aero unavailable (HTTP 500): {}": 8 mock requests, no table, 0 "not monitored", 0 "not checked".
  The iOS catalog does not survive a failed list the way the web's `ResilientRoutesCatalog` does.
- **The same grid search with `demo-key-normal`** (a comparison, not a criterion) loaded every remaining list, 19
  calls, and drew 30 dates × 2 pairs. ICN-SEA read **"not monitored"** in all 30 cells, and 12 HKG-SEA cells read "—".
  **"not checked"** appeared nowhere: nothing in these runs cuts a pull short.

Screenshots: `e2-ask.png`, `e2-grid.png`, `e2-grid-normal-key.png`.

### 2.5 E3 — Stop during the second request, then a relaunch: PASS

Question 1 ran `text` and was answered and committed. Question 2, "What are the taxes and fees on the cheapest option?",
ran `tool_use_search`, then `text` at one event per second. The driver called `services.ask.stop()` 2,003 ms after
request 2 started (03:53:04.616Z to 03:53:06.619Z). The entry ended `stopped`, `stoppedDuring: "request"` and
`committed: false`, showing "Stopped. Nothing more will be sent for this question. The request already sent to
Anthropic still finishes and may be billed." The server wrote all 8 events of that request and logged
`server-completed` at 7,004 ms; only then did the host terminate the app.

After the relaunch, the restored conversation had two entries: answered and committed, then stopped and not committed,
with the same Stop sentence and Ask again. Question 3's first request carried:

| | messages | hashes |
|---|---|---|
| Question 2, request 1 (seq 125) | 3 | `a8164237…` (user 1), `dd4e44cb…` (assistant 1), `a9c4bd04…` (user 2) |
| Question 3, request 1 (seq 165) | 3 | `a8164237…`, `dd4e44cb…`, `d8a018fe…` (user 3) |

The committed history was byte-identical, and the stopped question's turns were not resent. System `ceedb542…` and
tools `1811d0eb…` were equal, and question 3 was answered.

```
{"seq":140,"at":"2026-09-15T03:53:04.621Z",…,"event":"request","method":"POST","path":"/sse/v1/messages","label":"E3-q2-r2","item":"text:every=1000:label=E3-q2-r2","stack":"native-like",…,"messages_length":5,…}
{"seq":155,"at":"2026-09-15T03:53:11.626Z",…,"event":"server-completed","req":140,"label":"E3-q2-r2","script":"text","completed_after_ms":7004,"events_written":8,"pings_written":0,"note":"the server sent the whole stream"}
{"seq":156,"at":"2026-09-15T03:53:11.827Z",…,"event":"host-mark","label":"E3:host-terminates"}
{"seq":165,"at":"2026-09-15T03:53:15.275Z",…,"event":"request","method":"POST","path":"/sse/v1/messages","label":"E3-q3","item":"text:label=E3-q3",…,"messages_length":3,"message_sha256":["a8164237e603bd7fbbd7cc9871cfca7868825fef3f7a30f89b759b7c7d1427fb","dd4e44cbc4bb10b5c389ea18320795b7a250729ac86c72e793f49e5307dee31e","d8a018fe08475b11689d421eed294799252cf3d58e4cb8f7ca7228fc70aa19c4"],…}
```

Screenshots: `e3-stopped.png`, `e3-after-relaunch.png`.

### 2.6 E4 and E5 — Try again, the spend limit and the rate limit: PASS

**E4.** The first request (seq 177) was answered 529 with `overloaded_error` and `request-id: req_probe_0177`. The
entry showed the alert "Anthropic is overloaded and did not answer. Anthropic request ID: req_probe_0177", with Try
again, Ask again, and "Sends the same request again. If the first one reached Anthropic, both may be billed."
`retryEntryId` was that entry. `services.ask.retry()` sent seq 183: 5,566 bytes, sha256
`b8ec4e9c8e306911940ef15eab51cfaee18696bcb88c3b8b1576742060dd0b19`, identical to the first. It completed, and the
entry ended answered with 2 requests.

**E5, spend limit.** One request (seq 198) was answered 429 with `details.error_code: enforced_spend_limit_reached`.
The copy read "Anthropic refused the request because your organization reached its spend limit: This organization has
reached its spend limit." with the request ID. No other Anthropic request was logged before the next queue reset. The
only action was Ask again: no Try again, and `retryEntryId` null.

**E5, rate limit.** One request (seq 205) was answered 429 with `retry-after: 7`. The copy read "Anthropic's rate limit
for your key was reached: Number of request tokens has exceeded your per-minute rate limit. Anthropic asks to wait 7
seconds before trying again.", with Try again, Ask again and the hint.

```
{"seq":178,…,"event":"error-response","req":177,"label":"E4-r1","status":529,"error_type":"overloaded_error","spend":false,"retry_after":null,"request_id":"req_probe_0177"}
{"seq":183,"at":"2026-09-15T03:53:17.289Z",…,"label":"E4-r2","item":"text:label=E4-r2","stack":"native-like",…,"body_length":5566,"body_sha256":"b8ec4e9c8e306911940ef15eab51cfaee18696bcb88c3b8b1576742060dd0b19",…}
{"seq":199,…,"event":"error-response","req":198,"label":"E5-spend","status":429,"error_type":"rate_limit_error","spend":true,"retry_after":null,"request_id":"req_probe_0198"}
{"seq":206,…,"event":"error-response","req":205,"label":"E5-rate","status":429,"error_type":"rate_limit_error","spend":false,"retry_after":"7","request_id":"req_probe_0205"}
```

Screenshots: `e4-overloaded.png`, `e4-after-retry.png`, `e5-spend.png`, `e5-rate-limit.png`.

### 2.7 E6 — follow-ups stay append-only: PASS

Question 1 (`tool_use_search`, then `text`) sent requests of 1 and 3 messages. Question 2 (`text`) sent 5:

| Question 2, request 1 (seq 238) | hash | equals |
|---|---|---|
| user: context + question 1 | `a8164237…` | question 1's last request, message 1 |
| assistant: text + `tool_use` | `f34f66da…` | message 2 |
| user: `tool_result` | `7f010edd…` | message 3 |
| assistant: "The cheapest business seats in this search are on Alaska: …" (200 characters) | `dd4e44cb…` | question 1's final assistant message |
| user: context + "What are the taxes and fees on the cheapest option?" | `a9c4bd04…` | the new turn |

System `ceedb542…` and tools `1811d0eb…` were equal across all three requests. Question 1 ended committed.
Screenshot: `e6-follow-up.png`.

### 2.8 E7 — leaving mid-question: PASS

The first request replayed `tool_use_search` over 40 s (13 events, 3,333 ms apart), with a ping each second. The host
read the server's log and opened Settings about 3 s in, then returned about 30 s in. Times are ms from the server's
line for the first request.

| | Run 3 | Run 2 |
|---|---|---|
| Host opens Settings (mark written before the command) | 3,112 | 3,062 |
| JS sees `hidden` (JS clock, from just before the question was asked) | 4,425 | 4,207 |
| Host returns to awardgrid | 30,134 | 30,213 |
| JS sees `visible` | 30,721 | 30,439 |
| Server: first request `server-completed`, 13 events, 39 pings | 39,998 | 39,998 |
| **Anthropic requests logged between leaving and returning** | **none** | none |
| Second request (`text`) logged | 40,178 | 40,044 |
| **Terminal states the app saw** | **one: answered, at 40,337** | one, at 40,091 |
| App process | the same PID at launch and at return (21130) | the same |

The activity log went: request 1 at 133 ms, the tool at 40,206, request 2 at 40,317, ended at 40,338. Every one of
those happened while visible. No pause step was recorded, because no step boundary fell inside the 27 s away; the first
request outlived the absence. As in T5, the Simulator did not suspend the app's networking. Screenshots:
`e7-after-return.png`, and `e7-away.png` (Settings opening over awardgrid, taken right after the launch command
returned: the app switch is still in motion, and awardgrid's card still reads "Waiting for Claude (2 s)").

### 2.9 E8 — process death: PASS, with a false meta line

The script `text` sent one event each 5 s. The app posted `e8_request_out` when the request was out. The host
terminated the app 3,078 ms after the server logged the request. The server logged `client-disconnected` at 3,212 ms
with 1 of 8 events written, so terminating the process closed the socket, where Stop (T4, E3) does not. After the
relaunch the entry was `unfinished`, not committed. It read "This question did not finish because awardgrid was closed
while it ran. Requests already sent may have been billed." and offered Ask again, enabled.

One line on that screen is false: the meta line reads **"Claude Opus 5 · No requests · 0 input tokens (0 read from
cache) · 0 output tokens · seats.aero calls: 0"**, though the probe server logged the request (seq 301). The service
counts a request in memory when it starts, but writes `ask.json` again only when the request finishes. So the file the
relaunch read still said 0 requests. E8's criterion does not cover the meta line, so the verdict stands.

```
{"seq":301,"at":"2026-09-15T03:54:17.354Z",…,"event":"request","method":"POST","path":"/sse/v1/messages","label":"E8","item":"text:every=5000:label=E8","stack":"native-like",…}
{"seq":305,"at":"2026-09-15T03:54:20.432Z",…,"event":"host-mark","label":"E8:host-terminates"}
{"seq":306,"at":"2026-09-15T03:54:20.567Z",…,"event":"client-disconnected","req":301,"label":"E8","script":"text","disconnected_after_ms":3212,"events_written":1,"events_total":8,"pings_written":0,"note":"the client hung up before the stream ended"}
```

Screenshot: `e8-unfinished.png`.

### 2.10 R1 — the normal build, restored

After each run the script stopped both servers by PID, rebuilt the normal app (`npm run build && npx cap sync ios`) and
installed it on both simulators. It then checked the bundle three ways.

| `apps/ios/dist/assets/` | Bytes | `127.0.0.1:45\|localhost:45\|probe-server\|sk-ant-` |
|---|---|---|
| `base-BFYtZZQN.js` | 2,542 | 0 |
| `index-CPjtKtwP.js` | 744,378 | 0 |
| `native-ILMP7Dva.js` | 770 | 0 |
| `node.browser-DbEv7Wcd.js` | 381 | 0 |
| `node.browser-uzVjoxqw.js` | 1,830 | 0 |
| `web-Bwvdr2YB.js` | 8,479 | 0 |
| `web-Dm1hYlbx.js` | 802 | 0 |

- **Pattern:** 0 in all seven `.js` files.
- **Chunks:** no `*probe*` or `*e2e*` chunk.
- **Hashes:** all seven `.js` files hash identically (sha256) to a normal build made from HEAD `1c6bd22` before any
  Part B change.

In run 1 the hash check **failed**. Its `index` was 744,406 bytes, because the e2e driver started in an effect of its
own, and `useEffect(() => {}, [services])` survived in the normal bundle. Runs 2 and 3 start the driver inside the
existing services effect behind the same constant, and the line drops out whole. As in §1.1, the source maps beside
the files are a different matter. `index-*.js.map` carries `App.tsx`'s source text, which names `e2e-driver`. No map
matches the R1 pattern: the count is 0 in all seven.

The main chunk, 744,378 bytes, is 76,937 over design §10.3's 667,441-byte baseline. That is past the 60 KB at which
growth is investigated. Part B adds none of it; step 7 part A added 24,971 over §1's 719,407. This is recorded, not
investigated here.

### 2.11 What §2 does not show

- **Anything on a device**, or a VoiceOver pass. A5 is a DOM reading.
- **The Keychain.** The e2e build keeps both keys in memory.
- **A pause before a step while awardgrid is away.** E7's absence fell inside one request.
- **get_flights, booking links, a truncated or refused answer, or "not checked" cells.** No script in these runs
  reached them.
- **Real Anthropic latency, billing or request IDs**, which need the owner's key (§1.12).

### 2.12 After the fixes

Part B's runs found three lines where the app said something untrue:

- **E2** (§2.4): the warning in Ask's tool result blamed today's quota for skipped route lists, with 759 calls left.
- **E6** (§2.7): a follow-up answered without a tool call showed no "Data: seats.aero", though its request resent an
  earlier committed search's results.
- **E8** (§2.9): the relaunched unfinished entry read "No requests", though the request had been sent.

Those three are fixed in the working tree on top of `df4a2da`, and the harness ran again on 2026-09-15 (UTC), on the same
two simulators. `--e2e` ran once end to end (armed 05:38:27Z). Step 3's mode also ran once (armed 05:44:32Z), because Part
B had moved it into `run_step3()` without running it again. Both runs exited 0 the first time, so nothing environmental
needed fixing and no run was repeated. The raw logs are not committed.

**What changed in the code.**

- **E8, in the shell.** `apps/ios/src/ask/ask-service.ts` now writes `ask.json` at `request_started` too, so a sent
  request is counted on disk. The loop emits that event as it sends, after the gate that waits for queued writes, so the
  request does not wait for this write, and a kill can still land before it. So `apps/ios/src/ask/labels.ts` adds
  `entryMetaLine`, which `AskEntry` uses. For an entry restored as unfinished, it states every saved count as a lower
  bound ("at least …"). It leaves out a count saved as zero rather than stating it, and closes with "This question may
  have used more than awardgrid saved before it was closed". Every other ending keeps `metaLine`, because those endings
  are written with the loop's own totals. Tests: three cases in `ask-service.test.ts`, including a kill before the
  count's write lands and a kill before a search step's calls are saved; `unfinished-meta.test.ts`; `ask-entry.test.ts`.
- **E2, in `packages/core/src/lib/ask/tools.ts` only.** `search_awards` replaces runFind's `find.routes_skipped` warning
  with one that names the bound that ran out: Ask's per-search route-list limit, today's quota, or both. To know which,
  it reads the remaining-calls count runFind sized its Get Routes budget with, through a wrapper around the quota. Other
  warnings pass through as runFind wrote them, in order. `find.ts`, the i18n dictionaries and the web app are unchanged.
  So are the system prompt and the tool descriptions: every request below hashes to system `ceedb542…` and tools
  `1811d0eb…`, as before. Test: `tools-routes-warning.test.ts`, a new file.
- **E6, in the shell.** `showsAttribution(entry, earlier)` holds when the entry's own requests carried seats.aero data
  (an included search, or a seats.aero read that answered). It also holds when any earlier entry that ended committed
  carried such data, since only committed entries are resent. `AskScreen` hands each entry the entries before it.
  Tests: `attribution.test.ts`, `ask-entry.test.ts`, `ask-screen.test.ts`, `labels.test.ts`.

**Verdicts after the fixes.**

| | Scenario | Verdict | After the fixes | Part B run 3 |
|---|---|---|---|---|
| **A3** | No Anthropic key | **PASS** | notice, composer and Ask disabled, 0 Anthropic requests; 30 dates × 3 pairs, 44 of 90 cells priced, 1 call, "188 of 950" | same |
| **A4** | Layout, 17 Pro and SE | **PASS** on both | every value `summary-e2e` reports is equal to run 3's: one nav row ending at x = 351.2, scrollWidth = clientWidth in all 7 states, footer on screen, 12 named controls ≥ 44 pt, the same unjudged controls under 44 pt | same |
| **A5** | Names, roles, status region | **PASS** | 32 states, 0 unnamed controls, the same names and status-region texts per state | same |
| **E1** | A question end to end | **FAIL** | step "…, business. **2 calls.**"; the mock logged the search + `routes?source=eurobonus`; quota line "0 of 950", then **"189 of 950"** | same |
| **E2** | Empty-cell reasons, `demo-key-partial` | **FAIL** | tool result `unmonitored: []`, `not_read_in_full: []`, now with **the warning naming Ask's limit**; grid search failed, "seats.aero unavailable (HTTP 500): {}", after 8 mock requests; with `demo-key-normal`: 19 calls, 30 "not monitored", 12 "—", 0 "not checked" | same, with the quota warning |
| **E3** | Stop, then a relaunch | **PASS** | stopped 2,001 ms into request 2; server completed at 7,001 ms; stopped entry kept after the relaunch (PID 62841 → 63006); question 3's request: `a8164237…`, `dd4e44cb…`, then `d8a018fe…` | 2,003 ms; 7,004 ms |
| **E4** | 529, then Try again | **PASS** | seq 177 answered 529 (`req_probe_0177`); resend seq 183, 5,566 bytes, sha256 `b8ec4e9c…`, equal; answered with 2 requests | same |
| **E5** | Spend limit; rate limit | **PASS** | spend copy, 1 request, no Try again (seq 198); rate-limit copy with the 7-second sentence and Try again (seq 205) | same |
| **E6** | Follow-ups are append-only | **PASS** | 5 messages, starting with question 1's last request + its answer; system and tools equal; message 3 now `5fbe6fcc…` (below); **"Data: seats.aero" under the follow-up** | message 3 `7f010edd…`; no attribution |
| **E7** | Leaving mid-question | **PASS** | leave 3,218; `hidden` 4,374; back 30,215; `visible` 30,561; server-completed 39,998 (13 events, 39 pings); none logged while away; request 2 at 40,057; one terminal state, answered at 40,149; the same PID at launch and return (63151) | 3,112; 4,425; 30,134; 30,721; 39,998; 40,178; 40,337 |
| **E8** | Process death | **PASS** | terminated 3,273 ms after the request; server `client-disconnected` at 3,396 ms, 1 of 8 events; UNFINISHED with Ask again, enabled (PID 63416 → 63455); **meta line "at least 1 request"** (below) | 3,078 ms; 3,212 ms; "No requests" |
| **R1** | The normal bundle | **PASS** | grep 0 in all 7 `.js`; no probe or e2e chunk; all 7 hash identical to a normal build of the fixed working tree made before the run; `index-CG3Jbm-I.js` 746,386 bytes | 744,378 bytes |

As in §2.8, E7's `hidden`, `visible` and terminal-state times are on the JS clock, from just before the question was
asked; the others are from the server's line for request 1.

How the two runs were compared:

- **The summaries.** Run 3's log was re-derived with today's `probe-log.mjs summary-e2e`, and its JSON compared leaf by
  leaf with this run's. A3, both A4s and A5 are equal in every value. E1 to E8 differ only in clock values, timestamps and
  milliseconds; the mock's own response times (0 to 3 ms); one evidence seq in E7 (a host mark logged one line later);
  E2's warning; E6's message-3 hash; and E8's meta line and saved request count.
- **Everything the app posted.** The same comparison, over every value the app posted, differs only in random entry
  IDs, clock fields, E6's `attribution`, E8's `meta` and `usage.requests`, and the boxes in `dom:e6-follow-up`. Those
  boxes moved because the page is 24 pt taller: `scrollHeight` went from 1,263 to 1,287.
- **Transport.** All 21 Anthropic requests were `POST /sse/v1/messages`, `native-like`, with
  `user-agent: Anthropic/JS 0.123.0`, no Origin and an `x-api-key` of 27 characters, and each carried a queue label.
- **Timings.** Every timing is within its scenario's terms: Stop about 2 s into E3's second request, and E7's leaving
  about 3 s and returning about 30 s after its first request.

**E2: the warning in the tool result.** Before (run 3, seq 80, as quoted in §2.4):

```
{"role":"user","blocks":[{"type":"tool_result","is_error":false,"chars":785,"fields":{"spent":{"seats_aero_calls":2,"from_cache":false,"question_calls_left":10,"today_calls_left":759},"rows_total":0,"unmonitored":[],"not_read_in_full":[],"warnings":["Couldn't check whether seats.aero monitors 2 empty pair(s): 24 program route list(s) skipped to stay within today's quota."]},…}]}
```

After (seq 80, the `E2-r2` request logged at 05:38:40.692Z):

```
{"role":"user","blocks":[{"type":"tool_result","is_error":false,"chars":866,"fields":{"spent":{"seats_aero_calls":2,"from_cache":false,"question_calls_left":10,"today_calls_left":759},"rows_total":0,"unmonitored":[],"not_read_in_full":[],"warnings":["Could not check whether seats.aero monitors 2 empty airport pairs: 24 program route lists were skipped because Ask lets one search make at most 1 route list call, not because of today's seats.aero quota."]},…}]}
```

What skipped the lists was Ask's one-call limit, with 759 calls left today, and the warning now says that. Nothing else
in the tool result changed: the mock logged the same search and `routes?source=virginatlantic`, and neither list names a
pair. So E2 still fails on its own criterion.

The same sentence, with 25 lists, is in E1's, E6's and E7's second requests. Those bodies, and E2's, grew from 6,960 to
7,041 bytes, and E6's follow-up (seq 238), which resends that tool result, from 7,490 to 7,571. The tool result is
message 3, so its hash changed with it: `7f010edd…` → `5fbe6fcc…` in E6 (§2.7), `788b7b17…` → `18f01049…` in E1's and
E7's second requests, `0719b778…` → `0bb18795…` in E2's. E6's check compares question 2's first request with question 1's
last one in the same run, and it still holds.

This run reached one wording only: Ask's fixed limit ran out with calls left today. The others are pinned by
`tools-routes-warning.test.ts`, not measured: today's quota alone, the limit and the quota both, and a limit lowered
below one call because the question's allowance went to the search's pages.

**E6: the attribution under the follow-up.** The newest entry, as the app read it from the DOM. Before (run 3, seq 248):

```
{"seq":248,"at":"2026-09-15T03:53:22.154Z",…,"event":"app","probe":"E6",…,"dom":{"question":"What are the taxes and fees on the cheapest option?","steps":[],…,"attribution":null,"attribution_after_answer":false,"meta":["Claude Opus 5 · 1 request · 4,392 input tokens (3,956 read from cache) · 96 output tokens · seats.aero calls: 0"],…}}
```

After (seq 248):

```
{"seq":248,"at":"2026-09-15T05:39:02.916Z",…,"event":"app","probe":"E6",…,"dom":{"question":"What are the taxes and fees on the cheapest option?","steps":[],…,"attribution":"Data: seats.aero","attribution_after_answer":true,"meta":["Claude Opus 5 · 1 request · 4,392 input tokens (3,956 read from cache) · 96 output tokens · seats.aero calls: 0"],…}}
```

The follow-up made no seats.aero call ("seats.aero calls: 0"), and its request resent question 1's search results
(messages 2 and 3 above). It now carries the attribution, after its answer. Question 1's entry carried it before and
still does. Screenshot: `e6-follow-up-after-fixes.png`.

**E8: the meta line after the relaunch.** In both runs the app posted `e8_request_out` (seq 303) with
`"usage":{"requests":1,…}` in memory. Before (run 3, seq 310), the relaunch read 0 from disk:

```
{"seq":310,"at":"2026-09-15T03:54:22.857Z",…,"event":"app","probe":"E8",…,"usage":{"requests":0,…},…,"attribution":null,"attribution_after_answer":false,"meta":["Claude Opus 5 · No requests · 0 input tokens (0 read from cache) · 0 output tokens · seats.aero calls: 0"],"ending":["This question did not finish because awardgrid was closed while it ran. Requests already sent may have been billed."],…}
```

After (seq 310):

```
{"seq":310,"at":"2026-09-15T05:40:01.519Z",…,"event":"app","probe":"E8",…,"usage":{"requests":1,…},…,"attribution":null,"attribution_after_answer":false,"meta":["Claude Opus 5 · at least 1 request · This question may have used more than awardgrid saved before it was closed"],"ending":["This question did not finish because awardgrid was closed while it ran. Requests already sent may have been billed."],…}
```

The count saved at `request_started` had reached `ask.json` before the host terminated the app, 3,273 ms after the
server logged the request. The relaunched entry holds 1 request and says "at least 1 request". It no longer states token
counts or a seats.aero count that no response had reported. The race the fix also covers was not reached on the
Simulator: a kill that lands before that write. There the line would read "Claude Opus 5 · This question may have used
more than awardgrid saved before it was closed", and only unit tests pin that (`ask-service.test.ts`, which restores from
the file as it stood when the request was handed to the transport, and `unfinished-meta.test.ts`).
Screenshot: `e8-unfinished-after-fixes.png`.

**Screenshots.** Two were added: `e6-follow-up-after-fixes.png` and `e8-unfinished-after-fixes.png`, byte for byte as
the run wrote them. The originals stay as they were. None of this run's other 31 screenshots shows a different screen:

- 20 are byte-identical to the committed ones.
- The SE's seven differ only in the status-bar clock: 20:55 in run 3, 22:41 now. The 17 Pro's status bar reads 09:41 in
  both runs.
- `a3-ask-no-anthropic-key`, `a4-17pro-ask-idle` and `a4-17pro-nav-working` differ in 351 to 2,560 pixels, all along
  the anti-aliased edges of rounded panels, and their DOM facts are equal.
- `e7-away` caught Settings opening at a different frame of the animation. It still reads "Waiting for Claude (2 s)".

**Step 3's mode, against §1.** Every verdict matches §1:

| | Probe | Verdict | This run | §1 run 2 |
|---|---|---|---|---|
| **A0** | Native GET to both loopback hosts, no ATS key | **PASS** | 200 in 50 ms; 200 in 7 ms; both `native-like` | 87 ms; 10 ms |
| **T1** | 5 s idle timeout vs. a 10-chunk drip | **PASS** | server-completed 18,025 ms, 10,240 bytes in JS after 18,042 ms; control cut at 5,017 ms, "The request timed out." at 5,019 ms | 18,004 ms; 5,014 ms |
| **T2** | SDK stream over the production adapter | **PASS** | `tool_use`, fixture input, 142 tokens; no Origin, no Sec-Fetch, `Anthropic/JS 0.123.0`, key length 27; body 5,289 bytes, sha256 **`9768dfc1…4a7e6dd`** in JS and at the server; completed at 12,000 ms (13 events, 11 pings), resolved in JS after 12,050 ms | same hash; 12,001 ms; 12,083 ms |
| **T2b** | WebView fetch, same URL and body | **PASS** | OPTIONS preflight with `origin: capacitor://localhost` and Sec-Fetch-*; no POST; `Load failed` after 5 ms | 9 ms |
| **T3** | `event: error` mid-stream | **PASS** | `overloaded_mid_answer` after 759 ms, `req_probe_0044` | 758 ms |
| **T4** | Stop at 800 ms into a 6 s replay | **PASS** | abort at 801 ms; JS rejected 4 ms after; the server wrote all 8 events and completed at 5,999 ms, no disconnect | 800 ms; 1 ms; 5,999 ms |
| **A1b** | Real api.anthropic.com POST, invalid key | **FAIL** | 401 `AuthenticationError`, the same class as the probe server's 401, after 386 ms; **`requestID` null**, body `request_id` null; the same 8 headers by name, none `request-id` (`cf-ray: a3b55311dbc2ebc3-SEA`); the probe server's control 401 carried `request-id: req_probe_0064` | 1,890 ms; `…-SJC` |
| **A2** | WebView fetch to both hosts | **PASS** | both `NativeHttpRequiredError`, 1 ms and 0 ms | same |
| **X1** | The seats.aero rewrite | **PASS** | 200, `x-ratelimit-remaining: 812`, 1,171 bytes in 10 ms; mock logged `GET /partnerapi/routes?source=united 200` | 4 ms |
| **T5** | Leave 3 s into a 60 s drip, return at 48 s | **PASS** | host leaves at 3,101 ms; `hidden` 4,791; host returns 48,239; `visible` 48,605; server 59,001 ms, 60 chunks; one outcome, resolved, 61,440 bytes at 59,022 ms while visible; the same PID at launch and return (66164) | 3,142; 4,918; 48,087; 48,880; 59,028 |
| **R1** | The normal bundle | **PASS** | grep 0 in all 7 `.js`; no probe chunk; `index-CG3Jbm-I.js` 746,386 bytes | 719,407 bytes |

The mode's own `summary.json`, compared leaf by leaf with §1 run 2's, differs only in timings and in values no criterion
reads:

- **Minified names.** The error constructors, such as `Cm` → `wm` for the 401, changed with the code added since step 3.
- **Key order.** The order of keys inside the 401 and 529 messages changed, which §1.7 had already seen change between
  runs.
- **A0's sizes.** Its two responses were each 30 bytes longer. That response is the probe server's log so far.
- **A1b's host.** It answered in 386 ms, not 1,890 ms, from a Cloudflare edge in SEA rather than SJC.

A1b sent one request to api.anthropic.com, with `sk-ant-probe-invalid-000000`, as §1.7 describes. The run was armed once
(seq 2), and the app consumed that arm at launch. After this mode's restore, the seven `.js` files in `apps/ios/dist`
again hash identically to the baseline R1 used above. The main chunk's 746,386 bytes are 2,008 over §2.10's 744,378, all
of it from these fixes, and 78,945 over design §10.3's 667,441 baseline. That is recorded, not investigated, as in §2.10.

At the end the normal app was installed on both simulators. Their bundles carry the same seven `.js` names, with a
pattern count of 0. The SE simulator was shut down by UDID. Both servers were stopped by the PIDs the scripts started,
and ports 4599 and 4597 were free.

### Reproducing §2

```bash
R1_BASELINE=<sha256 list of a normal build at HEAD> apps/ios/probes/run-probes.sh --e2e <scratch-dir outside the repository>
node apps/ios/probes/probe-log.mjs summary-e2e <scratch-dir>/probe-log.jsonl --mock <scratch-dir>/mock-seats.out
```

Besides §1's requirements, `--e2e` uses the Simulator named by `$SE_NAME` (default `awardgrid iPhone SE (3rd
generation)`), creating it on the newest installed iOS runtime that supports that device type if it does not exist.
It writes the probe log, the mock's log, `shots/`, `summary-e2e.txt` and `r1.txt` under the scratch directory.
`R1_BASELINE` is optional; without it, R1 is the pattern and the chunk names only. The script exits 7 when R1 fails.
It exits 9, after the restore and R1, when a phase timed out, a wait failed or the summary did not finish. Scenario
FAILs are results and leave the exit at 0. Exit 9 was added after run 3, where every phase reported done; before it,
an incomplete run showed only in `summary-e2e.txt`'s `phases` line.

## 3. On the owner's own keys (2026-09-23)

**Status: the first real question was answered, and it found a defect twelve Simulator scenarios had
not.** Ask ran on the owner's own seats.aero Pro key and Anthropic key, on the iPhone 17 Pro simulator
(`A480530B-3036-4B12-80D4-F37A6130D898`), against the real api.anthropic.com and the real seats.aero
Partner API. Keys were typed into Settings by the owner and live in the Simulator's Keychain; no key
was ever written to a file or a command. This section records what that run showed. K2, K4, K5 and K6
have not run.

### 3.1 K3 — the key check, on both keys

Saving the Anthropic key ran the check the design describes, a `GET /v1/models/claude-opus-5` that
carries no question. It came back accepted: **"Anthropic accepted this key for Claude Opus 5. Checking
sends no question."** The seats.aero key saved and its section read `On file: ••••` with the last four
of the owner's key. Both requests crossed the native adapter; the WebView tripwire was not touched.

An earlier save had put the seats.aero key into the Anthropic field by mistake. Anthropic answered
401 and the screen read "Anthropic rejected this key." with **`Anthropic request ID:
req_011CfMAhDyDiqUV8ArSRSFXN`**. That is worth recording against **A1b** (§1.7), which measured a real
401 carrying no `request-id` header and is a FAIL on that criterion: a real 401 on the key-check path
*did* carry a readable request ID. Whether the difference is the path (`/v1/models/{id}` against
`/v1/messages`), the key shape, or the date is not established here.

### 3.2 K1 — the first question, end to end

Question: "Cheapest business class from SEA to Tokyo in the next 30 days?", asked with no search
included, on an empty conversation.

| | |
|---|---|
| Asked at | `2026-09-23T23:02:28.733Z` |
| Answered at | `2026-09-23T23:02:57.843Z` |
| **Wall clock** | **29.1 s**, for 4 model requests and 3 seats.aero calls |
| Usage, as the meta line showed it | Claude Opus 5 · 4 requests · 13,989 input tokens (9,013 read from cache) · 1,170 output tokens · seats.aero calls: 3 |
| Steps | `search_awards` **failed** (2 calls) → `search_awards` from this device's cache (0 calls) → `get_flights` (1 call) |
| Quota afterwards | `seats.aero calls today: 3 of 950` |

**The cache was read, on the first question of a fresh conversation.** 9,013 of 13,989 input tokens
came from cache across the four requests, which is the first evidence that prompt caching works here
at all; §2's cache numbers were the scripted fixtures'. A question is therefore not four times the
price of one request.

**The answer was usable and correctly hedged.** It led with Qantas at 90,000 miles for 7 Oct
(AS123 SEA 13:20 → NRT 16:00, nonstop, 4 seats, $349 in fees), then said the better value was Alaska
at 95,000 miles on the same flight for $6 in fees, 5,000 miles to save about $343. It marked the ages
the tools reported ("Data pulled just now (0 min old)", "That row was 144 min old"), said the results
came from the device cache so a pair could have gone unchecked, and said this is seats.aero's cached
data rather than live inventory, to confirm on the program's own site before transferring points.
"Data: seats.aero" rendered under it.

### 3.3 The defect: a required field the live API omits

The first `search_awards` failed after spending two calls. The tool result the app sent Claude carries
the reason, and `ask.json` keeps it:

```
{"error":"seatsaero_error","message":"seats.aero could not complete the search: seats.aero routes response did not match the documented schema at \"0.NumDaysOut\": Invalid input: expected number, received undefined.","seats_aero_calls":2,"question_calls_left":10}
```

A Get Routes entry arrived without `NumDaysOut`. `Route` (`packages/core/src/lib/seatsaero/types.ts`)
required it, so zod threw, and `runFind` lost rows two calls had already paid for. The OpenAPI snapshot
the schema was written from gives both `NumDaysOut` and `Distance` a `default: 0`
(`docs/reference/seatsaero/get-routes-1.md`), and nothing in the app or the core reads either field:
the schema was stricter than the documentation it came from. Both are defaulted now, and a new test
file, `packages/core/src/lib/seatsaero/routes-live-shape.test.ts`, pins the live shape. The regions
stay required: the documentation gives them no default, and no response seen here dropped one.

Every fixture under `packages/core/test/fixtures/seatsaero/` is built from the documentation's own
examples (#13), so no Simulator run could have caught this. §1 and §2 passed 12 scenarios of 12 on
mock servers while this waited in the first real search.

**The same class of failure is filed as #89**: one bad or failing route list throws away a whole
search, and its rows, after the calls are spent. This fix removes today's cause, not that fragility.

### 3.4 The fix, verified on the same path

After the fix, a grid search for "HKG, SHA to SEA, next 30 days, business and first" — the Search
screen, the same `runFind` and the same Get Routes call, with no Anthropic tokens spent — completed:
**27 seats.aero calls, a drawn grid** (HKG-SEA 156,900 Qantas with 4 seats, 190,000 Qatar, and others),
and **SHA-SEA read "not monitored" in every row**, which is the answer only a Get Routes response can
give. Quota afterwards: `30 of 950`.

### 3.5 What this run did not show

- **K2** (Stop and billing), **K4** (leaving the app on a device), **K5** (a device, not a simulator)
  and **K6** (effort `medium` against `high`) have not run.
- **Cost in dollars.** The app shows tokens and calls, never dollars (§2, DECISIONS "Phase 5"). At the
  published rates this question is a few cents; the owner's Console is the only record that settles it.
- **Whether `GET /v1/models/{id}` bills anything** (AS1). The check ran twice today; the Console says.
- **Anything on a device.** This was the Simulator, on the Mac's network.
