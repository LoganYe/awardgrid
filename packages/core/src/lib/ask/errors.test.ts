/**
 * describeAskError over errors the real SDK produces, from scripted responses and rejections.
 *
 * Each case builds its error the way the app will, by running createAskClient's send() against a fake
 * fetch, so no classification can pass against an error shape the SDK never makes. The copy is pinned
 * verbatim. It is what a person reads when money may already have been spent, and a paraphrase that
 * drifted toward "timed out" or "nothing was billed" would claim something the app never observed.
 * No network and no clock: elapsed time arrives through the context, as the loop passes it.
 */
import Anthropic, { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { type StreamEvent, toSse } from "../../../test/fixtures/ask/sse";
import streams from "../../../test/fixtures/ask/streams.json";
import { createAskClient } from "./client";
import { type AskErrorContext, askRequestIdLine, describeAskError, scrubSecrets } from "./errors";
import { ASK_MAX_TOKENS, ASK_MODEL } from "./limits";

const ANTHROPIC_KEY = "sk-ant-api03-errors-test-key-DO_NOT_LEAK";
const SEATS_KEY = "pro_seats_key_for_errors_tests_SECRET";

const PARAMS: Anthropic.MessageStreamParams = {
  model: ASK_MODEL,
  max_tokens: ASK_MAX_TOKENS,
  messages: [{ role: "user", content: "Cheapest business class from SEA to Tokyo in October?" }],
};

type ScriptName = Exclude<keyof typeof streams, `_${string}`>;
const script = (name: ScriptName) => streams[name] as unknown as StreamEvent[];

function ctx(over: Partial<AskErrorContext> = {}): AskErrorContext {
  return { elapsedMs: 12_000, hidden: false, secrets: [SEATS_KEY, ANTHROPIC_KEY], ...over };
}

/** Run send() against `respond` and return what it rejected with. */
async function sendError(
  respond: (init: RequestInit) => Response | Promise<Response>,
  signal: AbortSignal = new AbortController().signal,
): Promise<unknown> {
  const fetchImpl = (async (_input: RequestInfo | URL, init: RequestInit = {}) => respond(init)) as typeof fetch;
  try {
    await createAskClient({ apiKey: ANTHROPIC_KEY, fetch: fetchImpl }).send(PARAMS, { signal });
  } catch (err) {
    return err;
  }
  throw new Error("send() resolved, but the scripted response should have failed it");
}

/** An Anthropic error response: the documented body (claude-api shared/error-codes.md) and a request-id header. */
function errorResponse(status: number, error: Record<string, unknown>, headers: Record<string, string> = {}): Response {
  const requestId = `req_synthetic_${status}`;
  return new Response(JSON.stringify({ type: "error", error, request_id: requestId }), {
    status,
    headers: { "content-type": "application/json", "request-id": requestId, ...headers },
  });
}

function streamResponse(events: readonly StreamEvent[]): Response {
  return new Response(toSse(events, { pingEvery: 1 }), {
    status: 200,
    headers: { "content-type": "text/event-stream", "request-id": "req_synthetic_stream" },
  });
}

/**
 * What the WebView receives when URLSession fails: a CapacitorException, which is an Error carrying the
 * localizedDescription as its message (@capacitor/ios native-bridge.js:951-974).
 */
function nativeRejection(localizedDescription: string): Error {
  return Object.assign(new Error(localizedDescription), { code: "NSURLErrorDomain" });
}

/** The shell's adapter errors, stood in for by name, because core cannot import apps/ios. */
function namedError(name: string, message: string): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

describe("an HTTP error from Anthropic maps to its code and copy", () => {
  it.each([
    {
      status: 400,
      type: "invalid_request_error",
      said: 'messages: roles must alternate between "user" and "assistant"',
      code: "bad_request",
      retryable: false,
      message: 'Anthropic could not accept the request (400): messages: roles must alternate between "user" and "assistant"',
    },
    {
      status: 401,
      type: "authentication_error",
      said: "invalid x-api-key",
      code: "anthropic_key_rejected",
      retryable: false,
      message: "Anthropic rejected your API key. Check it in Settings.",
    },
    {
      status: 403,
      type: "permission_error",
      said: "Your API key does not have permission to use the specified resource.",
      code: "anthropic_forbidden",
      retryable: false,
      message: "Anthropic refused the request (permission_error): Your API key does not have permission to use the specified resource.",
    },
    {
      status: 404,
      type: "not_found_error",
      said: "model: claude-opus-5",
      code: "model_unavailable",
      retryable: false,
      message: "Anthropic says this key cannot use Claude Opus 5.",
    },
    {
      status: 413,
      type: "request_too_large",
      said: "Request exceeds the maximum allowed number of bytes.",
      code: "too_large",
      retryable: false,
      message: "This conversation is too large to send. Start a new conversation.",
    },
    {
      status: 429,
      type: "rate_limit_error",
      said: "Number of request tokens has exceeded your per-minute rate limit.",
      code: "rate_limited",
      retryable: true,
      message: "Anthropic's rate limit for your key was reached: Number of request tokens has exceeded your per-minute rate limit.",
    },
    {
      status: 500,
      type: "api_error",
      said: "Internal server error",
      code: "anthropic_error",
      retryable: true,
      message: "Anthropic returned an error (500): Internal server error",
    },
    {
      status: 529,
      type: "overloaded_error",
      said: "Overloaded",
      code: "overloaded",
      retryable: true,
      message: "Anthropic is overloaded and did not answer.",
    },
  ])("$status $type → $code", async ({ status, type, said, code, retryable, message }) => {
    const err = await sendError(() => errorResponse(status, { type, message: said }));
    expect(describeAskError(err, ctx())).toEqual({ code, retryable, message, requestId: `req_synthetic_${status}` });
  });

  it("any other 4xx is a request that resending cannot fix, named by its own status", async () => {
    const err = await sendError(() => errorResponse(422, { type: "invalid_request_error", message: "Unprocessable." }));
    expect(describeAskError(err, ctx())).toEqual({
      code: "bad_request",
      retryable: false,
      message: "Anthropic could not accept the request (422): Unprocessable.",
      requestId: "req_synthetic_422",
    });
  });
});

describe("429: a spend limit is not a rate limit", () => {
  it("names the spend limit when error.details.error_code says so, and offers no Try again", async () => {
    const err = await sendError(() =>
      errorResponse(429, {
        type: "rate_limit_error",
        message: "This organization has reached its spend limit.",
        details: { error_code: "enforced_spend_limit_reached" },
      }),
    );
    expect(describeAskError(err, ctx())).toEqual({
      code: "spend_limit",
      retryable: false,
      message: "Anthropic refused the request because your organization reached its spend limit: This organization has reached its spend limit.",
      requestId: "req_synthetic_429",
    });
  });

  it("reads retry-after into the rate-limit copy when the header is present", async () => {
    const seven = await sendError(() => errorResponse(429, { type: "rate_limit_error", message: "Slow down" }, { "retry-after": "7" }));
    expect(describeAskError(seven, ctx())).toMatchObject({
      code: "rate_limited",
      retryable: true,
      message: "Anthropic's rate limit for your key was reached: Slow down. Anthropic asks to wait 7 seconds before trying again.",
    });

    const one = await sendError(() => errorResponse(429, { type: "rate_limit_error", message: "Slow down." }, { "retry-after": "1" }));
    expect(describeAskError(one, ctx()).message).toBe(
      "Anthropic's rate limit for your key was reached: Slow down. Anthropic asks to wait 1 second before trying again.",
    );
  });

  it("leaves the wait out for a date-form retry-after, and reads unfamiliar details as an ordinary rate limit", async () => {
    const err = await sendError(() =>
      errorResponse(
        429,
        { type: "rate_limit_error", message: "Slow down.", details: { error_code: "something_else" } },
        { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" },
      ),
    );
    expect(describeAskError(err, ctx())).toMatchObject({ code: "rate_limited", message: "Anthropic's rate limit for your key was reached: Slow down." });
  });
});

describe("an error event inside a 200 stream", () => {
  it("overloaded_error partway through is overloaded_mid_answer, with the stream's request ID", async () => {
    const err = await sendError(() => streamResponse(script("overloaded_mid")));
    expect(err).toBeInstanceOf(APIError);
    expect(describeAskError(err, ctx())).toEqual({
      code: "overloaded_mid_answer",
      retryable: true,
      message: "Anthropic became overloaded partway through the answer. What Claude had already generated may still be billed.",
      requestId: "req_synthetic_stream",
    });
  });

  it("api_error partway through is anthropic_error, named by its type", async () => {
    const events = script("overloaded_mid").map((e) =>
      e.type === "error" ? { type: "error", error: { type: "api_error", message: "Internal server error" } } : e,
    );
    const err = await sendError(() => streamResponse(events));
    expect(describeAskError(err, ctx())).toEqual({
      code: "anthropic_error",
      retryable: true,
      message: "Anthropic returned an error (api_error): Internal server error",
      requestId: "req_synthetic_stream",
    });
  });
});

describe("the loop's own aborts are named by the reason it gave", () => {
  /** Send, wait until the request is out, then abort with `reason`, as Stop or the 450 s timer does. */
  async function abortedWith(reason: string) {
    const controller = new AbortController();
    let markSent!: () => void;
    const requestOut = new Promise<void>((resolve) => {
      markSent = resolve;
    });
    const pending = sendError(
      (init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(namedError("AbortError", "The operation was aborted.")));
          markSent();
        }),
      controller.signal,
    );
    await requestOut;
    controller.abort(reason);
    return { err: await pending, reason: controller.signal.reason as unknown };
  }

  it("Stop → stopped, which says the request already sent still finishes and may be billed", async () => {
    const { err, reason } = await abortedWith("stop");
    expect(err).toBeInstanceOf(APIUserAbortError);
    expect(describeAskError(err, ctx({ reason }))).toEqual({
      code: "stopped",
      retryable: false,
      message: "Stopped. Nothing more will be sent for this question. The request already sent to Anthropic still finishes and may be billed.",
      requestId: null,
    });
  });

  it("the 450 s bound → request_limit, stated in minutes and never as a connection timeout", async () => {
    const { err, reason } = await abortedWith("request_limit");
    expect(err).toBeInstanceOf(APIUserAbortError);
    expect(describeAskError(err, ctx({ reason, elapsedMs: 450_000 }))).toEqual({
      code: "request_limit",
      retryable: true,
      message:
        "Stopped waiting for Anthropic after 7.5 minutes, the most one request may take. The request may still have been processed and billed to your key.",
      requestId: null,
    });
  });

  it("the reason wins over whatever the rejection looks like", () => {
    expect(describeAskError(new APIConnectionError({ message: "Connection error." }), ctx({ reason: "stop" })).code).toBe("stopped");
  });
});

