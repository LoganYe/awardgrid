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
 */
import { ANTHROPIC_IDLE_TIMEOUT_MS } from "@awardgrid/core/ask/limits";
import { InMemoryAvailabilityCache } from "@awardgrid/core/seatsaero/cache";
import { Quota } from "@awardgrid/core/seatsaero/quota";
import { RoutesCatalog } from "@awardgrid/core/seatsaero/routes";
import { type AskService, type Visibility, createAskService } from "../ask/ask-service";
import { anthropicKeychain } from "../native/anthropic-key";
import { createNativeFetch } from "../native/http";
import { type KeyStore, keychain } from "../native/keychain";
import { type Locale, detectLocale } from "./locale";
import { type LastSearchStore, createWorkspaceLastSearch } from "../search/last-search";
import { AskStore } from "../store/ask-store";
import { type FileStore, SnapshotStore, WATCHES_FILE } from "../store/persistence";
import { migrateLegacyWatch } from "@awardgrid/core/workspace/watch-migration";
import { DeviceQuotaStore } from "../store/quota-store";
import { WatchStore } from "../store/watch-store";
import { type ApiResult, type FindValue, type ParsedText, SearchEngine } from "../search/search";
import { createSearchPort } from "../workspace/search-port";
import { searchViewFromSnapshot } from "../workspace/snapshot-view";
import { createDetailService, type DetailService } from "../workspace/detail-service";
import { SettingsStore } from "./settings-store";
import { FavoritesStore } from "../store/favorites-store";
import type { KeyCheckOutcome } from "@awardgrid/core/seatsaero/key-check";
import { SlotFileStorage } from "../workspace/slot-storage";
import { type PersistResult, WorkspaceStore } from "../workspace/workspace-store";
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
  const today = now.toISOString().slice(0, 10);
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
}

/** A run that came from the Search screen's text: what was typed, and what the parser said about it. */
interface TypedSearch {
  text: string;
  parsed: ParsedText;
}

/** The seats.aero key, or null when there is none or the Keychain cannot be read. */
async function readKey(keys: KeyStore): Promise<string | null> {
  try {
    return await keys.get();
  } catch {
    return null;
  }
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

  // Warm start. All best-effort: a missing or corrupt snapshot costs one cold search, and must never stop the app
  // from launching. Watches are the person's own: one that cannot be read is kept, never written over (T14).
  cache.restore(await snapshots.loadCache());
  quotaStore.restore(await snapshots.loadQuota());
  await restoreWatches(watches, snapshots, now());
  await migrateWatches(watches, snapshots.files, now());

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

  // The workspace's runs go through the same engine, one at a time; restoring it sends nothing. Each answer is
  // recorded for the Search screen and Ask BEFORE the workspace can show it, with the text that was typed when the
  // run came from the text search (`lastSearch` is created just below; answers only arrive after bootstrap returns).
  const searchPort = createSearchPort({
    engine,
    keys,
    now,
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
  const workspace = new WorkspaceStore({ search: searchPort, now: () => now().toISOString(), storage: new SlotFileStorage(snapshots.files) });
  const details = createDetailService({
    workspace,
    getTrips: (option, apiKey) => engine.getTrips(option, apiKey),
    readKey: () => readKey(keys),
    now,
  });
  await workspace.restore();
  const deviceLocale = opts.locale ?? detectLocale(typeof navigator === "undefined" ? undefined : navigator.language);
  const settings = new SettingsStore({ storage: new SlotFileStorage(snapshots.files), deviceLocale });
  await settings.restore();
  // Saved snapshots (T13): read at launch; nothing is fetched and nothing is written.
  const favorites = new FavoritesStore(new SlotFileStorage(snapshots.files), () => now().toISOString());
  await favorites.load();
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
    searchText,
    prepareText: async (text) => engine.parseText(text, await readKey(keys)),
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
