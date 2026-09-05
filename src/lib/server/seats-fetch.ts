/**
 * Dev-only escape hatch: when SEATS_AERO_BASE_URL is set (e.g. http://127.0.0.1:3999/partnerapi/
 * from `pnpm exec tsx scripts/mock-seatsaero.ts`), every request the seats.aero client makes to
 * https://seats.aero/partnerapi/ is rewritten to that base so the whole web app can be exercised
 * against the recorded fixtures without spending a single real API call.
 *
 * Unset in production → returns undefined → the real global fetch is used unchanged.
 */
import { SEATS_AERO_BASE_URL } from "@/lib/seatsaero/client";

export function seatsFetchFromEnv(env: Record<string, string | undefined> = process.env): typeof fetch | undefined {
  const base = env.SEATS_AERO_BASE_URL?.trim();
  if (!base) return undefined;
  const target = base.replace(/\/?$/, "/");
  const rewritten: typeof fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith(SEATS_AERO_BASE_URL)) {
      const next = target + url.slice(SEATS_AERO_BASE_URL.length);
      return fetch(next, init);
    }
    return fetch(input as string, init);
  };
  return rewritten;
}
