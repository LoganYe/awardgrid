/**
 * Booting the app on sample data (release plan step 16), and entering and leaving it. Loaded only in sample mode, or
 * at the moment of switching (../app/data-source.ts imports it dynamically), so none of sample mode's code or data is
 * in the bundle a live launch runs.
 *
 * Sample mode's ports, every one of them its own:
 *   - **keys**: an in-memory key store holding a placeholder, so search, details and watches run as they do with an
 *     account. It is never written to the Keychain, never shown (Settings says "Sample data" instead), and never sent
 *     anywhere: the sample transport is the only thing that sees it.
 *   - **the Anthropic key**: an empty in-memory store; Ask stays off in sample mode.
 *   - **transports**: the sample transport for seats.aero (./sample-fetch.ts), and one that refuses every Anthropic
 *     request. The native HTTP adapter is never built, let alone called.
 *   - **files**: the live file store under `sample/` (SampleFiles): the cache, the quota counter, watches, the
 *     workspace, Saved, settings. These services never read or write the real ones, nor today's real call count.
 *   - **no account**: in the OAuth flavour too, sample mode boots with `oauth: null`, so the token store is never built
 *     and no token is read, renewed or removed; there is nothing to Disconnect, and Settings › seats.aero account says
 *     to exit sample data to connect. Sample data is made on this device, so no short-term limit applies to it.
 *
 * The account's own files are another matter in the OAuth flavour: they hold seats.aero's results under its 24-hour
 * limit, and the account's services, which sweep them, are not running. `accountSweeper` sweeps them while sample mode
 * runs (DataSourceControl.sweepAccount), reading no token either.
 *
 * Entering copies the language and appearance chosen in Settings into sample/'s settings, so the app looks the same;
 * leaving copies them back (a choice made in sample mode is still the person's choice) and deletes sample/.
 */
import { type BootstrapOptions, bootstrap, shortTermLimitOf } from "../app/bootstrap";
import { type DataSourceControl, type SampleCoverage, writeDataSource } from "../app/data-source";
import { SETTINGS_NAMESPACE, SettingsStore } from "../app/settings-store";
import { MemoryKeyStore } from "../native/keychain";
import { type FileStore, SnapshotStore } from "../store/persistence";
import { SlotFileStorage } from "../workspace/slot-storage";
import { SAMPLE_AIRPORT_COUNT, sampleCovers } from "./airports";
import { sampleCoversDate } from "./generate";
import { createSampleFetch } from "./sample-fetch";

/** Where sample mode's files live in the live file store. */
export const SAMPLE_PREFIX = "sample/";
/** The list of every file sample mode has written, so leaving can delete them all (a FileStore cannot list). */
export const SAMPLE_INDEX = `${SAMPLE_PREFIX}files.json`;
/** What sample mode's in-memory key store holds: not a key, and never shown, saved or sent off the device. */
export const SAMPLE_KEY = "sample-mode-on-this-device";

/** What sample data covers, as the Search screen says it. */
export const SAMPLE_COVERAGE: SampleCoverage = {
  airports: SAMPLE_AIRPORT_COUNT,
  covers: sampleCovers,
  coversDate: sampleCoversDate,
};

