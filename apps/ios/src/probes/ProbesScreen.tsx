/**
 * Probe build only: the Phase 5 Simulator probes, run once on launch with no taps (design §10.2-§10.3).
 *
 * This file is in a bundle only when VITE_AG_PROBES=1. App.tsx imports it behind that constant and main.tsx opens
 * #/probes. apps/ios/probes/run-probes.sh builds that bundle, runs it against apps/ios/probes/probe-server.mjs,
 * restores the normal build and checks that it carries none of this (R1). Results are in docs/PHASE5.md §1.
 *
 * Every probe uses the production adapter (createNativeFetch) and the production client (createAskClient). The
 * Anthropic probes change only `baseURL`, except A1b, which has none: it reaches api.anthropic.com with a key
 * Anthropic rejects before any model runs, so nothing can be billed. Each result is posted to the probe server,
 * and the verdicts that depend on what arrived are decided from the server's own lines, not from this screen: an
 * app cannot certify its own networking (docs/PHASE0.md §2).
 *
 * Order: start (asks the server whether this launch is armed), A0, then only if armed: T1, T2, T2b, T3, T4, A1b,
 * A2, X1, "done", and T5, whose leaving and returning the host script performs.
 */
import { useEffect, useState } from "react";
import { type AskModel, createAskClient } from "@awardgrid/core/ask/client";
import { describeAskError, scrubSecrets } from "@awardgrid/core/ask/errors";
import { ANTHROPIC_IDLE_TIMEOUT_MS, ASK_MAX_TOKENS, ASK_MODEL } from "@awardgrid/core/ask/limits";
import { ASK_SYSTEM_PROMPT } from "@awardgrid/core/ask/prompt";
import { ASK_TOOLS } from "@awardgrid/core/ask/tools";
import streams from "@awardgrid/core/test-fixtures/ask/streams.json";
import { createNativeFetch } from "../native/http";
import { PROBE_SERVER, PROBE_SERVER_BY_NAME, SEATS_AERO_PREFIX, withSeatsMock } from "./probe-transport";

type Values = Record<string, unknown>;
type SendParams = Parameters<AskModel["send"]>[0];
type Message = Awaited<ReturnType<AskModel["send"]>>;
type ContentBlock = Message["content"][number];
type ToolUseBlock = Extract<ContentBlock, { type: "tool_use" }>;

interface ProbeResult {
  probe: string;
  /** null when the verdict needs the server's log (T2b), or for a progress marker. */
  pass: boolean | null;
  values: Values;
}

interface Row extends ProbeResult {
  via: string;
}

/**
 * Anthropic rejects this key before any model runs, so a request with it can be billed nothing. Its length, 27,
 * is what T2 checks in the server's log.
 */
const PROBE_KEY = "sk-ant-probe-invalid-000000";
const T2_QUESTION = "Cheapest business class from SEA to Tokyo (東京) in October?";
/** How long T5 waits for its request to settle, from the moment it is sent. */
const T5_WAIT_MS = 240_000;

/** The probe server this run reaches: 127.0.0.1, unless A0 finds only the name localhost reachable. */
let server = PROBE_SERVER;
/** One run per launch, whatever React does with the screen. */
let started = false;

const now = () => performance.now();
const since = (from: number) => Math.round((now() - from) * 10) / 10;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const scrub = (text: string) => scrubSecrets(text, [PROBE_KEY]).slice(0, 600);
const controlFetch = createNativeFetch();

