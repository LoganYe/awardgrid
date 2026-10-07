/**
 * Where this run of the app gets its results (release plan steps 16-17): the person's own seats.aero account
 * ("live"), or sample mode's labelled sample data, made up on this device for any route AwardGrid knows ("sample").
 *
 * The choice is kept in its own small file beside the app's others (the same two-slot storage as the workspace) and
 * read before bootstrap(), on every launch, by `resolveBoot`: App boots with what it returns. In sample mode the
 * services are built over sample mode's own ports (../sample/boot.ts: an in-memory key, the sample transport, files
 * under sample/), so the real Keychain item, the real snapshots and today's real call count are never read or
 * written. Switching writes the choice and boots the app again in place; leaving sample mode deletes sample/.
 *
 * Sample mode's code is loaded only when it is used: ../sample/boot.ts and what it imports are their own chunk.
 */
import { createContext } from "react";
import type { BootstrapOptions } from "./bootstrap";
import { type FileStore, capacitorFiles } from "../store/persistence";
import { SlotFileStorage } from "../workspace/slot-storage";

export type DataSourceKind = "live" | "sample";

/** The file (two slots) that holds the choice, in the live file store. */
export const DATA_SOURCE_NAMESPACE = "data-source-v1";

/** What sample data covers, for the empty-result note: the airports AwardGrid recognises, today … today + 364. */
export interface SampleCoverage {
  /** How many airports. */
  airports: number;
  /** Whether a code (an airport or a metro of the seed) has sample data. */
  covers(code: string): boolean;
  /** Whether a day (YYYY-MM-DD) is inside the covered window on `today`. */
  coversDate(date: string, today: string): boolean;
}

export interface DataSourceControl {
  readonly kind: DataSourceKind;
  /** Sample mode only. */
  readonly coverage: SampleCoverage | null;
  /** Save what is on screen, switch to sample data and boot again on it. Live mode only. */
  enterSample(): Promise<void>;
  /** Switch back to the account, delete sample/ and boot again. Sample mode only. */
  exitSample(): Promise<void>;
}

/** A run with no way to switch (tests, the probe builds): live, and switching does nothing. */
export const LIVE_ONLY: DataSourceControl = {
  kind: "live",
  coverage: null,
  enterSample: async () => {},
  exitSample: async () => {},
};

/** Whether these services show sample data. Services built without a data source (older tests) are live. */
export function isSample(services: { dataSource?: DataSourceControl } | null | undefined): boolean {
  return services?.dataSource?.kind === "sample";
}

/**
 * Whether the screen shows sample data, for what renders rows without the services in hand (a card's time line).
 * App provides it; anything rendered outside App reads false.
 */
export const SampleDataContext = createContext(false);

/** The choice on this device. Anything missing, unreadable or unexpected is "live": sample mode is only ever chosen. */
export async function readDataSource(files: FileStore): Promise<DataSourceKind> {
  try {
    const value = await new SlotFileStorage(files).read(DATA_SOURCE_NAMESPACE);
    return typeof value === "object" && value !== null && (value as { source?: unknown }).source === "sample" ? "sample" : "live";
  } catch {
    return "live";
  }
}

/** Keep the choice. Rejects when it could not be saved, so a switch that would not survive a relaunch is not made. */
export async function writeDataSource(files: FileStore, kind: DataSourceKind): Promise<void> {
  await new SlotFileStorage(files).writeAtomically(DATA_SOURCE_NAMESPACE, { source: kind });
}

/** The live file store the app was given: the host's (tests, the fixture host) or the device's. */
export function liveFilesOf(live: BootstrapOptions): FileStore {
  return live.snapshots?.files ?? capacitorFiles;
}

export interface BootHooks {
  /** Before entering sample mode: save what the live services hold. */
  beforeSwitch(): Promise<unknown>;
  /** Boot the app again, which reads the choice again. */
  reboot(): void;
}

/**
 * The options to boot with: `live` as given (production passes none, so bootstrap() builds the native ports), or
 * sample mode's, built from it, when sample data was chosen. Either way with the control to switch.
 */
export async function resolveBoot(live: BootstrapOptions, hooks: BootHooks): Promise<BootstrapOptions> {
  const files = liveFilesOf(live);
  const kind = await readDataSource(files);
  const control: DataSourceControl = {
    kind,
    coverage: null,
    async enterSample() {
      await hooks.beforeSwitch();
      const sample = await import("../sample/boot");
      await sample.enterSampleData(files);
      hooks.reboot();
    },
    async exitSample() {
      const sample = await import("../sample/boot");
      await sample.exitSampleData(files);
      hooks.reboot();
    },
  };
  if (kind === "live") return { ...live, dataSource: control };
  const sample = await import("../sample/boot");
  return sample.sampleBootstrapOptions(live, files, control);
}
