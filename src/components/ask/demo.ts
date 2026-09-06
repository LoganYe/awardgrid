/**
 * Offline demo stream wiring (e2e only). The screenshot suite runs with no ANTHROPIC_API_KEY, so
 * the real ask lane can never stream; `/api/ask/demo` serves a scripted SSE stream with the same
 * framing so the streaming UI can be exercised and photographed offline.
 *
 * Two independent switches, both required:
 *   - the server must run with ASK_DEMO_STREAM=1 (otherwise the route is a 404), and
 *   - the page must ask for it: NEXT_PUBLIC_ASK_DEMO=1 at build time, or `?askdemo=1` in the URL
 *     (the URL form also works against a build made without the variable, which is how CI builds).
 *
 * `?askcap=1` additionally puts the drawer at its daily cap so that state can be captured.
 * In production neither switch is set, no probe request is made, and the route does not exist.
 */

export const ASK_DEMO_ENDPOINT = "/api/ask/demo";

/**
 * Where the decision is remembered for the rest of the browser session. The grid rewrites its
 * own URL when a query runs, so the switch must survive losing the query string.
 */
export const ASK_DEMO_STORAGE_KEY = "awardgrid.ask.demo";

export interface AskDemoState {
  on: boolean;
  /** Report today's spend at the cap, so the at-cap state can be captured. */
  cap: boolean;
  /** Answer with this error code instead of a stream (`?askerr=no_key`). */
  err: AskDemoError | null;
}

/** The failure states the scripted stream can act out; anything else is ignored. */
export const ASK_DEMO_ERRORS = ["no_key", "timeout", "plugin_missing", "budget", "sdk"] as const;
export type AskDemoError = (typeof ASK_DEMO_ERRORS)[number];

export function askDemoError(value: string | null): AskDemoError | null {
  return value !== null && (ASK_DEMO_ERRORS as readonly string[]).includes(value) ? (value as AskDemoError) : null;
}

export const ASK_DEMO_OFF: AskDemoState = { on: false, cap: false, err: null };

/** Does this page want the scripted stream? Pass `window.location.search`. */
export function askDemoRequested(search: string): boolean {
  if (process.env.NEXT_PUBLIC_ASK_DEMO === "1") return true;
  try {
    return new URLSearchParams(search).get("askdemo") === "1";
  } catch {
    return false;
  }
}

/** Does this page want the at-cap state? Only meaningful together with `askDemoRequested`. */
export function askDemoCapRequested(search: string): boolean {
  try {
    return new URLSearchParams(search).get("askcap") === "1";
  } catch {
    return false;
  }
}

/** Which scripted failure this page wants, if any (`?askerr=no_key`). */
export function askDemoErrorRequested(search: string): AskDemoError | null {
  try {
    return askDemoError(new URLSearchParams(search).get("askerr"));
  } catch {
    return null;
  }
}

/**
 * The switch for this page, remembered for the session. Pure apart from the two storage calls,
 * both guarded so a browser with storage disabled still resolves from the URL.
 */
export function resolveAskDemo(search: string, storage: Storage | null): AskDemoState {
  if (askDemoRequested(search)) {
    const state: AskDemoState = { on: true, cap: askDemoCapRequested(search), err: askDemoErrorRequested(search) };
    try {
      storage?.setItem(ASK_DEMO_STORAGE_KEY, JSON.stringify({ cap: state.cap, err: state.err }));
    } catch {
      // storage disabled: the URL still carries the switch for this page view
    }
    return state;
  }
  try {
    const raw = storage?.getItem(ASK_DEMO_STORAGE_KEY);
    if (!raw) return ASK_DEMO_OFF;
    const parsed: unknown = JSON.parse(raw);
    const obj = (typeof parsed === "object" && parsed !== null ? parsed : {}) as { cap?: unknown; err?: unknown };
    return { on: true, cap: obj.cap === true, err: askDemoError(typeof obj.err === "string" ? obj.err : null) };
  } catch {
    return ASK_DEMO_OFF;
  }
}

/**
 * Scripted stream URL (POST, same body as /api/ask). The locale travels with it: the scripted
 * answer has a Chinese script too, so an answered zh screenshot is not an English answer body
 * under Chinese chrome.
 */
export function askDemoStreamUrl({ cap, err }: Pick<AskDemoState, "cap" | "err">, locale?: string): string {
  const suffix = locale === "zh" ? "locale=zh" : "";
  const query = [err ? `err=${err}` : cap ? "cap=1" : "", suffix].filter(Boolean).join("&");
  return query.length > 0 ? `${ASK_DEMO_ENDPOINT}?${query}` : ASK_DEMO_ENDPOINT;
}

/**
 * Scripted usage URL. `answers` is how many answers this page has already received, so the
 * meter moves after every answer without the route holding any state.
 */
export function askDemoUsageUrl(answers: number, cap: boolean): string {
  const after = Number.isFinite(answers) ? Math.max(0, Math.trunc(answers)) : 0;
  return `${ASK_DEMO_ENDPOINT}?usage=1&after=${after}${cap ? "&cap=1" : ""}`;
}

/** Is the route actually enabled on this server? A 404 (production) answers false. */
export async function probeAskDemo(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`${ASK_DEMO_ENDPOINT}?probe=1`, { credentials: "same-origin", headers: { accept: "application/json" } });
    if (!res.ok) return false;
    const body = (await res.json()) as { demo?: unknown };
    return body.demo === true;
  } catch {
    return false;
  }
}