function errorFacts(err: unknown): Values | null {
  if (err === null || err === undefined) return null;
  if (!(err instanceof Error)) return { thrown: scrub(String(err)) };
  const e = err as Error & { status?: unknown; requestID?: unknown; type?: unknown; code?: unknown; host?: unknown; cause?: unknown };
  const cause = e.cause instanceof Error ? { name: e.cause.name, message: scrub(e.cause.message), code: (e.cause as { code?: unknown }).code ?? null } : null;
  return {
    name: e.name,
    constructor: (Object.getPrototypeOf(e) as { constructor?: { name?: string } } | null)?.constructor?.name ?? null,
    message: scrub(e.message),
    status: e.status ?? null,
    request_id: e.requestID ?? null,
    type: e.type ?? null,
    code: e.code ?? null,
    host: e.host ?? null,
    cause,
  };
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Key-order-independent JSON, for "the tool input equals the fixture". */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

const SCRIPTS = streams as unknown as Record<string, ReadonlyArray<Record<string, unknown>>>;

/** The tool input a script streams, joined from its input_json_delta parts. */
function fixtureToolInput(script: string): unknown {
  let json = "";
  for (const event of SCRIPTS[script] ?? []) {
    const delta = event.delta as { type?: string; partial_json?: string } | undefined;
    if (event.type === "content_block_delta" && delta?.type === "input_json_delta") json += delta.partial_json ?? "";
  }
  return JSON.parse(json);
}

/** usage.output_tokens of a script's last message_delta, which is cumulative. */
function fixtureOutputTokens(script: string): number | null {
  let tokens: number | null = null;
  for (const event of SCRIPTS[script] ?? []) {
    if (event.type === "message_delta") tokens = (event.usage as { output_tokens?: number } | undefined)?.output_tokens ?? tokens;
  }
  return tokens;
}

function params(question: string): SendParams {
  return { model: ASK_MODEL, max_tokens: ASK_MAX_TOKENS, system: ASK_SYSTEM_PROMPT, tools: ASK_TOOLS, messages: [{ role: "user", content: question }] };
}

/** A probe client: production factory, production adapter at Anthropic's idle timeout, the probe server as baseURL. */
function probeClient(fetchImpl: typeof fetch = createNativeFetch({ timeoutMs: ANTHROPIC_IDLE_TIMEOUT_MS })): AskModel {
  return createAskClient({ apiKey: PROBE_KEY, fetch: fetchImpl, baseURL: `${server}/sse` });
}

/** Replace the probe server's queue. Sent over the native adapter, which needs no CORS. */
async function resetQueue(query: Record<string, string>): Promise<void> {
  const res = await controlFetch(`${server}/reset?${new URLSearchParams(query).toString()}`, { method: "POST" });
  if (!res.ok) throw new Error(`POST /reset answered ${res.status}: ${await res.text()}`);
}

/** Post one result: through the WebView's fetch (the CORS-enabled /log), or the native adapter if that fails. */
async function report(result: ProbeResult): Promise<{ via: string; reply: Values | null }> {
  const init: RequestInit = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...result, at: new Date().toISOString() }) };
  const bases = server === PROBE_SERVER ? [PROBE_SERVER, PROBE_SERVER_BY_NAME] : [server, PROBE_SERVER];
  for (const base of bases) {
    try {
      const res = await fetch(`${base}/log`, init);
      if (res.ok) return { via: "webview", reply: (await res.json()) as Values };
    } catch {
      // Try the native adapter next.
    }
    try {
      const res = await controlFetch(`${base}/log`, init);
      if (res.ok) return { via: "native", reply: (await res.json()) as Values };
    } catch {
      // Try the next base.
    }
  }
  return { via: "unsent", reply: null };
}

// ---- The probes ----

async function probeA0(): Promise<ProbeResult> {
  const nativeFetch = createNativeFetch();
  const values: Values = {};
  for (const [label, base] of [
    ["ip", PROBE_SERVER],
    ["localhost", PROBE_SERVER_BY_NAME],
  ] as const) {
    const t = now();
    try {
      const res = await nativeFetch(`${base}/log?probe=A0&host=${label}`);
      const text = await res.text();
      values[label] = { url: `${base}/log`, ok: res.ok, status: res.status, bytes: text.length, ms: since(t) };
    } catch (err) {
      const facts = errorFacts(err);
      values[label] = { url: `${base}/log`, ok: false, ms: since(t), error: facts, ats: /App Transport Security/i.test(JSON.stringify(facts)) };
    }
  }
  const ok = (v: unknown) => (v as { ok?: boolean }).ok === true;
  if (!ok(values.ip) && ok(values.localhost)) server = PROBE_SERVER_BY_NAME;
  values.server_used_next = server;
  return { probe: "A0", pass: ok(values.ip) && ok(values.localhost), values };
}

