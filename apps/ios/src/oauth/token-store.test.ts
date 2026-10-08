/**
 * The OAuth flavour's KeyStore (./token-store.ts): what every seats.aero call reads, renewed early, once at a time,
 * through the token service; a revoked grant purges, a passing failure does not; Disconnect wins over a renewal.
 */
import { describe, expect, it, vi } from "vitest";
import type { BrokerResult, TokenBroker } from "./broker";
import { EARLY_REFRESH_MS, TokenKeyStore, bearer } from "./token-store";
import { MemoryTokenVault, type SeatsTokens, type TokenVault } from "./token-vault";

const T0 = Date.parse("2026-10-06T12:00:00Z");
const TOKENS: SeatsTokens = { access: "seats:ota:first", refresh: "seats:otr:keep", expiresAt: T0 + 3599_000 };

function broker(answers: BrokerResult[] | ((refresh: string) => Promise<BrokerResult>)) {
  const calls: string[] = [];
  const queue = Array.isArray(answers) ? [...answers] : null;
  const b: TokenBroker = {
    exchange: vi.fn(async () => ({ ok: false, reason: "unavailable", status: 500, error: null }) as BrokerResult),
    refresh: vi.fn(async (refresh: string): Promise<BrokerResult> => {
      calls.push(refresh);
      if (queue) return queue.shift() ?? { ok: false, reason: "unavailable", status: 500, error: null };
      return (answers as (refresh: string) => Promise<BrokerResult>)(refresh);
    }),
  };
  return { broker: b, calls };
}

const fresh = (access: string, refresh: string | null = null, expiresIn = 3599): BrokerResult => ({ ok: true, grant: { access, refresh, expiresIn } });

