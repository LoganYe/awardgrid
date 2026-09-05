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

/** "2026-09-06T12:34:56.000Z" → locale date string; falls back to the raw value. */
export function formatDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}
