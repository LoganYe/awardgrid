/**
 * Phase 5 probe server (docs/PHASE5.md §1). Node, no dependencies, listening on 127.0.0.1 only.
 *
 * The model is Phase 0's evidence server (spikes/phase0-native-http/probe-server.mjs, docs/PHASE0.md §2-§4). An
 * app cannot certify its own networking, so this server writes down what actually arrived and when the client
 * hung up. Every verdict in PHASE5.md §1 is a line this server wrote, or a value the app posted to it.
 *
 * Routes
 *   GET  /drip?chunks=N&every=MS&bytes=B  N chunks of B ASCII bytes: the first at once, then one each MS. Logs every
 *                                         write, then `server-completed` or `client-disconnected`.
 *   GET  /slow?ms=MS                      sends nothing for MS, then a small JSON body. Same verdict lines.
 *   POST /sse/v1/messages                 the Messages API, scripted. Answers with the next queued item: a script
 *                                         from packages/core/test/fixtures/ask/streams.json replayed as SSE, or a
 *                                         JSON error status. Logs the request's stack telltales and body hashes.
 *   GET  /sse/v1/models/:id?status=N      models.retrieve, scripted (200 by default, or the /reset `models`).
 *   POST /reset?script=a,b&label=L&every=MS&ping=MS&status=N&spend=1&retry_after=S&models=N
 *                                         replaces the queue; with no `script`, empties it.
 *   GET  /log                             this run's log lines, as JSON.
 *   POST /log                             the app posts its results here. The only route with CORS headers.
 *   POST /arm, POST /mark?label=TEXT      host only (run-probes.sh): allow one probe run; put a host event in the log.
 *   GET  /healthz                         readiness for run-probes.sh. Not logged.
 *
 * A queue item is ":"-separated parts: the one bare part names a script, and each k=v part sets an option for
 * that item, e.g. `tool_use_search:every=1000:ping=1000`, `text:every=857`, `status=529`, `status=429:spend=1`,
 * `status=429:retry_after=7`. An option on the request URL wins over the item's, which wins over the /reset query's.
 * `every` is the delay between events and `ping` sends `event: ping` on its own timer, both in ms.
 *
 * A key is never written: x-api-key is logged as its length, other headers by name only unless listed in
 * `telltales`, and any "sk-ant-" run in text the app posts is masked.
 *
 * Usage: node apps/ios/probes/probe-server.mjs <scratch-dir>
 *   The log is $PROBE_LOG, or <scratch-dir>/probe-log.jsonl, appended one JSON line per event. It may not be
 *   inside the repository. The port is $PROBE_PORT, default 4599, and never 3000, 3400 or 3999.
 */
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = realpathSync(path.resolve(HERE, "..", "..", ".."));
const STREAMS_FILE = path.join(REPO, "packages", "core", "test", "fixtures", "ask", "streams.json");

/** Live production serves 3000; the e2e suite owns 3400 and 3999 (playwright.config.ts). */
const FORBIDDEN_PORTS = new Set([3000, 3400, 3999]);
const HOST = "127.0.0.1";
const PORT = Number(process.env.PROBE_PORT ?? 4599);

function refuse(message) {
  console.error(`probe-server: ${message}`);
  process.exit(2);
}

if (!Number.isInteger(PORT) || PORT <= 0 || FORBIDDEN_PORTS.has(PORT)) refuse(`refusing port ${String(process.env.PROBE_PORT)}`);
const scratch = process.argv[2];
if (!process.env.PROBE_LOG && !scratch) refuse("usage: node probe-server.mjs <scratch-dir>, or set PROBE_LOG");
const requestedLog = path.resolve(process.env.PROBE_LOG ?? path.join(scratch, "probe-log.jsonl"));
mkdirSync(path.dirname(requestedLog), { recursive: true });
const LOG_FILE = path.join(realpathSync(path.dirname(requestedLog)), path.basename(requestedLog));
if (LOG_FILE === REPO || LOG_FILE.startsWith(REPO + path.sep)) refuse(`refusing to write the log inside the repository: ${LOG_FILE}`);

const STREAMS = JSON.parse(readFileSync(STREAMS_FILE, "utf8"));
const SCRIPT_NAMES = Object.keys(STREAMS).filter((name) => Array.isArray(STREAMS[name]));

const startedAt = Date.now();
let seq = 0;
/** This run's entries, for GET /log. */
const entries = [];

function log(event, fields = {}) {
  const entry = { seq: ++seq, at: new Date().toISOString(), t_ms: Date.now() - startedAt, event, ...fields };
  entries.push(entry);
  appendFileSync(LOG_FILE, `${JSON.stringify(entry)}\n`);
  return entry;
}