async function probeT1(): Promise<ProbeResult> {
  const nativeFetch = createNativeFetch({ timeoutMs: 5000 });
  const t = now();
  let drip: Values;
  try {
    const res = await nativeFetch(`${server}/drip?chunks=10&every=2000&bytes=1024&probe=T1`);
    const text = await res.text();
    drip = { ok: true, status: res.status, bytes: new TextEncoder().encode(text).length, ms: since(t) };
  } catch (err) {
    drip = { ok: false, ms: since(t), error: errorFacts(err) };
  }
  const c = now();
  let control: Values;
  try {
    const res = await nativeFetch(`${server}/slow?ms=20000&probe=T1`);
    control = { ok: true, status: res.status, ms: since(c) };
  } catch (err) {
    control = { ok: false, ms: since(c), error: errorFacts(err) };
  }
  return { probe: "T1", pass: drip.ok === true && drip.bytes === 10_240 && control.ok === false, values: { timeout_ms: 5000, drip, control } };
}

async function probeT2(seen: { body: string | null }): Promise<ProbeResult> {
  await resetQueue({ script: "tool_use_search:every=1000:ping=1000", label: "T2" });
  const inner = createNativeFetch({ timeoutMs: ANTHROPIC_IDLE_TIMEOUT_MS });
  const hashed = { sha256: null as string | null, bodyType: "none", utf8Bytes: null as number | null };
  // Hash exactly what the SDK hands the adapter, before the adapter sees it.
  const hashing = (async (input: RequestInfo | URL, init?: RequestInit) => {
    hashed.bodyType = typeof init?.body;
    if (typeof init?.body === "string") {
      seen.body = init.body;
      hashed.sha256 = await sha256Hex(init.body);
      hashed.utf8Bytes = new TextEncoder().encode(init.body).length;
    }
    return inner(input, init);
  }) as typeof fetch;
  const t = now();
  try {
    const message = await probeClient(hashing).send(params(T2_QUESTION), { signal: new AbortController().signal });
    const tool = message.content.find((block): block is ToolUseBlock => block.type === "tool_use");
    const expectedInput = fixtureToolInput("tool_use_search");
    const expectedTokens = fixtureOutputTokens("tool_use_search");
    const inputMatches = tool !== undefined && canonical(tool.input) === canonical(expectedInput);
    return {
      probe: "T2",
      pass: message.stop_reason === "tool_use" && inputMatches && message.usage.output_tokens === expectedTokens,
      values: {
        ms: since(t),
        stop_reason: message.stop_reason,
        tool_name: tool?.name ?? null,
        tool_input: tool?.input ?? null,
        tool_input_equals_fixture: inputMatches,
        output_tokens: message.usage.output_tokens,
        fixture_output_tokens: expectedTokens,
        js_body_sha256: hashed.sha256,
        js_body_utf8_bytes: hashed.utf8Bytes,
        js_body_type: hashed.bodyType,
        secure_context: window.isSecureContext,
      },
    };
  } catch (err) {
    return { probe: "T2", pass: false, values: { ms: since(t), error: errorFacts(err), js_body_sha256: hashed.sha256, js_body_type: hashed.bodyType } };
  }
}

async function probeT2b(body: string | null): Promise<ProbeResult> {
  await resetQueue({ script: "text", label: "T2b" });
  const t = now();
  try {
    const res = await fetch(`${server}/sse/v1/messages?probe=T2b`, { method: "POST", headers: { "content-type": "application/json" }, body: body ?? "{}" });
    return { probe: "T2b", pass: null, values: { ms: since(t), settled: "resolved", status: res.status, body_is_t2_body: body !== null } };
  } catch (err) {
    return { probe: "T2b", pass: null, values: { ms: since(t), settled: "rejected", error: errorFacts(err), body_is_t2_body: body !== null } };
  } finally {
    await resetQueue({}).catch(() => undefined);
  }
}

