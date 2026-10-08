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
 *
 * The workspace (UI/UX v1 T05) is restored here too, and runs nothing: what was on screen comes back as it was saved,
 * with its own time, and a new search only starts when the person asks for one.
 *
 * The OAuth flavour (./flags.ts OAUTH, release plan step 18b) is wired here as well: the seats.aero "key" is the
 * token store (../oauth/token-store.ts), the account is connected and disconnected through `seatsAccount`, and every
 * seats.aero result the device keeps follows the 24-hour Short-Term Caching limit (../retention/short-term.ts): pruned
 * at launch, before each save, and on each `sweepShortTerm`; purged whole by Disconnect or a revoked grant. The key
 * flavour has no `seatsAccount` and no limit, and launches exactly as it did.
 */
import { ANTHROPIC_IDLE_TIMEOUT_MS } from "@awardgrid/core/ask/limits";
import { InMemoryAvailabilityCache } from "@awardgrid/core/seatsaero/cache";
import { Quota } from "@awardgrid/core/seatsaero/quota";
import { ResilientRoutesCatalog } from "@awardgrid/core/seatsaero/routes";
import { type AskService, type Visibility, createAskService } from "../ask/ask-service";
import { anthropicKeychain } from "../native/anthropic-key";
import { createNativeFetch } from "../native/http";
import { type KeyStore, keychain } from "../native/keychain";
import { type DataSourceControl, LIVE_ONLY } from "./data-source";
import { localDate } from "./local-date";
import { type Locale, detectLocale } from "./locale";
import { type LastSearchStore, createWorkspaceLastSearch } from "../search/last-search";
import { AskStore } from "../store/ask-store";
import { type FileStore, SnapshotStore, WATCHES_FILE } from "../store/persistence";
import { migrateLegacyWatch } from "@awardgrid/core/workspace/watch-migration";
import { DeviceQuotaStore } from "../store/quota-store";
import { WatchStore } from "../store/watch-store";
import { type ApiFailure, type ApiResult, type FindValue, type ParsedText, SearchEngine } from "../search/search";
import { createSearchPort } from "../workspace/search-port";
import { searchViewFromSnapshot } from "../workspace/snapshot-view";
import { createDetailService, type DetailService } from "../workspace/detail-service";
import { RequestCoordinator } from "../workspace/request-coordinator";
import { SettingsStore } from "./settings-store";
import { FavoritesStore } from "../store/favorites-store";
import { PlansStore } from "../store/plans-store";
import type { KeyCheckOutcome } from "@awardgrid/core/seatsaero/key-check";
import { SlotFileStorage } from "../workspace/slot-storage";
import { type PersistResult, WorkspaceStore } from "../workspace/workspace-store";
import { type WatchCheckResult, checkWatches } from "../watch/runner";
import { snapshotFromFind } from "@awardgrid/core/workspace/snapshot-from-find";
import { projectResults } from "@awardgrid/core/workspace/projection";
import type { FavoriteV1 } from "@awardgrid/core/workspace/types";
import { WORKSPACE_NAMESPACE } from "@awardgrid/core/workspace/workspace-store";
import { favoriteSnapshot, type FavoriteRowsReplacement } from "../store/favorites-store";
import { OAUTH, SEATS_CLIENT_ID } from "./flags";
import type { TokenBroker } from "../oauth/broker";
import type { ConnectOutcome } from "../oauth/connect";
import { type RenewableKeys, readKey as readKeySafely, renewedKey, withRenewal } from "../oauth/refresh-retry";
import type { AuthorizeResult } from "../oauth/seats-auth-plugin";
import type { TokenKeyStore } from "../oauth/token-store";
import type { TokenVault } from "../oauth/token-vault";
import { SHORT_TERM_MAX_AGE_MS, favoriteExpired, pruneCacheSnapshot, shortTermStorage, snapshotFetchedAt, watchExpiry, watchReset } from "../retention/short-term";

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
  /**
   * The versioned workspace: query revisions, the snapshot on screen and the ones before it, view preferences.
   * Saved in its own namespace by `persist`; restored at launch without running anything.
   */
  workspace: WorkspaceStore;
  /**
   * An option's details (UI/UX v1 T10): flight itineraries for a shown result, read only on an explicit request —
   * one Get Trips call through the engine's quota, cache and transport — and kept for this run of the app.
   */
  details: DetailService;
  /**
   * Check a seats.aero key before it is saved (T11): one call through the engine's quota and transport. Only on the
   * user's "Check and save"; never to draw a screen.
   */
  checkSeatsKey(draft: string): Promise<KeyCheckOutcome>;
  /**
   * The Search screen's text search, through the workspace: the text is parsed (nothing sent), the parsed query
   * runs as a workspace revision on the same engine path as every structured query, and the answer is returned in
   * the shape the screen already renders. A parse failure, or no key, never starts a run.
   */
  searchText(text: string): Promise<ApiResult<FindValue>>;
  /** The first half of `searchText`: the key check and the deterministic parse. Sends nothing. */
  prepareText(text: string): Promise<ApiResult<ParsedText>>;
  /**
   * The planner (release plan step 18): the same deterministic parse with no key asked for, since nothing is fetched —
   * a plan to look at, save, or try on sample data. A search still goes through `prepareText`'s key check.
   */
  parsePlan(text: string): Promise<ApiResult<ParsedText>>;
  /** The second half: run a parsed text as a workspace revision, labelled with the text. */
  runParsed(text: string, parsed: ParsedText): Promise<ApiResult<FindValue>>;
  /**
   * Run the shown search again as its structured query, labelled with its text: for a search whose text cannot
   * reproduce it (a mixed-cabin rule, dynamic pricing, a single airport that shares its city's code).
   */
  rerunShown(): Promise<ApiResult<FindValue>>;
  /** The last successful grid search: a view of the workspace's shown snapshot, for Ask's "Include my last search". */
  lastSearch: LastSearchStore;
  /** How the last workspace save went; null before the first. A failed save kept the previous file (docs/02 D04). */
  lastWorkspaceSave(): PersistResult | null;
  /** The app's clock (injected in tests and the fixture host): screens date things with it, not with new Date(). */
  now(): Date;
  /** The device's language (UI/UX v1 T07): what the screens speak until one is chosen in Settings. */
  locale: Locale;
  /** The language and appearance chosen in Settings (T11); screens read the language with `useLocale`. */
  settings: SettingsStore;
  /**
   * Persist the snapshots and Ask's conversation. The quota and watch writes are skipped when nothing moved.
   * cache.json is written on every call, and so is ask.json whenever there is a conversation, whole, so a long
   * conversation (core limits.ts MAX_CONVERSATION_FILE_BYTES) makes each call a large write.
   *
   * Never throws (T13, docs/02 D04): each part is saved on its own, a failed part keeps its previous file, and the
   * report — also kept in `saveStatus` for the chrome to show, with a way to try again — says which parts failed.
   */
  persist(): Promise<PersistReport>;
  /** How the last save went (T13): null when it was whole, else what could not be saved. */
  saveStatus: SaveStatus;
  /**
   * Saved snapshots (T13): copies of results, kept on this device in their own namespace. Loaded at launch without
   * fetching anything.
   */
  favorites: FavoritesStore;
  /**
   * Saved trip plans (release plan step 18): searches not run yet, as typed and as read, in their own namespace. Loaded
   * at launch without fetching anything. In sample mode they are sample mode's own, under sample/ like its other files.
   */
  plans: PlansStore;
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
  /** T17: the one queue for the entries that spend seats.aero calls; read-only use (what runs, what waits). */
  requests: Pick<RequestCoordinator, "active" | "waiting" | "idle">;
  /**
   * Where these services' results come from (release plan steps 16-17): the person's seats.aero account, or sample
   * mode's labelled sample data (./data-source.ts), and the way to switch between them.
   */
  dataSource: DataSourceControl;
  /** Subscribe to "the watches changed"; returns the unsubscribe function. */
  onWatchesChanged(listener: () => void): () => void;
  /** Tell subscribers the watches changed, after a screen edits the store itself. */
  notifyWatchesChanged(): void;
  /**
   * The OAuth flavour's seats.aero account (seats.aero's own sign-in): connect, disconnect, whether connected. Null in
   * the key flavour, whose key is pasted on the connect page and kept in `keys`.
   */
  seatsAccount: SeatsAccount | null;
  /**
   * How long seats.aero's results may be kept on this device, in ms: 24 hours in the OAuth flavour (its Addendum's
   * Short-Term Caching), null in the key flavour (no limit beyond the cache's own).
   */
  shortTermMs: number | null;
  /**
   * Remove whatever has passed the short-term limit: cache rows, workspace snapshots, Saved rows, watch baselines and
   * change details, Ask's route lists and an Ask conversation. The app calls it on returning to the foreground and
   * hourly while open; launch does the same. Does nothing without a limit. Never throws.
   */
  sweepShortTerm(): Promise<void>;
  /**
   * Search a saved item's own query again and put the fresh rows into it (the OAuth flavour: Saved keeps the query and
   * a summary once its rows pass 24 hours, and opening it fetches them again). Spends seats.aero calls, through the
   * same queue, quota and cache as any search.
   */
  refreshSaved(id: string): Promise<RefreshSavedOutcome>;
}

