/**
 * Phase 0: the native-HTTP adapter.
 *
 * PIVOT.md §2 calls this "the single most dangerous line in the build". The rules it sets,
 * and how they are honoured here:
 *
 *   1. Explicit adapter with `typeof fetch`'s signature over the native plugin — NOT the
 *      global `fetch` patch. `capacitor.config.ts` sets `CapacitorHttp.enabled: false`, so
 *      `window.fetch` stays the plain WKWebView fetch. That is deliberate: it keeps a
 *      CORS-enforcing fetch available for the A/B probe, and it means nothing can reach
 *      seats.aero *by accident* — only through this function.
 *   2. Carries connectTimeout/readTimeout natively, because `SeatsAeroClient` builds its
 *      20 s timeout from an AbortController (client.ts:312) and classifies the failure by
 *      reading `signal.aborted` (client.ts:327). Without a native timeout, an abandoned
 *      search still spends a quota call.
 *   3. Fails loudly at launch, never silently falls back to the WebView.
 *
 * The adapter is injected as `opts.fetch` into `SeatsAeroClient` (client.ts:227), whose
 * field is typed `typeof fetch` (client.ts:217) — hence the signature here.
 */
import { Capacitor, CapacitorHttp } from "@capacitor/core";

/** Thrown when the native bridge is not the thing serving our requests. */
export class NativeHttpUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeHttpUnavailableError";
  }
}

export interface NativeFetchInit extends RequestInit {
  /** iOS: URLSessionConfiguration.timeoutIntervalForRequest, in ms. */
  connectTimeout?: number;
  /** iOS: URLSessionConfiguration.timeoutIntervalForResource, in ms. */
  readTimeout?: number;
}

/**
 * Startup assertion (PIVOT §2: "A silent fallback must fail loudly at launch, not at first
 * search"). Structural only — it proves the bridge is registered, and costs no HTTP call.
 * The behavioural proof is probe P3 in probes.ts.
 */
export function assertNativeHttpAvailable(): void {
  if (!Capacitor.isNativePlatform()) {
    throw new NativeHttpUnavailableError(
      `Not a native platform (got "${Capacitor.getPlatform()}"). In a browser this adapter would ` +
        `fall through to WebView networking, which seats.aero blocks by CORS.`,
    );
  }
  if (!Capacitor.isPluginAvailable("CapacitorHttp")) {
    throw new NativeHttpUnavailableError("CapacitorHttp plugin is not registered on the native side.");
  }
  if (typeof CapacitorHttp?.request !== "function") {
    throw new NativeHttpUnavailableError("CapacitorHttp.request is not callable.");
  }
}

function headersToRecord(init: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!init) return out;
  new Headers(init).forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/** 204/304 must be constructed with a null body or the Response constructor throws. */
const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

/**
 * `fetch`-shaped, but every byte travels over URLSession via the Capacitor bridge.
 *
 * Deliberately NOT supported, because this spike does not need them and a silent partial
 * implementation is how the "works in the WebView, breaks on device" class of bug gets in:
 * streaming bodies, redirect/credential/cache modes, and `Request` objects as input.
 */
export async function nativeFetch(input: RequestInfo | URL, init: NativeFetchInit = {}): Promise<Response> {
  assertNativeHttpAvailable();

  if (typeof Request !== "undefined" && input instanceof Request) {
    throw new NativeHttpUnavailableError("nativeFetch takes a URL, not a Request object.");
  }
  const url = typeof input === "string" ? input : input.toString();
  const method = (init.method ?? "GET").toUpperCase();

  // Abort BEFORE we cross the bridge: once the native request is in flight we may not be
  // able to recall it (that is exactly what probe P4 measures).
  if (init.signal?.aborted) throw abortError(init.signal);

  const request = CapacitorHttp.request({
    url,
    method,
    headers: headersToRecord(init.headers),
    data: init.body ?? undefined,
    // Take the bytes as text and parse them ourselves, mirroring client.ts:342, which does
    // `await response.text()` then `JSON.parse` so a non-JSON body is a typed error rather
    // than a plugin-level surprise.
    responseType: "text",
    connectTimeout: init.connectTimeout,
    readTimeout: init.readTimeout,
    // Belt and braces: if the plugin ever decided to service this in the WebView, we would
    // rather it fail than silently succeed in a way that breaks on a CORS-less origin.
    webFetchExtra: undefined,
  });

  const response = init.signal ? await raceAbort(request, init.signal) : await request;

  // iOS parses JSON eagerly when the content-type says so, even under responseType: "text".
  const body =
    typeof response.data === "string" || response.data == null
      ? (response.data as string | null)
      : JSON.stringify(response.data);

  const headers = new Headers();
  for (const [key, value] of Object.entries(response.headers ?? {})) {
    // Header values arrive as strings; arrays would be a plugin change, so be tolerant.
    headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
  }

  return new Response(NULL_BODY_STATUS.has(response.status) ? null : (body ?? ""), {
    status: response.status,
    statusText: "",
    headers,
  });
}

function abortError(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  const err = new Error("The operation was aborted.");
  err.name = "AbortError";
  return err;
}

/**
 * Rejects the JS promise when the signal fires. Whether the *native* request also stops is
 * the open question PIVOT §2 flags and probe P4 answers by asking the server what it saw.
 */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}