const KEY_RUN = /sk-ant-[A-Za-z0-9_-]*/g;
/** Masks anything shaped like an Anthropic key in a value the app posted. The probe key is fake; the rule is not. */
function mask(value) {
  return JSON.parse(JSON.stringify(value ?? null).replace(KEY_RUN, "sk-ant-****"));
}

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const elapsed = (from) => Math.round(performance.now() - from);

/**
 * What identifies the stack that sent a request. WebKit always adds Origin and Sec-Fetch-* to a cross-origin
 * fetch; URLSession adds neither (docs/PHASE0.md §2). Absent headers are logged as null, so "no origin" is a
 * value in the log rather than an omission.
 */
function telltales(req) {
  const h = req.headers;
  const secFetch = {};
  for (const [name, value] of Object.entries(h)) if (name.startsWith("sec-fetch-")) secFetch[name] = String(value);
  const origin = h.origin ?? null;
  return {
    stack: origin !== null || Object.keys(secFetch).length > 0 ? "webview-like" : "native-like",
    "user-agent": h["user-agent"] ?? null,
    origin,
    sec_fetch: secFetch,
    "content-type": h["content-type"] ?? null,
    "anthropic-version": h["anthropic-version"] ?? null,
    "access-control-request-method": h["access-control-request-method"] ?? null,
    x_api_key_length: typeof h["x-api-key"] === "string" ? h["x-api-key"].length : null,
    header_names: Object.keys(h).sort(),
  };
}

