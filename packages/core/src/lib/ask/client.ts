/**
 * The only place awardgrid builds an Anthropic client, and why each option is what it is.
 *
 * The official SDK brings typed request parameters, an SSE parser and typed errors. Left to its defaults
 * inside the app's WebView, it would get four things wrong:
 *
 *   1. It would call the WebView's `fetch` (SDK client.js:114): a browser request that carries Origin and
 *      depends on Anthropic's CORS answer, instead of the native adapter every other request in this app
 *      goes through (apps/ios/src/native/http.ts).
 *   2. It would refuse to construct at all, having detected a browser (client.js:93-94).
 *   3. It would retry a failed request twice (client.js:113), and a retried request can be billed twice.
 *   4. It would fill anything left unset from `process.env`, wherever one exists: a bearer token, a base
 *      URL, a log level (client.js:71, :80-82, :110).
 *
 * Each is overridden below, and client.test.ts pins every override through the real SDK. One environment
 * read has no override: ANTHROPIC_CUSTOM_HEADERS is folded into every request's headers (client.js:117-127),
 * and it could even replace x-api-key. It never applies in the app, because the SDK reads the environment
 * only through globalThis.process, which a WKWebView does not have and apps/ios/vite.config.ts does not
 * define; client.test.ts blanks it so the tests do not depend on the shell they run in.
 *
 * Requests go out as a stream and come back whole. With `messages.stream(…).finalMessage()` the server
 * keeps sending pings and deltas while CapacitorHttp buffers the body (limits.ts,
 * ANTHROPIC_IDLE_TIMEOUT_MS, says what that is relied on for), and an `event: error` partway through
 * becomes an APIError of that type (core/streaming.js:114-117) rather than a silently short message. The
 * answer still reaches JS in one piece, because CapacitorHttp hands over a finished body.
 */
import Anthropic from "@anthropic-ai/sdk";
import { SDK_BACKSTOP_TIMEOUT_MS } from "./limits";

/** The client was handed a transport this app must never use. describeAskError reports it as a wiring bug, not an outage. */
export class AskTransportError extends Error {
  constructor(message: string) {
    super(message);
    // Set explicitly: errors.ts classifies by name, and a minifier renames classes.
    this.name = "AskTransportError";
  }
}

/**
 * No key was given. The service refuses a missing key before it builds a client, so reaching this is a bug;
 * it is refused here too, because the SDK would otherwise fail only at request time, with an error
 * describeAskError could not tell from a failed connection (client.js validateHeaders).
 */
export class AskKeyMissingError extends Error {
  constructor() {
    super("createAskClient needs the person's Anthropic API key.");
    // Set explicitly: errors.ts classifies by name, and a minifier renames classes.
    this.name = "AskKeyMissingError";
  }
}

/** Everything Ask needs from Anthropic: one request, and one check of a key. */
export interface AskModel {
  /**
   * One Messages API request, streamed and read to its final message. Aborting `signal` stops the wait.
   * It cannot recall a request CapacitorHttp has already sent (docs/PHASE0.md §3).
   */
  send(params: Anthropic.MessageStreamParams, opts: { signal: AbortSignal }): Promise<Anthropic.Message>;
  /**
   * `GET /v1/models/{model}` with this key, a request that carries no prompt. Resolves when Anthropic
   * returns the model; rejects with the SDK's typed error (401, 403, 404) when it does not.
   */
  checkKey(model: string, opts?: { signal?: AbortSignal }): Promise<void>;
}

export interface CreateAskClientOptions {
  /** The person's own key, read from the Keychain for this client. */
  apiKey: string;
  /** The native adapter (`createNativeFetch`, apps/ios/src/native/http.ts). Required, and never the global fetch. */
  fetch: typeof fetch;
  /** Only the probe build passes one, to reach a local probe server. */
  baseURL?: string;
}

export function createAskClient(opts: CreateAskClientOptions): AskModel {
  // A missing fetch is refused here, before the SDK can quietly substitute its default.
  if (typeof opts.fetch !== "function" || opts.fetch === globalThis.fetch) {
    throw new AskTransportError("createAskClient needs the native adapter; the global fetch in this app is the WebView's.");
  }
  if (typeof opts.apiKey !== "string" || !opts.apiKey.trim()) throw new AskKeyMissingError();
  const client = new Anthropic({
    apiKey: opts.apiKey,
    // Never ANTHROPIC_AUTH_TOKEN (client.js:80-82). A key and a token together send both headers, which
    // Anthropic rejects with a 401 (claude-api shared/error-codes.md, "401 Unauthorized").
    authToken: null,
    // Never ANTHROPIC_BASE_URL (client.js:71).
    baseURL: opts.baseURL ?? "https://api.anthropic.com",
    // Otherwise Shims.getDefaultFetch(), which in the app is the WebView's (client.js:114).
    fetch: opts.fetch,
    // Without it the SDK throws in a WebView (client.js:93-94). It adds
    // `anthropic-dangerous-direct-browser-access: true` (client.js:838-839). The danger it names, a key
    // shipped to a web page's visitors, does not arise here: the key is the person's own, kept in their
    // Keychain and sent only over native HTTP.
    dangerouslyAllowBrowser: true,
    // The default is 2 (client.js:113). A retry can bill twice, so resending is the person's decision.
    maxRetries: 0,
    // Above the loop's own per-request bound, which is the one that can say why it stopped waiting.
    timeout: SDK_BACKSTOP_TIMEOUT_MS,
    // Request details stay out of the WebView console, whatever ANTHROPIC_LOG says (client.js:110).
    logLevel: "off",
  });
  return {
    send: (params, { signal }) => client.messages.stream(params, { signal }).finalMessage(),
    checkKey: async (model, { signal } = {}) => {
      await client.models.retrieve(model, undefined, { signal });
    },
  };
}
