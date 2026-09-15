/**
 * The native-HTTP adapter. Every seats.aero byte in this app goes through here.
 *
 * `docs/PIVOT.md` §2 calls this "the single most dangerous line in the build", and Phase 0
 * (`docs/PHASE0.md`) turned its two open questions into measurements. Both answers are encoded
 * below rather than left as folklore:
 *
 *   1. **CORS is real and the WebView is not exempt.** A WKWebView `fetch()` to seats.aero fails
 *      with `TypeError: Load failed`; the same URL over the native bridge returns HTTP 401 with 17
 *      readable headers. So `capacitor.config.ts` leaves `CapacitorHttp.enabled` FALSE — the global
 *      `fetch` patch is not relied on — and nothing reaches seats.aero except through this file.
 *
 *   2. **`AbortSignal` does not cancel a native request; a native timeout does.** Measured: abort at
 *      800 ms, promise rejected at 803 ms, and the server still completed its full 6 000 ms
 *      response at 6 002 ms. A native timeout, by contrast, closed the socket at 1 507 ms against
 *      the same 6 000 ms hold. That run set both timeout options to 1 500 ms, which iOS reads as ONE
 *      idle interval (see NativeFetchInit below), so "timeout" here means that interval, not a total.
 *
 *      This is a quota fact, not a latency curiosity. `SeatsAeroClient` bounds requests with an
 *      `AbortController` (`client.ts:312`) and reads `signal.aborted` to classify the failure
 *      (`:327`) — a mechanism that is a no-op against URLSession. Ported naively it would stop the
 *      *waiting* but not the *spending*, and an abandoned search would still burn one of the 1,000
 *      daily calls with nobody told. So this adapter ALWAYS sends a native timeout, and the signal
 *      is treated as what it actually is: a way to stop listening, never a way to stop the request.
 */
import { Capacitor, CapacitorHttp } from "@capacitor/core";

/** Matches DEFAULT_TIMEOUT_MS in the core client, but enforced natively where it actually bites. */
export const DEFAULT_NATIVE_TIMEOUT_MS = 20_000;

export class NativeHttpUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeHttpUnavailableError";
  }
}

/**
 * `RequestInit` plus CapacitorHttp's two timeout options, which on iOS are not two settings.
 *
 * Capacitor reads `connectTimeout ?? readTimeout` into ONE `URLRequest.timeoutInterval`
 * (HttpRequestHandler.swift:203-205), so `readTimeout` is ignored whenever `connectTimeout` is set;
 * this adapter sends the same value as both. Apple defines that interval as an IDLE interval, reset
 * to 0 whenever bytes arrive (NSURLRequest.h:281-290, iOS 26.5 SDK), not a total budget: a response
 * that keeps sending bytes is not cut by it, a silent one is. Phase 0's 1,507 ms timeout against a
 * 6,000 ms hold fits that reading, because /slow sent nothing while it held.
 *
 * A string `body` crosses unchanged. Capacitor sets `httpBody` only when it finds a Content-Type
 * header (CapacitorUrlRequest.swift:215-221); its lookup lower-cases the stored keys and the key it
 * asks for (:118-124), so a lower-case `content-type` counts; and a string body becomes its UTF-8
 * bytes before any JSON or form handling (:184-186). Both Swift files are in
 * @capacitor/ios/Capacitor/Capacitor/Plugins/.
 */
export interface NativeFetchInit extends RequestInit {
  /** iOS: the idle URLRequest.timeoutInterval, ms. Wins over `readTimeout` when both are set. */
  connectTimeout?: number;
  /** iOS: the same single idle interval, used only when `connectTimeout` is absent, ms. */
  readTimeout?: number;
}

/** Everything the adapter needs from the platform, so tests can supply a fake. */
export interface NativeHttpDeps {
  isNativePlatform: () => boolean;
  getPlatform: () => string;
  isPluginAvailable: (name: string) => boolean;
  request: (options: Record<string, unknown>) => Promise<{
    status: number;
    data: unknown;
    headers?: Record<string, string | string[]>;
    url?: string;
  }>;
}

export const capacitorDeps: NativeHttpDeps = {
  isNativePlatform: () => Capacitor.isNativePlatform(),
  getPlatform: () => Capacitor.getPlatform(),
  isPluginAvailable: (name) => Capacitor.isPluginAvailable(name),
  // The adapter builds a plain option bag so tests can supply a fake bridge; `url` is always
  // present by construction, which the structural cast through `unknown` acknowledges.
  request: (options) => CapacitorHttp.request(options as unknown as Parameters<typeof CapacitorHttp.request>[0]),
};