/** Body length and hashes. Each message, `system` and `tools` is hashed as JSON.stringify of its parsed value. */
function bodyFacts(body) {
  const facts = { body_length: body.length, body_sha256: sha256(body) };
  if (body.length === 0) return facts;
  let json;
  try {
    json = JSON.parse(body.toString("utf8"));
  } catch {
    return { ...facts, body_json: false };
  }
  const messages = Array.isArray(json?.messages) ? json.messages : null;
  return {
    ...facts,
    body_json: true,
    model: json?.model ?? null,
    stream: json?.stream ?? null,
    max_tokens: json?.max_tokens ?? null,
    messages_length: messages ? messages.length : null,
    message_sha256: messages ? messages.map((m) => sha256(JSON.stringify(m))) : null,
    system_sha256: json?.system === undefined ? null : sha256(JSON.stringify(json.system)),
    tools_sha256: json?.tools === undefined ? null : sha256(JSON.stringify(json.tools)),
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res, status, value, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

function int(value, fallback, min, max) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

// ---- The scripted Messages API ----

const OPTION_KEYS = ["every", "ping", "status", "spend", "retry_after"];
let queue = [];
let queueDefaults = {};
let modelsStatus = null;
/** Set by the host before a launch, and consumed by the app's `start` post: one launch runs the probes once. */
let armed = false;

function parseItem(raw, label) {
  const item = { raw, label, name: null, opts: {} };
  for (const part of raw.split(":")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq === -1) item.name = part;
    else item.opts[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return item;
}

function option(url, item, key) {
  return url.searchParams.get(key) ?? item?.opts[key] ?? queueDefaults[key] ?? null;
}

/** Anthropic's error body: `{ type: "error", error: { type, message }, request_id }` (API errors page). */
function errorFor(status, spend) {
  if (status === 401) return { type: "authentication_error", message: "invalid x-api-key" };
  if (status === 403) return { type: "permission_error", message: "Your API key does not have permission to use the specified resource." };
  if (status === 404) return { type: "not_found_error", message: "The requested resource could not be found." };
  if (status === 429 && spend) {
    return { type: "rate_limit_error", message: "This organization has reached its spend limit.", details: { error_code: "enforced_spend_limit_reached" } };
  }
  if (status === 429) return { type: "rate_limit_error", message: "Number of request tokens has exceeded your per-minute rate limit." };
  if (status === 529) return { type: "overloaded_error", message: "Overloaded" };
  return { type: "api_error", message: "Internal server error" };
}

function sendError(res, request, status, { spend = false, retryAfter = null } = {}) {
  const requestId = `req_probe_${String(request.seq).padStart(4, "0")}`;
  const headers = { "request-id": requestId };
  if (retryAfter !== null) headers["retry-after"] = String(retryAfter);
  const error = errorFor(status, spend);
  sendJson(res, status, { type: "error", error, request_id: requestId }, headers);
  log("error-response", { req: request.seq, label: request.label ?? null, status, error_type: error.type, spend, retry_after: retryAfter, request_id: requestId });
}

function replay(res, request, script, { every, ping }) {
  const events = STREAMS[script];
  const requestId = `req_probe_${String(request.seq).padStart(4, "0")}`;
  res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", "request-id": requestId });
  const t0 = performance.now();
  let written = 0;
  let pings = 0;
  let settled = false;
  let eventTimer = null;
  let pingTimer = null;
  const frame = (payload) => `event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`;
  const halt = () => {
    clearTimeout(eventTimer);
    clearInterval(pingTimer);
  };
  const onClose = () => {
    if (settled) return;
    settled = true;
    halt();
    log("client-disconnected", {
      req: request.seq,
      label: request.label,
      script,
      disconnected_after_ms: elapsed(t0),
      events_written: written,
      events_total: events.length,
      pings_written: pings,
      note: "the client hung up before the stream ended",
    });
  };
  res.on("close", onClose);
  const next = () => {
    if (settled) return;
    const event = events[written];
    res.write(frame(event));
    written += 1;
    log("sse-write", { req: request.seq, label: request.label, index: written, type: event.type, at_ms: elapsed(t0) });
    if (written === events.length) {
      settled = true;
      halt();
      res.removeListener("close", onClose);
      res.end();
      log("server-completed", {
        req: request.seq,
        label: request.label,
        script,
        completed_after_ms: elapsed(t0),
        events_written: written,
        pings_written: pings,
        note: "the server sent the whole stream",
      });
      return;
    }
    eventTimer = setTimeout(next, Math.max(0, t0 + written * every - performance.now()));
  };
  if (ping > 0) {
    pingTimer = setInterval(() => {
      if (settled) return;
      res.write(frame({ type: "ping" }));
      pings += 1;
    }, ping);
  }
  next();
}

// ---- Routes ----

function drip(req, res, url) {
  const chunks = int(url.searchParams.get("chunks"), 10, 1, 600);
  const every = int(url.searchParams.get("every"), 1000, 0, 60_000);
  const bytes = int(url.searchParams.get("bytes"), 1024, 16, 1 << 20);
  const request = log("request", { method: req.method, path: req.url, ...telltales(req), chunks, every, bytes });
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  const t0 = performance.now();
  let written = 0;
  let bytesWritten = 0;
  let settled = false;
  let timer = null;
  const chunkText = (n) => `${`chunk ${n} `.padEnd(bytes - 1, ".")}\n`;
  const onClose = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    log("client-disconnected", {
      req: request.seq,
      path: req.url,
      disconnected_after_ms: elapsed(t0),
      chunks_written: written,
      bytes_written: bytesWritten,
      note: "the client hung up before the response completed",
    });
  };
  res.on("close", onClose);
  const tick = () => {
    if (settled) return;
    const text = chunkText(written + 1);
    res.write(text);
    written += 1;
    bytesWritten += Buffer.byteLength(text);
    log("drip-write", { req: request.seq, chunk: written, at_ms: elapsed(t0), bytes_written: bytesWritten });
    if (written === chunks) {
      settled = true;
      res.removeListener("close", onClose);
      res.end();
      log("server-completed", {
        req: request.seq,
        path: req.url,
        completed_after_ms: elapsed(t0),
        chunks_written: written,
        bytes_written: bytesWritten,
        note: "the server sent the whole response",
      });
      return;
    }
    timer = setTimeout(tick, Math.max(0, t0 + written * every - performance.now()));
  };
  tick();
}

function slow(req, res, url) {
  const ms = int(url.searchParams.get("ms"), 8000, 0, 120_000);
  const request = log("request", { method: req.method, path: req.url, ...telltales(req), held_ms: ms });
  const t0 = performance.now();
  let settled = false;
  // The Phase 0 measurement: if the native request is really cancelled, the socket closes before the timer fires.
  const onClose = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    log("client-disconnected", { req: request.seq, path: req.url, disconnected_after_ms: elapsed(t0), note: "the client hung up before the response was sent" });
  };
  res.on("close", onClose);
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    res.removeListener("close", onClose);
    const body = JSON.stringify({ slow: true, ms });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(body);
    log("server-completed", { req: request.seq, path: req.url, completed_after_ms: elapsed(t0), bytes_written: body.length, note: "the server sent the whole response" });
  }, ms);
}