/** The OAuth flavour's account connection (Settings › seats.aero account). */
export interface SeatsAccount {
  /** Whether this build has an OAuth client ID; without one, Connect cannot start (a development build). */
  configured: boolean;
  /** Whether tokens are on file. Reads the Keychain only: nothing is sent. */
  connected(): Promise<boolean>;
  /** seats.aero's sign-in and consent, the code exchange, and the tokens saved (../oauth/connect.ts). */
  connect(): Promise<ConnectOutcome>;
  /**
   * Remove the tokens, then everything kept from seats.aero (the OAuth Addendum's purge): cached results, the
   * workspace's snapshots, Saved rows (each item's query and summary stay), watch baselines and change details (the
   * watches stay, and start again), loaded details, route lists and an Ask conversation. Requests already out finish
   * first, so nothing they bring back survives it.
   */
  disconnect(): Promise<DisconnectOutcome>;
}

/** "keychain": the tokens are still on file. "saved": they are gone, but a file could not be written (said, retried). */
export type DisconnectOutcome = { ok: true } | { ok: false; reason: "keychain" | "saved"; message?: string };

export type RefreshSavedOutcome =
  | { ok: true; item: FavoriteV1 }
  | { ok: false; reason: "unknown" }
  | { ok: false; reason: "search"; error: ApiFailure }
  | { ok: false; reason: "write"; detail: Exclude<FavoriteRowsReplacement, { ok: true }> };

