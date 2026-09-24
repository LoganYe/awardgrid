/**
 * Everything that has to happen once, at launch, in the right order.
 *
 * The order matters in one specific way: the quota snapshot is restored BEFORE the first search
 * can run, and the `X-RateLimit-Remaining` observer is wired into the fetch adapter at
 * construction — not after the first response. If it were wired later, the very first call after
 * a reinstall would be the one call whose header nobody read, which is exactly the case PIVOT §2
 * says to protect against.
 *
 * Ask is wired here too, and left cold. Launch builds no Anthropic client and reads no Anthropic key:
 * the service reads both keys when a question starts (../ask/ask-service.ts), so the grid lane opens,
 * searches and checks watches with no Anthropic key at all. The only Ask work at launch is reading
 * ask.json, so that a question the app was closed during shows as unfinished instead of vanishing.
 */
import { ANTHROPIC_IDLE_TIMEOUT_MS } from "@awardgrid/core/ask/limits";
import { InMemoryAvailabilityCache } from "@awardgrid/core/seatsaero/cache";
import { Quota } from "@awardgrid/core/seatsaero/quota";
import { RoutesCatalog } from "@awardgrid/core/seatsaero/routes";
import { type AskService, type Visibility, createAskService } from "../ask/ask-service";
import { anthropicKeychain } from "../native/anthropic-key";
import { createNativeFetch } from "../native/http";
import { type KeyStore, keychain } from "../native/keychain";
import { type LastSearchStore, createLastSearch } from "../search/last-search";
import { AskStore } from "../store/ask-store";
import { SnapshotStore } from "../store/persistence";
import { DeviceQuotaStore } from "../store/quota-store";
import { WatchStore } from "../store/watch-store";
import { SearchEngine } from "../search/search";
import { type WatchCheckResult, checkWatches } from "../watch/runner";

export interface AppServices {
  engine: SearchEngine;
  cache: InMemoryAvailabilityCache;
  quotaStore: DeviceQuotaStore;
  watches: WatchStore;
  snapshots: SnapshotStore;
  keys: KeyStore;
  /** The Anthropic key Ask uses, in its own Keychain item. Read when a question or a key check starts, never at launch. */
  anthropicKeys: KeyStore;
  /** Ask's one conversation. The service runs questions, not a screen, so leaving the Ask screen never stops one. */
  ask: AskService;
  /** The last successful grid search, in memory only, for Ask's "Include my last search". */
  lastSearch: LastSearchStore;
  /**
   * Persist the snapshots and Ask's conversation. The quota and watch writes are skipped when nothing moved.
   * cache.json is written on every call, and so is ask.json whenever there is a conversation, whole, so a long
   * conversation (core limits.ts MAX_CONVERSATION_FILE_BYTES) makes each call a large write.
   */
  persist(): Promise<void>;
  /**
   * Empty the availability cache, in memory AND on disk. Quota, watches, both keys and ask.json are left alone.
   * See `SnapshotStore.clearCache` for why both halves are required.
   */
  clearCache(): Promise<void>;
  /**
   * Check every watch that may be checked, once, now. Concurrent calls share one run: opening the
   * app twice in quick succession must not spend seats.aero calls on the same watches twice.
   */
  checkWatches(): Promise<WatchCheckResult[]>;
  /** The outcomes of the most recent run, in memory only. Skips (no key, low quota) live here. */
  lastWatchRun(): readonly WatchCheckResult[];
  /** Resolves once no watch run is under way: when the run in flight finishes, or at once. Ask waits on it before each tool call. */
  whenWatchesIdle(): Promise<void>;
  /** Subscribe to "the watches changed"; returns the unsubscribe function. */
  onWatchesChanged(listener: () => void): () => void;
  /** Tell subscribers the watches changed, after a screen edits the store itself. */
  notifyWatchesChanged(): void;
}

