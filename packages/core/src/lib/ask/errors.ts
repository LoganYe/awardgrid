/**
 * Anthropic request failures, described in words that claim no more than the app observed.
 *
 * Two facts about this transport decide the order of the checks in describeAskError:
 *
 *   1. The tool loop aborts its own AbortController with a reason, "stop" or "request_limit". Either way
 *      the rejection is the SDK's APIUserAbortError, so the reason comes from the caller, never the error.
 *   2. A native failure reaches JS as a CapacitorException whose `message` is URLSession's
 *      localizedDescription and whose `code` is only "NSURLErrorDomain" (HttpRequestHandler.swift:224;
 *      @capacitor/ios Capacitor/Capacitor/assets/native-bridge.js:951-974). The NSError number never
 *      crosses the bridge. The SDK then decides "timed out" by matching /timed? ?out/ against that text
 *      (SDK client.js:533-534), which fails on a device set to another language. So no copy names a cause
 *      taken from the SDK's error class: a connection failure quotes the words that arrived and the
 *      seconds the loop measured.
 *
 * Only a failure the SDK reports as a connection failure (APIConnectionError, which wraps the rejected
 * fetch, client.js:576) is described as one. A response that arrived but could not be read, such as an
 * empty 200 or a malformed event, is its own case: calling it a failed connection would name a cause the
 * app did not observe.
 *
 * The copy lives in core, where apps/ios/src/honesty.test.ts scans it.
 */
import { APIConnectionError, APIError, APIUserAbortError, AnthropicError } from "@anthropic-ai/sdk";
import { ASK_REQUEST_LIMIT_MS } from "./limits";

export type AskFailureCode =
  | "stopped"
  | "request_limit"
  | "anthropic_key_missing"
  | "anthropic_key_rejected"
  | "model_unavailable"
  | "anthropic_forbidden"
  | "spend_limit"
  | "rate_limited"
  | "bad_request"
  | "too_large"
  | "overloaded"
  | "overloaded_mid_answer"
  | "anthropic_error"
  | "unreadable_response"
  | "connection_failed"
  | "connection_failed_left_app"
  | "wiring";

export interface AskFailure {
  code: AskFailureCode;
  /** Whether "Try again", which resends the identical request, can plausibly succeed. */
  retryable: boolean;
  /** What the person reads. Every secret is masked, and text quoted from Anthropic or the OS is capped. */
  message: string;
  /** Anthropic's `request-id` response header (SDK core/error.js:14), when a response carried one. */
  requestId: string | null;
}

export interface AskErrorContext {
  /** `signal.reason` of the loop's own AbortController: "stop" or "request_limit" once it has aborted. */
  reason?: unknown;
  /** From sending the request to its failure, by the loop's injected clock. */
  elapsedMs: number;
  /** Whether awardgrid was hidden at any moment while the request was out. */
  hidden: boolean;
  /** Keys to mask wherever quoted text might echo one: the seats.aero key and the Anthropic key. */
  secrets: ReadonlyArray<string | null | undefined>;
}

/** Longest text quoted from Anthropic or the OS into one message, in characters (code points). */
const QUOTE_CAP = 300;

const MASK = "••••";

const STOPPED = "Stopped. Nothing more will be sent for this question. The request already sent to Anthropic still finishes and may be billed.";

/**
 * Errors meaning this build cannot make a native request at all. Matched by name, which each one sets
 * explicitly: core cannot import the shell's classes, and a minifier renames them.
 */
const WIRING_ERRORS = new Set(["NativeHttpUnavailableError", "NativeHttpRequiredError", "AskTransportError"]);

type FailureOf = (code: AskFailureCode, retryable: boolean, message: string) => AskFailure;

