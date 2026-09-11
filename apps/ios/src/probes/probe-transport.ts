/**
 * Probe build only (VITE_AG_PROBES=1): where the probe build's requests go instead of the real hosts.
 *
 * App.tsx imports this file behind that constant, so in any other build it is not in the bundle, and R1
 * (apps/ios/probes/run-probes.sh) checks that the normal bundle carries none of these hosts.
 *
 * seats.aero: `withSeatsMock` wraps the native adapter and is handed to bootstrap as `fetchImpl`. That places it
 * BELOW the rate-limit observer (bootstrap.ts seatsTransport) and below Ask's budget guard, which both still see
 * the https://seats.aero/partnerapi/ URL, while the bytes go to the local mock (scripts/mock-seatsaero.ts on
 * 127.0.0.1:4597). The mock sends no X-RateLimit-Remaining, so this adds one, and the device's quota store is
 * reached through the same observer path a real response takes (design §10.2, E1 in step 7).
 *
 * Anthropic: probe clients pass the probe server's `/sse` base URL to createAskClient, the one option they change.
 * ProbesScreen builds it from whichever loopback name A0 reached; PROBE_ANTHROPIC_BASE_URL is the 127.0.0.1 form.
 */
import type { BootstrapOptions } from "../app/bootstrap";
import { createNativeFetch } from "../native/http";

export const SEATS_AERO_PREFIX = "https://seats.aero/partnerapi/";
export const MOCK_SEATS_PREFIX = "http://127.0.0.1:4597/partnerapi/";
export const PROBE_RATE_LIMIT_REMAINING = "812";

/** apps/ios/probes/probe-server.mjs. Never 3000, 3400 or 3999. */
export const PROBE_SERVER = "http://127.0.0.1:4599";
/** The same server by name, which probes use only if A0 shows 127.0.0.1 unreachable and localhost reachable. */
export const PROBE_SERVER_BY_NAME = "http://localhost:4599";
export const PROBE_ANTHROPIC_BASE_URL = `${PROBE_SERVER}/sse`;

/** Statuses the Response constructor refuses to pair with a body. */
const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

function urlOf(input: RequestInfo | URL): string | null {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return null;
}

/** `inner`, with seats.aero Partner API requests sent to the local mock and answered with x-ratelimit-remaining: 812. */
export function withSeatsMock(inner: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    if (url === null || !url.startsWith(SEATS_AERO_PREFIX)) return inner(input, init);
    const res = await inner(MOCK_SEATS_PREFIX + url.slice(SEATS_AERO_PREFIX.length), init);
    const headers = new Headers(res.headers);
    headers.set("x-ratelimit-remaining", PROBE_RATE_LIMIT_REMAINING);
    const body = NULL_BODY_STATUS.has(res.status) ? null : await res.text();
    return new Response(body, { status: res.status, headers });
  }) as typeof fetch;
}

/** What App.tsx passes to bootstrap in a probe build: the production adapter, below the observer, pointed at the mock. */
export function probeBootstrapOptions(): BootstrapOptions {
  return { fetchImpl: withSeatsMock(createNativeFetch()) };
}