/**
 * Watches from before T14 become structured ones (core workspace/watch-migration.ts): a date rule only on the parser's
 * proof, the rest kept as text and marked for review; none dropped. The old file is copied aside first, once, so it
 * stays readable after the first save in the new format (docs/02 D04). Nothing is fetched.
 */
export async function migrateWatches(store: WatchStore, files: FileStore, now: Date): Promise<number> {
  const legacy = store.unmigrated();
  if (legacy.length === 0) return 0;
  try {
    const raw = await files.read(WATCHES_FILE);
    if (raw !== null && (await files.read(WATCHES_V1_BACKUP)) === null) await files.write(WATCHES_V1_BACKUP, raw);
  } catch {
    // The copy is a courtesy; the migration keeps the watches either way.
  }
  const today = localDate(now);
  for (const watch of legacy) {
    const migrated = await migrateLegacyWatch({ id: watch.id, name: watch.name, enabled: watch.enabled, text: watch.text }, today);
    store.update(watch.id, { draft: migrated.draft, review: migrated.review ?? null });
  }
  return legacy.length;
}

/** Where the pre-T14 watches file is kept, as it was, once migrated. */
export const WATCHES_V1_BACKUP = "watches.v1.json";

/**
 * Read watches.json without ever losing it (T14: old data is never deleted). A file the device cannot read, or one
 * from a newer version, is held: the store takes no change and nothing is written over it. A damaged file (not a
 * watches file) is copied aside as it was, and the list starts empty; if the copy fails, it is held too.
 */
export async function restoreWatches(store: WatchStore, snapshots: SnapshotStore, now: Date): Promise<void> {
  const file = await snapshots.readWatchesFile();
  if (file.kind === "unreadable") return store.holdUnreadable();
  if (file.kind === "read") {
    store.restore(file.snapshot);
    return;
  }
  store.restore(null);
  if (file.kind === "damaged") {
    const aside = `watches.damaged-${now.toISOString().replace(/[:.]/g, "-")}.json`;
    try {
      await snapshots.files.write(aside, file.raw);
      store.noteKeptAside(aside);
    } catch {
      store.holdUnreadable();
    }
  }
}

export type PersistReport = { ok: true } | { ok: false; failed: string[]; message: string };

export interface SaveProblem {
  /** Which files could not be written: cache, quota, watches, workspace, ask. */
  failed: string[];
  /** The storage's own words for the first failure (English). */
  message: string;
  at: string;
}

