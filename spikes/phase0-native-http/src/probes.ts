/**
 * The Phase 0 probe suite.
 *
 * Acceptance (kickoff): the response arrives and rows render; we state explicitly HOW we
 * proved the call went over native HTTP and not the WebView; we report whether
 * X-RateLimit-Remaining came back and its value; and we report whether AbortSignal actually
 * cancelled the native request or only the promise.
 *
 * Each probe below is one of those claims, made falsifiable. P1/P2 are a differential pair
 * run against the SAME url from the SAME screen: if the premise were wrong — if the WebView
 * could reach seats.aero after all — P1 would pass and the pivot would not need Capacitor.
 */
import { Capacitor } from "@capacitor/core";
import { assertNativeHttpAvailable, nativeFetch } from "./nativeFetch";

export const PROBE_ORIGIN = "http://localhost:4599";
export const SEATS_AERO_BASE = "https://seats.aero/partnerapi/";

export type ProbeStatus = "pass" | "fail" | "inconclusive" | "pending" | "running";

export interface ProbeResult {
  id: string;
  title: string;
  /** What a passing run means. Printed in the UI so a green tick is never self-certifying. */
  expectation: string;
  status: ProbeStatus;
  detail: string;
  evidence?: Record<string, unknown>;
  ms?: number;
}

