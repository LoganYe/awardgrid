import { capabilityMessageKey, type WatchCapabilities } from "@awardgrid/core/workspace/watch-capabilities";
import type { CopyKey } from "@awardgrid/core/workspace/present";

/**
 * What a watch actually does on this platform — the single source of truth for every claim the app
 * and the landing page make about it.
 *
 * `honesty.test.ts` reads this. While `inBackground` is false, no user-visible string in the shell
 * or on the landing page may say that a check happens in the background, so a claim cannot drift
 * away from what is built.
 *
 * Why `inBackground` is false. Verified from `@capacitor/background-runner` 3.0.0's own source — and
 * corrected once already. The first reason recorded here was that a background watch would HAVE to
 * move the seats.aero key out of the Keychain into the plugin's `UserDefaults`-backed store. That is
 * not strictly true: `BackgroundRunner.shared.execute(config:inputArgs:)` is public, so native Swift
 * can read the Keychain item and pass the key to the task in memory. The reasons that do hold:
 *
 *   - Its `Response` exposes no headers (`RunnerEngine/JSResponse.swift`: only ok, status, url,
 *     text, json), so a background watch would spend quota without reading `X-RateLimit-Remaining`,
 *     which PIVOT §2 says to trust over the local counter.
 *   - Its JavaScriptCore context installs no `AbortController` and no `process`
 *     (`RunnerEngine/Context.swift`), and the core uses both (`seatsaero/client.ts`, the cache-TTL
 *     default in `seatsaero/cache.ts`), so the engine would throw before its first request.
 *   - Keeping the key in the Keychain needs native Swift in AppDelegate registering its own task;
 *     the plugin's default path persists to `UserDefaults.standard` (`CapacitorAPI/KV.swift`).
 *   - No background task runs in the Simulator, where this project is verified, so it could not be
 *     tested honestly — and Apple promises no cadence for one anyway.
 */
export const WATCH_CHECKS = {
  /** Checked when the app is opened or returns to the foreground. */
  onOpen: true,
  /** Not built. Flipping this without building it makes the honesty test stop protecting the copy. */
  inBackground: false,
} as const;

/**
 * This platform's watch capabilities, for core's capability sentence (UI/UX v1 T20, A33): checks on open and return,
 * no scheduled checks, no push. Read from WATCH_CHECKS, so the sentence cannot drift from what is built.
 */
export const IOS_WATCH_CAPABILITIES: WatchCapabilities = {
  checkOnForeground: WATCH_CHECKS.onOpen,
  scheduledChecks: WATCH_CHECKS.inBackground,
  pushEnabled: false,
};

/**
 * The approved sentence for iOS: core's key from the capabilities, with iOS's own row ("watch.ios", which also says
 * there are no push alerts) where the capability is foreground only. iOS has no scheduler: were one built, this, the
 * screen and honesty.test.ts change together, so a scheduled sentence is refused here rather than shown.
 */
export function watchCapabilityCopyKey(cap: WatchCapabilities = IOS_WATCH_CAPABILITIES): Extract<CopyKey, "watch.ios" | "watch.unavailable"> {
  const key = capabilityMessageKey(cap);
  if (key === "watch.foreground_only") return "watch.ios";
  if (key === "watch.unavailable") return "watch.unavailable";
  throw new Error(`No iOS sentence for "${key}": iOS has no scheduler.`);
}