async function probeT3(): Promise<ProbeResult> {
  await resetQueue({ script: "overloaded_mid:every=250", label: "T3" });
  const t = now();
  try {
    const message = await probeClient().send(params("Which program has the cheapest seats in this search?"), { signal: new AbortController().signal });
    return { probe: "T3", pass: false, values: { ms: since(t), settled: "resolved", stop_reason: message.stop_reason } };
  } catch (err) {
    const elapsedMs = since(t);
    const failure = describeAskError(err, { elapsedMs, hidden: false, secrets: [PROBE_KEY] });
    const facts = errorFacts(err);
    return {
      probe: "T3",
      pass: failure.code === "overloaded_mid_answer" && facts?.type === "overloaded_error",
      values: { ms: elapsedMs, error: facts, code: failure.code, retryable: failure.retryable, message: failure.message, request_id: failure.requestId },
    };
  }
}

async function probeT4(): Promise<ProbeResult> {
  // `text` has 8 events; 7 gaps of 857 ms end the replay at about 6,000 ms.
  await resetQueue({ script: "text:every=857", label: "T4" });
  const controller = new AbortController();
  const t = now();
  const settled = probeClient()
    .send(params("Which program has the cheapest seats in this search?"), { signal: controller.signal })
    .then(
      () => ({ outcome: "resolved", at: now(), err: null as unknown }),
      (err: unknown) => ({ outcome: "rejected", at: now(), err }),
    );
  await delay(800);
  const abortAt = now();
  // The loop aborts with this reason when the person taps Stop (design §2.4).
  controller.abort("stop");
  const result = await settled;
  const afterAbort = Math.round((result.at - abortAt) * 10) / 10;
  const values: Values = {
    abort_at_ms: Math.round((abortAt - t) * 10) / 10,
    settled: result.outcome,
    settled_after_abort_ms: afterAbort,
    error: errorFacts(result.err),
    // The reason read back from the signal, as loop.ts does, so "stopped" is the classification of what the abort left.
    code: result.err === null ? null : describeAskError(result.err, { reason: controller.signal.reason, elapsedMs: since(t), hidden: false, secrets: [PROBE_KEY] }).code,
  };
  // Let the replay the server is still sending end before the next probe, so its verdict is in the log first.
  await delay(Math.max(0, t + 6_600 - now()));
  return { probe: "T4", pass: result.outcome === "rejected" && afterAbort >= 0 && afterAbort <= 50, values };
}

/** Response headers whose values are recorded; every other header is recorded by name only. */
const HEADER_VALUES = new Set(["request-id", "content-type", "content-length", "server", "via", "x-should-retry", "cf-ray", "cf-cache-status"]);

/** Records what the production adapter handed back (status, header names, a few values), and passes the response on untouched. */
function recordingFetch(inner: typeof fetch, into: Values[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await inner(input, init);
    const names: string[] = [];
    const values: Record<string, string> = {};
    res.headers.forEach((value, name) => {
      names.push(name);
      if (HEADER_VALUES.has(name)) values[name] = value;
    });
    into.push({ url: String(input), status: res.status, header_names: names.sort(), header_values: values });
    return res;
  }) as typeof fetch;
}