async function readIndex(live: FileStore): Promise<string[]> {
  try {
    const raw = await live.read(SAMPLE_INDEX);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

/**
 * The live file store, under `sample/`. Every path it writes is added to sample/files.json first, so clearSampleFiles
 * can find it again after a relaunch. Index writes are queued and each writes the whole list as it stands then.
 *
 * Sealed when sample mode is left (`seal`): a save the old services still make after that — a search or a watch check
 * that finished during the exit — is dropped, and the writes already under way finish before sample/ is deleted, so
 * no file outlives the exit unlisted and turns up in the next visit.
 */
export class SampleFiles implements FileStore {
  readonly #live: FileStore;
  #index: Promise<Set<string>> | null = null;
  #saving: Promise<unknown> = Promise.resolve();
  #sealed = false;
  readonly #writing = new Set<Promise<void>>();

  constructor(live: FileStore) {
    this.#live = live;
  }

  #known(): Promise<Set<string>> {
    this.#index ??= readIndex(this.#live).then((paths) => new Set(paths));
    return this.#index;
  }

  async read(path: string): Promise<string | null> {
    return this.#live.read(SAMPLE_PREFIX + path);
  }

  async write(path: string, data: string): Promise<void> {
    if (this.#sealed) return;
    const write = this.#write(path, data);
    this.#writing.add(write);
    try {
      await write;
    } finally {
      this.#writing.delete(write);
    }
  }

  /** Stop writing (later writes are dropped), once the writes under way have finished. */
  async seal(): Promise<void> {
    this.#sealed = true;
    await Promise.allSettled([...this.#writing]);
  }

  /** Write again: the exit that sealed this store failed, and sample mode goes on. */
  unseal(): void {
    this.#sealed = false;
  }

  async #write(path: string, data: string): Promise<void> {
    const known = await this.#known();
    if (!known.has(path)) {
      known.add(path);
      const saved = this.#saving.then(() => this.#live.write(SAMPLE_INDEX, JSON.stringify([...known].sort())));
      this.#saving = saved.catch(() => undefined);
      await saved;
    }
    await this.#live.write(SAMPLE_PREFIX + path, data);
  }

  async remove(path: string): Promise<void> {
    await this.#live.remove(SAMPLE_PREFIX + path);
  }
}

/** Delete every file sample mode wrote, then its list. Nothing outside sample/ is touched. */
export async function clearSampleFiles(live: FileStore): Promise<void> {
  for (const path of await readIndex(live)) await live.remove(SAMPLE_PREFIX + path);
  await live.remove(SAMPLE_INDEX);
}

/** The language and appearance chosen in one file store's settings (defaults when none, or unreadable). */
async function chosen(files: FileStore): Promise<{ locale: "en" | "zh" | null; theme: ReturnType<SettingsStore["theme"]> }> {
  const settings = new SettingsStore({ storage: new SlotFileStorage(files), deviceLocale: "en" });
  await settings.restore();
  const { locale, theme } = settings.get();
  return { locale, theme };
}

/**
 * Switch to sample data: start from an empty sample/, with the language and appearance of Settings, then keep the
 * choice. Rejects (and the app stays as it is) when the choice cannot be saved.
 */
export async function enterSampleData(live: FileStore): Promise<void> {
  await clearSampleFiles(live);
  const { locale, theme } = await chosen(live);
  await new SlotFileStorage(new SampleFiles(live)).writeAtomically(SETTINGS_NAMESPACE, { locale, theme, aiConsent: null });
  await writeDataSource(live, "sample");
}

/**
 * Switch back to the account: the language and appearance chosen in sample mode go back to Settings, the choice is
 * kept, and sample/ is deleted. The choice is written before anything is deleted, so a failure part-way leaves the app
 * on the account, and entering sample mode again starts by clearing whatever was left.
 */
export async function exitSampleData(live: FileStore): Promise<void> {
  const { locale, theme } = await chosen(new SampleFiles(live));
  const settings = new SettingsStore({ storage: new SlotFileStorage(live), deviceLocale: "en" });
  await settings.restore();
  if (locale !== null && locale !== settings.get().locale) await settings.setLocale(locale);
  if (theme !== settings.get().theme) await settings.setTheme(theme);
  await writeDataSource(live, "live");
  await clearSampleFiles(live);
}

/** Every Anthropic request in sample mode: refused before anything is sent (Ask is off). */
const noAnthropic: typeof fetch = async () => {
  throw new Error("Not available with sample data.");
};

/** The account sweeper's transports: it only removes what passed the limit, and sends nothing. */
const sendNothing: typeof fetch = async () => {
  throw new Error("The sweep sends nothing.");
};

export interface AccountSweeper {
  /** One sweep of the account's files; joins the one under way. Never throws. */
  sweep(): Promise<void>;
  /** Run no more sweeps, once the one under way has finished (leaving sample mode). */
  stop(): Promise<void>;
  /** Sweep again: the exit that stopped it failed, and sample mode goes on. */
  resume(): void;
}

/**
 * The sweep of the account's own files while sample mode runs, for an account under a short-term limit of `limitMs`
 * (the OAuth flavour's 24 hours). Each sweep boots the account's services afresh over `live`'s files — so it never
 * keeps an old reading of them — with no account at all: `oauth: null`, so the token store is never built and no token
 * is read; an empty in-memory key; transports that send nothing. Their launch and their own `sweepShortTerm` remove
 * what passed the limit (cache rows, workspace snapshots, Saved rows, watch baselines, an Ask conversation) and save.
 * Nothing under sample/ is read or written.
 */
export function accountSweeper(live: BootstrapOptions, files: FileStore, limitMs: number): AccountSweeper {
  let running: Promise<void> | null = null;
  let stopped = false;
  const sweep = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    running ??= (async () => {
      try {
        const account = await bootstrap({
          snapshots: new SnapshotStore(files),
          now: live.now,
          locale: live.locale,
          visibility: live.visibility,
          keys: new MemoryKeyStore(),
          anthropicKeys: new MemoryKeyStore(),
          fetchImpl: sendNothing,
          anthropicFetch: sendNothing,
          // Both transports are injected and neither is native (the rule bootstrap.ts gives); nothing is sent anyway.
          assertNative: () => {},
          oauth: null,
          shortTermMs: limitMs,
        });
        await account.sweepShortTerm();
      } catch {
        // The next sweep tries again, and the account's own launch prunes the same way.
      } finally {
        running = null;
      }
    })();
    return running;
  };
  return {
    sweep,
    async stop() {
      stopped = true;
      await running;
    },
    resume() {
      stopped = false;
    },
  };
}

/** The options sample mode boots with, over the live ones it was chosen from (their clock, language and visibility). */
export async function sampleBootstrapOptions(live: BootstrapOptions, files: FileStore, control: DataSourceControl): Promise<BootstrapOptions> {
  const keys = new MemoryKeyStore();
  await keys.set(SAMPLE_KEY);
  const now = live.now ?? (() => new Date());
  const sampleFiles = new SampleFiles(files);
  // The account's files keep their limit while sample mode runs (the OAuth flavour); none to keep in the key flavour.
  const accountLimit = shortTermLimitOf(live);
  const sweeper = accountLimit != null ? accountSweeper(live, files, accountLimit) : null;
  return {
    keys,
    anthropicKeys: new MemoryKeyStore(),
    snapshots: new SnapshotStore(sampleFiles),
    now: live.now,
    fetchImpl: createSampleFetch({ now }),
    anthropicFetch: noAnthropic,
    visibility: live.visibility,
    // Both transports are injected here, and neither is native: there is no native bridge for Ask to check for (the
    // rule bootstrap.ts gives for a host that injects both). Ask stays off in sample mode either way.
    assertNative: () => {},
    locale: live.locale,
    // No account in sample mode, whatever the flavour: no token store, no Disconnect, and no limit on sample data.
    oauth: null,
    shortTermMs: null,
    dataSource: {
      ...control,
      kind: "sample",
      coverage: SAMPLE_COVERAGE,
      ...(sweeper ? { sweepAccount: sweeper.sweep } : {}),
      // These services stop writing under sample/ before it is deleted (SampleFiles.seal), and go on if the exit fails.
      // The account sweeper finishes before the account's own services boot over its files, and goes on likewise.
      async exitSample() {
        await sampleFiles.seal();
        await sweeper?.stop();
        try {
          await control.exitSample();
        } catch (err) {
          sampleFiles.unseal();
          sweeper?.resume();
          throw err;
        }
      },
    },
  };
}
