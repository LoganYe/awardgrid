/**
 * Minimal JSON client for the settings page. Every API error is `{ error: <code> }`, so the
 * helper returns the code (or a synthetic "network" / "unknown") and the parsed body — never
 * the raw response text, which keeps error rendering to translated codes only.
 */
export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  /** `resetAt` accompanies a 429 `quota` error (ISO timestamp of the next UTC midnight). */
  | { ok: false; status: number; error: string; resetAt?: string };

export async function apiJson<T>(path: string, init: { method: string; body?: unknown } = { method: "GET" }): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method,
      credentials: "same-origin",
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    return { ok: false, status: 0, error: "network" };
  }
  if (res.status === 204) return { ok: true, status: 204, data: undefined as T };
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  if (res.ok) return { ok: true, status: res.status, data: parsed as T };
  const code = typeof parsed === "object" && parsed !== null && typeof (parsed as { error?: unknown }).error === "string"
    ? (parsed as { error: string }).error
    : res.status === 401
      ? "unauthorized"
      : "unknown";
  const resetAt = typeof parsed === "object" && parsed !== null && typeof (parsed as { resetAt?: unknown }).resetAt === "string"
    ? (parsed as { resetAt: string }).resetAt
    : undefined;
  return { ok: false, status: res.status, error: code, ...(resetAt ? { resetAt } : {}) };
}

// ---------------------------------------------------------------------------
// Endpoints the settings page uses
// ---------------------------------------------------------------------------

export interface TelegramLinkResult {
  deepLink: string | null;
  mock: boolean;
  expiresAt?: string;
}
export interface TelegramStatusResult {
  linked: boolean;
  mock: boolean;
}

export const apiTelegramLink = (): Promise<ApiResult<TelegramLinkResult>> => apiJson("/api/telegram/link", { method: "POST" });
export const apiTelegramUnlink = (): Promise<ApiResult<undefined>> => apiJson("/api/telegram/link", { method: "DELETE" });
export const apiTelegramStatus = (): Promise<ApiResult<TelegramStatusResult>> => apiJson("/api/telegram/status");

/**
 * POST /api/auth/password — 200 `{ ok: true }` with a rotated session cookie, or
 * `{ error: "invalid_current" | "weak_password" | "invalid_body" }`. Changing the password logs
 * out every other device (the route revokes the other sessions).
 */
export const apiChangePassword = (current: string, next: string): Promise<ApiResult<{ ok: true }>> =>
  apiJson("/api/auth/password", { method: "POST", body: { current, next } });

// ---------------------------------------------------------------------------
// Formatting (Intl only; the locale is the UI language)
// ---------------------------------------------------------------------------

const intlLocale = (locale: string): string => (locale === "zh" ? "zh-CN" : "en-US");

/** "2026-09-06T12:34:56.000Z" → locale date string; falls back to the raw value. */
export function formatDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/**
 * Day and month for a status line ("Sep 6" / "9月6日"), with the year only when it is not the
 * current one — a key added this year needs no year to be understood.
 */
export function formatDayMonth(iso: string, locale: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const options: Intl.DateTimeFormatOptions =
    d.getFullYear() === now.getFullYear() ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" };
  try {
    return new Intl.DateTimeFormat(intlLocale(locale), options).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}