describe("a native failure quotes the OS and the measured seconds", () => {
  it("connection_failed carries the elapsed seconds and the OS message verbatim", async () => {
    const err = await sendError(() => Promise.reject(nativeRejection("The network connection was lost.")));
    expect(err).toBeInstanceOf(APIConnectionError);
    expect(describeAskError(err, ctx({ elapsedMs: 31_400 }))).toEqual({
      code: "connection_failed",
      retryable: true,
      message:
        "The connection to Anthropic failed after 31 seconds: The network connection was lost. The request may still have been processed and billed to your key.",
      requestId: null,
    });
  });

  it("connection_failed_left_app when awardgrid was hidden while the request was out", async () => {
    const err = await sendError(() => Promise.reject(nativeRejection("The network connection was lost.")));
    expect(describeAskError(err, ctx({ hidden: true }))).toEqual({
      code: "connection_failed_left_app",
      retryable: true,
      message:
        "The request to Anthropic was interrupted after you left awardgrid: The network connection was lost. It may still have been processed and billed to your key.",
      requestId: null,
    });
  });

  it("a timeout in another language is quoted as the OS wrote it, because the SDK's timeout check only reads English", async () => {
    const err = await sendError(() => Promise.reject(nativeRejection("Zeitüberschreitung bei der Anforderung.")));
    expect(err).toBeInstanceOf(APIConnectionError);
    expect(err).not.toBeInstanceOf(APIConnectionTimeoutError);
    expect(describeAskError(err, ctx({ elapsedMs: 90_200 })).message).toBe(
      "The connection to Anthropic failed after 90 seconds: Zeitüberschreitung bei der Anforderung. The request may still have been processed and billed to your key.",
    );
  });

  it("an English OS timeout arrives as the SDK's own sentence, because the SDK discards the native error (client.js:568-569)", async () => {
    const err = await sendError(() => Promise.reject(nativeRejection("The request timed out.")));
    expect(err).toBeInstanceOf(APIConnectionTimeoutError);
    expect(describeAskError(err, ctx({ elapsedMs: 1_000 })).message).toBe(
      "The connection to Anthropic failed after 1 second: Request timed out. The request may still have been processed and billed to your key.",
    );
  });

  it("quoted words without closing punctuation still end their sentence", async () => {
    const err = await sendError(() => Promise.reject(nativeRejection("Could not connect to the server")));
    expect(describeAskError(err, ctx({ elapsedMs: 2_000 })).message).toBe(
      "The connection to Anthropic failed after 2 seconds: Could not connect to the server. The request may still have been processed and billed to your key.",
    );
  });
});

