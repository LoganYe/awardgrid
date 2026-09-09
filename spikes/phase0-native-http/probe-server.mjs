/**
 * Phase 0 evidence server. Runs on the Mac; the iOS Simulator shares the host network stack,
 * so the app reaches it at http://localhost:3999.
 *
 * Phase 0's acceptance says: "You state explicitly how you proved the call went over native
 * HTTP and not the WebView." Screenshots of a rendered grid cannot prove that. This can:
 * it is a server that seats.aero's CORS posture is copied onto, and it writes down exactly
 * what arrived.
 *
 *   /no-cors   — 200 JSON with NO Access-Control-* headers, like seats.aero. A WKWebView
 *                fetch() may *send* this request but may never read the reply; URLSession
 *                does not care. Either way the request lands here and is recorded, so the
 *                log distinguishes the two stacks by what they sent:
 *                  WebView   → Origin: capacitor://localhost, Sec-Fetch-*, Safari UA
 *                  URLSession→ no Origin, no Sec-Fetch-*, CFNetwork/Darwin UA
 *   /slow      — holds the response open for ?ms, and records whether the client hung up
 *                first. This is what answers "did AbortSignal cancel the native request, or
 *                only the promise?" — a question only the server can answer honestly.
 *   /log       — the recording, WITH permissive CORS so the app can always read it back.
 *   /reset     — clear the recording.
 *
 * No dependencies; `node probe-server.mjs`.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 3999);

/** @type {Array<Record<string, unknown>>} */
const log = [];
let seq = 0;

/** Headers that identify which networking stack issued a request. */
const TELLTALE = [
  "user-agent",
  "origin",
  "referer",
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-dest",
  "accept",
  "accept-language",
  "accept-encoding",
  "partner-authorization",
];

function record(req, extra = {}) {
  const headers = {};
  for (const name of TELLTALE) {
    const v = req.headers[name];
    if (v !== undefined) {
      // Never write a key into the log: this file is read aloud in a report.
      headers[name] = name === "partner-authorization" ? `<present, ${String(v).length} chars>` : String(v);
    }
  }
  const entry = {
    n: ++seq,
    at: new Date().toISOString(),
    method: req.method,
    path: req.url,
    // The decisive pair. A WKWebView fetch() always announces an Origin and Sec-Fetch-*
    // metadata; URLSession never does.
    stack: headers.origin || headers["sec-fetch-mode"] ? "webview-like" : "native-like",
    headers,
    ...extra,
  };
  log.push(entry);
  console.log(JSON.stringify(entry));
  return entry;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (url.pathname === "/log" || url.pathname === "/reset") {
    // The reporting channel is the ONE place that sends CORS headers, so the WebView can
    // always read the evidence even when it could not read the probe response itself.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    if (req.method === "OPTIONS") return res.writeHead(204).end();
    if (url.pathname === "/reset") {
      log.length = 0;
      seq = 0;
      return res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
    }
    return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ log }, null, 2));
  }

  if (url.pathname === "/slow") {
    const ms = Math.min(Number(url.searchParams.get("ms") ?? 8000), 60000);
    const entry = record(req, { held_ms: ms, outcome: "in-flight" });
    const started = Date.now();
    let settled = false;

    // The measurement. If the native request is genuinely cancelled, the socket closes here
    // before the timer fires. If only the JS promise was abandoned, the timer wins and the
    // full response is written to a client that is no longer listening — which means the
    // request still cost a seats.aero quota call.
    const onClose = () => {
      if (settled) return;
      settled = true;
      entry.outcome = "client-disconnected";
      entry.disconnected_after_ms = Date.now() - started;
      console.log(JSON.stringify({ ...entry, note: "client hung up before the response completed" }));
    };
    res.on("close", onClose);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      entry.outcome = "server-completed";
      entry.completed_after_ms = Date.now() - started;
      res.removeListener("close", onClose);
      console.log(JSON.stringify({ ...entry, note: "server sent the whole response" }));
      // No CORS headers here either.
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ slow: true, ms }));
    }, ms);

    res.on("close", () => clearTimeout(timer));
    return;
  }

  // Default: the seats.aero impersonation. 200, JSON, and not one Access-Control-* header.
  const entry = record(req);
  res.writeHead(200, { "content-type": "application/json", "x-probe-served-by": "phase0-probe-server" });
  res.end(JSON.stringify({ ok: true, sawYouAs: entry.stack, n: entry.n, headers: entry.headers }, null, 2));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`probe-server listening on http://localhost:${PORT} (no CORS headers except /log)`);
});
