/**
 * The OAuth flavour through the app's own services (release plan step 18b): connect, search with the Bearer token,
 * renew a refused token, the 24-hour limit at launch and on a sweep, Saved searched again, Disconnect's purge and a
 * revoked grant's — with seats.aero, the token service and the sign-in sheet faked, and the files in memory. The key
 * flavour is checked beside it: no account, no limit, nothing pruned.
 *
 * Sample mode (release plan steps 16-17) in the OAuth flavour, at the end: it boots with no account, so no token is
 * read, written or removed; the account's own files still lose what passes 24 hours while it runs; and Disconnect
 * never touches sample/.
 */
import { describe, expect, it, vi } from "vitest";
import { fakeFetch, jsonResponse } from "@awardgrid/core/test-fixtures/seatsaero/helpers";
import { favoriteFromSnapshot } from "@awardgrid/core/workspace/favorites-store";
import type { Watch } from "@awardgrid/core/watch";
import { MemoryKeyStore } from "../native/keychain";
import { LOCAL_USER } from "../search/search";
import type { BrokerResult, TokenBroker } from "../oauth/broker";
import { CALLBACK_SCHEME } from "../oauth/connect";
import { MemoryTokenVault, type TokenVault } from "../oauth/token-vault";
import { SAMPLE_PREFIX, enterSampleData } from "../sample/boot";
import { CACHE_FILE, MemoryFileStore, SnapshotStore } from "../store/persistence";
import { type BootstrapOptions, bootstrap } from "./bootstrap";
import { readDataSource, resolveBoot, writeDataSource } from "./data-source";

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

/** The options the account's services boot with in the OAuth flavour, over the session's parts (`vault` by default). */
function liveOptions(s: Session, vault: TokenVault = s.vault): BootstrapOptions {
  return {
    snapshots: new SnapshotStore(s.files),
    now: () => new Date(s.now.t),
    fetchImpl: s.seats.fetchImpl,
    oauth: {
      vault,
      broker: s.service.broker,
      clientId: "test-client",
      legacyKeys: null,
      authorize: async (url) => ({ ok: true, url: `${CALLBACK_SCHEME}://oauth/seats?code=good-code&state=${new URL(url).searchParams.get("state")}` }),
    },
  };
}