/** The outcome of the last save, for the chrome (T13). */
export class SaveStatus {
  #problem: SaveProblem | null = null;
  readonly #listeners = new Set<() => void>();
  readonly get = (): SaveProblem | null => this.#problem;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  set(problem: SaveProblem | null): void {
    if (problem === null && this.#problem === null) return;
    this.#problem = problem;
    for (const listener of [...this.#listeners]) {
      try {
        listener();
      } catch {
        // One broken subscriber must not stop the others.
      }
    }
  }
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
  /** The language the translated screens speak. Default: the device's (navigator.language). */
  locale?: Locale;
  /**
   * The OAuth flavour's connection. Default: on when the build is the OAuth flavour (./flags.ts OAUTH), with the
   * Keychain vault, the token service over native HTTP, the native sign-in sheet and the build's client ID. Tests pass
   * their own parts, or null for the key flavour whatever the build.
   */
  oauth?: OAuthOptions | null;
  /** The short-term caching limit in ms. Default: 24 hours with OAuth, none without. */
  shortTermMs?: number | null;
  /**
   * Live or sample data, and the way to switch (./data-source.ts resolveBoot, which App boots through). Default: live,
   * with no way to switch.
   */
  dataSource?: DataSourceControl;
}

export interface OAuthOptions {
  vault?: TokenVault;
  broker?: TokenBroker;
  /** The transport the default broker uses. Default: a native adapter of its own (no rate-limit observer). */
  tokenFetch?: typeof fetch;
  authorize?: (url: string) => Promise<AuthorizeResult>;
  clientId?: string;
  /** A key pasted in an earlier key-flavour build, removed by Disconnect. Default: the Keychain item in production. */
  legacyKeys?: KeyStore | null;
}

/** A run that came from the Search screen's text: what was typed, and what the parser said about it. */
interface TypedSearch {
  text: string;
  parsed: ParsedText;
}

/** The seats.aero key, or null when there is none or the Keychain cannot be read. */
const readKey = readKeySafely;

/** Resolves once the workspace has no run under way (or after `timeoutMs`, so a stuck run cannot hold a purge). */
function whenWorkspaceSettled(workspace: WorkspaceStore, timeoutMs = 30_000): Promise<void> {
  if (workspace.getState().run.kind !== "running") return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    const unsubscribe = workspace.subscribe(() => {
      if (workspace.getState().run.kind !== "running") finish();
    });
  });
}

/**
 * Whether this build may load the OAuth parts (../oauth/kit.ts): the OAuth flavour, or a test (which passes `oauth` in
 * any flavour). Written out as App.tsx's OAUTH_BUILT is, so the other flavours' bundles carry no OAuth chunk.
 */
const OAUTH_KIT = import.meta.env.VITE_AG_CONNECT === "oauth" || import.meta.env.MODE === "test";

