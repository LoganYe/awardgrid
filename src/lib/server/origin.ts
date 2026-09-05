/**
 * Cross-site request guard for every state-changing /api/* handler (login CSRF, kickoff
 * §0.2 #2/#8 and §5: a victim silently logged into an attacker's account would encrypt their
 * seats.aero key under the attacker's user_id).
 *
 * Rules (applied by src/proxy.ts to non-safe methods under /api/):
 *   - `Sec-Fetch-Site` present and not `same-origin` / `none` → reject.
 *   - `Origin` present and its host differs from the request `Host` (or `X-Forwarded-Host`
 *     when TRUST_PROXY_HEADERS declares a reverse proxy) → reject.
 *   - Neither header present (curl, old clients) → allowed; the JSON body rule in readJson()
 *     (Content-Type must be application/json) is the second line of defence, since HTML forms
 *     cannot send that content type cross-site without a CORS preflight.
 *
 * Pure: takes headers + method, returns a verdict. No logging (headers can carry anything).
 */
import { trustProxyHeaders } from "@/lib/server/rate-limit";

export const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

export type OriginVerdict = { ok: true } | { ok: false; reason: "sec_fetch_site" | "origin_mismatch" };

/** Host the request was addressed to, as seen by the app (proxy header only when declared trusted). */
export function requestHost(headers: Headers, env: Record<string, string | undefined> = process.env): string | null {
  if (trustProxyHeaders(env)) {
    const fwd = headers.get("x-forwarded-host");
    if (fwd) {
      const first = fwd.split(",")[0]?.trim();
      if (first) return first.toLowerCase();
    }
  }
  const host = headers.get("host");
  return host ? host.trim().toLowerCase() : null;
}

/** Host (with port) of an Origin header value, or null when it is unparsable / "null". */
export function originHost(origin: string): string | null {
  const v = origin.trim();
  if (v === "" || v === "null") return null;
  try {
    return new URL(v).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Evaluate the guard for one request. Safe methods always pass. */
export function checkOrigin(
  method: string,
  headers: Headers,
  env: Record<string, string | undefined> = process.env,
): OriginVerdict {
  if (SAFE_METHODS.has(method.toUpperCase())) return { ok: true };

  const site = headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (site && site !== "same-origin" && site !== "none") return { ok: false, reason: "sec_fetch_site" };

  const origin = headers.get("origin");
  if (origin !== null) {
    const host = requestHost(headers, env);
    const oh = originHost(origin);
    if (host === null || oh === null || oh !== host) return { ok: false, reason: "origin_mismatch" };
  }
  return { ok: true };
}

/** True when `pathname` is under the API namespace the guard protects. */
export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}
