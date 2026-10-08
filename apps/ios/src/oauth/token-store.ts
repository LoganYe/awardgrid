/**
 * The OAuth flavour's KeyStore (release plan step 18b): what every seats.aero call reads as its "key".
 *
 * `get()` returns "Bearer seats:ota:…", which the core client sends unchanged as `Partner-Authorization` — exactly the
 * header seats.aero documents for an OAuth access token — so search, watches, details and the quota counter need no
 * second code path. The access token lives about an hour; this store renews it through the token service before it
 * runs out:
 *
 *   - **Early.** A token with less than EARLY_REFRESH_MS left is renewed before it is handed out, so a search that
 *     starts just before the hour is not the one refused.
 *   - **Single flight.** Any number of callers asking at once share one renewal: one request to the service, one new
 *     token, written once.
 *   - **After a refusal.** `refresh(rejected)` renews on demand when seats.aero refused a token anyway (the device's
 *     clock, or a token revoked and reissued); a caller that hands in the token it was refused, when another caller
 *     has already replaced it, gets the new one without a second renewal (../oauth/refresh-retry.ts).
 *   - **A passing failure is not a disconnection.** Offline, or the service down: the token on file is handed out
 *     as it is, so the request says what went wrong instead of claiming no account is connected.
 *   - **A revoked grant is.** When seats.aero refuses the refresh token itself (the person removed AwardGrid in
 *     seats.aero, or the account ended), the tokens are removed and `onRevoked` runs, which purges every seats.aero
 *     result kept on the device (the OAuth Addendum asks for that on revocation). From then on `get()` is null.
 *   - **Disconnect wins.** A renewal still out when `clear()` runs never writes its tokens back.
 *
 * `set()` refuses: tokens arrive only through the connect flow (`save`). Nothing here logs a token, and a token is never
 * shown: the connect page says "Connected", never characters of it.
 */
import type { KeyStore } from "../native/keychain";
import { type BrokerResult, type TokenBroker, meansRevoked } from "./broker";
import { ACCESS_PREFIX, type SeatsTokens, type TokenVault } from "./token-vault";

/** Renew when less than this is left. */
export const EARLY_REFRESH_MS = 5 * 60_000;
/** The "Bearer " prefix seats.aero's Partner-Authorization header takes before an OAuth access token. */
export const BEARER = "Bearer ";

export function bearer(access: string): string {
  return `${BEARER}${access}`;
}

/** The access token inside a Bearer value, or the value itself. */
function accessOf(value: string): string {
  return value.startsWith(BEARER) ? value.slice(BEARER.length) : value;
}

export type RenewalOutcome = { kind: "fresh"; tokens: SeatsTokens } | { kind: "revoked" } | { kind: "failed"; result: BrokerResult } | { kind: "cleared" };

export interface TokenKeyStoreOptions {
  vault: TokenVault;
  broker: TokenBroker;
  /** ms since the epoch. */
  now?: () => number;
  earlyMs?: number;
  /** seats.aero refused the refresh token: the connection is gone. Purges what the device kept from it. */
  onRevoked?: () => Promise<void> | void;
}

export class TokenKeyStore implements KeyStore {
  readonly #vault: TokenVault;
  readonly #broker: TokenBroker;
  readonly #now: () => number;
  readonly #earlyMs: number;
  readonly #onRevoked: (() => Promise<void> | void) | undefined;
  #renewal: Promise<RenewalOutcome> | null = null;
  /** Moves on every clear() and save(): a renewal started before either never writes. */
  #generation = 0;
  /**
   * The last renewal's tokens, held in memory too: if the Keychain refused to keep them, the next request still uses
   * them (and their refresh token, which seats.aero may have rotated) rather than the older ones on file.
   */
  #latest: SeatsTokens | null = null;

  constructor(opts: TokenKeyStoreOptions) {
    this.#vault = opts.vault;
    this.#broker = opts.broker;
    this.#now = opts.now ?? (() => Date.now());
    this.#earlyMs = opts.earlyMs ?? EARLY_REFRESH_MS;
    this.#onRevoked = opts.onRevoked;
  }