describe("a build that cannot make native requests is a wiring bug, not an outage", () => {
  const WIRING = {
    code: "wiring",
    retryable: false,
    message: "Ask cannot reach Anthropic from this build: native HTTP is not available. This is a wiring bug, not an outage.",
    requestId: null,
  };

  it.each(["NativeHttpUnavailableError", "NativeHttpRequiredError"])("%s thrown by the transport", async (name) => {
    const err = await sendError(() => {
      throw namedError(name, "CapacitorHttp is not registered on the native side.");
    });
    expect(describeAskError(err, ctx())).toEqual(WIRING);
  });

  it("AskTransportError from createAskClient", () => {
    let err: unknown;
    try {
      createAskClient({ apiKey: ANTHROPIC_KEY, fetch: globalThis.fetch });
    } catch (e) {
      err = e;
    }
    expect(describeAskError(err, ctx())).toEqual(WIRING);
  });
});

describe("secrets, length and the request ID", () => {
  it("masks both keys in Anthropic's words and in the OS's", async () => {
    const http = await sendError(() =>
      errorResponse(400, { type: "invalid_request_error", message: `messages.0.content: found ${ANTHROPIC_KEY} and ${SEATS_KEY}` }),
    );
    const native = await sendError(() => Promise.reject(nativeRejection(`Could not load https://seats.aero/partnerapi/search?key=${SEATS_KEY}`)));
    for (const failure of [describeAskError(http, ctx()), describeAskError(native, ctx())]) {
      expect(failure.message).not.toContain(ANTHROPIC_KEY);
      expect(failure.message).not.toContain(SEATS_KEY);
      expect(failure.message).toContain("••••");
    }
  });

  it("caps quoted text at 300 characters after masking, so the cut never leaves part of a key", async () => {
    // Without masking first, the cut would land 9 characters into the key and show "sk-ant-ap".
    const long = `${"x".repeat(290)}${ANTHROPIC_KEY}${"y".repeat(2_000)}`;
    const err = await sendError(() => errorResponse(400, { type: "invalid_request_error", message: long }));
    const { message } = describeAskError(err, ctx());
    const prefix = "Anthropic could not accept the request (400): ";
    expect(message.startsWith(prefix)).toBe(true);
    expect(message.length - prefix.length).toBeLessThanOrEqual(300);
    expect(message).not.toContain(ANTHROPIC_KEY.slice(0, 6));
  });

  it("keeps the request ID for the line shown under the failure", async () => {
    const err = await sendError(() => errorResponse(500, { type: "api_error", message: "Internal server error" }));
    const { requestId } = describeAskError(err, ctx());
    expect(requestId).toBe("req_synthetic_500");
    expect(askRequestIdLine(requestId!)).toBe("Anthropic request ID: req_synthetic_500");
  });
});

