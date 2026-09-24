/**
 * Check a seats.aero key before it is saved (UI/UX v1 T11; docs/04 S08 "检查并保存"): the smallest documented Cached
 * Search — one route, one day, ten rows — which costs exactly one seats.aero call. The screen says so before the
 * user asks for it, and nothing checks a key on its own.
 *
 * Ported from the web's `validateSeatsAeroKey` (src/lib/keys/index.ts, left as it is), with the call accounted the
 * way runGetTrips accounts one (trips.ts): reserved on the quota before the request, released only if no request
 * reached the transport. 401/403 → the key is refused; a transport failure or timeout → network (the request may
 * have arrived, so the call stays counted); any other failure → unknown. A 200 whose body does not match the schema
 * still proves the key was accepted.
 *
 * Two outcomes send nothing, and say so: a key with a space or line break inside it ("malformed": seats.aero is never
 * asked, so it is not said to have refused it), and a day whose calls are used up ("quota", with when the count
 * resets). Every outcome is a value; nothing here throws.
 */
import { SeatsAeroClient, SeatsAeroHttpError, SeatsAeroNetworkError, SeatsAeroResponseError } from "./client";
import { type Quota, QuotaExceededError } from "./quota";

export type KeyCheckOutcome =
  | { ok: true }
  | { ok: false; reason: "invalid" | "malformed" | "network" | "unknown" }
  | { ok: false; reason: "quota"; resetAt: string };

export interface KeyCheckOptions {
  apiKey: string;
  userId: string;
  fetch: typeof fetch;
  quota: Quota;
}

export async function checkSeatsKey(opts: KeyCheckOptions): Promise<KeyCheckOutcome & { api_calls_used: number }> {
  const key = opts.apiKey.trim();
  if (key.length === 0) return { ok: false, reason: "invalid", api_calls_used: 0 };
  if (/\s/.test(key)) return { ok: false, reason: "malformed", api_calls_used: 0 };
  const client = new SeatsAeroClient({ apiKey: key, fetch: opts.fetch });
  const day = opts.quota.today();
  try {
    await opts.quota.reserve(opts.userId, 1, day);
  } catch (err) {
    if (err instanceof QuotaExceededError) return { ok: false, reason: "quota", resetAt: err.resetAt.toISOString(), api_calls_used: 0 };
    return { ok: false, reason: "unknown", api_calls_used: 0 };
  }
  let calls = 0;
  const unsubscribe = client.subscribe(() => {
    calls += 1;
  });
  try {
    await client.cachedSearch({ origin_airport: ["SEA"], destination_airport: ["NRT"], start_date: day, end_date: day, take: 10 });
    return { ok: true, api_calls_used: calls };
  } catch (err) {
    if (err instanceof SeatsAeroResponseError) return { ok: true, api_calls_used: calls };
    if (err instanceof SeatsAeroHttpError) return { ok: false, reason: err.kind === "invalid_key" ? "invalid" : "unknown", api_calls_used: calls };
    if (err instanceof SeatsAeroNetworkError) return { ok: false, reason: "network", api_calls_used: calls };
    return { ok: false, reason: "unknown", api_calls_used: calls };
  } finally {
    unsubscribe();
    if (calls === 0) await opts.quota.release(opts.userId, 1, day);
    else if (calls > 1) await opts.quota.increment(opts.userId, calls - 1, day);
  }
}