export interface BootstrapOptions {
  keys?: KeyStore;
  snapshots?: SnapshotStore;
  now?: () => Date;
  /** Injected in tests; production builds the native adapter. */
  fetchImpl?: typeof fetch;
  /** Injected in tests; production uses the Anthropic key's own Keychain item. */
  anthropicKeys?: KeyStore;
  /** The transport for api.anthropic.com. Injected in tests; production builds a second native adapter. */
  anthropicFetch?: typeof fetch;
  /** Whether awardgrid is visible. Injected in tests; production reads document.visibilityState. */
  visibility?: Visibility;
  /**
   * Ask's check that native HTTP exists before it sends anything. Production leaves it unset, so Ask keeps
   * its default (assertNativeHttpAvailable). Only a host that injects BOTH transports itself (the UI/UX test
   * host) replaces it, since there the injected anthropicFetch is the transport and no native bridge exists.
   */
  assertNative?: () => void;
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

/**
 * The seats.aero transport every grid search, watch check and Ask tool call goes through: `inner`,
 * with seats.aero's own X-RateLimit-Remaining folded into the device's quota counter on every response.
 */
export function seatsTransport(inner: typeof fetch, quotaStore: DeviceQuotaStore, now: () => Date): typeof fetch {
  return withRateLimitObserver(inner, (headers) => quotaStore.observeRateLimitRemaining(headers.get("x-ratelimit-remaining"), now()));
}

export async function bootstrap(opts: BootstrapOptions = {}): Promise<AppServices> {
  const now = opts.now ?? (() => new Date());
  const keys = opts.keys ?? keychain;
  const anthropicKeys = opts.anthropicKeys ?? anthropicKeychain;
  const snapshots = opts.snapshots ?? new SnapshotStore();

  const cache = new InMemoryAvailabilityCache();
  const quotaStore = new DeviceQuotaStore();
  const watches = new WatchStore();

  // Warm start. All best-effort: a missing or corrupt snapshot costs one cold search (or, for
  // watches, an empty list), and must never stop the app from launching.
  cache.restore(await snapshots.loadCache());
  quotaStore.restore(await snapshots.loadQuota());
  watches.restore(await snapshots.loadWatches());

  // The observer wraps whatever transport we end up with, rather than living inside the native
  // adapter. Putting it in the adapter looked tidier and was wrong: any other transport — a test
  // double today, a desktop or extension shell tomorrow — would silently lose the reconciliation
  // while still appearing to work, which is the exact failure mode PIVOT §2 is about.
  const fetchImpl = seatsTransport(opts.fetchImpl ?? createNativeFetch(), quotaStore, now);

  // Anthropic gets a second adapter of its own. Its idle timeout is 90 s where seats.aero keeps 20 s
  // (core ask/limits.ts, ANTHROPIC_IDLE_TIMEOUT_MS), and it has NO rate-limit observer: an Anthropic
  // response says nothing about seats.aero's quota. Building it sends nothing.
  const anthropicFetch = opts.anthropicFetch ?? createNativeFetch({ timeoutMs: ANTHROPIC_IDLE_TIMEOUT_MS });

  const engine = new SearchEngine({
    fetchImpl,
    cache,
    routes: new RoutesCatalog(),
    quota: new Quota({ store: quotaStore, now }),
    now,
  });

  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // One broken subscriber must not stop the others hearing about the change.
      }
    }
  };

  let lastRun: WatchCheckResult[] = [];
  let inFlight: Promise<WatchCheckResult[]> | null = null;
  const whenWatchesIdle = (): Promise<void> =>
    inFlight === null
      ? Promise.resolve()
      : inFlight.then(
          () => undefined,
          () => undefined,
        );

  const lastSearch = createLastSearch();
  const ask = createAskService({
    anthropicKeys,
    seatsKeys: keys,
    anthropicFetch,
    seatsFetch: fetchImpl,
    engine,
    store: new AskStore(snapshots.files),
    // A tool call that spent calls saves what this function saves: the cache, the quota and ask.json.
    persist: () => persist(),
    lastSearch,
    whenWatchesIdle,
    now,
    visibility: opts.visibility,
    assertNative: opts.assertNative,
  });

  const persist = async (): Promise<void> => {
    await snapshots.saveCache(cache.snapshot());
    if (quotaStore.dirty) {
      await snapshots.saveQuota(quotaStore.snapshot(now()));
      quotaStore.markClean();
    }
    if (watches.dirty) {
      await snapshots.saveWatches(watches.snapshot());
      watches.markClean();
    }
    await ask.persist();
  };

  // Last of the warm start, and the only Ask work at launch: read ask.json, where a question the app
  // was closed during becomes an unfinished entry. No key is read and nothing is sent.
  await ask.restore();

  return {
    engine,
    cache,
    quotaStore,
    watches,
    snapshots,
    keys,
    anthropicKeys,
    ask,
    lastSearch,
    persist,
    async clearCache() {
      // Memory first: if the file went first and a persist() landed in between, it would write
      // the rows straight back — which is precisely the Phase 2 bug this replaces.
      cache.restore(null);
      await snapshots.clearCache();
    },
    checkWatches() {
      if (inFlight) return inFlight;
      inFlight = (async () => {
        try {
          const results = await checkWatches({ engine, store: watches, apiKey: await keys.get(), now });
          await persist();
          lastRun = results;
          notify();
          return results;
        } finally {
          inFlight = null;
        }
      })();
      return inFlight;
    },
    lastWatchRun: () => lastRun,
    whenWatchesIdle,
    onWatchesChanged(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    notifyWatchesChanged: notify,
  };
}
