/**
 * createAskClient over the real SDK, with a fake fetch standing in for the native adapter.
 *
 * The options in client.ts matter only through what the SDK then does, so these tests watch the wire:
 * the key header and no bearer token even when the environment offers one, the production host even when
 * the environment names another, one request with no retry, and a buffered SSE body read to a final
 * message. No network: every response is scripted, and every stream comes from
 * test/fixtures/ask/streams.json.
 */
import Anthropic, { AuthenticationError, InternalServerError } from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type StreamEvent, toSse } from "../../../test/fixtures/ask/sse";
import streams from "../../../test/fixtures/ask/streams.json";
import { AskKeyMissingError, AskTransportError, createAskClient } from "./client";
import { ASK_MAX_TOKENS, ASK_MODEL, SDK_BACKSTOP_TIMEOUT_MS } from "./limits";

const KEY = "sk-ant-api03-client-test-key-DO_NOT_LEAK";

const PARAMS: Anthropic.MessageStreamParams = {
  model: ASK_MODEL,
  max_tokens: ASK_MAX_TOKENS,
  messages: [{ role: "user", content: "Cheapest business class from SEA to Tokyo in October?" }],
};

type ScriptName = Exclude<keyof typeof streams, `_${string}`>;
const script = (name: ScriptName) => streams[name] as unknown as StreamEvent[];

interface SentRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: RequestInit["body"];
}

/** A fetch that records each request and answers with a fresh response from `respond`. */
function recordingFetch(respond: () => Response) {
  const requests: SentRequest[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requests.push({ url, method: init.method ?? "GET", headers, body: init.body });
    return respond();
  }) as typeof fetch;
  return { fetchImpl, requests };
}

function sseResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "request-id": "req_synthetic_stream" } });
}

function jsonResponse(body: unknown, status: number, requestId: string): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "request-id": requestId } });
}

const signal = () => new AbortController().signal;

/** The tool input a script streams, joined from its input_json_delta fragments. */
function toolInputOf(events: readonly StreamEvent[]): string {
  return events
    .map((e) => (e.type === "content_block_delta" ? (e.delta as { type: string; partial_json?: string }) : null))
    .filter((delta) => delta?.type === "input_json_delta")
    .map((delta) => delta!.partial_json)
    .join("");
}

/** The text a script streams for one block index. */
function textOf(events: readonly StreamEvent[], index: number): string {
  return events
    .filter((e) => e.type === "content_block_delta" && e.index === index)
    .map((e) => (e.delta as { text?: string }).text ?? "")
    .join("");
}