async function handle(req, res) {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  const route = url.pathname;

  if (route === "/healthz" && req.method === "GET") return sendJson(res, 200, { ok: true });

  if (route === "/log") {
    if (req.method === "GET") {
      log("request", { method: req.method, path: req.url, ...telltales(req) });
      return sendJson(res, 200, { lines: entries });
    }
    // The reporting channel, and the one route with CORS headers: the WebView can always post its results here.
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type");
    res.setHeader("access-control-allow-methods", "POST");
    if (req.method === "OPTIONS") return res.writeHead(204).end();
    if (req.method === "POST") {
      const body = await readBody(req);
      let payload;
      try {
        payload = JSON.parse(body.toString("utf8"));
      } catch {
        return sendJson(res, 400, { ok: false, error: "not JSON" });
      }
      const isStart = payload?.probe === "start";
      const armedForThisLaunch = isStart ? armed : undefined;
      if (isStart) armed = false;
      log(
        "app",
        mask({
          probe: payload?.probe ?? null,
          pass: payload?.pass ?? null,
          values: payload?.values ?? null,
          app_at: payload?.at ?? null,
          posted_via: telltales(req).stack,
          ...(isStart ? { armed: armedForThisLaunch } : {}),
        }),
      );
      return sendJson(res, 200, isStart ? { ok: true, armed: armedForThisLaunch } : { ok: true });
    }
  }

  if (route === "/arm" && req.method === "POST") {
    armed = true;
    return sendText(res, 200, String(log("host-arm").seq));
  }
  if (route === "/mark" && req.method === "POST") {
    return sendText(res, 200, String(log("host-mark", { label: url.searchParams.get("label") ?? "" }).seq));
  }

  if (route === "/reset" && req.method === "POST") {
    const label = url.searchParams.get("label");
    queue = (url.searchParams.get("script") ?? "")
      .split(",")
      .map((raw) => raw.trim())
      .filter(Boolean)
      .map((raw) => parseItem(raw, label));
    queueDefaults = Object.fromEntries(OPTION_KEYS.filter((key) => url.searchParams.has(key)).map((key) => [key, url.searchParams.get(key)]));
    modelsStatus = url.searchParams.get("models");
    const unknown = queue.filter((item) => item.name !== null && !SCRIPT_NAMES.includes(item.name)).map((item) => item.name);
    log("reset", { label, queue: queue.map((item) => item.raw), defaults: queueDefaults, models: modelsStatus, unknown_scripts: unknown, stack: telltales(req).stack });
    return sendJson(res, unknown.length ? 400 : 200, { ok: unknown.length === 0, queued: queue.length, unknown });
  }

  if (route === "/drip" && req.method === "GET") return drip(req, res, url);
  if (route === "/slow" && req.method === "GET") return slow(req, res, url);

  if (route.startsWith("/sse/")) {
    if (req.method === "OPTIONS") {
      // Answered with no CORS headers, the posture Phase 0 copied from seats.aero: a WebView preflight fails here.
      log("request", { method: req.method, path: req.url, ...telltales(req), preflight: true });
      return res.writeHead(204).end();
    }
    if (route === "/sse/v1/messages" && req.method === "POST") {
      const body = await readBody(req);
      const item = queue.shift() ?? null;
      const request = log("request", { method: req.method, path: req.url, label: item?.label ?? null, item: item?.raw ?? null, ...telltales(req), ...bodyFacts(body) });
      request.label = item?.label ?? null;
      const status = int(option(url, item, "status"), 0, 0, 599);
      if (status > 0) {
        return sendError(res, request, status, { spend: option(url, item, "spend") === "1", retryAfter: option(url, item, "retry_after") });
      }
      if (item?.name === null || item?.name === undefined || !SCRIPT_NAMES.includes(item.name)) {
        log("no-script", { req: request.seq, item: item?.raw ?? null, note: "nothing queued for this request; answered 500" });
        return sendError(res, request, 500);
      }
      return replay(res, request, item.name, { every: int(option(url, item, "every"), 0, 0, 60_000), ping: int(option(url, item, "ping"), 0, 0, 60_000) });
    }
    if (route.startsWith("/sse/v1/models/") && req.method === "GET") {
      const id = decodeURIComponent(route.slice("/sse/v1/models/".length));
      const status = int(url.searchParams.get("status") ?? modelsStatus, 200, 100, 599);
      const request = log("request", { method: req.method, path: req.url, model_id: id, ...telltales(req) });
      if (status !== 200) return sendError(res, request, status);
      const requestId = `req_probe_${String(request.seq).padStart(4, "0")}`;
      sendJson(res, 200, { type: "model", id, display_name: "Claude Opus 5", created_at: "2026-01-01T00:00:00Z" }, { "request-id": requestId });
      log("models-response", { req: request.seq, status: 200, request_id: requestId });
      return;
    }
  }

  log("request", { method: req.method, path: req.url, ...telltales(req), unrouted: true });
  return sendJson(res, 404, { ok: false, error: "no such probe route" });
}

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    log("server-error", { method: req.method, path: req.url, message: String(err?.message ?? err) });
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: "probe server error" });
    else res.end();
  });
});

server.on("error", (err) => {
  console.error(`probe-server: ${err.code === "EADDRINUSE" ? `port ${PORT} is already held; refusing to start` : err.message}`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  log("server-start", { host: HOST, port: PORT, pid: process.pid, log_file: LOG_FILE, scripts: SCRIPT_NAMES });
  console.log(`probe-server on http://${HOST}:${PORT}; log ${LOG_FILE}`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    log("server-stop", { signal });
    process.exit(0);
  });
}