describe("failures that are not a failed connection are not described as one", () => {
  it("a missing key refused by createAskClient says so, and nothing about billing, because nothing was sent", () => {
    let err: unknown;
    try {
      createAskClient({ apiKey: "  ", fetch: (async () => new Response("")) as typeof fetch });
    } catch (e) {
      err = e;
    }
    expect(describeAskError(err, ctx())).toEqual({
      code: "anthropic_key_missing",
      retryable: false,
      message: "Ask has no Anthropic API key to send. Add one in Settings.",
      requestId: null,
    });
  });

  it("an empty 200 is a response that could not be read, not a failed connection", async () => {
    const err = await sendError(() => new Response("", { status: 200, headers: { "content-type": "text/event-stream" } }));
    const failure = describeAskError(err, ctx());
    expect(failure).toMatchObject({ code: "unreadable_response", retryable: true, requestId: null });
    expect(failure.message).toMatch(/^Anthropic's response could not be read: .+ The request may still have been processed and billed to your key\.$/);
  });

  it("an event whose data is not JSON is a response that could not be read", async () => {
    const err = await sendError(() => new Response("event: message_start\ndata: {not json\n\n", { status: 200, headers: { "content-type": "text/event-stream" } }));
    expect(describeAskError(err, ctx()).code).toBe("unreadable_response");
  });

  it("an abort that arrives without the loop's reason is still a stop", async () => {
    const controller = new AbortController();
    const pending = sendError(
      (init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(namedError("AbortError", "The operation was aborted.")));
          queueMicrotask(() => controller.abort());
        }),
      controller.signal,
    );
    const err = await pending;
    expect(err).toBeInstanceOf(APIUserAbortError);
    expect(describeAskError(err, ctx()).code).toBe("stopped");
  });
});