beforeEach(() => {
  // The SDK folds ANTHROPIC_CUSTOM_HEADERS into every request with no option to turn it off
  // (client.js:117-127), so a developer's shell could add or replace headers these tests assert on.
  vi.stubEnv("ANTHROPIC_CUSTOM_HEADERS", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("createAskClient refuses a transport this app must not use", () => {
  it("refuses to build without an injected fetch, rather than let the SDK fall back to its default", () => {
    expect(() => createAskClient({ apiKey: KEY, fetch: undefined as unknown as typeof fetch })).toThrow(AskTransportError);
  });

  it("refuses the global fetch, which in the app is the WebView's", () => {
    expect(() => createAskClient({ apiKey: KEY, fetch: globalThis.fetch })).toThrow(
      "createAskClient needs the native adapter; the global fetch in this app is the WebView's.",
    );
  });

  it("refuses a missing or blank key before any request, rather than let the SDK fail at request time", () => {
    const { fetchImpl, requests } = recordingFetch(() => sseResponse(toSse(script("text"))));
    for (const apiKey of ["", "   "]) expect(() => createAskClient({ apiKey, fetch: fetchImpl })).toThrow(AskKeyMissingError);
    expect(requests).toHaveLength(0);
  });
});

describe("what send() puts on the wire", () => {
  it("sends the key as x-api-key with anthropic-version 2023-06-01, and no bearer token even when the environment has one", async () => {
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "env-bearer-token-that-must-not-be-sent");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-env-key-that-must-not-be-sent");
    const { fetchImpl, requests } = recordingFetch(() => sseResponse(toSse(script("text"))));

    await createAskClient({ apiKey: KEY, fetch: fetchImpl }).send(PARAMS, { signal: signal() });

    expect(requests).toHaveLength(1);
    const { headers } = requests[0]!;
    expect(headers["x-api-key"]).toBe(KEY);
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers).not.toHaveProperty("authorization");
    expect(JSON.stringify(requests)).not.toContain("must-not-be-sent");
  });

  it("POSTs the parameters as a JSON string with stream: true, the direct-access header and the 900 s backstop", async () => {
    const { fetchImpl, requests } = recordingFetch(() => sseResponse(toSse(script("text"))));

    await createAskClient({ apiKey: KEY, fetch: fetchImpl }).send(PARAMS, { signal: signal() });

    const req = requests[0]!;
    expect(req.method).toBe("POST");
    expect(req.headers["content-type"]).toBe("application/json");
    // A string body is what crosses CapacitorHttp unchanged (apps/ios/src/native/http.ts, NativeFetchInit).
    expect(typeof req.body).toBe("string");
    expect(JSON.parse(req.body as string)).toEqual({ ...PARAMS, stream: true });
    expect(req.headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(req.headers["x-stainless-timeout"]).toBe(String(SDK_BACKSTOP_TIMEOUT_MS / 1000));
  });

  it("goes to https://api.anthropic.com whatever ANTHROPIC_BASE_URL says, and to a passed baseURL as given", async () => {
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://decoy.example.test");
    const production = recordingFetch(() => sseResponse(toSse(script("text"))));
    await createAskClient({ apiKey: KEY, fetch: production.fetchImpl }).send(PARAMS, { signal: signal() });
    expect(production.requests.map((r) => r.url)).toEqual(["https://api.anthropic.com/v1/messages"]);

    // Only the probe build passes a baseURL, to reach its local probe server.
    const probe = recordingFetch(() => sseResponse(toSse(script("text"))));
    await createAskClient({ apiKey: KEY, fetch: probe.fetchImpl, baseURL: "http://127.0.0.1:4599/sse" }).send(PARAMS, { signal: signal() });
    expect(probe.requests.map((r) => r.url)).toEqual(["http://127.0.0.1:4599/sse/v1/messages"]);
  });

  it("sends exactly one request on a 529, because a retry could bill twice, and logs nothing even when ANTHROPIC_LOG asks", async () => {
    vi.stubEnv("ANTHROPIC_LOG", "debug");
    const consoleSpies = (["debug", "info", "log", "warn", "error"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
    const { fetchImpl, requests } = recordingFetch(() =>
      jsonResponse({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, 529, "req_synthetic_529"),
    );

    const sent = createAskClient({ apiKey: KEY, fetch: fetchImpl }).send(PARAMS, { signal: signal() });

    await expect(sent).rejects.toBeInstanceOf(InternalServerError);
    await expect(sent).rejects.toMatchObject({ status: 529, requestID: "req_synthetic_529" });
    expect(requests).toHaveLength(1);
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("reading a buffered stream", () => {
  it("parses a whole SSE body, pings included, into the final message with its tool input and usage", async () => {
    const events = script("tool_use_search");
    const body = toSse(events, { pingEvery: 2 });
    expect(body).toMatch(/^event: ping$/m);
    const { fetchImpl } = recordingFetch(() => sseResponse(body));

    const message = await createAskClient({ apiKey: KEY, fetch: fetchImpl }).send(PARAMS, { signal: signal() });

    expect(message.stop_reason).toBe("tool_use");
    expect(message.content.map((block) => block.type)).toEqual(["text", "tool_use"]);
    expect(message.content[0]).toEqual({ type: "text", text: textOf(events, 0), citations: null });
    const toolUse = message.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
    expect(toolUse).toMatchObject({ id: "toolu_synthetic_search_1", name: "search_awards" });
    expect(toolUse!.input).toEqual(JSON.parse(toolInputOf(events)));

    const start = events[0] as unknown as { message: { usage: { input_tokens: number } } };
    const finalDelta = events.findLast((e) => e.type === "message_delta") as unknown as { usage: { output_tokens: number } };
    expect(message.usage.input_tokens).toBe(start.message.usage.input_tokens);
    expect(message.usage.output_tokens).toBe(finalDelta.usage.output_tokens);
  });
});

describe("checkKey", () => {
  it("sends a GET to /v1/models/claude-opus-5 with the key and no body", async () => {
    const { fetchImpl, requests } = recordingFetch(() =>
      jsonResponse({ type: "model", id: ASK_MODEL, display_name: "Claude Opus 5", created_at: "2026-01-01T00:00:00Z" }, 200, "req_synthetic_model"),
    );

    await createAskClient({ apiKey: KEY, fetch: fetchImpl }).checkKey(ASK_MODEL);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: "GET", url: "https://api.anthropic.com/v1/models/claude-opus-5" });
    expect(requests[0]!.body ?? null).toBeNull();
    expect(requests[0]!.headers["x-api-key"]).toBe(KEY);
  });

  it("rejects with the SDK's AuthenticationError when Anthropic refuses the key", async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, 401, "req_synthetic_401"),
    );

    await expect(createAskClient({ apiKey: KEY, fetch: fetchImpl }).checkKey(ASK_MODEL)).rejects.toBeInstanceOf(AuthenticationError);
  });
});
