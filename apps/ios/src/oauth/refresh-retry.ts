/**
 * One retry after a renewal, when seats.aero refuses the token (release plan step 18b): search, the watch runner and
 * an option's details each go through this.
 *
 * An OAuth access token can be refused before the store expected (the device's clock is off, or seats.aero reissued
 * it). Then the request is sent once more with a renewed token, and only once. What the person is told depends on
 * what the renewal found:
 *   - refused again with a token renewed just now: the account, not its token (most likely one without API access),
 *     so connecting again would not help (`refused_renewed`);
 *   - the token service could not renew it (offline, the service or seats.aero's sign-in down): a passing failure, to
 *     try again in a moment, not a lost connection (`renewal_unavailable`);
 *   - nothing to renew (the grant was revoked and purged, or nothing is connected): the refusal as it always was,
 *     "connect again".
 * A pasted key has nothing to renew (its store has no `renew`), so the key flavour sends and says exactly what it did.
 */
import { RESULTS } from "../components/results/copy";
import type { KeyStore } from "../native/keychain";
import type { ApiResult } from "../search/search";

/**
 * What renewing a refused key gave: a new key, or why there is none. "unavailable": the token service did not renew it
 * this time, which a later try may fix. "none": there is nothing to renew (a pasted key, no connection, a revoked
 * grant), or nothing new came back.
 */
export type Renewal = { key: string } | { key: null; reason: "none" | "unavailable" };

/** A KeyStore that can renew what it hands out (./token-store.ts). */
export interface RenewableKeys extends Pick<KeyStore, "get"> {
  renew?(rejected?: string | null): Promise<Renewal>;
}

/**
 * The failure kinds a refusal is said as after a renewal (search.ts ApiFailure.kind). Each has its sentence in both
 * languages in the results screen's copy; the failure's message is the English one, as the engine's others are.
 */
export type RefusalKind = "refused_renewed" | "renewal_unavailable";

/** Which of the two a failure was said as, or null (any other answer, or a refusal said as it always was). */
export function refusalKind(result: ApiResult<unknown>): RefusalKind | null {
  return !result.ok && (result.kind === "refused_renewed" || result.kind === "renewal_unavailable") ? result.kind : null;
}

const NOT_RENEWED: Renewal = { key: null, reason: "none" };

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

/** The renewal after `rejected` was refused: the renewed key, or why there is none (a key that came back the same is none). */
export async function renewedKey(keys: RenewableKeys, rejected: string | null): Promise<Renewal> {
  if (!keys.renew || !rejected) return NOT_RENEWED;
  let renewal: Renewal;
  try {
    renewal = await keys.renew(rejected);
  } catch {
    return { key: null, reason: "unavailable" };
  }
  return renewal.key === rejected ? NOT_RENEWED : renewal;
}

/** A refusal said as what the renewal found (see the top of this file); any other answer as it is. */
export function sayRefusal<T>(result: ApiResult<T>, renewal: Renewal): ApiResult<T> {
  if (!refusedByProvider(result) || result.ok) return result;
  const kind: RefusalKind | null = renewal.key !== null ? "refused_renewed" : renewal.reason === "unavailable" ? "renewal_unavailable" : null;
  return kind ? { ...result, kind, message: RESULTS.en.runFailed[kind] } : result;
}

/** After `refused` and `renewal`: once more with the renewed key when there is one, and the answer said as above. */
export async function afterRenewal<T>(refused: ApiResult<T>, renewal: Renewal, attempt: (key: string) => Promise<ApiResult<T>>): Promise<ApiResult<T>> {
  return sayRefusal(renewal.key !== null ? await attempt(renewal.key) : refused, renewal);
}

/**
 * Run `attempt` with the key; when seats.aero refuses it and the store renews it, once more with the new one.
 * `stillWanted` is asked before the second send (a search a newer one replaced is not sent again).
 */
export async function withRenewal<T>(keys: RenewableKeys, attempt: (key: string | null) => Promise<ApiResult<T>>, stillWanted: () => boolean = () => true): Promise<ApiResult<T>> {
  const key = await readKey(keys);
  const first = await attempt(key);
  if (!refusedByProvider(first) || !stillWanted()) return first;
  return afterRenewal(first, await renewedKey(keys, key), attempt);
}
