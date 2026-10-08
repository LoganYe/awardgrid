/**
 * One retry after a renewal, when seats.aero refuses the token (release plan step 18b): search, the watch runner and
 * an option's details each go through this.
 *
 * An OAuth access token can be refused before the store expected (the device's clock is off, or seats.aero reissued
 * it). Then the request is sent once more with a renewed token, and only once: a second refusal is the answer, said as
 * it always was. A pasted key has nothing to renew (its store has no `refresh`), so the key flavour sends exactly what
 * it sent before.
 */
import type { KeyStore } from "../native/keychain";
import type { ApiResult } from "../search/search";

/** A KeyStore that can renew what it hands out (./token-store.ts). */
export interface RenewableKeys extends Pick<KeyStore, "get"> {
  refresh?(rejected?: string | null): Promise<string | null>;
}

/** seats.aero refused the key or token itself (HTTP 401 or 403): search.ts reports it as `no_key` with that status. */
export function refusedByProvider(result: ApiResult<unknown>): boolean {
  return !result.ok && result.error === "no_key" && (result.status === 401 || result.status === 403);
}

/** The key, or null when there is none or it cannot be read. */
export async function readKey(keys: Pick<KeyStore, "get">): Promise<string | null> {
  try {
    return await keys.get();
  } catch {
    return null;
  }
}

/**
 * The renewed key after `rejected` was refused, or null when there is nothing to renew (a pasted key), nothing came
 * back, or it came back the same.
 */
export async function renewedKey(keys: RenewableKeys, rejected: string | null): Promise<string | null> {
  if (!keys.refresh || !rejected) return null;
  let fresh: string | null;
  try {
    fresh = await keys.refresh(rejected);
  } catch {
    return null;
  }
  return fresh && fresh !== rejected ? fresh : null;
}

/**
 * Run `attempt` with the key; when seats.aero refuses it and the store renews it, once more with the new one.
 * `stillWanted` is asked before the second send (a search a newer one replaced is not sent again).
 */
export async function withRenewal<T>(keys: RenewableKeys, attempt: (key: string | null) => Promise<ApiResult<T>>, stillWanted: () => boolean = () => true): Promise<ApiResult<T>> {
  const key = await readKey(keys);
  const first = await attempt(key);
  if (!refusedByProvider(first) || !stillWanted()) return first;
  const fresh = await renewedKey(keys, key);
  return fresh ? attempt(fresh) : first;
}