/**
 * Fail loudly at launch, not at first search (PIVOT §2). A silent fall-through to WebView
 * networking would surface as a CORS error much later, on a device, looking like a seats.aero
 * outage rather than a wiring bug.
 */
export function assertNativeHttpAvailable(deps: NativeHttpDeps = capacitorDeps): void {
  if (!deps.isNativePlatform()) {
    throw new NativeHttpUnavailableError(
      `Not a native platform (got "${deps.getPlatform()}"). seats.aero sends no CORS headers from any ` +
        `origin, so a WebView build cannot reach it at all — this is a wiring bug, not an outage.`,
    );
  }
  if (!deps.isPluginAvailable("CapacitorHttp")) {
    throw new NativeHttpUnavailableError("CapacitorHttp is not registered on the native side.");
  }
  if (typeof deps.request !== "function") {
    throw new NativeHttpUnavailableError("CapacitorHttp.request is not callable.");
  }
}

/** Response statuses the Response constructor refuses to pair with a body. */
const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

function headersToRecord(init: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!init) return out;
  new Headers(init).forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

export interface CreateNativeFetchOptions {
  deps?: NativeHttpDeps;
  /** Default native timeout when a caller does not set one. */
  timeoutMs?: number;
  /**
   * Called with the response headers of every completed request. This is how the quota counter
   * learns seats.aero's own `X-RateLimit-Remaining`, which PIVOT §2 says to trust over the local
   * count — a local counter resets when the app is reinstalled and seats.aero's does not.
   */
  onResponseHeaders?: (headers: Headers, url: string) => void;
}

/**
 * Build a `typeof fetch` that travels over URLSession. Inject the result as `opts.fetch` into
 * `SeatsAeroClient` (`client.ts:227`, typed `typeof fetch` at `:217`) — do not install it globally.
 */
export function createNativeFetch(opts: CreateNativeFetchOptions = {}): typeof fetch {
  const deps = opts.deps ?? capacitorDeps;
  const defaultTimeout = opts.timeoutMs ?? DEFAULT_NATIVE_TIMEOUT_MS;

  return async function nativeFetch(input: RequestInfo | URL, init: NativeFetchInit = {}): Promise<Response> {
    assertNativeHttpAvailable(deps);

    if (typeof Request !== "undefined" && input instanceof Request) {
      throw new NativeHttpUnavailableError("nativeFetch takes a URL, not a Request object.");
    }
    const url = typeof input === "string" ? input : input.toString();
    const signal = init.signal ?? undefined;

    // Refuse before crossing the bridge. After this point the request cannot be recalled — that
    // is the measured Phase 0 finding, not a guess — so this is the only honest cancellation.
    if (signal?.aborted) throw abortError(signal);

    const pending = deps.request({
      url,
      method: (init.method ?? "GET").toUpperCase(),
      headers: headersToRecord(init.headers),
      data: init.body ?? undefined,
      // Take bytes as text and parse upstream, mirroring client.ts:342 so a non-JSON body is a
      // typed error rather than a plugin-level surprise.
      responseType: "text",
      // ALWAYS set, never inherited from the signal: the signal cannot stop the native request,
      // and an unbounded request that the user walked away from still costs a quota call.
      connectTimeout: init.connectTimeout ?? defaultTimeout,
      readTimeout: init.readTimeout ?? defaultTimeout,
    });

    const res = signal ? await raceAbort(pending, signal) : await pending;

    const headers = new Headers();
    for (const [key, value] of Object.entries(res.headers ?? {})) {
      headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
    }
    opts.onResponseHeaders?.(headers, url);

    // iOS parses JSON eagerly when the content-type says so, even under responseType: "text".
    const body = typeof res.data === "string" || res.data == null ? (res.data as string | null) : JSON.stringify(res.data);

    return new Response(NULL_BODY_STATUS.has(res.status) ? null : (body ?? ""), {
      status: res.status,
      headers,
    });
  } as typeof fetch;
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const err = new Error("The operation was aborted.");
  err.name = "AbortError";
  return err;
}

/**
 * Stop waiting when the signal fires. Deliberately named for what it does: the native request
 * carries on to completion, so this frees the UI, not the quota.
 */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    const done = () => signal.removeEventListener("abort", onAbort);
    promise.then(
      (v) => {
        done();
        resolve(v);
      },
      (e) => {
        done();
        reject(e);
      },
    );
  });
}