export function describeAskError(err: unknown, ctx: AskErrorContext): AskFailure {
  const requestId = err instanceof APIError ? (err.requestID ?? null) : null;
  // Mask first, then cap, so the cut can never leave part of a key showing.
  const quote = (text: string) => capQuote(scrubSecrets(text, ctx.secrets));
  const failure: FailureOf = (code, retryable, message) => ({ code, retryable, message: scrubSecrets(message, ctx.secrets), requestId });

  if (ctx.reason === "stop") return failure("stopped", false, STOPPED);
  if (ctx.reason === "request_limit") {
    return failure(
      "request_limit",
      true,
      `Stopped waiting for Anthropic after ${ASK_REQUEST_LIMIT_MS / 60_000} minutes, the most one request may take. The request may still have been processed and billed to your key.`,
    );
  }
  if (inChain(err, (e) => e.name === "AskKeyMissingError")) {
    // createAskClient refused before any request: nothing reached Anthropic, so nothing is said about billing.
    return failure("anthropic_key_missing", false, "Ask has no Anthropic API key to send. Add one in Settings.");
  }
  if (inChain(err, (e) => WIRING_ERRORS.has(e.name))) {
    return failure("wiring", false, "Ask cannot reach Anthropic from this build: native HTTP is not available. This is a wiring bug, not an outage.");
  }
  // Anthropic answered: with an HTTP error status, or with an `event: error` inside a 200 stream. Both
  // carry that response's headers; the SDK's connection and abort errors never do (core/error.js).
  if (err instanceof APIError && err.headers !== undefined) return fromAnthropic(err, quote, failure);
  // The loop's controller is the only thing that aborts a send, so an abort that arrives without a reason
  // is still a stop, and still says the request already sent may be billed.
  if (err instanceof APIUserAbortError) return failure("stopped", false, STOPPED);
  if (!(err instanceof APIConnectionError) && (err instanceof AnthropicError || err instanceof SyntaxError)) {
    // A response arrived and the SDK could not read it: an empty 200 ("request ended without sending any
    // chunks"), or an event whose data is not JSON. The connection worked, so the copy does not say it failed.
    return failure(
      "unreadable_response",
      true,
      `Anthropic's response could not be read: ${asSentence(quote(errorText(err)))} The request may still have been processed and billed to your key.`,
    );
  }

  const said = asSentence(quote(transportMessage(err)));
  if (ctx.hidden) {
    return failure(
      "connection_failed_left_app",
      true,
      `The request to Anthropic was interrupted after you left awardgrid: ${said} It may still have been processed and billed to your key.`,
    );
  }
  const seconds = Math.round(ctx.elapsedMs / 1000);
  return failure(
    "connection_failed",
    true,
    `The connection to Anthropic failed after ${seconds} ${seconds === 1 ? "second" : "seconds"}: ${said} The request may still have been processed and billed to your key.`,
  );
}

/** The line shown under a failure that carried a request ID, for a support request to Anthropic. */
export function askRequestIdLine(requestId: string): string {
  return `Anthropic request ID: ${requestId}`;
}

/**
 * Mask every secret in `text`, as typed, as it would appear inside a JSON string, and URL-encoded, so a
 * key echoed back in an error body, a JSON payload or a URL is never shown or saved. Longest first, so a
 * secret that contains another is masked whole. A string shorter than 8 characters is left alone: it
 * cannot be a real key, and masking it would blank ordinary words. The rule extends the web lane's
 * redactSecrets (src/app/api/ask/wire.ts:109-125) with the URL form.
 */
export function scrubSecrets(text: string, secrets: ReadonlyArray<string | null | undefined>): string {
  const forms = new Set<string>();
  for (const secret of secrets) {
    if (!secret || secret.length < 8) continue;
    forms.add(secret);
    forms.add(JSON.stringify(secret).slice(1, -1));
    forms.add(encodeURIComponent(secret));
  }
  let out = text;
  for (const form of [...forms].sort((a, b) => b.length - a.length)) out = out.split(form).join(MASK);
  return out;
}