/** Cached Search, built exactly as src/lib/seatsaero/client.ts:162 builds it. No invented params. */
export function cachedSearchUrl(origin: string, destination: string, daysOut = 30, window = 7): string {
  const day = (offset: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  const qs = new URLSearchParams({
    origin_airport: origin,
    destination_airport: destination,
    start_date: day(daysOut),
    end_date: day(daysOut + window),
    take: "10",
  });
  return `${SEATS_AERO_BASE}search?${qs}`;
}

const now = () => performance.now();

/** P0 — the startup assertion. A silent WebView fallback must fail here, not at first search. */
export async function probeStartupAssertion(): Promise<ProbeResult> {
  const base = {
    id: "P0",
    title: "Startup assertion: the native bridge is live",
    expectation: "Passes only on a native platform with CapacitorHttp registered.",
  };
  try {
    assertNativeHttpAvailable();
    return {
      ...base,
      status: "pass",
      detail: `platform="${Capacitor.getPlatform()}", native=${Capacitor.isNativePlatform()}, CapacitorHttp registered.`,
      evidence: {
        platform: Capacitor.getPlatform(),
        isNativePlatform: Capacitor.isNativePlatform(),
        pluginAvailable: Capacitor.isPluginAvailable("CapacitorHttp"),
        // If this is ever true, the global fetch is patched and the P1/P2 differential is void.
        globalFetchIsPatched: !/native code/.test(String(globalThis.fetch)),
      },
    };
  } catch (err) {
    return { ...base, status: "fail", detail: String(err) };
  }
}

/** P1 — the control. WebView fetch to seats.aero must FAIL. A pass here would refute the pivot. */
export async function probeWebViewToSeatsAero(): Promise<ProbeResult> {
  const url = cachedSearchUrl("SFO", "NRT");
  const base = {
    id: "P1",
    title: "Control: WKWebView fetch() → seats.aero",
    expectation: "Must FAIL. seats.aero sends no Access-Control-Allow-Origin, so the WebView blocks it.",
  };
  const t0 = now();
  try {
    const res = await fetch(url, { headers: { "Partner-Authorization": "phase0-probe-no-key" } });
    return {
      ...base,
      status: "fail",
      ms: now() - t0,
      detail:
        `The WebView reached seats.aero and read status ${res.status}. This REFUTES the CORS premise — ` +
        `if a WebView can call seats.aero, the pivot does not need a native adapter.`,
      evidence: { status: res.status, url },
    };
  } catch (err) {
    return {
      ...base,
      status: "pass",
      ms: now() - t0,
      detail: `Blocked, as predicted: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
      evidence: { url, error: String(err) },
    };
  }
}

/** P2 — the same URL over the native adapter. Must succeed, with readable response headers. */
export async function probeNativeToSeatsAero(): Promise<ProbeResult> {
  const url = cachedSearchUrl("SFO", "NRT");
  const base = {
    id: "P2",
    title: "Native URLSession → seats.aero (same URL as P1)",
    expectation:
      "Must return an HTTP status and readable headers. Any status proves reachability; CORS never applies.",
  };
  const t0 = now();
  try {
    const res = await nativeFetch(url, { headers: { "Partner-Authorization": "phase0-probe-no-key" } });
    const headers = Object.fromEntries(res.headers.entries());
    return {
      ...base,
      status: "pass",
      ms: now() - t0,
      detail:
        `HTTP ${res.status} from seats.aero, with ${Object.keys(headers).length} readable response headers. ` +
        `401 is expected here — this probe deliberately sends an invalid key, because reachability, ` +
        `not authorisation, is what P2 tests. A CORS-blocked request could not report either.`,
      evidence: { status: res.status, headers, url },
    };
  } catch (err) {
    return { ...base, status: "fail", ms: now() - t0, detail: String(err), evidence: { url } };
  }
}

/**
 * P3 — the direct proof, and the one the acceptance criterion actually asks for.
 *
 * Both stacks are pointed at a server we control that copies seats.aero's CORS posture. The
 * server writes down what it received. WKWebView announces `Origin: capacitor://localhost`
 * and `Sec-Fetch-*`; URLSession sends neither and identifies itself as CFNetwork/Darwin.
 * That difference is not inferable from inside the app — it is observed from outside it.
 */
export async function probeStackIdentification(): Promise<ProbeResult> {
  const base = {
    id: "P3",
    title: "Which stack sent it? Ask the server.",
    expectation:
      "The server must log TWO requests: one webview-like (Origin + Sec-Fetch-*), one native-like (CFNetwork UA, no Origin).",
  };
  const t0 = now();
  try {
    await fetch(`${PROBE_ORIGIN}/reset`).catch(() => {});

    let webviewOutcome: string;
    try {
      const r = await fetch(`${PROBE_ORIGIN}/no-cors?via=webview-fetch`);
      webviewOutcome = `unexpectedly readable: HTTP ${r.status}`;
    } catch (err) {
      webviewOutcome = `blocked in JS (${err instanceof Error ? err.name : "error"}) — but check the server log`;
    }

    let nativeOutcome: string;
    let nativeBody: unknown = null;
    try {
      const r = await nativeFetch(`${PROBE_ORIGIN}/no-cors?via=native-adapter`);
      nativeBody = JSON.parse(await r.text());
      nativeOutcome = `HTTP ${r.status}, body readable`;
    } catch (err) {
      nativeOutcome = `FAILED: ${String(err)}`;
    }

    const log = (await (await fetch(`${PROBE_ORIGIN}/log`)).json()) as {
      log: Array<{ path: string; stack: string; headers: Record<string, string> }>;
    };
    const viaWebview = log.log.find((e) => e.path.includes("via=webview-fetch"));
    const viaNative = log.log.find((e) => e.path.includes("via=native-adapter"));

    const proved = viaNative?.stack === "native-like";
    return {
      ...base,
      status: proved ? "pass" : "fail",
      ms: now() - t0,
      detail: proved
        ? `The adapter's request arrived with no Origin and no Sec-Fetch-* metadata, UA ` +
          `"${viaNative?.headers["user-agent"] ?? "?"}" — a URLSession signature, not a browser one. ` +
          `The WebView's request to the same CORS-less path ${webviewOutcome}.`
        : `Could not confirm a native-like request in the server log. Native call: ${nativeOutcome}.`,
      evidence: {
        webviewOutcome,
        nativeOutcome,
        nativeBody,
        serverSawFromWebView: viaWebview ?? "(nothing logged)",
        serverSawFromAdapter: viaNative ?? "(nothing logged)",
      },
    };
  } catch (err) {
    return {
      ...base,
      status: "inconclusive",
      ms: now() - t0,
      detail: `Probe server unreachable at ${PROBE_ORIGIN}. Start it with \`node probe-server.mjs\`. ${err}`,
    };
  }
}

/**
 * P4 — does AbortSignal cancel the native request, or only the promise?
 *
 * PIVOT §2 flags this as unverified. It matters in money: if abandoning a search leaves the
 * request running, an abandoned search still spends one of 1,000 daily quota calls.
 * Only the server can answer, so we ask it.
 */
export async function probeAbortSignal(): Promise<ProbeResult> {
  const base = {
    id: "P4",
    title: "Does AbortSignal cancel the NATIVE request?",
    expectation:
      'Server logs "client-disconnected" → the socket really closed. "server-completed" → only the JS promise was abandoned, and the call still cost quota.',
  };
  const t0 = now();
  const HOLD_MS = 6000;
  const ABORT_AT_MS = 800;
  try {
    await fetch(`${PROBE_ORIGIN}/reset`).catch(() => {});
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ABORT_AT_MS);

    let jsOutcome: string;
    const jsStart = now();
    try {
      const r = await nativeFetch(`${PROBE_ORIGIN}/slow?ms=${HOLD_MS}&via=abort-test`, { signal: controller.signal });
      jsOutcome = `promise RESOLVED with HTTP ${r.status} after ${Math.round(now() - jsStart)} ms (abort had no effect at all)`;
    } catch (err) {
      jsOutcome = `promise rejected after ${Math.round(now() - jsStart)} ms with ${err instanceof Error ? err.name : String(err)}`;
    }

    // Outlive the server's hold, so its verdict is final rather than still in-flight.
    await new Promise((r) => setTimeout(r, HOLD_MS - ABORT_AT_MS + 1200));
    const log = (await (await fetch(`${PROBE_ORIGIN}/log`)).json()) as {
      log: Array<{ path: string; outcome?: string; disconnected_after_ms?: number; completed_after_ms?: number }>;
    };
    const entry = log.log.find((e) => e.path.includes("via=abort-test"));

    const cancelled = entry?.outcome === "client-disconnected";
    return {
      ...base,
      // The status reports what AbortSignal DID, not whether the measurement succeeded.
      // Marking a "the native request kept running" result as PASS because we managed to
      // observe it would be exactly the kind of self-certifying green tick this spike exists
      // to avoid.
      status: !entry ? "inconclusive" : cancelled ? "pass" : "fail",
      ms: now() - t0,
      detail: !entry
        ? "The probe server never saw the request; cannot judge."
        : cancelled
          ? `NATIVE REQUEST WAS CANCELLED. The server saw the client hang up after ` +
            `${entry.disconnected_after_ms} ms of a ${HOLD_MS} ms hold. ${jsOutcome}.`
          : `ONLY THE PROMISE WAS ABANDONED. The server completed the full ${HOLD_MS} ms response ` +
            `(at ${entry.completed_after_ms} ms) with nobody listening. ${jsOutcome}. ` +
            `Consequence: an abandoned seats.aero search still spends a quota call, so the adapter ` +
            `MUST carry a native readTimeout rather than relying on AbortController.`,
      evidence: { jsOutcome, serverVerdict: entry ?? "(nothing logged)", holdMs: HOLD_MS, abortAtMs: ABORT_AT_MS },
    };
  } catch (err) {
    return { ...base, status: "inconclusive", ms: now() - t0, detail: `Probe server unreachable. ${err}` };
  }
}

/** P5 — is readTimeout honoured on iOS, or is it Android-only? PIVOT §2 depends on the answer. */
export async function probeNativeReadTimeout(): Promise<ProbeResult> {
  const base = {
    id: "P5",
    title: "Is readTimeout honoured natively on iOS?",
    expectation:
      "Should reject in ~1.5 s, not ~6 s. If it waits the full hold, iOS ignores readTimeout and the 20 s budget in client.ts:313 has no native equivalent.",
  };
  const HOLD_MS = 6000;
  const READ_TIMEOUT_MS = 1500;
  const t0 = now();
  try {
    await nativeFetch(`${PROBE_ORIGIN}/slow?ms=${HOLD_MS}&via=timeout-test`, {
      connectTimeout: READ_TIMEOUT_MS,
      readTimeout: READ_TIMEOUT_MS,
    });
    return {
      ...base,
      status: "fail",
      ms: now() - t0,
      detail: `Resolved after ${Math.round(now() - t0)} ms despite a ${READ_TIMEOUT_MS} ms readTimeout.`,
    };
  } catch (err) {
    const elapsed = now() - t0;
    const honoured = elapsed < HOLD_MS * 0.8;
    return {
      ...base,
      status: honoured ? "pass" : "fail",
      ms: elapsed,
      detail: honoured
        ? `Timed out after ${Math.round(elapsed)} ms against a ${HOLD_MS} ms hold — the native timeout is real.`
        : `Waited ${Math.round(elapsed)} ms, i.e. the full server hold: readTimeout was IGNORED on iOS. ` +
          `The adapter cannot bound a request natively, so an abandoned search may still cost quota.`,
      evidence: { elapsedMs: Math.round(elapsed), readTimeoutMs: READ_TIMEOUT_MS, holdMs: HOLD_MS, error: String(err) },
    };
  }
}

export interface AvailabilityRow {
  ID: string;
  Date: string;
  Source: string;
  Route: { OriginAirport: string; DestinationAirport: string };
  YMileageCost?: string | null;
  WMileageCost?: string | null;
  JMileageCost?: string | null;
  FMileageCost?: string | null;
  YAvailable?: boolean | null;
  JAvailable?: boolean | null;
  YRemainingSeats?: number | null;
  JRemainingSeats?: number | null;
}

export interface LiveSearchOutcome extends ProbeResult {
  rows: AvailabilityRow[];
  rateLimitRemaining: string | null;
  rateLimitHeaders: Record<string, string>;
}

/**
 * P6 — the acceptance criterion itself: a real key, a real query, real rows, over native HTTP.
 * Also the only probe that can report X-RateLimit-Remaining, which seats.aero returns on an
 * authenticated call. PIVOT §2 wants that header trusted over the local counter.
 */
export async function probeLiveCachedSearch(apiKey: string, origin = "SFO", destination = "NRT"): Promise<LiveSearchOutcome> {
  const url = cachedSearchUrl(origin, destination);
  const base = {
    id: "P6",
    title: `Live Cached Search: ${origin} → ${destination}, over native HTTP`,
    expectation: "HTTP 200, rows rendered, and the rate-limit headers read off the response.",
    rows: [] as AvailabilityRow[],
    rateLimitRemaining: null as string | null,
    rateLimitHeaders: {} as Record<string, string>,
  };
  if (!apiKey) {
    return { ...base, status: "pending", detail: "No seats.aero key supplied — see README ‘Supplying the key’." };
  }
  const t0 = now();
  try {
    // 20_000 mirrors DEFAULT_TIMEOUT_MS in client.ts, but enforced natively rather than by
    // an AbortController the native side may not honour (see P4/P5).
    const res = await nativeFetch(url, {
      headers: { "Partner-Authorization": apiKey },
      connectTimeout: 20_000,
      readTimeout: 20_000,
    });
    const all = Object.fromEntries(res.headers.entries());
    const rateLimitHeaders = Object.fromEntries(
      Object.entries(all).filter(([k]) => k.toLowerCase().includes("ratelimit") || k.toLowerCase().includes("rate-limit")),
    );
    const remaining = res.headers.get("x-ratelimit-remaining");
    const text = await res.text();

    if (!res.ok) {
      return {
        ...base,
        status: "fail",
        ms: now() - t0,
        rateLimitRemaining: remaining,
        rateLimitHeaders,
        detail: `HTTP ${res.status}: ${text.slice(0, 200)}`,
        evidence: { status: res.status, headers: all },
      };
    }
    const json = JSON.parse(text) as { data?: AvailabilityRow[]; hasMore?: boolean; cursor?: number };
    const rows = json.data ?? [];
    return {
      ...base,
      status: rows.length > 0 ? "pass" : "inconclusive",
      ms: now() - t0,
      rows,
      rateLimitRemaining: remaining,
      rateLimitHeaders,
      detail:
        rows.length > 0
          ? `HTTP 200, ${rows.length} availability rows over native HTTP. ` +
            `X-RateLimit-Remaining: ${remaining ?? "NOT RETURNED"}.`
          : `HTTP 200 but zero rows — the call worked; this route/date window simply has no cached ` +
            `availability. Reachability is proven; try another route.`,
      evidence: {
        status: res.status,
        hasMore: json.hasMore,
        cursor: json.cursor,
        rateLimitHeaders,
        allResponseHeaders: all,
        url: url.replace(/([?&]take=)\d+/, "$1…"),
      },
    };
  } catch (err) {
    return { ...base, status: "fail", ms: now() - t0, detail: String(err), evidence: { url } };
  }
}