describe("TokenKeyStore", () => {
  it("hands out the access token as a Bearer value, and null when nothing is connected", async () => {
    const vault = new MemoryTokenVault(TOKENS);
    const store = new TokenKeyStore({ vault, broker: broker([]).broker, now: () => T0 });
    expect(await store.get()).toBe("Bearer seats:ota:first");
    expect(bearer("seats:ota:x")).toBe("Bearer seats:ota:x");
    expect(await new TokenKeyStore({ vault: new MemoryTokenVault(), broker: broker([]).broker }).get()).toBeNull();
  });

  it("renews early: a token with less than five minutes left is replaced before it is handed out", async () => {
    let now = T0;
    const vault = new MemoryTokenVault(TOKENS);
    const { broker: b, calls } = broker([fresh("seats:ota:second")]);
    const store = new TokenKeyStore({ vault, broker: b, now: () => now });
    now = TOKENS.expiresAt - EARLY_REFRESH_MS - 1;
    expect(await store.get()).toBe("Bearer seats:ota:first");
    expect(calls).toEqual([]);
    now = TOKENS.expiresAt - EARLY_REFRESH_MS + 1;
    expect(await store.get()).toBe("Bearer seats:ota:second");
    expect(calls).toEqual(["seats:otr:keep"]);
    // Kept, with the refresh token seats.aero did not rotate, and a new expiry from now.
    expect(await vault.read()).toEqual({ access: "seats:ota:second", refresh: "seats:otr:keep", expiresAt: now + 3599_000 });
  });

  it("keeps a rotated refresh token", async () => {
    const vault = new MemoryTokenVault({ ...TOKENS, expiresAt: T0 });
    const store = new TokenKeyStore({ vault, broker: broker([fresh("seats:ota:second", "seats:otr:rotated")]).broker, now: () => T0 });
    await store.get();
    expect((await vault.read())?.refresh).toBe("seats:otr:rotated");
  });

  it("single flight: callers asking at once share one renewal", async () => {
    let release: (r: BrokerResult) => void = () => {};
    const { broker: b, calls } = broker(() => new Promise<BrokerResult>((resolve) => (release = resolve)));
    const store = new TokenKeyStore({ vault: new MemoryTokenVault({ ...TOKENS, expiresAt: T0 }), broker: b, now: () => T0 });
    const all = Promise.all([store.get(), store.get(), store.get(), store.renew("Bearer seats:ota:first").then((r) => r.key)]);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    release(fresh("seats:ota:second"));
    expect(await all).toEqual(["Bearer seats:ota:second", "Bearer seats:ota:second", "Bearer seats:ota:second", "Bearer seats:ota:second"]);
    expect(calls).toHaveLength(1);
  });

  it("renew(rejected) renews on demand, but not again when another caller already replaced the refused token", async () => {
    const vault = new MemoryTokenVault(TOKENS);
    const { broker: b, calls } = broker([fresh("seats:ota:second")]);
    const store = new TokenKeyStore({ vault, broker: b, now: () => T0 });
    expect(await store.renew("Bearer seats:ota:first")).toEqual({ key: "Bearer seats:ota:second" });
    expect(await store.renew("Bearer seats:ota:first")).toEqual({ key: "Bearer seats:ota:second" });
    expect(calls).toHaveLength(1);
  });

  it("a passing failure (offline, the service down) is not a disconnection: the token on file is handed out", async () => {
    const onRevoked = vi.fn();
    const vault = new MemoryTokenVault({ ...TOKENS, expiresAt: T0 - 1 });
    const store = new TokenKeyStore({ vault, broker: broker([{ ok: false, reason: "network", status: 0, error: null }]).broker, now: () => T0, onRevoked });
    expect(await store.get()).toBe("Bearer seats:ota:first");
    expect(await vault.read()).not.toBeNull();
    expect(onRevoked).not.toHaveBeenCalled();
    // A forced renewal that fails gives nothing new to retry with, and says the service could not renew it.
    const again = new TokenKeyStore({ vault, broker: broker([{ ok: false, reason: "unavailable", status: 502, error: "upstream_unavailable" }]).broker, now: () => T0 });
    expect(await again.renew("Bearer seats:ota:first")).toEqual({ key: null, reason: "unavailable" });
    expect(await vault.read()).not.toBeNull();
  });

  it("a revoked grant (invalid_grant) removes the tokens and runs the purge; from then on nothing is connected", async () => {
    const onRevoked = vi.fn();
    const vault = new MemoryTokenVault({ ...TOKENS, expiresAt: T0 });
    const store = new TokenKeyStore({ vault, broker: broker([{ ok: false, reason: "rejected", status: 400, error: "invalid_grant" }]).broker, now: () => T0, onRevoked });
    expect(await store.get()).toBeNull();
    expect(await vault.read()).toBeNull();
    expect(onRevoked).toHaveBeenCalledTimes(1);
    expect(await store.connected()).toBe(false);
    // Nothing left to renew: "none", which is said as connecting again.
    expect(await store.renew("Bearer seats:ota:first")).toEqual({ key: null, reason: "none" });
  });

  it("AwardGrid's own client being refused (invalid_client) is not the person's revocation", async () => {
    const onRevoked = vi.fn();
    const vault = new MemoryTokenVault({ ...TOKENS, expiresAt: T0 });
    const store = new TokenKeyStore({ vault, broker: broker([{ ok: false, reason: "rejected", status: 401, error: "invalid_client" }]).broker, now: () => T0, onRevoked });
    expect(await store.get()).toBe("Bearer seats:ota:first");
    expect(onRevoked).not.toHaveBeenCalled();
    expect(await vault.read()).not.toBeNull();
  });

  it("a firewall's 401/403 on the refresh (no OAuth error code) is a passing failure: tokens kept, nothing purged", async () => {
    // A 403 "rejected" (an earlier token service's word for it), a 403 page that is not JSON, a bare 401.
    for (const result of [
      { ok: false, reason: "unavailable", status: 403, error: "rejected" },
      { ok: false, reason: "unavailable", status: 403, error: null },
      { ok: false, reason: "rejected", status: 401, error: null },
      { ok: false, reason: "rejected", status: 403, error: "rejected" },
    ] satisfies BrokerResult[]) {
      const onRevoked = vi.fn();
      const vault = new MemoryTokenVault({ ...TOKENS, expiresAt: T0 });
      const store = new TokenKeyStore({ vault, broker: broker([result]).broker, now: () => T0, onRevoked });
      expect(await store.get(), JSON.stringify(result)).toBe("Bearer seats:ota:first");
      expect(await vault.read()).toEqual({ ...TOKENS, expiresAt: T0 });
      expect(await store.connected()).toBe(true);
      expect(onRevoked).not.toHaveBeenCalled();
    }
  });

  it("Disconnect wins: a renewal still out when clear() runs never writes its tokens back", async () => {
    let release: (r: BrokerResult) => void = () => {};
    const vault = new MemoryTokenVault({ ...TOKENS, expiresAt: T0 });
    const { broker: b, calls } = broker(() => new Promise<BrokerResult>((resolve) => (release = resolve)));
    const store = new TokenKeyStore({ vault, broker: b, now: () => T0 });
    const pending = store.get();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await store.clear();
    release(fresh("seats:ota:after-disconnect"));
    expect(await pending).toBeNull();
    expect(await vault.read()).toBeNull();
  });

  it("a renewal the Keychain could not keep is still used, with its rotated refresh token, until one is kept", async () => {
    const vault = new MemoryTokenVault({ ...TOKENS, expiresAt: T0 });
    vault.write = async () => {
      throw new Error("Keychain refused");
    };
    const { broker: b, calls } = broker([fresh("seats:ota:second", "seats:otr:rotated"), fresh("seats:ota:third")]);
    let now = T0;
    const store = new TokenKeyStore({ vault, broker: b, now: () => now });
    expect(await store.get()).toBe("Bearer seats:ota:second");
    expect(await store.get()).toBe("Bearer seats:ota:second");
    now += 3599_000;
    expect(await store.get()).toBe("Bearer seats:ota:third");
    expect(calls).toEqual(["seats:otr:keep", "seats:otr:rotated"]);
    // Disconnect still wins over tokens only memory holds.
    await store.clear();
    expect(await store.get()).toBeNull();
    expect(await store.connected()).toBe(false);
  });

  it("a write that removed the old item and failed to add the new one (KeychainSwift's set) loses nothing; the next read keeps it", async () => {
    const inner = new MemoryTokenVault({ ...TOKENS, expiresAt: T0 });
    let failures = 1;
    const vault: TokenVault = {
      read: () => inner.read(),
      clear: () => inner.clear(),
      // Delete, then add: the add fails once, after the delete.
      write: async (tokens) => {
        await inner.clear();
        if (failures-- > 0) throw new Error("errSecInteractionNotAllowed");
        await inner.write(tokens);
      },
    };
    const { broker: b, calls } = broker([fresh("seats:ota:second", "seats:otr:rotated")]);
    const store = new TokenKeyStore({ vault, broker: b, now: () => T0 });
    expect(await store.get()).toBe("Bearer seats:ota:second");
    expect(await inner.read()).toBeNull();
    // Still connected in this run of the app, with the rotated refresh token.
    expect(await store.connected()).toBe(true);
    expect(await store.get()).toBe("Bearer seats:ota:second");
    expect(await inner.read()).toEqual({ access: "seats:ota:second", refresh: "seats:otr:rotated", expiresAt: T0 + 3599_000 });
    expect(await store.get()).toBe("Bearer seats:ota:second");
    expect(calls).toEqual(["seats:otr:keep"]);
  });

  it("saves the code exchange's tokens with their expiry, refuses set(), and says whether it is connected without sending", async () => {
    const vault = new MemoryTokenVault();
    const { broker: b, calls } = broker([]);
    const store = new TokenKeyStore({ vault, broker: b, now: () => T0 });
    expect(await store.connected()).toBe(false);
    await store.save({ access: "seats:ota:new", refresh: "seats:otr:new", expiresIn: 3599 });
    expect(await vault.read()).toEqual({ access: "seats:ota:new", refresh: "seats:otr:new", expiresAt: T0 + 3599_000 });
    expect(await store.connected()).toBe(true);
    await expect(store.set("pasted-key")).rejects.toThrow(/own sign-in/);
    await expect(store.save({ access: "not-a-token", refresh: "seats:otr:new", expiresIn: 3599 })).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});