/** A response Anthropic sent: the HTTP status table, or the error type of an `event: error` in a stream. */
function fromAnthropic(err: APIError, quote: (text: string) => string, failure: FailureOf): AskFailure {
  const said = quote(anthropicWords(err));
  const status = err.status;
  if (status === undefined) {
    // An `event: error` after HTTP 200 (core/streaming.js:114-117): no status, and the error type from the
    // event body. What streamed before it may be billed, so neither copy says otherwise.
    if (err.type === "overloaded_error") {
      return failure(
        "overloaded_mid_answer",
        true,
        "Anthropic became overloaded partway through the answer. What Claude had already generated may still be billed.",
      );
    }
    return failure("anthropic_error", true, withWords(`Anthropic returned an error (${err.type ?? "error event"})`, said));
  }
  if (status === 401) return failure("anthropic_key_rejected", false, "Anthropic rejected your API key. Check it in Settings.");
  if (status === 404) return failure("model_unavailable", false, "Anthropic says this key cannot use Claude Opus 5.");
  if (status === 403) return failure("anthropic_forbidden", false, withWords(`Anthropic refused the request (${err.type ?? status})`, said));
  if (status === 429) {
    if (isSpendLimit(err)) {
      return failure("spend_limit", false, withWords("Anthropic refused the request because your organization reached its spend limit", said));
    }
    const wait = retryAfterSeconds(err);
    const lead = withWords("Anthropic's rate limit for your key was reached", said);
    const text = wait === null ? lead : `${asSentence(lead)} Anthropic asks to wait ${wait} ${wait === 1 ? "second" : "seconds"} before trying again.`;
    return failure("rate_limited", true, text);
  }
  if (status === 413) return failure("too_large", false, "This conversation is too large to send. Start a new conversation.");
  if (status === 529) return failure("overloaded", true, "Anthropic is overloaded and did not answer.");
  if (status >= 500) return failure("anthropic_error", true, withWords(`Anthropic returned an error (${status})`, said));
  // 400, and any other 4xx without a row of its own (409, 422, …): resending the same request cannot fix it.
  return failure("bad_request", false, withWords(`Anthropic could not accept the request (${status})`, said));
}

/**
 * A spend-limit 429 names itself in `error.details.error_code` (Anthropic's rate-limits page). Nothing in
 * the SDK's types describes that field, so it is read defensively, and any other 429 is a rate limit.
 */
function isSpendLimit(err: APIError): boolean {
  return field(field(field(err.error, "error"), "details"), "error_code") === "enforced_spend_limit_reached";
}

/**
 * `retry-after` in whole or decimal seconds. An HTTP-date form is left out rather than guessed at, and so is
 * zero, which asks for no wait at all.
 */
function retryAfterSeconds(err: APIError): number | null {
  const raw = err.headers?.get("retry-after")?.trim();
  if (!raw || !/^\d+(?:\.\d+)?$/.test(raw)) return null;
  const seconds = Number(raw);
  return seconds > 0 ? seconds : null;
}

/**
 * Anthropic's own sentence. An error body is `{ type: "error", error: { type, message } }` (claude-api
 * shared/error-codes.md), while the SDK's `message` is that whole body as JSON behind the status
 * (core/error.js, makeMessage), so the nested message is read first and the SDK's text is the fallback.
 * A response with no body has no words of Anthropic's at all; the SDK's "status code (no body)" filler is
 * not quoted as if Anthropic had said it.
 */
function anthropicWords(err: APIError): string {
  const nested = field(field(err.error, "error"), "message");
  if (typeof nested === "string") return nested;
  if (err.error === undefined) return "";
  const prefix = `${err.status} `;
  return err.status !== undefined && err.message.startsWith(prefix) ? err.message.slice(prefix.length) : err.message;
}

/**
 * The words a transport failure arrived with. The SDK wraps a rejected fetch as APIConnectionError with the
 * rejection as `cause` (client.js:576), whose message is the OS's own. When that message matched
 * /timed? ?out/, the SDK instead throws APIConnectionTimeoutError with its own "Request timed out." and keeps
 * no cause (client.js:568-569), so its sentence is the only one left to quote.
 */
function transportMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause: unknown = (err as { cause?: unknown }).cause;
  return cause instanceof Error && cause.message ? cause.message : err.message;
}

function errorText(err: Error): string {
  return err.message || err.name;
}

/** The shell's adapter errors arrive as the `cause` of an APIConnectionError (client.js:576), so the chain is walked. */
function inChain(err: unknown, match: (e: Error) => boolean): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
    if (match(current)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

/** A lead sentence followed by the quoted words when there are any, or ended plainly when there are none. */
function withWords(lead: string, said: string): string {
  return said ? `${lead}: ${said}` : `${lead}.`;
}

/** Cut by code points, not UTF-16 units, so the cut never splits an emoji or other astral character. */
function capQuote(text: string): string {
  const chars = Array.from(text.trim());
  return chars.length <= QUOTE_CAP ? chars.join("") : `${chars.slice(0, QUOTE_CAP - 1).join("")}…`;
}

/**
 * Quoted words run straight into the next sentence of the copy, so they must end like a sentence. OS
 * messages on a device set to Chinese or Japanese end in full-width punctuation, which already ends one.
 */
function asSentence(text: string): string {
  return /[.!?…。！？]$/.test(text) ? text : `${text}.`;
}
