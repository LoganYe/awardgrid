/**
 * The OAuth flavour through the app's own services (release plan step 18b): connect, search with the Bearer token,
 * renew a refused token, the 24-hour limit at launch and on a sweep, Saved searched again, Disconnect's purge and a
 * revoked grant's — with seats.aero, the token service and the sign-in sheet faked, and the files in memory. The key
 * flavour is checked beside it: no account, no limit, nothing pruned.
 */
import { describe, expect, it, vi } from "vitest";
import { fakeFetch, jsonResponse } from "@awardgrid/core/test-fixtures/seatsaero/helpers";
import { favoriteFromSnapshot } from "@awardgrid/core/workspace/favorites-store";
import type { Watch } from "@awardgrid/core/watch";
import { MemoryKeyStore } from "../native/keychain";
import type { BrokerResult, TokenBroker } from "../oauth/broker";
import { CALLBACK_SCHEME } from "../oauth/connect";
import { MemoryTokenVault } from "../oauth/token-vault";
import { CACHE_FILE, MemoryFileStore, SnapshotStore } from "../store/persistence";
import { type BootstrapOptions, bootstrap } from "./bootstrap";

const T0 = Date.parse("2026-10-01T00:00:00.000Z");
const HOUR = 3600_000;
const QUERY = "HKG to SEA next 30 days business";

function apiRow(date: string) {
  return {
    ID: `id-${date}`,
    RouteID: "r1",
    Route: { ID: "r1", OriginAirport: "HKG", DestinationAirport: "SEA", Source: "alaska" },
    Date: date,
    ParsedDate: `${date}T00:00:00Z`,
    Source: "alaska",
    JAvailable: true,
    JMileageCost: "81234",
    JRemainingSeats: 2,
    JAirlines: "AS",
    JDirect: true,
    YAvailable: false,
    WAvailable: false,
    FAvailable: false,
  };
}

/** seats.aero, faked: accepts the access tokens in `valid` (as "Bearer …") or any pasted key, and counts calls. */
function seatsAero() {
  const state = { calls: 0, auth: [] as string[], valid: new Set<string>(["seats:ota:first"]) };
  const fetchImpl = fakeFetch((req) => {
    state.calls += 1;
    const auth = req.headers["partner-authorization"] ?? "";
    state.auth.push(auth);
    if (auth.startsWith("Bearer ") && !state.valid.has(auth.slice(7))) return jsonResponse({}, 401);
    return req.url.pathname.endsWith("/routes") ? jsonResponse([]) : jsonResponse({ data: [apiRow("2026-10-05")], hasMore: false });
  });
  return { fetchImpl, state };
}

/** The token service, faked: answers refreshes from a queue (default: a new token that seats.aero then accepts). */
function tokenService(seats: ReturnType<typeof seatsAero>, answers: BrokerResult[] = []) {
  let n = 1;
  const refreshes: string[] = [];
  const broker: TokenBroker = {
    exchange: vi.fn(async (code: string) =>
      code === "good-code" ? ({ ok: true, grant: { access: "seats:ota:first", refresh: "seats:otr:one", expiresIn: 3599 } } as BrokerResult) : ({ ok: false, reason: "rejected", status: 400, error: "invalid_grant" } as BrokerResult),
    ),
    refresh: vi.fn(async (refresh: string) => {
      refreshes.push(refresh);
      const queued = answers.shift();
      if (queued) return queued;
      n += 1;
      const access = `seats:ota:renewed${n}`;
      seats.state.valid.add(access);
      return { ok: true, grant: { access, refresh: null, expiresIn: 3599 } } as BrokerResult;
    }),
  };
  return { broker, refreshes };
}

interface Session {
  now: { t: number };
  files: MemoryFileStore;
  seats: ReturnType<typeof seatsAero>;
  vault: MemoryTokenVault;
  service: ReturnType<typeof tokenService>;
}