async function probeA1b(): Promise<ProbeResult> {
  // Two controls from the probe server first: the error classes the SDK builds for a 401 and for a 529. lint keeps the
  // SDK out of apps/ios/src and a minifier renames classes, so A1b's class is named by comparison with these.
  await resetQueue({ models: "401", label: "A1b-control" });
  const controlResponses: Values[] = [];
  const control401 = await probeClient(recordingFetch(createNativeFetch({ timeoutMs: ANTHROPIC_IDLE_TIMEOUT_MS }), controlResponses))
    .checkKey(ASK_MODEL)
    .then(
      () => null,
      (err: unknown) => err,
    );
  await resetQueue({ script: "status=529", label: "A1b-control" });
  const control529 = await probeClient()
    .send(params("control"), { signal: new AbortController().signal })
    .then(
      () => null,
      (err: unknown) => err,
    );
  await resetQueue({});

  // No baseURL: https://api.anthropic.com, over the production adapter, with the rejected key.
  const responses: Values[] = [];
  const client = createAskClient({ apiKey: PROBE_KEY, fetch: recordingFetch(createNativeFetch({ timeoutMs: ANTHROPIC_IDLE_TIMEOUT_MS }), responses) });
  const t = now();
  try {
    const message = await client.send({ model: ASK_MODEL, max_tokens: 16, messages: [{ role: "user", content: "Hello" }] }, { signal: new AbortController().signal });
    return { probe: "A1b", pass: false, values: { ms: since(t), settled: "resolved", stop_reason: message.stop_reason, responses } };
  } catch (err) {
    const elapsedMs = since(t);
    const e = err as { status?: unknown; requestID?: unknown; error?: unknown };
    const prototype = Object.getPrototypeOf(err) as unknown;
    const sameAs401 = control401 !== null && prototype === Object.getPrototypeOf(control401);
    const sameAs529 = control529 !== null && prototype === Object.getPrototypeOf(control529);
    const failure = describeAskError(err, { elapsedMs, hidden: false, secrets: [PROBE_KEY] });
    return {
      probe: "A1b",
      pass: e.status === 401 && typeof e.requestID === "string" && e.requestID.length > 0 && sameAs401 && !sameAs529,
      values: {
        ms: elapsedMs,
        error: errorFacts(err),
        anthropic_body: e.error ?? null,
        code: failure.code,
        same_class_as_probe_401: sameAs401,
        same_class_as_probe_529: sameAs529,
        responses,
        control_401_responses: controlResponses,
        control_401: errorFacts(control401),
        control_529: errorFacts(control529),
      },
    };
  }
}

async function probeA2(): Promise<ProbeResult> {
  const values: Values = {};
  let pass = true;
  for (const [label, url] of [
    ["anthropic", "https://api.anthropic.com/v1/models"],
    ["seats", "https://seats.aero/partnerapi/routes?source=united"],
  ] as const) {
    const t = now();
    try {
      const res = await fetch(url);
      values[label] = { url, settled: "resolved", status: res.status, ms: since(t) };
      pass = false;
    } catch (err) {
      values[label] = { url, settled: "rejected", ms: since(t), error: errorFacts(err) };
      if (!(err instanceof Error) || err.name !== "NativeHttpRequiredError") pass = false;
    }
  }
  return { probe: "A2", pass, values };
}

/** A harness check for step 7, not a design probe: the probe build's seats.aero rewrite reaches the mock. */
async function probeX1(): Promise<ProbeResult> {
  const seats = withSeatsMock(createNativeFetch());
  const t = now();
  try {
    const res = await seats(`${SEATS_AERO_PREFIX}routes?source=united`, { headers: { "Partner-Authorization": "demo-key-normal", accept: "application/json" } });
    const text = await res.text();
    const remaining = res.headers.get("x-ratelimit-remaining");
    return { probe: "X1", pass: res.status === 200 && remaining === "812", values: { ms: since(t), status: res.status, x_ratelimit_remaining: remaining, bytes: text.length } };
  } catch (err) {
    return { probe: "X1", pass: false, values: { ms: since(t), error: errorFacts(err) } };
  }
}

