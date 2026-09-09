/**
 * Everything that has to happen once, at launch, in the right order.
 *
 * The order matters in one specific way: the quota snapshot is restored BEFORE the first search
 * can run, and the `X-RateLimit-Remaining` observer is wired into the fetch adapter at
 * construction — not after the first response. If it were wired later, the very first call after
 * a reinstall would be the one call whose header nobody read, which is exactly the case PIVOT §2
 * says to protect against.
 */
import { InMemoryAvailabilityCache } from "@awardgrid/core/seatsaero/cache";
import { Quota } from "@awardgrid/core/seatsaero/quota";
import { RoutesCatalog } from "@awardgrid/core/seatsaero/routes";
import { createNativeFetch } from "../native/http";
import { type KeyStore, keychain } from "../native/keychain";
import { SnapshotStore } from "../store/persistence";
import { DeviceQuotaStore } from "../store/quota-store";
import { SearchEngine } from "../search/search";

export interface AppServices {
  engine: SearchEngine;
  cache: InMemoryAvailabilityCache;
  quotaStore: DeviceQuotaStore;
  snapshots: SnapshotStore;
  keys: KeyStore;
  /** Persist whatever has changed. Cheap to call; skips the quota write when nothing moved. */
  persist(): Promise<void>;
}

export interface BootstrapOptions {
  keys?: KeyStore;
  snapshots?: SnapshotStore;
  now?: () => Date;
  /** Injected in tests; production builds the native adapter. */
  fetchImpl?: typeof fetch;
}

/** Only seats.aero's own responses are authoritative about seats.aero's quota. */
function isSeatsAero(input: RequestInfo | URL): boolean {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return url.startsWith("https://seats.aero/");
}

/**
 * Wrap a fetch so every seats.aero response's rate-limit header is fed to `observe` before the
 * response is handed on. Transport-agnostic on purpose (see the call site).
 *
 * Reading the header must never be able to break a search: a throw here would turn a successful
 * API call into a failed one, and the local counter is only ever a safety margin.
 */
export function withRateLimitObserver(inner: typeof fetch, observe: (headers: Headers) => void): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await inner(input, init);
    if (isSeatsAero(input)) {
      try {
        observe(res.headers);
      } catch {
        // Never let bookkeeping fail a request.
      }
    }
    return res;
  }) as typeof fetch;
}

export async function bootstrap(opts: BootstrapOptions = {}): Promise<AppServices> {
  const now = opts.now ?? (() => new Date());
  const keys = opts.keys ?? keychain;
  const snapshots = opts.snapshots ?? new SnapshotStore();

  const cache = new InMemoryAvailabilityCache();
  const quotaStore = new DeviceQuotaStore();

  // Warm start. Both are best-effort: a missing or corrupt snapshot costs one cold search, and
  // must never stop the app from launching.
  cache.restore(await snapshots.loadCache());
  quotaStore.restore(await snapshots.loadQuota());

  // The observer wraps whatever transport we end up with, rather than living inside the native
  // adapter. Putting it in the adapter looked tidier and was wrong: any other transport — a test
  // double today, a desktop or extension shell tomorrow — would silently lose the reconciliation
  // while still appearing to work, which is the exact failure mode PIVOT §2 is about.
  const fetchImpl = withRateLimitObserver(opts.fetchImpl ?? createNativeFetch(), (headers) =>
    quotaStore.observeRateLimitRemaining(headers.get("x-ratelimit-remaining"), now()),
  );

  const engine = new SearchEngine({
    fetchImpl,
    cache,
    routes: new RoutesCatalog(),
    quota: new Quota({ store: quotaStore, now }),
    now,
  });

  return {
    engine,
    cache,
    quotaStore,
    snapshots,
    keys,
    async persist() {
      await snapshots.saveCache(cache.snapshot());
      if (quotaStore.dirty) {
        await snapshots.saveQuota(quotaStore.snapshot(now()));
        quotaStore.markClean();
      }
    },
  };
}