function session(over: Partial<Session> = {}): Session {
  const seats = over.seats ?? seatsAero();
  return {
    now: over.now ?? { t: T0 },
    files: over.files ?? new MemoryFileStore(),
    seats,
    vault: over.vault ?? new MemoryTokenVault({ access: "seats:ota:first", refresh: "seats:otr:one", expiresAt: T0 + 3599_000 }),
    service: over.service ?? tokenService(seats),
  };
}

function boot(s: Session, extra: Partial<BootstrapOptions> = {}) {
  return bootstrap({
    snapshots: new SnapshotStore(s.files),
    now: () => new Date(s.now.t),
    fetchImpl: s.seats.fetchImpl,
    oauth: {
      vault: s.vault,
      broker: s.service.broker,
      clientId: "test-client",
      legacyKeys: null,
      authorize: async (url) => ({ ok: true, url: `${CALLBACK_SCHEME}://oauth/seats?code=good-code&state=${new URL(url).searchParams.get("state")}` }),
    },
    ...extra,
  });
}

function watch(): Watch {
  return { id: "w1", name: "HKG to SEA", text: QUERY, draft: null, lastCheckedAt: null, baseline: [], dropThresholdPct: 10, enabled: true, createdAt: new Date(T0).toISOString() };
}

/** Every file's text, joined: what is on the device's disk. */
const disk = (files: MemoryFileStore) => [...files.files.values()].join("\n");

describe("the key flavour is unchanged", () => {
  it("no account, no limit, and results older than 24 hours stay where they were", async () => {
    const files = new MemoryFileStore();
    const keys = new MemoryKeyStore();
    await keys.set("pro_unchanged_test_key");
    const seats = seatsAero();
    let now = T0;
    const first = await bootstrap({ keys, snapshots: new SnapshotStore(files), now: () => new Date(now), fetchImpl: seats.fetchImpl });
    expect(first.seatsAccount).toBeNull();
    expect(first.shortTermMs).toBeNull();
    expect((await first.searchText(QUERY)).ok).toBe(true);
    await first.persist();
    now = T0 + 48 * HOUR;
    const later = await bootstrap({ keys, snapshots: new SnapshotStore(files), now: () => new Date(now), fetchImpl: seats.fetchImpl });
    expect(later.workspace.getState().displayedSnapshot?.rows.length).toBeGreaterThan(0);
    expect(later.cache.snapshot().users[0]?.rows.length).toBeGreaterThan(0);
    expect(seats.state.auth.every((a) => a === "pro_unchanged_test_key")).toBe(true);
  });
});