function boot(s: Session, extra: Partial<BootstrapOptions> = {}) {
  return bootstrap({ ...liveOptions(s), ...extra });
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

  it("a search that leaves a pair empty asks seats.aero for no route list, on a cold launch or after", async () => {
    const s = session();
    const svc = await boot(s);
    for (const text of ["HKG, PVG to SEA next 30 days business", "HKG, PVG to SEA next 30 days first"]) {
      const res = await svc.searchText(text);
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value.notices.map((n) => n.code)).not.toContain("find.routes_skipped");
    }
    expect(s.seats.fetchImpl.calls.map((c) => c.url.pathname)).toEqual(["/partnerapi/search", "/partnerapi/search"]);
  });

  it("route lists (Ask's) last 24 hours at most, and the sweep removes them", async () => {
    const s = session();
    const svc = await boot(s);
    await svc.engine.routes.prime(LOCAL_USER, "united", []);
    s.now.t += 23 * HOUR;
    await svc.sweepShortTerm();
    expect(svc.engine.routes.loadedSources(LOCAL_USER)).toEqual(["united"]);
    s.now.t += 2 * HOUR;
    expect(svc.engine.routes.isLoaded(LOCAL_USER, "united")).toBe(false);
    await svc.sweepShortTerm();
    expect(svc.engine.routes.loadedSources(LOCAL_USER)).toEqual([]);
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
    await svc.engine.routes.prime(LOCAL_USER, "alaska", []);
    await svc.persist();
    expect(disk(s.files)).toContain("81234");

    expect(await svc.seatsAccount!.disconnect()).toEqual({ ok: true });
    expect(svc.engine.routes.loadedSources(LOCAL_USER)).toEqual([]);
    expect(await svc.engine.routes.hydrate(LOCAL_USER, ["alaska"])).toEqual([]);
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

  it("Disconnect that cannot write the workspace or Saved says so, still empties the screen, and a later sweep finishes it", async () => {
    const s = session();
    const svc = await boot(s);
    await svc.searchText(QUERY);
    const shown = svc.workspace.getState().displayedSnapshot!;
    await svc.favorites.save(favoriteFromSnapshot(shown, new Date(s.now.t).toISOString(), "f1"));
    await svc.persist();
    expect(disk(s.files)).toContain("81234");
    s.now.t += 60_000;

    // The disk refuses every write to the workspace's and Saved's slot files.
    const write = s.files.write.bind(s.files);
    let refuse = true;
    s.files.write = async (path: string, data: string) => {
      if (refuse && /^(workspace-v1|favorites-v1)\./.test(path)) throw new Error("disk full");
      return write(path, data);
    };
    const outcome = await svc.seatsAccount!.disconnect();
    // Said, not claimed as done: the connection is gone, but a file still holds results.
    expect(outcome).toMatchObject({ ok: false, reason: "saved", message: "disk full" });
    expect(await s.vault.read()).toBeNull();
    // Nothing from seats.aero is shown any more, although the old workspace file could not be written over.
    expect(svc.workspace.getState().displayedSnapshot).toBeNull();
    expect(svc.workspace.history()).toEqual([]);
    expect(svc.cache.snapshot().users.every((u) => u.rows.length === 0)).toBe(true);

    // The disk recovers: the next sweep (on returning to the app, or hourly) finishes the purge, well inside 24 hours.
    refuse = false;
    s.now.t += 60 * 60_000;
    await svc.sweepShortTerm();
    expect(svc.favorites.get("f1")).toMatchObject({ rows: [], query: shown.query });
    const workspaceFiles = [...s.files.files.entries()].filter(([path]) => path.startsWith("workspace-v1.")).map(([, text]) => text);
    expect(workspaceFiles.length).toBe(2);
    expect(disk(s.files)).not.toContain("81234");
    expect(await svc.persist()).toEqual({ ok: true });
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

/** A token vault that counts every read, write and removal (sample mode must make none), over `inner`. */
function countingVault(inner: TokenVault) {
  const counts = { read: 0, write: 0, clear: 0 };
  const vault: TokenVault = {
    read: async () => {
      counts.read += 1;
      return inner.read();
    },
    write: async (tokens) => {
      counts.write += 1;
      await inner.write(tokens);
    },
    clear: async () => {
      counts.clear += 1;
      await inner.clear();
    },
  };
  return { vault, counts };
}

/** sample/'s files, by path: what sample mode keeps. */
const sampleFiles = (files: MemoryFileStore) => Object.fromEntries([...files.files].filter(([path]) => path.startsWith(SAMPLE_PREFIX)));
/** Every other file's text, joined: the account's files. */
const accountDisk = (files: MemoryFileStore) =>
  [...files.files]
    .filter(([path]) => !path.startsWith(SAMPLE_PREFIX))
    .map(([, text]) => text)
    .join("\n");

/** The account's results on disk at s.now: a search, a Saved item and a watch's baseline, as in the tests above. */
async function accountWithResults(s: Session) {
  const live = await boot(s);
  expect((await live.searchText(QUERY)).ok).toBe(true);
  await live.favorites.save(favoriteFromSnapshot(live.workspace.getState().displayedSnapshot!, new Date(s.now.t).toISOString(), "f1"));
  live.watches.add(watch());
  await live.checkWatches();
  await live.persist();
  expect(accountDisk(s.files)).toContain("81234");
  return live;
}

const noHooks = { beforeSwitch: async () => {}, reboot: () => {} };

describe("sample mode in the OAuth flavour", () => {
  it("boots with no account: no token is read, nothing can be disconnected, no limit on sample data; searches run on sample data", async () => {
    const s = session();
    const { vault, counts } = countingVault(s.vault);
    await enterSampleData(s.files);
    const options = await resolveBoot(liveOptions(s, vault), noHooks);
    expect(options.oauth).toBeNull();
    expect(options.shortTermMs).toBeNull();
    const svc = await bootstrap(options);
    expect(svc.dataSource.kind).toBe("sample");
    expect(svc.seatsAccount).toBeNull();
    expect(svc.shortTermMs).toBeNull();
    expect((await svc.searchText(QUERY)).ok).toBe(true);
    const shown = svc.workspace.getState().displayedSnapshot!;
    expect(shown.rows.length).toBeGreaterThan(0);
    await svc.favorites.save(favoriteFromSnapshot(shown, new Date(s.now.t).toISOString(), "f1"));
    await svc.persist();
    // Sample data is made on this device: a day later it is all still there.
    s.now.t += 25 * HOUR;
    await svc.sweepShortTerm();
    expect(svc.workspace.getState().displayedSnapshot?.rows.length).toBe(shown.rows.length);
    expect(svc.favorites.get("f1")!.rowsRemoved).toBeUndefined();
    // Nothing went to seats.aero, and the Keychain's tokens were never read, written or removed.
    expect(s.seats.state.calls).toBe(0);
    expect(counts).toEqual({ read: 0, write: 0, clear: 0 });
    expect(await s.vault.read()).not.toBeNull();
  });

  it("the account's own files lose what passes 24 hours while sample mode runs; no token is read and sample/ is untouched", async () => {
    const s = session();
    await accountWithResults(s);
    const calls = s.seats.state.calls;

    // Into sample mode; the account's services are not running any more.
    const { vault, counts } = countingVault(s.vault);
    await enterSampleData(s.files);
    const svc = await bootstrap(await resolveBoot(liveOptions(s, vault), noHooks));
    expect((await svc.searchText(QUERY)).ok).toBe(true);
    await svc.persist();
    const sweepAccount = svc.dataSource.sweepAccount;
    expect(sweepAccount).toBeTypeOf("function");
    const sampleBefore = sampleFiles(s.files);
    expect(Object.keys(sampleBefore).length).toBeGreaterThan(0);

    // Within 24 hours the sweep keeps the account's results.
    s.now.t += 23 * HOUR;
    await sweepAccount!();
    expect(accountDisk(s.files)).toContain("81234");

    // Past them, it removes them from every file and both slots: cache, workspace, Saved rows, the watch's baseline.
    s.now.t += 2 * HOUR;
    await sweepAccount!();
    expect(accountDisk(s.files)).not.toContain("81234");
    expect(sampleFiles(s.files)).toEqual(sampleBefore);
    expect(s.seats.state.calls).toBe(calls);
    expect(counts).toEqual({ read: 0, write: 0, clear: 0 });

    // Back on the account (its next launch): Saved keeps the search and a summary, and the watch starts over.
    await writeDataSource(s.files, "live");
    s.vault = new MemoryTokenVault({ access: "seats:ota:first", refresh: "seats:otr:one", expiresAt: s.now.t + 3599_000 });
    const later = await boot(s);
    expect(later.favorites.get("f1")).toMatchObject({ rows: [], query: expect.anything() });
    expect(later.favorites.get("f1")!.rowsRemoved).toBeDefined();
    expect(later.watches.get("w1")).toMatchObject({ baseline: [], text: QUERY });
  });

  it("leaving sample mode waits for a sweep under way and runs no more", async () => {
    const s = session();
    await accountWithResults(s);
    await enterSampleData(s.files);
    const reboot = vi.fn();
    const svc = await bootstrap(await resolveBoot(liveOptions(s), { beforeSwitch: async () => {}, reboot }));
    s.now.t += 25 * HOUR;
    let swept = false;
    const sweeping = svc.dataSource.sweepAccount!().then(() => (swept = true));
    await svc.dataSource.exitSample();
    // The sweep finished before the exit went on to boot the account's services over the same files.
    expect(swept).toBe(true);
    await sweeping;
    expect(reboot).toHaveBeenCalledTimes(1);
    expect(await readDataSource(s.files)).toBe("live");
    const write = vi.spyOn(s.files, "write");
    await svc.dataSource.sweepAccount!();
    expect(write).not.toHaveBeenCalled();
  });

  it("the key flavour's sample mode has no account sweep", async () => {
    const files = new MemoryFileStore();
    await enterSampleData(files);
    const options = await resolveBoot({ snapshots: new SnapshotStore(files), now: () => new Date(T0), oauth: null }, noHooks);
    expect(options.dataSource?.kind).toBe("sample");
    expect(options.dataSource?.sweepAccount).toBeUndefined();
  });

  it("Disconnect never touches sample/", async () => {
    const s = session();
    // sample/ as an exit that stopped part-way leaves it: the choice written back to the account, the files not yet
    // deleted (the next visit clears them on the way in).
    await enterSampleData(s.files);
    const sample = await bootstrap(await resolveBoot(liveOptions(s), noHooks));
    expect((await sample.searchText(QUERY)).ok).toBe(true);
    await sample.persist();
    await writeDataSource(s.files, "live");
    const sampleBefore = sampleFiles(s.files);
    expect(Object.keys(sampleBefore).length).toBeGreaterThan(1);

    const live = await accountWithResults(s);
    expect(live.dataSource.kind).toBe("live");
    expect(await live.seatsAccount!.disconnect()).toEqual({ ok: true });
    expect(accountDisk(s.files)).not.toContain("81234");
    expect(sampleFiles(s.files)).toEqual(sampleBefore);
  });
});