describe("copy edges", () => {
  it("a response with no body quotes nothing, rather than the SDK's filler as if Anthropic had said it", async () => {
    const limited = await sendError(() => new Response(null, { status: 429, headers: { "request-id": "req_nobody", "retry-after": "0" } }));
    expect(describeAskError(limited, ctx()).message).toBe("Anthropic's rate limit for your key was reached.");
    const broken = await sendError(() => new Response(null, { status: 500, headers: { "request-id": "req_nobody" } }));
    expect(describeAskError(broken, ctx()).message).toBe("Anthropic returned an error (500).");
  });

  it("full-width punctuation already ends a sentence, so an OS message in Chinese is not given a second stop", async () => {
    const err = await sendError(() => Promise.reject(nativeRejection("网络连接已中断。")));
    expect(describeAskError(err, ctx()).message).toBe(
      "The connection to Anthropic failed after 12 seconds: 网络连接已中断。 The request may still have been processed and billed to your key.",
    );
  });

  it("the 300-character cap counts characters, so it never splits an emoji", async () => {
    const err = await sendError(() => Promise.reject(nativeRejection("✈️😀".repeat(400))));
    const { message } = describeAskError(err, ctx());
    expect(message).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(message).toContain("…");
  });
});

describe("scrubSecrets", () => {
  it("masks a secret URL-encoded, as it appears in a query string", () => {
    const secret = "seats+pro/key==abcdef";
    expect(scrubSecrets(`GET /search?k=${encodeURIComponent(secret)}`, [secret])).toBe("GET /search?k=••••");
  });

  it("masks a secret as typed and as it appears inside a JSON string", () => {
    const secret = 'pro_"quoted"\\key_1234';
    expect(scrubSecrets(`raw ${secret} json ${JSON.stringify({ key: secret })}`, [secret])).toBe('raw •••• json {"key":"••••"}');
  });

  it("leaves strings under 8 characters and empty entries alone", () => {
    expect(scrubSecrets("short abc1234 stays", ["abc1234", "", null, undefined])).toBe("short abc1234 stays");
  });

  it("masks a secret that contains another as one, longest first", () => {
    expect(scrubSecrets("key sk-ant-api03-LONGERKEY end", ["sk-ant-api03", "sk-ant-api03-LONGERKEY"])).toBe("key •••• end");
  });
});