describe("the OAuth flavour", () => {
  it("connects through the sign-in sheet and the token service, and searches with the Bearer token", async () => {
    const s = session({ vault: new MemoryTokenVault() });
    const svc = await boot(s);
    expect(svc.seatsAccount?.configured).toBe(true);
    expect(svc.shortTermMs).toBe(24 * HOUR);
    expect(await svc.seatsAccount!.connected()).toBe(false);
    expect((await svc.searchText(QUERY)).ok).toBe(false);
    expect(await svc.seatsAccount!.connect()).toEqual({ ok: true });
    expect(s.service.broker.exchange).toHaveBeenCalledWith("good-code", expect.stringMatching(/^[A-Za-z0-9_-]{43}$/));
    expect(await svc.seatsAccount!.connected()).toBe(true);
    expect((await svc.searchText(QUERY)).ok).toBe(true);
    expect(s.seats.state.auth.filter(Boolean).every((a) => a === "Bearer seats:ota:first")).toBe(true);
  });

  it("a build without a client ID cannot start connecting, and says so", async () => {
    const s = session({ vault: new MemoryTokenVault() });
    const svc = await boot(s, { oauth: { vault: s.vault, broker: s.service.broker, clientId: "", legacyKeys: null } });
    expect(svc.seatsAccount?.configured).toBe(false);
    expect(await svc.seatsAccount!.connect()).toEqual({ ok: false, reason: "not_configured" });
  });

  it("a token seats.aero refuses is renewed through the token service and the search sent once more", async () => {
    const s = session();
    s.seats.state.valid.delete("seats:ota:first");
    const svc = await boot(s);
    const res = await svc.searchText(QUERY);
    expect(res.ok).toBe(true);
    expect(s.service.refreshes).toEqual(["seats:otr:one"]);
    const sent = s.seats.state.auth.filter(Boolean);
    expect(sent[0]).toBe("Bearer seats:ota:first");
    expect(sent.length).toBeGreaterThan(1);
    expect(sent.slice(1).every((a) => a === "Bearer seats:ota:renewed2")).toBe(true);
    expect((await s.vault.read())?.access).toBe("seats:ota:renewed2");
  });

  it("at launch, everything older than 24 hours is gone: cache, workspace, Saved rows, a watch's baseline", async () => {
    const s = session();
    const first = await boot(s);
    expect((await first.searchText(QUERY)).ok).toBe(true);
    const shown = first.workspace.getState().displayedSnapshot!;
    await first.favorites.save(favoriteFromSnapshot(shown, new Date(s.now.t).toISOString(), "f1"));
    first.watches.add(watch());
    await first.checkWatches();
    expect(first.watches.get("w1")!.baseline.length).toBeGreaterThan(0);
    await first.persist();
    expect(disk(s.files)).toContain("81234");

    // 25 hours later, a new launch.
    s.now.t = T0 + 25 * HOUR;
    s.vault = new MemoryTokenVault({ access: "seats:ota:first", refresh: "seats:otr:one", expiresAt: s.now.t + 3599_000 });
    const later = await boot(s);
    expect(later.cache.snapshot().users.every((u) => u.rows.length === 0 && u.coverage.length === 0)).toBe(true);
    expect(later.workspace.getState().displayedSnapshot).toBeNull();
    expect(later.workspace.history()).toEqual([]);
    const saved = later.favorites.get("f1")!;
    expect(saved).toMatchObject({ rows: [], rowsRemoved: { at: new Date(s.now.t).toISOString(), options: shown.rows.length } });
    expect(saved.query).toEqual(shown.query);
    expect(later.watches.get("w1")).toMatchObject({ baseline: [], baselineWindow: null, text: QUERY });
    await later.persist();
    // Off the disk too, in every file and both slots.
    expect(disk(s.files)).not.toContain("81234");
  });

  it("a sweep removes what passed 24 hours while the app stayed open", async () => {
    const s = session();
    const svc = await boot(s);
    expect((await svc.searchText(QUERY)).ok).toBe(true);
    await svc.favorites.save(favoriteFromSnapshot(svc.workspace.getState().displayedSnapshot!, new Date(s.now.t).toISOString(), "f1"));
    await svc.persist();
    s.now.t += 23 * HOUR;
    await svc.sweepShortTerm();
    expect(svc.workspace.getState().displayedSnapshot).not.toBeNull();
    expect(svc.favorites.get("f1")!.rows.length).toBeGreaterThan(0);
    s.now.t += 2 * HOUR;
    await svc.sweepShortTerm();
    expect(svc.workspace.getState().displayedSnapshot).toBeNull();
    expect(svc.favorites.get("f1")!.rowsRemoved).toBeDefined();
    expect(svc.cache.snapshot().users.every((u) => u.rows.length === 0)).toBe(true);
    expect(disk(s.files)).not.toContain("81234");
  });

  it("opening a Saved item past 24 hours searches its query again and puts fresh rows back", async () => {
    const s = session();
    const svc = await boot(s);
    await svc.searchText(QUERY);
    await svc.favorites.save(favoriteFromSnapshot(svc.workspace.getState().displayedSnapshot!, new Date(s.now.t).toISOString(), "f1"));
    s.now.t += 25 * HOUR;
    s.vault = new MemoryTokenVault({ access: "seats:ota:first", refresh: "seats:otr:one", expiresAt: s.now.t + 3599_000 });
    const later = await boot(s);
    expect(later.favorites.get("f1")!.rowsRemoved).toBeDefined();
    const before = s.seats.state.calls;
    const outcome = await later.refreshSaved("f1");
    expect(outcome.ok).toBe(true);
    expect(s.seats.state.calls).toBeGreaterThan(before);
    const item = later.favorites.get("f1")!;
    expect(item.rowsRemoved).toBeUndefined();
    expect(item.rows.length).toBeGreaterThan(0);
    expect(item.rows.every((r) => Date.parse(r.value.fetched_at) === s.now.t)).toBe(true);
    expect(await later.refreshSaved("missing")).toEqual({ ok: false, reason: "unknown" });
  });

  it("Disconnect removes the tokens and every seats.aero result: cache, workspace, Saved rows, watches' baselines, details", async () => {
    const s = session();
    const svc = await boot(s);
    await svc.searchText(QUERY);
    const shown = svc.workspace.getState().displayedSnapshot!;
    await svc.favorites.save(favoriteFromSnapshot(shown, new Date(s.now.t).toISOString(), "f1"));
    svc.watches.add(watch());
    await svc.checkWatches();
    svc.workspace.setSelected({ snapshotId: shown.id, rowKey: shown.rows[0]!.key }, true);
    await svc.persist();
    expect(disk(s.files)).toContain("81234");

    expect(await svc.seatsAccount!.disconnect()).toEqual({ ok: true });
    expect(await s.vault.read()).toBeNull();
    expect(await svc.seatsAccount!.connected()).toBe(false);
    expect(svc.cache.snapshot().users.every((u) => u.rows.length === 0)).toBe(true);
    expect(JSON.parse(s.files.files.get(CACHE_FILE) ?? "{}").users ?? []).toEqual([]);
    expect(svc.workspace.getState().displayedSnapshot).toBeNull();
    expect(svc.workspace.getState().selected).toEqual([]);
    expect(svc.lastSearch.get()).toBeNull();
    expect(svc.favorites.get("f1")).toMatchObject({ rows: [], query: shown.query });
    expect(svc.watches.get("w1")).toMatchObject({ baseline: [], lastCheckedAt: null, lastResult: null, text: QUERY, enabled: true });
    expect(disk(s.files)).not.toContain("81234");
    // Searching now needs a connection again.
    expect(await svc.searchText(QUERY)).toMatchObject({ ok: false, error: "no_key" });
  });

  it("Disconnect also removes a key pasted in an earlier key-flavour build", async () => {
    const s = session();
    const legacy = new MemoryKeyStore();
    await legacy.set("pro_legacy_key_from_build_4");
    const svc = await boot(s, { oauth: { vault: s.vault, broker: s.service.broker, clientId: "c", legacyKeys: legacy } });
    await svc.seatsAccount!.disconnect();
    expect(await legacy.get()).toBeNull();
  });

  it("a revoked grant (seats.aero refuses the refresh token) purges the same way, without waiting on itself", async () => {
    const s = session();
    s.service = tokenService(s.seats, [{ ok: false, reason: "rejected", status: 400, error: "invalid_grant" }]);
    const svc = await boot(s);
    await svc.searchText(QUERY);
    await svc.favorites.save(favoriteFromSnapshot(svc.workspace.getState().displayedSnapshot!, new Date(s.now.t).toISOString(), "f1"));
    await svc.persist();
    // The person removes AwardGrid in seats.aero: the token is refused, and the renewal is refused too. (The cache is
    // emptied first, so the search reaches seats.aero instead of being answered from this device.)
    s.seats.state.valid.clear();
    await svc.clearCache();
    const res = await svc.searchText(QUERY);
    expect(res).toMatchObject({ ok: false, error: "no_key" });
    await vi.waitFor(async () => {
      expect(await s.vault.read()).toBeNull();
      expect(svc.favorites.get("f1")!.rows).toEqual([]);
      expect(disk(s.files)).not.toContain("81234");
    });
    expect(await svc.seatsAccount!.connected()).toBe(false);
  });
});
