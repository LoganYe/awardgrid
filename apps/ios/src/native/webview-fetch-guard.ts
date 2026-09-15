/**
 * A tripwire on the WebView's own `fetch`: api.anthropic.com and seats.aero are reached over native HTTP only.
 *
 * Every request to either host goes through ./http.ts, over CapacitorHttp. The WebView's global `fetch` is a
 * different network stack with different rules, and for these two hosts using it is always a bug:
 *
 *   - seats.aero sends no CORS headers, so a WebView fetch fails with "Load failed" (docs/PHASE0.md §2). That
 *     failure reads like an outage, not like the wiring bug it is.
 *   - api.anthropic.com is the worse case, because the failure may not happen. The SDK marks its requests with
 *     `anthropic-dangerous-direct-browser-access: true` (SDK client.js:838-839), and Anthropic may answer such a
 *     request from a browser. A regression that let the SDK use the global fetch could then work silently, from
 *     the WebView, with an Origin header on every request.
 *
 * `createAskClient` already refuses `globalThis.fetch` (packages/core/src/lib/ask/client.ts), and lint keeps the
 * SDK out of this app (eslint.config.mjs). This guard is the runtime layer under both. main.tsx installs it before
 * React renders, and from then on a global fetch to either host rejects with NativeHttpRequiredError. That name is
 * one describeAskError reads as a wiring failure (errors.ts WIRING_ERRORS), so Ask's copy calls it a wiring bug and
 * not an outage. Every other URL passes through untouched.
 */

/** Hosts this app reaches only through the native adapter. Compared after the URL parser lower-cases the host. */
const NATIVE_ONLY_HOSTS: ReadonlySet<string> = new Set(["api.anthropic.com", "seats.aero"]);

/** Marks an installed guard, so a second install (a hot reload, a second import) wraps nothing twice. */
const GUARD_MARK = Symbol.for("awardgrid.webViewFetchGuard");

export class NativeHttpRequiredError extends Error {
  readonly host: string;
  constructor(host: string) {
    super(`${host} must be reached over native HTTP (src/native/http.ts), never the WebView's fetch.`);
    // Set explicitly: describeAskError classifies by name, and a minifier renames classes.
    this.name = "NativeHttpRequiredError";
    this.host = host;
  }
}

/** What the guard wraps: `globalThis` in the app, a plain object in tests. */
export interface FetchTarget {
  fetch: typeof fetch;
  /** Relative URLs resolve against it, as the WebView resolves them. */
  location?: { href: string };
}

/**
 * Wrap `target.fetch` so a request to api.anthropic.com or seats.aero, over http or https, rejects before the
 * WebView sends it. Returns true when this call installed the guard, and false when one was already in place
 * or there was no fetch to guard.
 */
export function installWebViewFetchGuard(target: FetchTarget = globalThis): boolean {
  const inner = target.fetch as (typeof fetch & { [GUARD_MARK]?: true }) | undefined;
  if (typeof inner !== "function" || inner[GUARD_MARK] === true) return false;

  const guarded = async function webViewFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const read = readInput(input);
    const host = nativeOnlyHost(read.url, target.location?.href);
    if (host !== null) throw new NativeHttpRequiredError(host);
    // Called on the target, as the WebView expects: window.fetch invoked with another `this` throws.
    return inner.call(target, read.input, init);
  };
  Object.defineProperty(guarded, GUARD_MARK, { value: true });
  target.fetch = guarded as typeof fetch;
  return true;
}

/** The native-only host `raw` names, or null. A URL the parser rejects is not one of them. */
function nativeOnlyHost(raw: string, base: string | undefined): string | null {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  // Another scheme (capacitor:, data:, blob:) can never carry a request to either host.
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  // The parser has already lower-cased the host; a trailing dot names the same host.
  const host = url.hostname.replace(/\.$/, "");
  return NATIVE_ONLY_HOSTS.has(host) ? host : null;
}

/** Request.prototype's own `url` getter. It reads the URL the request carries, which an own `url` field cannot change. */
const requestUrl = typeof Request === "function" ? Object.getOwnPropertyDescriptor(Request.prototype, "url")?.get : undefined;

/**
 * What fetch will request, read once, and the input to hand on. fetch takes a Request's own URL and converts
 * anything else, a URL included, to a string (WebIDL USVString), so the guard does the same: a plain object's `url`
 * field never decides. Anything but a string or a Request goes on as the string that was checked, so a value whose
 * string changes from one read to the next cannot show the guard one host and the WebView another.
 */
function readInput(input: RequestInfo | URL): { url: string; input: RequestInfo | URL } {
  if (typeof input === "string") return { url: input, input };
  if (requestUrl !== undefined && input instanceof Request) return { url: String(requestUrl.call(input)), input };
  const url = String(input);
  return { url, input: url };
}