async function probeT5(): Promise<ProbeResult> {
  const nativeFetch = createNativeFetch({ timeoutMs: ANTHROPIC_IDLE_TIMEOUT_MS });
  const t = now();
  const visibility: Values[] = [];
  const onVisibility = () => visibility.push({ state: document.visibilityState, at_ms: since(t) });
  document.addEventListener("visibilitychange", onVisibility);
  let settles = 0;
  const outcomes: Values[] = [];
  const request = nativeFetch(`${server}/drip?chunks=60&every=1000&bytes=1024&probe=T5`).then(
    async (res) => {
      settles += 1;
      const text = await res.text();
      outcomes.push({ outcome: "resolved", status: res.status, bytes: new TextEncoder().encode(text).length, at_ms: since(t), visibility: document.visibilityState });
    },
    (err: unknown) => {
      settles += 1;
      outcomes.push({ outcome: "rejected", error: errorFacts(err), at_ms: since(t), visibility: document.visibilityState });
    },
  );
  const first = await Promise.race([request.then(() => "settled" as const), delay(T5_WAIT_MS).then(() => "gave_up" as const)]);
  // Keep watching a little, so a second outcome would be recorded if one ever arrived.
  await delay(5_000);
  document.removeEventListener("visibilitychange", onVisibility);
  return {
    probe: "T5",
    pass: first === "settled" && settles === 1 && outcomes.length === 1,
    values: { timeout_ms: ANTHROPIC_IDLE_TIMEOUT_MS, waited: first, settle_count: settles, outcomes, visibility },
  };
}

/** A probe that throws is a FAIL with its error, never the end of the run. */
async function guarded(probe: string, run: () => Promise<ProbeResult>): Promise<ProbeResult> {
  try {
    return await run();
  } catch (err) {
    return { probe, pass: false, values: { harness_error: errorFacts(err) } };
  }
}

async function runProbes(onRow: (row: Row) => void): Promise<void> {
  const emit = async (result: ProbeResult) => {
    const { via, reply } = await report(result);
    onRow({ ...result, via });
    return reply;
  };
  const hello = await emit({
    probe: "start",
    pass: null,
    values: { user_agent: navigator.userAgent, secure_context: window.isSecureContext, visibility: document.visibilityState, href: location.href },
  });
  await emit(await guarded("A0", probeA0));
  if (hello?.armed !== true) {
    // Not armed by run-probes.sh for this launch (or the server was unreachable): nothing else is sent, A1b included.
    onRow({ probe: "not armed", pass: null, values: { reply: hello }, via: "screen" });
    return;
  }
  await emit(await guarded("T1", probeT1));
  const seen = { body: null as string | null };
  await emit(await guarded("T2", () => probeT2(seen)));
  await emit(await guarded("T2b", () => probeT2b(seen.body)));
  await emit(await guarded("T3", probeT3));
  await emit(await guarded("T4", probeT4));
  await emit(await guarded("A1b", probeA1b));
  await emit(await guarded("A2", probeA2));
  await emit(await guarded("X1", probeX1));
  await emit({ probe: "done", pass: null, values: { server } });
  await emit({ probe: "t5_ready", pass: null, values: { visibility: document.visibilityState } });
  await emit(await guarded("T5", probeT5));
  await emit({ probe: "t5_done", pass: null, values: {} });
}

export function ProbesScreen() {
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState("Running probes.");

  useEffect(() => {
    if (started) return;
    started = true;
    void runProbes((row) => setRows((current) => [...current, row])).then(
      () => setStatus("Probes finished."),
      (err: unknown) => setStatus(`Probes stopped: ${String(err)}`),
    );
  }, []);

  return (
    <section aria-label="Probes">
      <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>Probes</h1>
      <p style={{ color: "var(--fg-muted)", margin: "0 0 12px" }}>{status}</p>
      <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 8 }}>
        {rows.map((row, i) => (
          <li key={i}>
            <strong>{row.probe}</strong> {row.pass === null ? "" : row.pass ? "PASS" : "FAIL"} ({row.via})
            <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 11, margin: "4px 0 0" }}>{JSON.stringify(row.values).slice(0, 400)}</pre>
          </li>
        ))}
      </ol>
    </section>
  );
}