/** How many options a saved item shows: what Saved and the Search screen show of it (core projectResults). */
function optionsShown(item: FavoriteV1): number {
  return projectResults(favoriteSnapshot(item), { kind: "list", calendarCabin: "J", sort: item.query.sort_by, localFilter: {} }).rows.length;
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

/** The OAuth flavour's parts these options boot with, or null for the key flavour (tests may pass either, in any build). */
function oauthOf(opts: Pick<BootstrapOptions, "oauth">): OAuthOptions | null {
  return opts.oauth !== undefined ? opts.oauth : OAUTH ? {} : null;
}

/**
 * The short-term caching limit (ms) services booted with `opts` keep seats.aero's results under: 24 hours with OAuth,
 * none without, unless `opts` says. Sample mode (../sample/boot.ts) reads it for the account it was entered from.
 */
export function shortTermLimitOf(opts: Pick<BootstrapOptions, "oauth" | "shortTermMs">): number | null {
  return opts.shortTermMs !== undefined ? opts.shortTermMs : oauthOf(opts) ? SHORT_TERM_MAX_AGE_MS : null;
}

export async function bootstrap(opts: BootstrapOptions = {}): Promise<AppServices> {
  const now = opts.now ?? (() => new Date());
  // The OAuth flavour, unless a test says otherwise (null: the key flavour; an object: OAuth with those parts).
  const oauth = oauthOf(opts);
  const shortTermMs = shortTermLimitOf(opts);
  /** True while Disconnect or a revoked grant purges: then everything fetched so far counts as past the limit. */
  let purging = false;
  /**
   * When Disconnect or a revoked grant last purged (ms). Nothing fetched before it may stay, whatever its age, so a
   * part the purge could not finish (a file that could not be written) is finished by the next sweep.
   */
  let purgedAt = Number.NEGATIVE_INFINITY;
  /** Anything from seats.aero fetched before this instant (ms) has passed the short-term limit (all of it while purging). */
  const cutoff = () => (purging ? Number.POSITIVE_INFINITY : Math.max(now().getTime() - (shortTermMs ?? 0), purgedAt));
  // Declared before the token store, which calls it when seats.aero revokes the grant; assigned once the stores exist.
  // Started, never awaited there: a revocation is found inside a request, and the purge waits for requests to finish.
  let purgeSeatsData: () => Promise<PersistReport> = async () => ({ ok: true });
  // The OAuth parts are their own chunk, loaded only here and only for that flavour (../oauth/kit.ts). OAUTH_KIT is a
  // build-time constant, so a build of another flavour drops the import and carries no such chunk at all.
  const kit = oauth && OAUTH_KIT ? await import("../oauth/kit") : null;
  const tokenBroker = oauth && kit ? (oauth.broker ?? kit.createTokenBroker({ fetchImpl: oauth.tokenFetch ?? createNativeFetch({ timeoutMs: kit.TOKEN_SERVICE_TIMEOUT_MS }) })) : null;
  const tokenStore: TokenKeyStore | null =
    oauth && kit && tokenBroker
      ? opts.keys instanceof kit.TokenKeyStore
        ? opts.keys
        : new kit.TokenKeyStore({ vault: oauth.vault ?? kit.keychainTokenVault, broker: tokenBroker, now: () => now().getTime(), onRevoked: () => void purgeSeatsData() })
      : null;
  const keys: KeyStore & RenewableKeys = opts.keys ?? tokenStore ?? keychain;
  const anthropicKeys = opts.anthropicKeys ?? anthropicKeychain;
  const snapshots = opts.snapshots ?? new SnapshotStore();
  /** The two-slot storage for the namespaces that can hold seats.aero's rows, under the short-term limit when there is one. */
  const seatsStorage = () => (shortTermMs != null ? shortTermStorage(new SlotFileStorage(snapshots.files), cutoff) : new SlotFileStorage(snapshots.files));

  const cache = new InMemoryAvailabilityCache();
  const quotaStore = new DeviceQuotaStore();
  const watches = new WatchStore();

  /** Drop cache rows and coverage past the short-term limit, in memory. Returns how many went. */
  const pruneCache = (): number => {
    if (shortTermMs == null) return 0;
    const pruned = pruneCacheSnapshot(cache.snapshot(), cutoff());
    if (pruned.dropped > 0) cache.restore(pruned.snapshot);
    return pruned.dropped;
  };
  /** Purge what watches keep from seats.aero past the short-term limit (watch/runner.ts then sets a new baseline). */
  const expireWatches = (): number => {
    if (shortTermMs == null || watches.hold) return 0;
    let changed = 0;
    for (const watch of watches.all()) {
      const patch = watchExpiry(watch, cutoff());
      if (patch && watches.update(watch.id, patch)) changed += 1;
    }
    return changed;
  };

  // Warm start. All best-effort: a missing or corrupt snapshot costs one cold search, and must never stop the app
  // from launching. Watches are the person's own: one that cannot be read is kept, never written over (T14).
  cache.restore(await snapshots.loadCache());
  // Under the short-term limit, what passed it while the app was closed leaves the disk now, not at the next save.
  if (pruneCache() > 0) await snapshots.saveCache(cache.snapshot()).catch(() => undefined);
  quotaStore.restore(await snapshots.loadQuota());
  await restoreWatches(watches, snapshots, now());
  await migrateWatches(watches, snapshots.files, now());
  expireWatches();

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
    // Ask's route lists (a grid search loads none: search.ts #execute). One program's list failing costs its "not
    // monitored" claim, never the paid rows (#89). They are seats.aero's data too: under the short-term limit they last
    // as long as results do, and the sweep and the purge clear them.
    routes: new ResilientRoutesCatalog({ now, ...(shortTermMs != null ? { ttlMs: shortTermMs } : {}) }),
    quota: new Quota({ store: quotaStore, now }),
    now,
  });

  // The workspace's runs go through the same engine, one at a time; restoring it sends nothing. Each answer is
  // recorded for the Search screen and Ask BEFORE the workspace can show it, with the text that was typed when the
  // run came from the text search (`lastSearch` is created just below; answers only arrive after bootstrap returns).
  // T17: the one queue for the entries that spend seats.aero calls (search, watch, Ask tool call, lookup).
  const requests = new RequestCoordinator();
  const searchPort = createSearchPort({
    engine,
    keys,
    now,
    coordinate: (operation) => requests.run("search", operation),
    onAnswer: (snapshot, value, run) => {
      const typed = run.meta as TypedSearch | undefined;
      lastSearch.record(snapshot.id, {
        text: typed?.text ?? snapshot.query.raw_text,
        value: typed
          ? { ...value, warnings: [...typed.parsed.warnings, ...value.warnings], notices: [...typed.parsed.notices, ...value.notices] }
          : value,
      });
    },
  });
  const workspaceStorage = seatsStorage();
  const workspace = new WorkspaceStore({ search: searchPort, now: () => now().toISOString(), storage: workspaceStorage });
  // The OAuth flavour renews a refused token once (../oauth/refresh-retry.ts); a pasted key has nothing to renew.
  const renewKey = tokenStore ? (rejected: string | null) => renewedKey(keys, rejected) : undefined;
  const details = createDetailService({
    workspace,
    // T17: a lookup starts after any search, watch run or Ask tool call before it.
    getTrips: (option, apiKey) => requests.run("detail", () => engine.getTrips(option, apiKey)),
    readKey: () => readKey(keys),
    renewKey,
    now,
    maxAgeMs: shortTermMs,
  });
  await workspace.restore();
  const deviceLocale = opts.locale ?? detectLocale(typeof navigator === "undefined" ? undefined : navigator.language);
  const settings = new SettingsStore({ storage: new SlotFileStorage(snapshots.files), deviceLocale });
  await settings.restore();
  // Saved snapshots (T13): read at launch; nothing is fetched, and nothing is written unless rows passed the short-term
  // limit (the OAuth flavour), which are removed now, each item keeping its query and summary.
  const favorites = new FavoritesStore(seatsStorage(), () => now().toISOString());
  await favorites.load();
  const expireFavorites = async () => {
    if (shortTermMs == null) return;
    await favorites.removeRows((item) => favoriteExpired(item, cutoff()), now().toISOString(), optionsShown);
  };
  await expireFavorites();
  // Saved trip plans (release plan step 18): read at launch, the same way. Over sample mode's files in sample mode.
  const plans = new PlansStore(new SlotFileStorage(snapshots.files));
  await plans.load();
  let lastWorkspaceSave: PersistResult | null = null;

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

  const lastSearch = createWorkspaceLastSearch(workspace, searchViewFromSnapshot);
  const ask = createAskService({
    // Release D10: read at every question, so a permission withdrawn in Settings stops the next one.
    consent: () => settings.aiConsent() !== null,
    anthropicKeys,
    seatsKeys: keys,
    anthropicFetch,
    seatsFetch: fetchImpl,
    engine,
    store: new AskStore(snapshots.files),
    // A tool call that spent calls saves what this function saves: the cache, the quota and ask.json.
    persist: async () => {
      await persist();
    },
    lastSearch,
    // T15: the search and any attached results come from the one snapshot every view shows, and its selection.
    context: {
      snapshot: () => workspace.getState().displayedSnapshot,
      selected: () => workspace.getState().selected,
      subscribe: (listener) => workspace.subscribe(listener),
      // The revision of the search on screen, not the run counter: a search still running leaves a proposal about the
      // one shown pending, and publishing (or showing another) makes it stale (T16 review).
      revision: () => workspace.getState().displayedSnapshot?.revision ?? 0,
    },
    // T17: each tool call is queued with the other spending entries; one still waiting at Stop never starts.
    coordinate: (kind, operation, signal, onStart) => requests.run(kind, operation, { signal, onStart }),
    // T16: an applied proposal is a search like any other: the workspace runs it, and what it spent is saved.
    runQuery: async (query) => {
      await workspace.run(query);
      await persist();
    },
    whenWatchesIdle,
    now,
    visibility: opts.visibility,
    assertNative: opts.assertNative,
  });

  const saveStatus = new SaveStatus();
  const persist = async (): Promise<PersistReport> => {
    const failed: string[] = [];
    let message = "";
    // Each part on its own: one that fails keeps its previous file and does not stop the others.
    const attempt = async (part: string, save: () => Promise<void>) => {
      try {
        await save();
      } catch (err) {
        failed.push(part);
        message ||= err instanceof Error ? err.message || err.name : String(err);
      }
    };
    // Under the short-term limit nothing older than it is written (or kept in memory).
    pruneCache();
    await attempt("cache", () => snapshots.saveCache(cache.snapshot()));
    if (quotaStore.dirty) {
      // Marked clean only once written, so a failed write is tried again next time.
      await attempt("quota", async () => {
        await snapshots.saveQuota(quotaStore.snapshot(now()));
        quotaStore.markClean();
      });
    }
    // A held store (a newer or unreadable file) is never written: that would be writing over the person's watches.
    if (watches.dirty && !watches.hold) {
      await attempt("watches", async () => {
        await snapshots.saveWatches(watches.snapshot());
        watches.markClean();
      });
    }
    lastWorkspaceSave = await workspace.persist();
    if (!lastWorkspaceSave.ok) {
      failed.push("workspace");
      message ||= lastWorkspaceSave.message;
    }
    await attempt("ask", async () => {
      await ask.persist();
      // Ask's own save never rejects (a question must not fail on it); it says whether ask.json is still unsaved.
      if (ask.saveFailed?.()) throw new Error("ask.json could not be saved");
    });
    saveStatus.set(failed.length > 0 ? { failed, message, at: now().toISOString() } : null);
    return failed.length > 0 ? { ok: false, failed, message } : { ok: true };
  };

  const searchText = async (text: string): Promise<ApiResult<FindValue>> => {
    const parsed = await engine.parseText(text, await readKey(keys));
    if (!parsed.ok) return parsed;
    return runTyped({ text, parsed: parsed.value });
  };

  const rerunShown = async (): Promise<ApiResult<FindValue>> => {
    const shown = workspace.getState().displayedSnapshot;
    if (!shown) return { ok: false, status: 400, error: "invalid_body", message: "There is no search on screen to run again." };
    const text = lastSearch.get()?.text ?? shown.query.raw_text;
    // The order the results are read in is the view's (U-030): running the search again keeps it.
    const query = { ...shown.query, sort_by: workspace.getState().preferences.sort };
    return runTyped({ text, parsed: { query, warnings: [], notices: [] } });
  };

  const runTyped = async (typed: TypedSearch): Promise<ApiResult<FindValue>> => {
    const outcome = await workspace.run(typed.parsed.query, typed);
    const answer = searchPort.takeResult(outcome.runId);
    if (outcome.kind === "published" && answer?.ok) {
      // The parser's own warnings and notices lead, as they did when the screen called engine.search.
      return {
        ok: true,
        value: {
          ...answer.value,
          warnings: [...typed.parsed.warnings, ...answer.value.warnings],
          notices: [...typed.parsed.notices, ...answer.value.notices],
        },
      };
    }
    if (answer && !answer.ok) return answer;
    if (outcome.kind === "superseded") {
      return { ok: false, status: 409, error: "internal", message: "A newer search replaced this one before it answered." };
    }
    return { ok: false, status: 500, error: "internal", message: "The search could not be shown." };
  };

  // Last of the warm start, and the only Ask work at launch: read ask.json, where a question the app
  // was closed during becomes an unfinished entry. No key is read and nothing is sent.
  await ask.restore();

  /** Under the short-term limit, an Ask conversation holding a question older than it is cleared (it carries results). */
  const expireAsk = async () => {
    if (shortTermMs == null) return;
    const oldest = ask.state().entries[0];
    const at = oldest ? Date.parse(oldest.askedAt) : NaN;
    if (oldest && !(at >= cutoff()) && ask.state().running === null) await ask.newConversation();
  };
  await expireAsk();

  const sweepShortTerm = async (): Promise<void> => {
    if (shortTermMs == null) return;
    try {
      pruneCache();
      // Snapshots past the limit leave memory and both slots: save (pruned on the way), then read back (pruned again).
      const stale = workspace.history().some((snapshot) => !((snapshotFetchedAt(snapshot) ?? -Infinity) >= cutoff()));
      if (stale && workspace.getState().run.kind !== "running") {
        await workspace.persist();
        // A search started during the save would be set aside by reading back now (restore resets the run), so the
        // read-back waits for the next sweep; every save meanwhile writes the workspace without the old rows.
        if (workspace.getState().run.kind !== "running") {
          await workspace.restore();
          workspace.clearSelection();
        }
      }
      // A chosen option is kept as a copy once its search leaves the history (core selection.ts): that copy, too.
      if (workspace.selectionEntries().some((entry) => entry.row !== null && !(Date.parse(entry.row.value.fetched_at) >= cutoff()))) {
        workspace.clearSelection();
      }
      await engine.routes.clear(cutoff());
      await expireFavorites();
      const watchesChanged = expireWatches() > 0;
      await expireAsk();
      await persist();
      if (watchesChanged) notify();
    } catch {
      // A sweep that could not finish runs again on the next foreground, and saves are pruned meanwhile.
    }
  };

  purgeSeatsData = async (): Promise<PersistReport> => {
    // What is already out finishes first, so nothing it brings back outlives the purge.
    await requests.idle();
    await whenWorkspaceSettled(workspace);
    await whenWatchesIdle();
    // Every part that could not be purged is said: Disconnect must not claim results were removed when they were not.
    const failed: string[] = [];
    let message = "";
    const fail = (part: string, text: string) => {
      failed.push(part);
      message ||= text;
    };
    purgedAt = now().getTime();
    purging = true;
    try {
      details.clear();
      lastSearch.clear();
      await engine.routes.clear();
      cache.restore(null);
      await snapshots.clearCache().catch(() => undefined);
      const state = workspace.getState();
      let workspaceWritten = true;
      try {
        await workspaceStorage.writeAtomically(WORKSPACE_NAMESPACE, { schemaVersion: 1, revision: state.revision, displayedId: null, previousId: null, preferences: state.preferences, snapshots: [] });
      } catch {
        workspaceWritten = false;
      }
      // Read back. While purging, the short-term storage drops every snapshot it reads, so the screen is emptied even
      // when the write above failed and the old file is still there.
      await workspace.restore();
      workspace.clearSelection();
      // That old file is then written over by the save below, and by every later save until one succeeds; the save
      // below reports it if it fails again.
      if (!workspaceWritten) workspace.setPreferences({});
      const saved = await favorites.removeRows(() => true, now().toISOString(), optionsShown);
      if (!saved.ok) fail("saved", saved.reason === "write_failed" ? saved.message : "Saved could not be changed on this device, so its seats.aero results were not removed.");
      if (!watches.hold) for (const watch of watches.all()) watches.update(watch.id, watchReset());
      if (ask.state().entries.length > 0 && ask.state().running === null) await ask.newConversation();
      const report = await persist();
      if (!report.ok) for (const part of report.failed) fail(part, report.message);
    } catch (err) {
      // Nothing above should throw; if something does, the purge is reported as unfinished, never as done.
      fail("purge", err instanceof Error ? err.message || err.name : String(err));
    } finally {
      purging = false;
    }
    notify();
    return failed.length > 0 ? { ok: false, failed, message } : { ok: true };
  };

  const legacyKeys = oauth ? (oauth.legacyKeys !== undefined ? oauth.legacyKeys : opts.oauth === undefined ? keychain : null) : null;
  const clientId = oauth ? (oauth.clientId ?? SEATS_CLIENT_ID) : "";
  const seatsAccount: SeatsAccount | null =
    oauth && kit && tokenStore && tokenBroker
      ? {
          configured: clientId !== "",
          connected: () => tokenStore.connected(),
          connect: () => kit.connectSeats({ clientId, authorize: oauth.authorize ?? ((url) => kit.authorizeWithSeats(url)), broker: tokenBroker, store: tokenStore }),
          async disconnect(): Promise<DisconnectOutcome> {
            await tokenStore.clear().catch(() => undefined);
            await legacyKeys?.clear().catch(() => undefined);
            const report = await purgeSeatsData();
            if (await tokenStore.connected()) return { ok: false, reason: "keychain" };
            return report.ok ? { ok: true } : { ok: false, reason: "saved", message: report.message };
          },
        }
      : null;

  return {
    engine,
    cache,
    quotaStore,
    watches,
    snapshots,
    keys,
    anthropicKeys,
    ask,
    workspace,
    details,
    checkSeatsKey: (draft) => engine.checkKey(draft),
    seatsAccount,
    shortTermMs,
    sweepShortTerm,
    async refreshSaved(id): Promise<RefreshSavedOutcome> {
      const item = favorites.get(id);
      if (!item) return { ok: false, reason: "unknown" };
      // T17: queued like any search; a token seats.aero refuses is renewed once (the OAuth flavour).
      const answer = await withRenewal(keys, (key) => requests.run("search", () => engine.searchQuery(item.query, key)));
      if (!answer.ok) {
        await persist();
        return { ok: false, reason: "search", error: answer };
      }
      const snapshot = snapshotFromFind(answer.value, { id: `saved-${id}`, revision: 0 }, now().toISOString());
      const written = await favorites.replaceRows(id, snapshot);
      await persist();
      return written.ok ? { ok: true, item: written.item } : { ok: false, reason: "write", detail: written };
    },
    searchText,
    prepareText: async (text) => engine.parseText(text, await readKey(keys)),
    parsePlan: (text) => engine.parsePlan(text),
    runParsed: (text, parsed) => runTyped({ text, parsed }),
    rerunShown,
    lastSearch,
    lastWorkspaceSave: () => lastWorkspaceSave,
    now,
    locale: deviceLocale,
    settings,
    persist,
    saveStatus,
    favorites,
    plans,
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
          // T17: one watch run is one job in the queue: it starts after a search or lookup under way, and they after it.
          const results = await requests.run("watch", async () =>
            checkWatches({ engine, store: watches, apiKey: await keys.get(), now, renewKey, baselineMaxAgeMs: shortTermMs }),
          );
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
    requests,
    dataSource: opts.dataSource ?? LIVE_ONLY,
    onWatchesChanged(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    notifyWatchesChanged: notify,
  };
}