  /** The tokens on file, or the newer ones a renewal could not write there. */
  async #read(): Promise<SeatsTokens | null> {
    const stored = await this.#vault.read();
    const latest = this.#latest;
    if (!stored) return null;
    return latest && latest.access !== stored.access && latest.expiresAt > stored.expiresAt ? latest : stored;
  }

  /** "Bearer seats:ota:…", renewed first when it is about to run out; null when no account is connected. */
  async get(): Promise<string | null> {
    const tokens = await this.#read();
    if (!tokens) return null;
    if (tokens.expiresAt - this.#now() > this.#earlyMs) return bearer(tokens.access);
    const outcome = await this.#renew(tokens);
    if (outcome.kind === "fresh") return bearer(outcome.tokens.access);
    if (outcome.kind === "revoked" || outcome.kind === "cleared") return null;
    // A passing failure: the token on file, so the request itself reports what happened.
    return bearer(tokens.access);
  }

  /**
   * Renew now, because seats.aero refused `rejected` (a Bearer value or a bare token). When the token on file is no
   * longer that one, another caller has renewed it already, and it is returned as it is. Null when nothing is
   * connected, the grant was revoked, or the renewal failed.
   */
  async refresh(rejected?: string | null): Promise<string | null> {
    const tokens = await this.#read();
    if (!tokens) return null;
    if (rejected && accessOf(rejected) !== tokens.access) return bearer(tokens.access);
    const outcome = await this.#renew(tokens);
    return outcome.kind === "fresh" ? bearer(outcome.tokens.access) : null;
  }

  /** Whether an account is connected, read from the Keychain alone: nothing is sent. */
  async connected(): Promise<boolean> {
    return (await this.#vault.read()) !== null;
  }

  /** Save the tokens the code exchange returned. Rejects when the Keychain refuses them. */
  async save(grant: { access: string; refresh: string; expiresIn: number }): Promise<void> {
    this.#generation += 1;
    this.#latest = null;
    await this.#vault.write({ access: grant.access, refresh: grant.refresh, expiresAt: this.#now() + grant.expiresIn * 1000 });
  }

  async set(_value: string): Promise<void> {
    throw new Error("seats.aero is connected through its own sign-in in this build; there is no key to save.");
  }

  /** Remove the tokens. A renewal still out does not bring them back. */
  async clear(): Promise<void> {
    this.#generation += 1;
    this.#renewal = null;
    this.#latest = null;
    await this.#vault.clear();
  }

  /** One renewal at a time; everyone asking meanwhile gets its outcome. */
  #renew(current: SeatsTokens): Promise<RenewalOutcome> {
    if (this.#renewal) return this.#renewal;
    const generation = this.#generation;
    const renewal = (async (): Promise<RenewalOutcome> => {
      const result = await this.#broker.refresh(current.refresh);
      if (generation !== this.#generation) return { kind: "cleared" };
      if (result.ok) {
        const tokens: SeatsTokens = { access: result.grant.access, refresh: result.grant.refresh ?? current.refresh, expiresAt: this.#now() + result.grant.expiresIn * 1000 };
        if (!tokens.access.startsWith(ACCESS_PREFIX)) return { kind: "failed", result };
        this.#latest = tokens;
        try {
          await this.#vault.write(tokens);
        } catch {
          // Not kept, but usable for this request; the next one renews again.
        }
        return { kind: "fresh", tokens };
      }
      if (meansRevoked(result)) {
        this.#generation += 1;
        this.#latest = null;
        await this.#vault.clear();
        try {
          await this.#onRevoked?.();
        } catch {
          // The purge reports its own failures; the tokens are gone either way.
        }
        return { kind: "revoked" };
      }
      return { kind: "failed", result };
    })().finally(() => {
      if (this.#renewal === renewal) this.#renewal = null;
    });
    this.#renewal = renewal;
    return renewal;
  }
}
